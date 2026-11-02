import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { MemoryRepository } from '../src/repository.js';
import { permissionRoles } from '../src/middleware/permissions.js';

const platformOrganizationId = '00000000-0000-4000-8000-000000000001';
const organizationId = '20000000-0000-4000-8000-000000000001';
const campusId = '30000000-0000-4000-8000-000000000001';

async function setup() {
  const password = randomBytes(24).toString('base64url');
  const repo = new MemoryRepository({
    users: [{
      id: randomUUID(), orgId: organizationId, name: 'School Owner',
      email: `owner-${randomUUID()}@example.test`, passwordHash: await bcrypt.hash(password, 4),
      role: 'owner_director', campusIds: [campusId], activeCampusId: campusId, isActive: true
    }],
    campuses: [{ id: campusId, organizationId, name: 'Test Campus', isActive: true }],
    sections: [], academicYears: []
  });
  const app = createApp({ repo, config: { ...config, NODE_ENV: 'test' } });
  const owner = repo.users[0];
  const login = await request(app).post('/api/auth/login')
    .send({ login: owner.email, password });
  assert.equal(login.status, 200);
  return {
    repo, app, owner, ownerHeaders: { Authorization: `Bearer ${login.body.data.accessToken}` }
  };
}

describe('managed roles and platform users', { concurrency: false }, () => {
  it('uses the database-seeded role matrix and applies permission changes immediately', async () => {
    const { repo, app, owner, ownerHeaders } = await setup();
    for (const [permission, roles] of Object.entries(permissionRoles)) {
      for (const role of roles) {
        assert.ok((await repo.getRolePermissions(organizationId, role)).includes(permission),
          `${role} is missing ${permission}`);
      }
    }

    const accountPassword = randomBytes(24).toString('base64url');
    const account = {
      id: randomUUID(), orgId: organizationId, name: 'Role Test Account',
      email: `role-user-${randomUUID()}@example.test`,
      passwordHash: await bcrypt.hash(accountPassword, 4),
      role: 'principal', campusIds: [campusId], activeCampusId: campusId, isActive: true
    };
    repo.users.push(account);
    const priorLogin = await request(app).post('/api/auth/login')
      .send({ login: account.email, password: accountPassword });
    assert.equal(priorLogin.status, 200);
    const createRole = await request(app).post('/api/roles').set(ownerHeaders)
      .send({ name: 'Limited Records Viewer', permissions: ['account.view'] });
    assert.equal(createRole.status, 201);
    const roleKey = createRole.body.data.key;
    const assigned = await request(app).put(`/api/accounts/${account.id}/role`)
      .set(ownerHeaders).send({ role: roleKey });
    assert.equal(assigned.status, 200);
    const revoked = await request(app).get('/api/auth/me')
      .set({ Authorization: `Bearer ${priorLogin.body.data.accessToken}` });
    assert.equal(revoked.status, 401);
    assert.equal(revoked.body.error.code, 'SESSION_REVOKED');
    const firstLogin = await request(app).post('/api/auth/login')
      .send({ login: account.email, password: 'not-the-account-password' });
    assert.equal(firstLogin.status, 401);

    const userLogin = await request(app).post('/api/auth/login')
      .send({ login: account.email, password: accountPassword });
    assert.equal(userLogin.status, 200);
    const userHeaders = { Authorization: `Bearer ${userLogin.body.data.accessToken}` };
    assert.equal((await request(app).get('/api/auth/me').set(userHeaders)).status, 200);

    const changed = await request(app).put(`/api/roles/${roleKey}/permissions`)
      .set(ownerHeaders).send({ permissions: [] });
    assert.equal(changed.status, 200);
    const deniedAfterChange = await request(app).get('/api/auth/me').set(userHeaders);
    assert.equal(deniedAfterChange.status, 403);
    assert.equal(deniedAfterChange.body.error.code, 'FORBIDDEN');
    assert.deepEqual(await repo.getRolePermissions(organizationId, roleKey), []);
    assert.ok(repo.audit.some((event) => event.action === 'role.created'));
    assert.ok(repo.audit.some((event) => event.action === 'role.permissions_updated'));
    assert.ok(repo.audit.some((event) => event.action === 'user.role_assigned'));
  });

  it('blocks privilege escalation, system-role edits, and cross-school role operations', async () => {
    const { repo, app, ownerHeaders } = await setup();
    const escalation = await request(app).post('/api/roles').set(ownerHeaders)
      .send({ name: 'Platform Grant', permissions: ['platform.manage'] });
    assert.equal(escalation.status, 403);
    assert.equal(escalation.body.error.code, 'PERMISSION_GRANT_FORBIDDEN');

    const systemEdit = await request(app)
      .put('/api/roles/owner_director/permissions').set(ownerHeaders)
      .send({ permissions: [] });
    assert.equal(systemEdit.status, 404);
    assert.equal(systemEdit.body.error.code, 'CUSTOM_ROLE_NOT_FOUND');
    const systemDelete = await request(app).delete('/api/roles/owner_director')
      .set(ownerHeaders);
    assert.equal(systemDelete.status, 404);
    const ownerPermissions = await repo.getRolePermissions(organizationId, 'owner_director');
    for (const permission of [
      'accounts.manage', 'school.branches.manage', 'school.export', 'school.close'
    ]) assert.ok(ownerPermissions.includes(permission), `owner_director lost ${permission}`);

    const principalPassword = randomBytes(24).toString('base64url');
    const principal = {
      id: randomUUID(), orgId: organizationId, name: 'School Principal',
      email: `principal-${randomUUID()}@example.test`,
      passwordHash: await bcrypt.hash(principalPassword, 4), role: 'principal',
      campusIds: [campusId], activeCampusId: campusId, isActive: true
    };
    repo.users.push(principal);
    const principalLogin = await request(app).post('/api/auth/login')
      .send({ login: principal.email, password: principalPassword });
    assert.equal(principalLogin.status, 200);
    const principalHeaders = {
      Authorization: `Bearer ${principalLogin.body.data.accessToken}`
    };
    const unheldGrant = await request(app).post('/api/roles').set(principalHeaders)
      .send({ name: 'Unauthorized school role', permissions: ['school.close'] });
    assert.equal(unheldGrant.status, 403);
    assert.equal(unheldGrant.body.error.code, 'PERMISSION_GRANT_FORBIDDEN');

    const otherOrg = randomUUID();
    const otherRole = { id: randomUUID(), organizationId: otherOrg, key: 'custom_other',
      name: 'Other school role', isSystem: false };
    repo.roles.push(otherRole);
    const otherAccountId = randomUUID();
    repo.users.push({
      id: otherAccountId, orgId: otherOrg, role: otherRole.key,
      email: `outside-${randomUUID()}@example.test`, isActive: true, campusIds: []
    });
    const assignOther = await request(app).put(`/api/accounts/${otherAccountId}/role`)
      .set(ownerHeaders).send({ role: 'owner_director' });
    assert.equal(assignOther.status, 404);
    const readOther = await request(app).get(`/api/accounts/${otherAccountId}/permissions`)
      .set(ownerHeaders);
    assert.equal(readOther.status, 404);
    assert.ok(!repo.audit.some((event) => event.entityId === otherAccountId));
  });

  it('prevents deactivating or demoting the last active school administrator', async () => {
    const { repo, app, owner } = await setup();
    const principalPassword = randomBytes(24).toString('base64url');
    const principal = {
      id: randomUUID(), orgId: organizationId, name: 'School Principal',
      email: `principal-${randomUUID()}@example.test`,
      passwordHash: await bcrypt.hash(principalPassword, 4), role: 'principal',
      campusIds: [campusId], activeCampusId: campusId, isActive: true
    };
    repo.users.push(principal);
    const login = await request(app).post('/api/auth/login')
      .send({ login: principal.email, password: principalPassword });
    assert.equal(login.status, 200);
    const headers = { Authorization: `Bearer ${login.body.data.accessToken}` };

    const deactivate = await request(app).patch(`/api/accounts/${owner.id}/status`)
      .set(headers).send({ isActive: false });
    assert.equal(deactivate.status, 409);
    assert.equal(deactivate.body.error.code, 'SCHOOL_LAST_ADMIN');

    const demote = await request(app).put(`/api/accounts/${owner.id}/role`)
      .set(headers).send({ role: 'principal' });
    assert.equal(demote.status, 409);
    assert.equal(demote.body.error.code, 'SCHOOL_LAST_ADMIN');
    assert.equal(repo.users.find((item) => item.id === owner.id).role, 'owner_director');
    assert.equal(repo.users.find((item) => item.id === owner.id).isActive, true);
  });

  it('manages platform administrators and refuses to deactivate the last active one', async () => {
    const { repo, app } = await setup();
    const password = randomBytes(24).toString('base64url');
    const admin = {
      id: randomUUID(), orgId: platformOrganizationId, name: 'Temporary Platform Admin',
      email: `platform-${randomUUID()}@example.test`, passwordHash: await bcrypt.hash(password, 4),
      role: 'super_admin', campusIds: [], activeCampusId: null, isActive: true
    };
    repo.users.push(admin);
    const login = await request(app).post('/api/auth/login')
      .send({ login: admin.email, password });
    assert.equal(login.status, 200);
    const headers = { Authorization: `Bearer ${login.body.data.accessToken}` };
    const list = await request(app).get('/api/platform/users').set(headers);
    assert.equal(list.status, 200);
    assert.ok(list.body.data.some((user) => user.id === admin.id));
    const protectedLastAdmin = await request(app)
      .patch(`/api/platform/users/${admin.id}/status`).set(headers).send({ isActive: false });
    assert.equal(protectedLastAdmin.status, 409);
    assert.equal(protectedLastAdmin.body.error.code, 'PLATFORM_LAST_ADMIN');

    const invitation = await request(app).post('/api/platform/users/invitations').set(headers)
      .send({ name: 'Second Platform Admin', email: `platform-invite-${randomUUID()}@example.test` });
    assert.equal(invitation.status, 201);
    const invitationToken = new URL(invitation.body.data.invitationUrl).pathname.split('/').pop();
    const accepted = await request(app).post('/api/auth/invitations/accept')
      .send({ token: invitationToken, password: randomBytes(24).toString('base64url') });
    assert.equal(accepted.status, 201);
    const secondId = accepted.body.data.user.id;

    const assigned = await request(app).put(`/api/platform/users/${secondId}/role`)
      .set(headers).send({ role: 'super_admin' });
    assert.equal(assigned.status, 200);

    const legacyUserPassword = randomBytes(24).toString('base64url');
    const legacyUser = {
      id: randomUUID(), orgId: platformOrganizationId, name: 'Legacy Platform User',
      email: `legacy-platform-${randomUUID()}@example.test`,
      passwordHash: await bcrypt.hash(legacyUserPassword, 4),
      role: 'super_admin', campusIds: [], activeCampusId: null, isActive: true
    };
    repo.users.push(legacyUser);
    const legacyLogin = await request(app).post('/api/auth/login')
      .send({ login: legacyUser.email, password: legacyUserPassword });
    assert.equal(legacyLogin.status, 200);
    const legacyHeaders = { Authorization: `Bearer ${legacyLogin.body.data.accessToken}` };
    legacyUser.role = 'legacy_platform_role';
    const changedRole = await request(app).put(`/api/platform/users/${legacyUser.id}/role`)
      .set(headers).send({ role: 'super_admin' });
    assert.equal(changedRole.status, 200);
    const revokedRoleSession = await request(app).get('/api/auth/me').set(legacyHeaders);
    assert.equal(revokedRoleSession.status, 401);
    assert.equal(revokedRoleSession.body.error.code, 'SESSION_REVOKED');

    const updated = await request(app).patch(`/api/platform/users/${secondId}`)
      .set(headers).send({ name: 'Updated Platform Admin' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.name, 'Updated Platform Admin');

    const deactivateLegacy = await request(app)
      .patch(`/api/platform/users/${legacyUser.id}/status`).set(headers)
      .send({ isActive: false });
    assert.equal(deactivateLegacy.status, 200);
    const deactivated = await request(app).patch(`/api/platform/users/${admin.id}/status`)
      .set(headers).send({ isActive: false });
    assert.equal(deactivated.status, 200);
    const remainingAdminLogin = await request(app).post('/api/auth/login')
      .send({ login: invitation.body.data.email, password: 'not-the-generated-password' });
    assert.equal(remainingAdminLogin.status, 401);
    const activeList = await request(app).get('/api/platform/users')
      .set({ Authorization: `Bearer ${accepted.body.data.accessToken}` });
    assert.equal(activeList.status, 200);
    const finalAdminId = activeList.body.data.find((user) => user.id === secondId).id;
    const finalRemoval = await request(app)
      .patch(`/api/platform/users/${finalAdminId}/status`)
      .set({ Authorization: `Bearer ${accepted.body.data.accessToken}` })
      .send({ isActive: false });
    assert.equal(finalRemoval.status, 409);
    assert.equal(finalRemoval.body.error.code, 'PLATFORM_LAST_ADMIN');
    for (const action of ['platform_user.invited', 'platform_user.updated',
      'platform_user.deactivated', 'platform_user.role_assigned']) {
      assert.ok(repo.audit.some((event) => event.action === action), `missing audit event ${action}`);
    }
  });
});
