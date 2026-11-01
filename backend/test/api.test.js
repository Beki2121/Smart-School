import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { generateLicenceKeyPair, issueLicenceDocument } from '../src/licence.js';
import { createRepository, MemoryRepository } from '../src/repository.js';

const campusId = '30000000-0000-4000-8000-000000000001';
const studentOne = '40000000-0000-4000-8000-000000000001';
const studentTwo = '40000000-0000-4000-8000-000000000002';
const studentThree = '40000000-0000-4000-8000-000000000003';
const sectionId = '70000000-0000-4000-8000-000000000001';
const sensitiveDataKey = Buffer.alloc(32, 7).toString('base64url');
let repo;
let app;
let token;

before(async () => {
  repo = await createRepository({
    ...config, STORAGE_MODE: 'memory', SENSITIVE_DATA_KEY: sensitiveDataKey
  });
  app = createApp({
    repo,
    config: {
      ...config,
      NODE_ENV: 'test',
      WEB_ALLOWED_ORIGINS: [...(config.WEB_ALLOWED_ORIGINS ?? []), 'https://school.example.test']
    }
  });
  const response = await request(app).post('/api/auth/login').send({
    login: config.DEMO_LOGIN_EMAIL, password: config.DEMO_LOGIN_PASSWORD
  });
  assert.equal(response.status, 200);
  token = response.body.data.accessToken;
});

describe('SIMS API', { concurrency: false }, () => {
  it('supports generic, expiring, single-use password recovery and revokes existing sessions', async () => {
    const owner = repo.users.find((user) => user.role === 'owner_director');
    const resetUser = {
      id: randomUUID(), orgId: owner.orgId, name: 'Password Reset User',
      email: 'password.reset@example.test', role: 'subject_teacher',
      campusIds: [owner.activeCampusId], activeCampusId: owner.activeCampusId,
      isActive: true, mustChangePassword: false,
      passwordHash: await bcrypt.hash('Initial-Password-2026!', 4)
    };
    repo.users.push(resetUser);
    const messages = [];
    const resetApp = createApp({
      repo, config: { ...config, NODE_ENV: 'test' },
      mailer: { sendPasswordResetEmail: async (message) => messages.push(message) }
    });
    const originalLogin = await request(resetApp).post('/api/auth/login').send({
      login: resetUser.email, password: 'Initial-Password-2026!'
    });
    assert.equal(originalLogin.status, 200);
    const resetCookie = originalLogin.headers['set-cookie'][0];
    const unknownEmail = await request(resetApp).post('/api/auth/password/forgot')
      .send({ email: 'not.registered@example.test' });
    assert.equal(unknownEmail.status, 202);
    assert.match(unknownEmail.body.data.message, /If an active account uses that email/);
    assert.equal(messages.length, 0);

    const requested = await request(resetApp).post('/api/auth/password/forgot')
      .send({ email: resetUser.email });
    assert.equal(requested.status, 202);
    assert.equal(messages.length, 1);
    const token = new URL(messages[0].resetUrl).pathname.split('/').at(-1);
    assert.ok(token);
    const reset = await request(resetApp).post('/api/auth/password/reset').send({
      token, password: 'Reset-Password-2026!', confirmPassword: 'Reset-Password-2026!'
    });
    assert.equal(reset.status, 204);
    assert.equal((await request(resetApp).post('/api/auth/password/reset').send({
      token, password: 'Another-Password-2026!', confirmPassword: 'Another-Password-2026!'
    })).status, 400);
    assert.equal((await request(resetApp).post('/api/auth/refresh').set('Cookie', resetCookie)).status, 401);
    assert.equal((await request(resetApp).get('/api/auth/me')
      .set('Authorization', `Bearer ${originalLogin.body.data.accessToken}`)).status, 401);
    assert.equal((await request(resetApp).post('/api/auth/login').send({
      login: resetUser.email, password: 'Initial-Password-2026!'
    })).status, 401);
    assert.equal((await request(resetApp).post('/api/auth/login').send({
      login: resetUser.email, password: 'Reset-Password-2026!'
    })).status, 200);
    const expiredToken = 'expired-reset-token-'.padEnd(43, 'x');
    const expiredHash = createHash('sha256').update(expiredToken).digest('hex');
    await repo.createPasswordReset(resetUser.email, expiredHash, new Date(Date.now() + 60_000).toISOString());
    repo.passwordResetTokens.get(expiredHash).expiresAt = new Date(Date.now() - 1000).toISOString();
    assert.equal((await request(resetApp).post('/api/auth/password/reset').send({
      token: expiredToken, password: 'Expired-Password-2026!', confirmPassword: 'Expired-Password-2026!'
    })).status, 400);
    assert.ok(repo.audit.some((record) => record.action === 'auth.password_reset_requested' &&
      record.entityId === resetUser.id));
    assert.ok(repo.audit.some((record) => record.action === 'auth.password_reset_completed' &&
      record.entityId === resetUser.id));
  });

  it('revokes reset links on mail failure and limits account management to the school', async () => {
    const owner = repo.users.find((user) => user.role === 'owner_director');
    const managedUser = {
      id: randomUUID(), orgId: owner.orgId, name: 'Managed Account',
      email: 'managed.account@example.test', role: 'subject_teacher',
      campusIds: [owner.activeCampusId], activeCampusId: owner.activeCampusId,
      isActive: true, mustChangePassword: false,
      passwordHash: await bcrypt.hash('Managed-Password-2026!', 4)
    };
    const outsideUser = {
      ...managedUser, id: randomUUID(), orgId: randomUUID(), email: 'outside@example.test'
    };
    repo.users.push(managedUser, outsideUser);
    const failedMailApp = createApp({
      repo, config: { ...config, NODE_ENV: 'test' },
      mailer: { sendPasswordResetEmail: async () => { throw Object.assign(new Error('SMTP failed'), { code: 'SMTP_FAILURE' }); } }
    });
    const baselineTokens = repo.passwordResetTokens.size;
    const deliveryFailure = await request(failedMailApp).post('/api/auth/password/forgot')
      .send({ email: managedUser.email });
    assert.equal(deliveryFailure.status, 202);
    assert.equal(repo.passwordResetTokens.size, baselineTokens);

    const headers = { Authorization: `Bearer ${token}` };
    const listed = await request(app).get('/api/accounts').set(headers);
    assert.equal(listed.status, 200);
    assert.ok(listed.body.data.some((account) => account.id === managedUser.id));
    assert.equal(listed.body.data.some((account) => account.id === outsideUser.id), false);
    const foreignMutation = await request(app).patch(`/api/accounts/${outsideUser.id}/status`)
      .set(headers).send({ isActive: false });
    assert.equal(foreignMutation.status, 404);
    const managedLogin = await request(app).post('/api/auth/login').send({
      login: managedUser.email, password: 'Managed-Password-2026!'
    });
    assert.equal(managedLogin.status, 200);
    const deactivated = await request(app).patch(`/api/accounts/${managedUser.id}/status`)
      .set(headers).send({ isActive: false });
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.data.isActive, false);
    const disabledLogin = await request(app).post('/api/auth/login').send({
      login: managedUser.email, password: 'Managed-Password-2026!'
    });
    assert.equal(disabledLogin.status, 403);
    assert.equal(disabledLogin.body.error.code, 'ACCOUNT_INACTIVE');
    const disabledAccess = jwt.sign({
      orgId: managedUser.orgId, role: managedUser.role,
      campusIds: managedUser.campusIds, activeCampusId: managedUser.activeCampusId
    }, config.JWT_ACCESS_SECRET, {
      subject: managedUser.id, expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    assert.equal((await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${disabledAccess}`)).status, 401);
    assert.equal((await request(app).patch(`/api/accounts/${owner.id}/status`)
      .set(headers).send({ isActive: false })).status, 409);
    const activated = await request(app).patch(`/api/accounts/${managedUser.id}/status`)
      .set(headers).send({ isActive: true });
    assert.equal(activated.status, 200);
    assert.equal(activated.body.data.isActive, true);
    assert.equal((await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${managedLogin.body.data.accessToken}`)).status, 401);
    assert.ok(repo.audit.some((record) => record.action === 'user.deactivated' &&
      record.entityId === managedUser.id));
    assert.ok(repo.audit.some((record) => record.action === 'user.activated' &&
      record.entityId === managedUser.id));
  });

  it('encrypts, scopes, and audits protected student data separately from student profiles', async () => {
    const profile = await request(app).get(`/api/students/${studentOne}`).set('Authorization', `Bearer ${token}`);
    assert.equal(profile.status, 200);
    assert.equal(Object.hasOwn(profile.body.data, 'healthNotes'), false);
    assert.equal(Object.hasOwn(profile.body.data, 'idNumber'), false);
    const students = await request(app).get('/api/students').set('Authorization', `Bearer ${token}`);
    assert.equal(students.status, 200);
    assert.ok(students.body.data.every((item) =>
      !Object.hasOwn(item, 'idNumber') && !Object.hasOwn(item, 'healthNotes') && !Object.hasOwn(item, 'specialNeeds')));

    const saved = await request(app).put(`/api/students/${studentOne}/sensitive-data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        idNumber: 'ET-1234-5678', healthNotes: 'Confidential health note',
        specialNeeds: 'Confidential learning support'
      });
    assert.equal(saved.status, 200);
    assert.equal(saved.headers['cache-control'], 'no-store');
    assert.deepEqual(saved.body.data, {
      idNumber: 'ET-1234-5678', healthNotes: 'Confidential health note',
      specialNeeds: 'Confidential learning support', allergies: null
    });
    const stored = repo.studentSensitive.get(studentOne);
    assert.ok(stored.idNumberEnc.startsWith('v1.'));
    assert.ok(!JSON.stringify(stored).includes('ET-1234-5678'));
    assert.ok(!JSON.stringify(stored).includes('Confidential'));
    assert.equal(stored.idNumberHash.length, 64);
    assert.deepEqual(repo.audit.at(-1).after, { fields: ['idNumber', 'healthNotes', 'specialNeeds'] });

    const revealed = await request(app).get(`/api/students/${studentOne}/sensitive-data`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(revealed.status, 200);
    assert.equal(revealed.headers['cache-control'], 'no-store');
    assert.deepEqual(revealed.body.data, saved.body.data);
    assert.equal(repo.audit.at(-1).action, 'student.sensitive_data_viewed');
    assert.deepEqual(repo.audit.at(-1).after, { fields: ['idNumber', 'healthNotes', 'specialNeeds', 'allergies'] });
    assert.ok(!JSON.stringify(repo.audit).includes('Confidential health note'));

    const teacherToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'subject_teacher',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000002', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const headers = { Authorization: `Bearer ${teacherToken}` };
    assert.equal((await request(app).get(`/api/students/${studentOne}/sensitive-data`).set(headers)).status, 403);
    assert.equal((await request(app).get('/api/alumni').set(headers)).status, 403);
    assert.equal((await request(app).put(`/api/students/${studentOne}/sensitive-data`)
      .set(headers).send({ healthNotes: 'Unauthorized' })).status, 403);
  });

  it('fails safely when protected student data is written without an encryption key', async () => {
    const configuredKey = repo.sensitiveDataKey;
    const previousData = repo.studentSensitive.get(studentOne);
    repo.sensitiveDataKey = '';
    try {
      const response = await request(app).put(`/api/students/${studentOne}/sensitive-data`)
        .set('Authorization', `Bearer ${token}`).send({ healthNotes: 'Must not be stored' });
      assert.equal(response.status, 503);
      assert.equal(response.body.error.code, 'SENSITIVE_DATA_KEY_NOT_CONFIGURED');
      assert.deepEqual(repo.studentSensitive.get(studentOne), previousData);
    } finally {
      repo.sensitiveDataKey = configuredKey;
    }
  });

  it('encrypts emergency contacts and limits access to authorized student-information roles', async () => {
    const created = await request(app).post(`/api/students/${studentOne}/emergency-contacts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Emergency Contact Example', phone: '+251911234567', relationship: 'Aunt', priority: 2 });
    assert.equal(created.status, 201);
    assert.equal(created.headers['cache-control'], 'no-store');
    assert.equal(created.body.data.name, 'Emergency Contact Example');
    assert.equal(created.body.data.phone, '+251911234567');
    const stored = repo.studentEmergencyContacts.find((item) => item.id === created.body.data.id);
    assert.ok(stored.nameEnc.startsWith('v1.'));
    assert.ok(stored.phoneEnc.startsWith('v1.'));
    assert.ok(!JSON.stringify(stored).includes('Emergency Contact Example'));
    assert.ok(!JSON.stringify(stored).includes('+251911234567'));
    assert.deepEqual(repo.audit.at(-1).after, {
      studentId: studentOne, fields: ['name', 'phone', 'relationship', 'priority'], priority: 2
    });

    const listed = await request(app).get(`/api/students/${studentOne}/emergency-contacts`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(listed.status, 200);
    assert.equal(listed.headers['cache-control'], 'no-store');
    assert.equal(listed.body.data[0].name, 'Emergency Contact Example');
    assert.equal(repo.audit.at(-1).action, 'student.emergency_contacts_viewed');
    assert.deepEqual(repo.audit.at(-1).after, { count: 1 });

    const teacherToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'subject_teacher',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000002', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const teacherHeaders = { Authorization: `Bearer ${teacherToken}` };
    assert.equal((await request(app).get(`/api/students/${studentOne}/emergency-contacts`)
      .set(teacherHeaders)).status, 403);
    assert.equal((await request(app).post(`/api/students/${studentOne}/emergency-contacts`)
      .set(teacherHeaders).send({
        name: 'Unauthorized Contact', phone: '+251911000000', relationship: 'Friend'
      })).status, 403);

    const removed = await request(app).delete(
      `/api/students/${studentOne}/emergency-contacts/${created.body.data.id}`
    ).set('Authorization', `Bearer ${token}`);
    assert.equal(removed.status, 204);
    assert.equal(repo.studentEmergencyContacts.some((item) => item.id === created.body.data.id), false);
    assert.equal(repo.audit.at(-1).action, 'student.emergency_contact_removed');
    assert.ok(!JSON.stringify(repo.audit).includes('+251911234567'));
  });

  it('reports health without authentication', async () => {
    const response = await request(app).get('/api/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'ok');
  });

  it('switches owners between branches and provisions a principal in the selected branch', async () => {
    const orgId = randomUUID();
    const homeCampusId = randomUUID();
    const ownerId = randomUUID();
    const branchRepo = new MemoryRepository({
      users: [{
        id: ownerId, orgId, name: 'Branch Owner', email: 'branch.owner@example.test',
        passwordHash: await bcrypt.hash('Branch-Owner-2026!', 4), role: 'owner_director',
        campusIds: [homeCampusId], activeCampusId: homeCampusId, isActive: true
      }],
      campuses: [{
        id: homeCampusId, organizationId: orgId, name: 'Main Branch', isActive: true
      }],
      sections: [], academicYears: []
    });
    branchRepo.subscriptionPlans[0].siteLimit = 2;
    const branchApp = createApp({ repo: branchRepo, config: { ...config, NODE_ENV: 'test' } });
    const login = await request(branchApp).post('/api/auth/login').send({
      login: 'branch.owner@example.test', password: 'Branch-Owner-2026!'
    });
    assert.equal(login.status, 200);
    const originalCookie = login.headers['set-cookie'][0].split(';')[0];
    const ownerHeaders = { Authorization: `Bearer ${login.body.data.accessToken}` };

    const nonOwner = jwt.sign({
      orgId, role: 'principal', campusIds: [homeCampusId], activeCampusId: homeCampusId
    }, config.JWT_ACCESS_SECRET, {
      subject: randomUUID(), expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    assert.equal((await request(branchApp).get('/api/school/branches')
      .set({ Authorization: `Bearer ${nonOwner}` })).status, 403);

    const createdBranch = await request(branchApp).post('/api/school/branches')
      .set(ownerHeaders).send({ name: 'North Branch', address: 'North district' });
    assert.equal(createdBranch.status, 201);
    const branchId = createdBranch.body.data.id;
    assert.deepEqual((await request(branchApp).get('/api/school/branches')
      .set(ownerHeaders)).body.data.map((branch) => branch.id), [homeCampusId, branchId]);
    assert.equal((await request(branchApp).patch(`/api/school/branches/${randomUUID()}`)
      .set(ownerHeaders).send({ name: 'Foreign branch rename' })).status, 404);

    const deniedCrossBranchSwitch = await request(branchApp).post('/api/auth/switch-branch')
      .set(ownerHeaders).set('Cookie', originalCookie).send({ campusId: randomUUID() });
    assert.equal(deniedCrossBranchSwitch.status, 403);
    const switched = await request(branchApp).post('/api/auth/switch-branch')
      .set(ownerHeaders).set('Cookie', originalCookie).send({ campusId: branchId });
    assert.equal(switched.status, 200);
    assert.equal(switched.body.data.user.activeCampusId, branchId);
    const newCookie = switched.headers['set-cookie'][0].split(';')[0];
    assert.notEqual(newCookie, originalCookie);
    assert.equal((await request(branchApp).post('/api/auth/refresh')
      .set('Cookie', originalCookie)).status, 401);
    const branchHeaders = { Authorization: `Bearer ${switched.body.data.accessToken}` };
    assert.equal((await request(branchApp).get('/api/school').set(branchHeaders))
      .body.data.id, branchId);

    const staff = await request(branchApp).post('/api/staff').set(branchHeaders).send({
      givenNameEn: 'Branch', fatherNameEn: 'Principal', grandfatherNameEn: 'Candidate',
      givenNameAm: 'ቅርንጫፍ', fatherNameAm: 'ርዕሰ', grandfatherNameAm: 'መምህር',
      jobTitle: 'Principal', employmentStatus: 'active'
    });
    assert.equal(staff.status, 201);
    const invitation = await request(branchApp).post('/api/account-invitations')
      .set(branchHeaders).send({
        targetType: 'staff', targetId: staff.body.data.id,
        email: 'north.principal@example.test', role: 'principal'
      });
    assert.equal(invitation.status, 201);
    const invitationToken = new URL(invitation.body.data.invitationUrl).pathname.split('/').at(-1);
    const accepted = await request(branchApp).post('/api/auth/invitations/accept')
      .send({ token: invitationToken, password: 'Branch-Principal-2026!' });
    assert.equal(accepted.status, 201);
    assert.equal(accepted.body.data.user.activeCampusId, branchId);
    assert.deepEqual(accepted.body.data.user.campusIds, [branchId]);
    assert.equal((await request(branchApp).get('/api/school/branches')
      .set({ Authorization: `Bearer ${accepted.body.data.accessToken}` })).status, 403);

    const deactivated = await request(branchApp).patch(`/api/school/branches/${branchId}`)
      .set(branchHeaders).send({ isActive: false });
    assert.equal(deactivated.status, 200);
    for (const accessToken of [switched.body.data.accessToken, accepted.body.data.accessToken]) {
      const requestAfterDeactivation = await request(branchApp).get('/api/school')
        .set({ Authorization: `Bearer ${accessToken}` });
      assert.equal(requestAfterDeactivation.status, 401);
      assert.equal(requestAfterDeactivation.body.error.code, 'SESSION_CAMPUS_UNAVAILABLE');
    }
    assert.ok(branchRepo.audit.some((record) => record.action === 'auth.branch_switched'));
  });

  it('allows configured browser origins while rejecting unlisted origins', async () => {
    const allowed = await request(app).get('/api/health').set('Origin', 'https://school.example.test');
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://school.example.test');
    assert.equal(allowed.headers['access-control-allow-credentials'], 'true');

    const denied = await request(app).get('/api/health').set('Origin', 'https://unlisted.example.test');
    assert.equal(denied.status, 200);
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  });

  it('accepts forwarded client IPs from the production reverse proxy', async () => {
    const productionApp = createApp({
      repo,
      config: { ...config, NODE_ENV: 'production' }
    });
    const response = await request(productionApp)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ login: 'proxy-check@example.test', password: 'invalid-password' });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'INVALID_CREDENTIALS');
  });

  it('rejects protected requests without a token', async () => {
    const response = await request(app).get('/api/students');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'AUTH_REQUIRED');
  });

  it('returns only the active campus students', async () => {
    const response = await request(app).get('/api/students').set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 3);
    assert.ok(response.body.data.every((student) => student.campusId === campusId));
  });

  it('lists only active-campus sections for attendance workflows', async () => {
    const response = await request(app).get('/api/sections').set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0].campusId, campusId);
  });

  it('returns the active academic year for the token-scoped campus', async () => {
    const response = await request(app).get('/api/academic-year').set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.labelEc, '2019 E.C.');
  });

  it('ignores a caller-supplied campus id on a validated student write', async () => {
    const response = await request(app).post('/api/students').set('Authorization', `Bearer ${token}`).send({
      campusId: '99999999-9999-4999-8999-999999999999',
      studentNo: 'TEST-100', givenNameAm: 'ሚሊ', fatherNameAm: 'አለሙ',
      grandfatherNameAm: 'አበበ', givenNameEn: 'Mili', fatherNameEn: 'Alemu',
      grandfatherNameEn: 'Abebe', gender: 'female', dateOfBirth: '2013-05-12',
      guardianPhone: '+251911000099', sectionName: 'Grade 7A'
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.body.data.student.campusId, campusId);
    assert.match(response.body.data.credentials.username, /^mili\.alemu\.test\.100\./);
    assert.ok(response.body.data.credentials.temporaryPassword.length >= 20);
    assert.equal(repo.audit.find((event) => event.action === 'student.created' &&
      event.entityId === response.body.data.student.id).after.studentNo, 'TEST-100');
    assert.ok(!JSON.stringify(repo.audit).includes(response.body.data.credentials.temporaryPassword));
  });

  it('creates a student login at registration and requires a password change before portal access', async () => {
    const registration = await request(app).post('/api/students').set('Authorization', 'Bearer ' + token)
      .send({
        studentNo: 'LOGIN-101', givenNameAm: 'ሚሊ', fatherNameAm: 'አለሙ',
        grandfatherNameAm: 'አበበ', givenNameEn: 'Mili', fatherNameEn: 'Alemu',
        grandfatherNameEn: 'Abebe', gender: 'female', sectionName: 'Grade 7A'
      });
    assert.equal(registration.status, 201);
    const { username, temporaryPassword } = registration.body.data.credentials;
    const login = await request(app).post('/api/auth/login')
      .send({ login: username, password: temporaryPassword });
    assert.equal(login.status, 200);
    assert.equal(login.body.data.user.mustChangePassword, true);
    const authorization = { Authorization: `Bearer ${login.body.data.accessToken}` };
    assert.equal((await request(app).get('/api/portal/home').set(authorization)).status, 403);
    assert.equal((await request(app).get('/api/auth/me').set(authorization)).body.data.mustChangePassword, true);
    const changed = await request(app).post('/api/auth/password/change').set(authorization)
      .send({ currentPassword: temporaryPassword, newPassword: 'Student-Private-Password-2026!' });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.data.user.mustChangePassword, false);
    const portal = await request(app).get('/api/portal/home')
      .set({ Authorization: `Bearer ${changed.body.data.accessToken}` });
    assert.equal(portal.status, 200);
    assert.equal(portal.body.data.students[0].student.id, registration.body.data.student.id);
    assert.equal((await request(app).post('/api/auth/login')
      .send({ login: username, password: temporaryPassword })).status, 401);
  });

  it('previews student CSV rows and atomically imports only eligible records', async () => {
    const csv = [
      'studentNo,givenNameAm,fatherNameAm,grandfatherNameAm,givenNameEn,fatherNameEn,grandfatherNameEn,gender,dateOfBirth,guardianPhone,previousSchool,sectionName',
      'BULK-001,ካሌብ,ገብረ,ማርያም,Kaleb,Gebre,Mariam,male,2014-04-04,+251911000010,Sample School,Grade 7A',
      'BULK-002,ካሌብ,ገብረ,ማርያም,Kaleb,Gebre,Mariam,male,2014-04-04,+251911000010,Sample School,Grade 7A',
      'SIMS-001,ሌላ,ሌላ,ሌላ,Other,Name,Person,female,2014-05-05,,Sample School,Grade 7A',
      'BULK-004,ሊያ,ገብረ,ማርያም,Liya,Gebre,Mariam,unknown,2014-06-06,,Sample School,Grade 7A'
    ].join('\r\n');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'text/csv' };
    const beforeCount = repo.students.length;
    const preview = await request(app).post('/api/students/import/preview').set(headers).send(csv);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers['cache-control'], 'no-store');
    assert.equal(preview.body.data.totalRows, 4);
    assert.equal(preview.body.data.eligibleCount, 1);
    assert.equal(preview.body.data.invalidCount, 3);
    assert.equal(preview.body.data.warningCount, 1);
    assert.equal(repo.students.length, beforeCount);

    const imported = await request(app).post('/api/students/import/commit').set(headers).send(csv);
    assert.equal(imported.status, 200);
    assert.equal(imported.headers['cache-control'], 'no-store');
    assert.equal(imported.body.data.createdCount, 1);
    assert.equal(imported.body.data.skippedCount, 3);
    assert.equal(imported.body.data.credentials.length, 1);
    assert.equal(imported.body.data.credentials[0].studentNo, 'BULK-001');
    assert.equal(imported.body.data.credentials[0].temporaryPassword.length, 36);
    assert.equal(repo.students.length, beforeCount + 1);
    assert.equal(repo.students.find((student) => student.studentNo === 'BULK-001').hasPortalAccount, true);
    assert.equal(repo.audit.filter((event) => event.action === 'student.created' &&
      event.after.studentNo === 'BULK-001').length, 1);

    const teacherToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'subject_teacher',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000002', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    assert.equal((await request(app).post('/api/students/import/preview')
      .set({ Authorization: `Bearer ${teacherToken}`, 'Content-Type': 'text/csv' }).send(csv)).status, 403);
    const importedStudent = repo.students.find((student) => student.studentNo === 'BULK-001');
    const importedUserId = importedStudent.userId;
    repo.students.splice(repo.students.indexOf(importedStudent), 1);
    repo.users.splice(repo.users.findIndex((user) => user.id === importedUserId), 1);
    repo.audit = repo.audit.filter((event) =>
      event.entityId !== importedStudent.id && event.entityId !== importedUserId);
  });

  it('validates the full 600-row student import limit and rejects larger files', async () => {
    const header = 'studentNo,givenNameAm,fatherNameAm,grandfatherNameAm,givenNameEn,fatherNameEn,grandfatherNameEn,gender,sectionName';
    const rows = Array.from({ length: 600 }, (_, index) =>
      `CAP-${String(index + 1).padStart(3, '0')},ስም,አባት,አያት,Name${index + 1},Father${index + 1},Family${index + 1},female,Grade 7A`);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'text/csv' };
    const beforeCount = repo.students.length;
    const preview = await request(app).post('/api/students/import/preview').set(headers)
      .send([header, ...rows].join('\r\n'));
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.totalRows, 600);
    assert.equal(preview.body.data.eligibleCount, 600);
    assert.equal(repo.students.length, beforeCount);

    const tooMany = await request(app).post('/api/students/import/preview').set(headers)
      .send([header, ...rows, 'CAP-601,ስም,አባት,አያት,Name601,Father601,Family601,female,Grade 7A'].join('\r\n'));
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.error.code, 'VALIDATION_ERROR');
    assert.equal(repo.students.length, beforeCount);
  });

  it('updates only the token-scoped campus profile and audits the change', async () => {
    const response = await request(app).put('/api/school').set('Authorization', `Bearer ${token}`).send({
      campusId: '99999999-9999-4999-8999-999999999999',
      name: 'Updated Learning Campus', address: 'Addis Ababa', phone: '+251911000000'
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.id, campusId);
    assert.equal(response.body.data.name, 'Updated Learning Campus');
    assert.equal(repo.audit.at(-1).action, 'school.profile_updated');
  });

  it('validates student writes and returns the standard error envelope', async () => {
    const response = await request(app).post('/api/students')
      .set('Authorization', `Bearer ${token}`).send({ studentNo: 'X' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(response.body.error.details));
  });

  it('updates campus-scoped student profiles and manages restricted guardian links', async () => {
    const profile = await request(app).patch(`/api/students/${studentOne}/profile`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dateOfBirth: '2014-04-05', guardianPhone: '+251911234567', previousSchool: 'Blue Nile School' });
    assert.equal(profile.status, 200);
    assert.equal(profile.body.data.dateOfBirth, '2014-04-05');
    assert.equal(profile.body.data.guardianPhone, '+251911234567');
    assert.deepEqual(repo.audit.at(-1).after, { fields: ['dateOfBirth', 'guardianPhone', 'previousSchool'] });

    const initial = await request(app).get(`/api/students/${studentOne}/guardians`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body.data, []);
    const linked = await request(app).post(`/api/students/${studentOne}/guardians`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        givenNameAm: 'ማርያም', fatherNameAm: 'አበበ', grandfatherNameAm: 'ተስፋዬ',
        givenNameEn: 'Mariam', fatherNameEn: 'Abebe', grandfatherNameEn: 'Tesfaye',
        phone: '+251911234567', email: 'mariam@example.test',
        relationship: 'mother', isPrimary: true
      });
    assert.equal(linked.status, 201);
    assert.equal(linked.body.data.isPrimary, true);
    assert.equal(linked.body.data.isVerified, false);
    assert.equal(linked.body.data.canViewResults, false);
    assert.equal(linked.body.data.canViewFees, false);
    assert.equal(repo.audit.at(-1).action, 'student.guardian_linked');
    const listed = await request(app).get(`/api/students/${studentOne}/guardians`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(listed.body.data.length, 1);
    assert.equal(listed.body.data[0].phone, '+251911234567');

    const teacherToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'subject_teacher',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000002', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const teacherHeaders = { Authorization: `Bearer ${teacherToken}` };
    const hiddenContacts = await request(app).get('/api/students').set(teacherHeaders);
    assert.equal(hiddenContacts.status, 200);
    assert.ok(hiddenContacts.body.data.every((student) => student.guardianPhone == null));
    const dashboard = await request(app).get('/api/dashboard').set(teacherHeaders);
    assert.equal(dashboard.status, 200);
    assert.ok(dashboard.body.data.recentStudents.every((student) => student.guardianPhone == null));
    const deniedGuardians = await request(app).get(`/api/students/${studentOne}/guardians`).set(teacherHeaders);
    assert.equal(deniedGuardians.status, 403);
    const deniedEdit = await request(app).patch(`/api/students/${studentOne}/profile`)
      .set(teacherHeaders).send({ previousSchool: 'Unauthorized edit' });
    assert.equal(deniedEdit.status, 403);
    const commendation = await request(app).post(`/api/students/${studentOne}/commendations`)
      .set('Authorization', `Bearer ${token}`).send({
        recordedOn: '2026-10-22', titleEn: 'Helpful classmate', titleAm: 'ደጋፊ የክፍል ጓደኛ',
        descriptionEn: 'Helped organize the class reading corner.',
        descriptionAm: 'የክፍሉን የንባብ ማዕዘን ለማደራጀት ረድቷል።'
      });
    assert.equal(commendation.status, 201);
    assert.equal(commendation.body.data.campusId, campusId);
    assert.equal(repo.audit.at(-1).action, 'student.commendation.created');
    const commendationList = await request(app)
      .get(`/api/students/${studentOne}/commendations`).set('Authorization', `Bearer ${token}`);
    assert.equal(commendationList.status, 200);
    assert.equal(commendationList.body.data[0].titleAm, 'ደጋፊ የክፍል ጓደኛ');
    const deniedCommendations = await request(app)
      .get(`/api/students/${studentOne}/commendations`).set(teacherHeaders);
    assert.equal(deniedCommendations.status, 403);
    const invalidCommendation = await request(app).post(`/api/students/${studentOne}/commendations`)
      .set('Authorization', `Bearer ${token}`).send({
        recordedOn: 'not-a-date', titleEn: 'A', titleAm: 'ሀ', descriptionEn: '', descriptionAm: ''
      });
    assert.equal(invalidCommendation.status, 400);
    const missingStudent = await request(app)
      .get('/api/students/99999999-9999-4999-8999-999999999999/commendations')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(missingStudent.status, 404);

    const removed = await request(app).delete(`/api/students/${studentOne}/guardians/${linked.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(removed.status, 204);
    const afterRemoval = await request(app).get(`/api/students/${studentOne}/guardians`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(afterRemoval.body.data.length, 0);
    assert.equal(repo.audit.at(-1).action, 'student.guardian_unlinked');
  });

  it('rejects a student placement in a section outside the active campus setup', async () => {
    const response = await request(app).post('/api/students').set('Authorization', `Bearer ${token}`).send({
      studentNo: 'TEST-SECTION', givenNameAm: 'ሚሊ', fatherNameAm: 'አለሙ',
      grandfatherNameAm: 'አበበ', givenNameEn: 'Mili', fatherNameEn: 'Alemu',
      grandfatherNameEn: 'Abebe', gender: 'female', sectionName: 'Other Campus Section'
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'CAMPUS_SCOPE_VIOLATION');
  });

  it('records attendance once for an idempotency UUID', async () => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Addis_Ababa', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const body = {
      clientUuid: '5b201d7a-7e5c-4dda-91e5-b5cbf13e79de',
      date: today, sectionId,
      records: [
        { studentId: studentOne, status: 'present' },
        { studentId: studentTwo, status: 'absent' },
        { studentId: studentThree, status: 'late' }
      ]
    };
    const first = await request(app).post('/api/attendance').set('Authorization', `Bearer ${token}`).send(body);
    const replay = await request(app).post('/api/attendance').set('Authorization', `Bearer ${token}`).send(body);
    assert.equal(first.status, 201);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.data.duplicate, true);
    assert.equal((await repo.listAttendance(campusId)).length, 1);
    const details = await request(app).get(`/api/attendance/sessions/${first.body.data.id}`)
      .set('Authorization', 'Bearer ' + token);
    assert.equal(details.status, 200);
    assert.equal(details.body.data.records.length, 3);
    assert.equal(details.body.data.records[0].studentName, 'Sara Abebe Tesfaye');
    const correctionTeacherToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'subject_teacher',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000002', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const teacherHeaders = { Authorization: 'Bearer ' + correctionTeacherToken };
    assert.equal((await request(app).get(`/api/attendance/sessions/${first.body.data.id}`)
      .set(teacherHeaders)).status, 403);
    assert.equal((await request(app).patch(
      `/api/attendance/sessions/${first.body.data.id}/records/${studentTwo}`
    ).set(teacherHeaders).send({ status: 'present', reason: 'Unauthorized correction.' })).status, 403);
    const parentToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'parent_guardian',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000001', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    assert.equal((await request(app).patch(
      `/api/attendance/sessions/${first.body.data.id}/records/${studentTwo}`
    ).set({ Authorization: 'Bearer ' + parentToken })
      .send({ status: 'present', reason: 'Parent attempt.' })).status, 403);
    const corrected = await request(app).patch(
      `/api/attendance/sessions/${first.body.data.id}/records/${studentTwo}`
    ).set('Authorization', 'Bearer ' + token).send({
      status: 'present', reason: 'Teacher verified the learner was in class.'
    });
    assert.equal(corrected.status, 200);
    assert.equal(corrected.body.data.records.find((record) => record.studentId === studentTwo).status, 'present');
    assert.equal(repo.audit.at(-1).action, 'attendance.corrected');
    assert.deepEqual(repo.audit.at(-1).before, { status: 'absent', reason: '' });
    assert.deepEqual(repo.audit.at(-1).after, {
      status: 'present', reason: 'Teacher verified the learner was in class.'
    });
    const noChange = await request(app).patch(
      `/api/attendance/sessions/${first.body.data.id}/records/${studentTwo}`
    ).set('Authorization', 'Bearer ' + token).send({
      status: 'present', reason: 'Still present.'
    });
    assert.equal(noChange.status, 409);
    assert.equal(noChange.body.error.code, 'ATTENDANCE_CORRECTION_NO_CHANGE');
    const missingReason = await request(app).patch(
      `/api/attendance/sessions/${first.body.data.id}/records/${studentThree}`
    ).set('Authorization', 'Bearer ' + token).send({ status: 'present', reason: '  ' });
    assert.equal(missingReason.status, 400);
    const historicalSession = await request(app).post('/api/attendance').set('Authorization', 'Bearer ' + token).send({
      clientUuid: '5b201d7a-7e5c-4dda-91e5-b5cbf13e79df',
      date: '2020-01-01', sectionId,
      records: [
        { studentId: studentTwo, status: 'absent' },
        { studentId: studentThree, status: 'late' }
      ]
    });
    assert.equal(historicalSession.status, 201);
    const lateCorrection = await request(app).patch(
      `/api/attendance/sessions/${historicalSession.body.data.id}/records/${studentTwo}`
    ).set('Authorization', 'Bearer ' + token).send({
      status: 'present', reason: 'Reviewed the signed paper register.'
    });
    assert.equal(lateCorrection.status, 202);
    assert.equal(lateCorrection.body.data.approvalRequired, true);
    assert.equal(lateCorrection.body.data.request.status, 'pending');
    const unchangedHistoricalRecord = await request(app)
      .get(`/api/attendance/sessions/${historicalSession.body.data.id}`)
      .set('Authorization', 'Bearer ' + token);
    assert.equal(unchangedHistoricalRecord.body.data.records
      .find((record) => record.studentId === studentTwo).status, 'absent');
    const duplicateLateCorrection = await request(app).patch(
      `/api/attendance/sessions/${historicalSession.body.data.id}/records/${studentTwo}`
    ).set('Authorization', 'Bearer ' + token).send({
      status: 'present', reason: 'Duplicate late correction.'
    });
    assert.equal(duplicateLateCorrection.status, 409);

    const approverToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'principal',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000093', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const approverHeaders = { Authorization: 'Bearer ' + approverToken };
    const pending = await request(app).get('/api/attendance/correction-requests').set(approverHeaders);
    assert.equal(pending.status, 200);
    assert.ok(pending.body.data.some((item) => item.id === lateCorrection.body.data.request.id));
    assert.equal((await request(app).get('/api/attendance/correction-requests')
      .set(teacherHeaders)).status, 403);
    const selfReview = await request(app).patch(
      `/api/attendance/correction-requests/${lateCorrection.body.data.request.id}`
    ).set('Authorization', 'Bearer ' + token).send({
      decision: 'approved', note: 'Self review attempt.'
    });
    assert.equal(selfReview.status, 409);
    const approvedCorrection = await request(app).patch(
      `/api/attendance/correction-requests/${lateCorrection.body.data.request.id}`
    ).set(approverHeaders).send({ decision: 'approved', note: 'Register evidence checked.' });
    assert.equal(approvedCorrection.status, 200);
    assert.equal(approvedCorrection.body.data.status, 'approved');
    const approvedAttendance = await request(app)
      .get(`/api/attendance/sessions/${historicalSession.body.data.id}`)
      .set(approverHeaders);
    assert.equal(approvedAttendance.body.data.records
      .find((record) => record.studentId === studentTwo).status, 'present');
    assert.ok(repo.audit.some((item) => item.action === 'attendance.correction_approved'));
    const rejectRequest = await request(app).patch(
      `/api/attendance/sessions/${historicalSession.body.data.id}/records/${studentThree}`
    ).set('Authorization', 'Bearer ' + token).send({
      status: 'absent', reason: 'Requesting correction after record review.'
    });
    assert.equal(rejectRequest.status, 202);
    const rejectedCorrection = await request(app).patch(
      `/api/attendance/correction-requests/${rejectRequest.body.data.request.id}`
    ).set(approverHeaders).send({ decision: 'rejected', note: 'Source evidence did not support the change.' });
    assert.equal(rejectedCorrection.status, 200);
    assert.equal(rejectedCorrection.body.data.status, 'rejected');
    const rejectedAttendance = await request(app)
      .get(`/api/attendance/sessions/${historicalSession.body.data.id}`)
      .set(approverHeaders);
    assert.equal(rejectedAttendance.body.data.records
      .find((record) => record.studentId === studentThree).status, 'late');
    assert.ok(repo.audit.some((item) => item.action === 'attendance.correction_rejected'));
    const summary = await request(app).get(`/api/attendance/summary?from=${today}&to=${today}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(summary.status, 200);
    assert.deepEqual(summary.body.data.totals, {
      sessions: 1, records: 3, present: 2, absent: 0, late: 1, excused: 0, attendanceRate: 100
    });
    assert.equal(summary.body.data.bySection[0].sectionName, 'Grade 7A');
    assert.equal(summary.body.data.byDate[0].date, today);
    const invalidRange = await request(app).get('/api/attendance/summary?from=2026-10-23&to=2026-10-22')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(invalidRange.status, 400);
    const tooLong = await request(app).get('/api/attendance/summary?from=2025-10-20&to=2026-10-22')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(tooLong.status, 400);
    const teacherToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'subject_teacher',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000002', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const teacherSummary = await request(app).get(`/api/attendance/summary?from=${today}&to=${today}`)
      .set({ Authorization: `Bearer ${teacherToken}` });
    assert.equal(teacherSummary.status, 200);
    assert.equal(teacherSummary.body.data.totals.records, 0);
  });

  it('rejects cross-campus student IDs and checks role permissions', async () => {
    const body = {
      clientUuid: 'e8d29ef6-337f-4f5b-8eb4-50468378d427',
      date: '2026-10-22', sectionId,
      records: [{ studentId: '99999999-9999-4999-8999-999999999999', status: 'absent' }]
    };
    const denied = await request(app).post('/api/attendance').set('Authorization', `Bearer ${token}`).send(body);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'CAMPUS_SCOPE_VIOLATION');
    const foreignSection = await request(app).post('/api/attendance').set('Authorization', `Bearer ${token}`).send({
      ...body, clientUuid: 'e8d29ef6-337f-4f5b-8eb4-50468378d428',
      sectionId: '99999999-9999-4999-8999-999999999999',
      records: [{ studentId: studentOne, status: 'absent' }]
    });
    assert.equal(foreignSection.status, 403);
    assert.equal(foreignSection.body.error.code, 'CAMPUS_SCOPE_VIOLATION');

    const parentToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'parent_guardian',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000001', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const roleDenied = await request(app).post('/api/attendance')
      .set('Authorization', `Bearer ${parentToken}`).send(body);
    assert.equal(roleDenied.status, 403);
    assert.equal(roleDenied.body.error.code, 'FORBIDDEN');
  });

  it('isolates actual second-campus student records from profile and protected-data routes', async () => {
    const secondCampusId = '30000000-0000-4000-8000-000000000002';
    const secondStudentId = '40000000-0000-4000-8000-000000000099';
    repo.campuses.push({
      id: secondCampusId, organizationId: '20000000-0000-4000-8000-000000000099',
      name: 'Isolated Test Campus', address: '', phone: ''
    });
    repo.students.push({
      id: secondStudentId, campusId: secondCampusId, studentNo: 'OTHER-001',
      givenNameAm: 'ሙከራ', fatherNameAm: 'ተማሪ', grandfatherNameAm: 'ሁለት',
      givenNameEn: 'Test', fatherNameEn: 'Student', grandfatherNameEn: 'Two',
      gender: 'female', sectionName: 'Grade 7A', status: 'enrolled'
    });
    try {
      const list = await request(app).get('/api/students').set('Authorization', `Bearer ${token}`);
      assert.equal(list.status, 200);
      assert.ok(list.body.data.every((student) => student.id !== secondStudentId));
      assert.equal((await request(app).get(`/api/students/${secondStudentId}`)
        .set('Authorization', `Bearer ${token}`)).status, 404);
      assert.equal((await request(app).get(`/api/students/${secondStudentId}/sensitive-data`)
        .set('Authorization', `Bearer ${token}`)).status, 404);
      assert.equal((await request(app).put(`/api/students/${secondStudentId}/sensitive-data`)
        .set('Authorization', `Bearer ${token}`).send({ healthNotes: 'Cross-campus attempt' })).status, 404);
      assert.equal((await request(app).get(`/api/students/${secondStudentId}/emergency-contacts`)
        .set('Authorization', `Bearer ${token}`)).status, 404);
      assert.equal((await request(app).post(`/api/students/${secondStudentId}/emergency-contacts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Cross-campus attempt', phone: '+251911000000', relationship: 'Friend' })).status, 404);
      assert.equal(repo.studentSensitive.has(secondStudentId), false);
      assert.equal(repo.studentEmergencyContacts.some((contact) => contact.studentId === secondStudentId), false);
    } finally {
      repo.students = repo.students.filter((student) => student.id !== secondStudentId);
      repo.campuses = repo.campuses.filter((campus) => campus.id !== secondCampusId);
    }
  });

  it('records a validated mark and does not allow over-max marks', async () => {
    const body = {
      clientUuid: '7e1346e1-cc9d-4e6e-841a-7e5d4b8cebac',
      studentId: studentOne, assessmentName: 'Math Quiz', value: 16, maxValue: 20
    };
    const saved = await request(app).post('/api/marks').set('Authorization', `Bearer ${token}`).send(body);
    assert.equal(saved.status, 201);
    assert.equal(saved.body.data.state, 'draft');
    assert.equal(repo.audit.at(-1).action, 'mark.created');
    const markId = saved.body.data.id;
    const submitted = await request(app).post(`/api/marks/${markId}/submit`)
      .set({ Authorization: 'Bearer ' + token });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.data.state, 'submitted');
    const selfApproved = await request(app).post(`/api/marks/${markId}/approve`)
      .set({ Authorization: 'Bearer ' + token });
    assert.equal(selfApproved.status, 409);
    assert.equal(selfApproved.body.error.code, 'MARK_APPROVER_MUST_DIFFER');
    const principalToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'principal',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000099', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const approved = await request(app).post(`/api/marks/${markId}/approve`)
      .set({ Authorization: 'Bearer ' + principalToken });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.state, 'approved');
    const published = await request(app).post(`/api/marks/${markId}/publish`)
      .set({ Authorization: 'Bearer ' + token });
    assert.equal(published.status, 200);
    assert.equal(published.body.data.state, 'locked');
    assert.ok(repo.portalResults(studentOne).some((item) => item.assessmentName === 'Math Quiz'));
    assert.equal(repo.audit.at(-1).action, 'mark.locked');
    const repeatedPublish = await request(app).post(`/api/marks/${markId}/publish`)
      .set({ Authorization: 'Bearer ' + token });
    assert.equal(repeatedPublish.status, 409);
    assert.equal(repeatedPublish.body.error.code, 'MARK_TRANSITION_INVALID');

    const invalid = await request(app).post('/api/marks').set('Authorization', `Bearer ${token}`).send({
      ...body, clientUuid: '9b7546e1-cc9d-4e6e-841a-7e5d4b8cebac', value: 21
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
    const unsupportedPrecision = await request(app).post('/api/marks')
      .set({ Authorization: 'Bearer ' + token }).send({
        ...body, clientUuid: 'a1754a1e-30f1-4b8b-bd38-f71dc9fa0b5c', value: 16.001
      });
    assert.equal(unsupportedPrecision.status, 400);
  });

  it('exposes the platform console to super admins and validates signed licences', async () => {
    const { privateKey, publicKey } = generateLicenceKeyPair();
    const licence = issueLicenceDocument({
      organization: 'SmartSchool Ethiopia',
      installationId: 'demo-installation-001',
      expiry: '2035-12-31T23:59:59.000Z',
      limits: { maxStudents: 500, maxCampuses: 5 },
      modules: ['academic_setup', 'attendance', 'marks', 'fees'],
      privateKey
    });

    const superAdminToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'super_admin',
      campusIds: [], activeCampusId: null
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000099', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });

    const summary = await request(app).get('/api/platform').set({ Authorization: `Bearer ${superAdminToken}` });
    assert.equal(summary.status, 200);
    assert.equal(summary.body.data.organizationId, '20000000-0000-4000-8000-000000000001');

    const verified = await request(app).post('/api/platform/licence/verify')
      .set({ Authorization: `Bearer ${superAdminToken}` })
      .send({ licence, publicKey: publicKey.export({ type: 'spki', format: 'pem' }) });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.data.valid, true);
    assert.equal(verified.body.data.data.organization, 'SmartSchool Ethiopia');
  });

  it('creates academic-year setup only within the authenticated campus and audits it', async () => {
    const body = {
      campusId: '99999999-9999-4999-8999-999999999999',
      labelEc: '2020 E.C.', startDate: '2027-09-11', endDate: '2028-09-10'
    };
    const created = await request(app).post('/api/academic-years')
      .set({ Authorization: `Bearer ${token}` }).send(body);
    assert.equal(created.status, 201);
    assert.equal(created.body.data.campusId, campusId);
    assert.equal(created.body.data.status, 'planned');
    assert.equal(repo.audit.at(-1).action, 'academic_year.created');
    const duplicate = await request(app).post('/api/academic-years')
      .set({ Authorization: `Bearer ${token}` }).send(body);
    assert.equal(duplicate.status, 409);
    const invalidDates = await request(app).post('/api/academic-years')
      .set({ Authorization: `Bearer ${token}` }).send({
        labelEc: '2021 E.C.', startDate: '2028-09-10', endDate: '2028-09-10'
      });
    assert.equal(invalidDates.status, 400);
  });

  it('creates terms within the active academic year and rejects out-of-range dates', async () => {
    const authHeaders = { Authorization: 'Bearer ' + token };
    const created = await request(app).post('/api/terms')
      .set({ Authorization: `Bearer ${token}` }).send({
        name: 'Term 1', startDate: '2026-09-11', endDate: '2027-01-15'
      });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.isCurrent, true);
    const second = await request(app).post('/api/terms')
      .set(authHeaders).send({
        name: 'Lifecycle term', startDate: '2027-01-16', endDate: '2027-09-10'
      });
    assert.equal(second.status, 201);
    assert.equal(second.body.data.isCurrent, false);
    const changed = await request(app).patch(`/api/terms/${second.body.data.id}/current`)
      .set(authHeaders);
    assert.equal(changed.status, 200);
    assert.equal(changed.body.data.isCurrent, true);
    const terms = await request(app).get('/api/terms').set(authHeaders);
    assert.deepEqual(terms.body.data.filter((term) => term.isCurrent).map((term) => term.id),
      [second.body.data.id]);
    assert.equal(repo.audit.at(-1).action, 'term.current_changed');
    const missingTerm = await request(app)
      .patch('/api/terms/00000000-0000-4000-8000-000000000099/current')
      .set(authHeaders);
    assert.equal(missingTerm.status, 404);
    const invalid = await request(app).post('/api/terms')
      .set({ Authorization: `Bearer ${token}` }).send({
        name: 'Outside', startDate: '2026-09-01', endDate: '2027-01-15'
      });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'TERM_OUTSIDE_ACADEMIC_YEAR');
  });

  it('manages school calendar entries and grade-mapped syllabus units', async () => {
    const headers = { Authorization: 'Bearer ' + token };
    const year = repo.academicYears.find((item) => item.status === 'active');
    const grade = repo.gradeLevels.find((item) => item.campusId === campusId);
    assert.ok(year && grade);
    assert.equal((await request(app).get('/api/school-calendar')).status, 401);
    let mapping = repo.gradeSubjects.find((item) => item.gradeLevelId === grade.id);
    let temporaryMapping = false;
    if (!mapping) {
      const savedMappings = await request(app).put(`/api/grades/${grade.id}/subjects`)
        .set(headers).send({
          subjects: [{
            subjectId: '61000000-0000-4000-8000-000000000001',
            stream: 'all', weeklyPeriods: 5, isRequired: true
          }]
        });
      assert.equal(savedMappings.status, 200);
      [mapping] = savedMappings.body.data;
        temporaryMapping = true;
    }

    const calendarEntry = await request(app).post('/api/school-calendar').set(headers).send({
      academicYearId: year.id, entryType: 'holiday',
      titleEn: 'School holiday', titleAm: 'የትምህርት ቤት በዓል',
      startDate: year.startDate, endDate: year.startDate,
      isNonInstructionalDay: true, notesEn: '', notesAm: ''
    });
    assert.equal(calendarEntry.status, 201);
    assert.equal(calendarEntry.body.data.campusId, campusId);
    const updatedCalendarEntry = await request(app).put(`/api/school-calendar/${calendarEntry.body.data.id}`)
      .set(headers).send({ ...calendarEntry.body.data, titleEn: 'Updated school holiday' });
    assert.equal(updatedCalendarEntry.status, 200);
    assert.equal(updatedCalendarEntry.body.data.titleEn, 'Updated school holiday');
    const calendarRows = await request(app).get('/api/school-calendar')
      .query({ from: year.startDate, to: year.startDate }).set(headers);
    assert.ok(calendarRows.body.data.some((item) =>
      item.id === calendarEntry.body.data.id && item.titleEn === 'Updated school holiday'));
    const invalidCalendarEntry = await request(app).post('/api/school-calendar').set(headers).send({
      entryType: 'event', titleEn: 'Invalid dates', titleAm: 'ቀን ስህተት',
      startDate: year.endDate, endDate: year.startDate, isNonInstructionalDay: false
    });
    assert.equal(invalidCalendarEntry.status, 400);

    const unit = await request(app).post('/api/curriculum/units').set(headers).send({
      academicYearId: year.id, gradeLevelId: grade.id, subjectId: mapping.subjectId,
      stream: mapping.stream, unitNumber: 1, titleEn: 'Foundations', titleAm: 'መሠረቶች',
      learningOutcomesEn: 'Explain foundational concepts.',
      learningOutcomesAm: 'መሠረታዊ ፅንሰ ሀሳቦችን ያብራሩ።',
      plannedStart: year.startDate, plannedEnd: year.startDate
    });
    assert.equal(unit.status, 201);
    assert.equal(unit.body.data.gradeLevelId, grade.id);
    const updatedUnit = await request(app).put(`/api/curriculum/units/${unit.body.data.id}`)
      .set(headers).send({ ...unit.body.data, titleEn: 'Foundations revised' });
    assert.equal(updatedUnit.status, 200);
    assert.equal(updatedUnit.body.data.titleEn, 'Foundations revised');
    const units = await request(app).get('/api/curriculum/units')
      .query({ academicYearId: year.id, gradeLevelId: grade.id }).set(headers);
    assert.ok(units.body.data.some((item) => item.id === unit.body.data.id));
    const removed = await request(app).delete(`/api/curriculum/units/${unit.body.data.id}`).set(headers);
    assert.equal(removed.status, 204);
    assert.equal(repo.audit.at(-1).action, 'curriculum_unit.deleted');
    const deletedCalendarEntry = await request(app)
      .delete(`/api/school-calendar/${calendarEntry.body.data.id}`).set(headers);
    assert.equal(deletedCalendarEntry.status, 204);
    assert.equal(repo.audit.at(-1).action, 'school_calendar_entry.deleted');

    const savedRule = await request(app).put(`/api/grades/${grade.id}/promotion-rule`).set(headers).send({
      minimumAnnualPercent: 65, maximumFailedRequiredSubjects: 1
    });
    assert.equal(savedRule.status, 200);
    assert.equal(savedRule.body.data.minimumAnnualPercent, 65);
    const rules = await request(app).get('/api/promotion-rules').set(headers);
    assert.ok(rules.body.data.some((item) => item.id === savedRule.body.data.id));

    const section = repo.sections.find((item) => item.campusId === campusId);
    const originalCapacity = section.capacity ?? null;
    const enrolledCount = repo.enrolments.filter((item) =>
      item.sectionId === section.id && item.academicYearId === section.academicYearId && item.status === 'active').length;
    const reducedCapacity = await request(app).patch(`/api/sections/${section.id}/capacity`)
      .set(headers).send({ capacity: Math.max(1, enrolledCount) });
    assert.equal(reducedCapacity.status, 200);
    if (enrolledCount > 1) {
      const tooSmall = await request(app).patch(`/api/sections/${section.id}/capacity`)
        .set(headers).send({ capacity: enrolledCount - 1 });
      assert.equal(tooSmall.status, 409);
    }
    const restoredCapacity = await request(app).patch(`/api/sections/${section.id}/capacity`)
      .set(headers).send({ capacity: originalCapacity });
    assert.equal(restoredCapacity.status, 200);
    if (temporaryMapping) {
      repo.gradeSubjects = repo.gradeSubjects.filter((item) => item.id !== mapping.id);
    }
  });

  it('creates supported school grades with editable grade-specific subject defaults', async () => {
    const headers = { Authorization: 'Bearer ' + token };
    const catalog = await request(app).get('/api/curriculum/grades').set(headers);
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.data.length, 12);
    assert.deepEqual(catalog.body.data.map((item) => item.code),
      Array.from({ length: 12 }, (_, index) => `G${index + 1}`));
    assert.ok(catalog.body.data.some((item) => item.code === 'G12'));
    assert.equal(catalog.body.data.some((item) => /KG|COLLEGE|UNIVERSITY|CAMPUS/i.test(item.code)), false);
    const unsupportedGrade = await request(app).post('/api/grades').set(headers).send({ code: 'KG1' });
    assert.equal(unsupportedGrade.status, 409);
    const grade = await request(app).post('/api/grades').set(headers).send({
      code: 'G8', nameEn: 'Custom override', nameAm: 'የተለየ', band: 'secondary', sortOrder: 8
    });
    assert.equal(grade.status, 201);
    assert.equal(grade.body.data.campusId, campusId);
    assert.equal(grade.body.data.nameEn, 'Grade 8');
    const gradeSubjects = await request(app).get(`/api/grades/${grade.body.data.id}/subjects`).set(headers);
    assert.equal(gradeSubjects.status, 200);
    assert.ok(gradeSubjects.body.data.some((item) => item.code === 'MAT'));
    const section = await request(app).post('/api/sections').set(headers).send({
      gradeLevelId: grade.body.data.id, name: 'Grade 8B', capacity: 35
    });
    assert.equal(section.status, 201);
    assert.equal(section.body.data.gradeName, 'Grade 8');
    const subject = await request(app).post('/api/subjects').set(headers).send({
      code: 'EXTRA', nameEn: 'Optional elective', nameAm: 'ተጨማሪ ትምህርት'
    });
    assert.equal(subject.status, 201);
    assert.equal(subject.body.data.campusId, campusId);
    assert.ok((await request(app).get('/api/sections').set(headers)).body.data
      .some((item) => item.id === section.body.data.id));
    assert.ok((await request(app).get('/api/grades').set(headers)).body.data
      .some((item) => item.id === grade.body.data.id));
    assert.ok((await request(app).get('/api/subjects').set(headers)).body.data
      .some((item) => item.id === subject.body.data.id));
  });

  it('requires a Grade 11–12 stream and selects stream-specific subjects', async () => {
    const headers = { Authorization: 'Bearer ' + token };
    const grade = await request(app).post('/api/grades').set(headers).send({ code: 'G11' });
    assert.equal(grade.status, 201);
    const missingStream = await request(app).post('/api/sections').set(headers).send({
      gradeLevelId: grade.body.data.id, name: 'Grade 11A'
    });
    assert.equal(missingStream.status, 409);
    const section = await request(app).post('/api/sections').set(headers).send({
      gradeLevelId: grade.body.data.id, name: 'Grade 11 Natural A', stream: 'natural_science'
    });
    assert.equal(section.status, 201);
    assert.equal(section.body.data.stream, 'natural_science');
    const naturalSubjects = await request(app).get(
      `/api/grades/${grade.body.data.id}/subjects?stream=natural_science`
    ).set(headers);
    assert.equal(naturalSubjects.status, 200);
    assert.ok(naturalSubjects.body.data.some((item) => item.code === 'BIO'));
    assert.equal(naturalSubjects.body.data.some((item) => item.code === 'GEO'), false);
  });

  it('rejects grade codes outside the school curriculum catalog', async () => {
    const response = await request(app).post('/api/grades')
      .set({ Authorization: 'Bearer ' + token }).send({ code: 'UNIVERSITY-Y1' });
    assert.equal(response.status, 409);
  });

  it('confirms campus grading policy and runs the audited report-card approval workflow', async () => {
    const headers = { Authorization: 'Bearer ' + token };
    const terms = await request(app).get('/api/terms').set(headers);
    const term = terms.body.data.find((item) => item.name === 'Term 1');
    const subjects = await request(app).get('/api/subjects').set(headers);
    const subject = subjects.body.data.find((item) => item.code === 'SCI');
    const secondSubject = subjects.body.data.find((item) => item.id !== subject?.id);
    assert.ok(term);
    assert.ok(subject);
    assert.ok(secondSubject);

    const scale = await request(app).put('/api/grading/bands').set(headers).send({
      bands: [
        { code: 'F', nameEn: 'Needs support', nameAm: 'ድጋፍ ያስፈልጋል', minPercent: 0 },
        { code: 'B', nameEn: 'Good', nameAm: 'ጥሩ', minPercent: 70 },
        { code: 'A', nameEn: 'Excellent', nameAm: 'በጣም ጥሩ', minPercent: 85 }
      ]
    });
    assert.equal(scale.status, 200);
    assert.equal(repo.audit.at(-1).action, 'grading_bands.replaced');
    const unconfirmedPolicy = await request(app).get('/api/grading/policy').set(headers);
    assert.equal(unconfirmedPolicy.status, 200);
    assert.equal(unconfirmedPolicy.body.data.confirmedAt, null);

    for (const [clientUuid, assessmentName, value, maxValue] of [
      ['e15b89f4-18d6-4b8b-9b08-000000000001', 'Science test 1', 18, 20],
      ['e15b89f4-18d6-4b8b-9b08-000000000002', 'Science test 2', 5, 10]
    ]) {
      const mark = await request(app).post('/api/marks').set(headers).send({
        clientUuid, studentId: studentOne, assessmentName, value, maxValue,
        termId: term.id, subjectId: subject.id
      });
      assert.equal(mark.status, 201);
      assert.equal(mark.body.data.termId, term.id);
      assert.equal(mark.body.data.subjectId, subject.id);
    }
    const secondSubjectMark = await request(app).post('/api/marks').set(headers).send({
      clientUuid: 'e15b89f4-18d6-4b8b-9b08-000000000003',
      studentId: studentOne, assessmentName: 'Second subject test', value: 50, maxValue: 100,
      termId: term.id, subjectId: secondSubject.id
    });
    assert.equal(secondSubjectMark.status, 201);
    const report = await request(app).get(`/api/report-cards/students/${studentOne}?termId=${term.id}`).set(headers);
    assert.equal(report.status, 200);
    assert.equal(report.body.data.status, 'provisional');
    assert.equal(report.body.data.gradingPolicyConfirmed, false);
    assert.equal(report.body.data.subjects.length, 2);
    assert.equal(report.body.data.subjects.find((item) => item.subjectId === subject.id).assessmentCount, 2);
    assert.equal(report.body.data.subjects.find((item) => item.subjectId === subject.id).percent, 76.67);
    assert.equal(report.body.data.subjects.find((item) => item.subjectId === subject.id).band.code, 'B');
    assert.equal(report.body.data.overallPercent, 56.15);

    const confirmedPolicy = await request(app).put('/api/grading/policy').set(headers)
      .send({ scoringMethod: 'equal_subject_weighted' });
    assert.equal(confirmedPolicy.status, 200);
    assert.equal(confirmedPolicy.body.data.scoringMethod, 'equal_subject_weighted');
    assert.ok(confirmedPolicy.body.data.confirmedAt);
    assert.equal(repo.audit.at(-1).action, 'grading_policy.confirmed');
    const equalWeightedReport = await request(app)
      .get(`/api/report-cards/students/${studentOne}?termId=${term.id}`).set(headers);
    assert.equal(equalWeightedReport.status, 200);
    assert.equal(equalWeightedReport.body.data.scoringMethod, 'equal_subject_weighted');
    assert.equal(equalWeightedReport.body.data.gradingPolicyConfirmed, true);
    assert.equal(equalWeightedReport.body.data.overallPercent, 63.34);

    const summary = await request(app).get(`/api/marks/summary?termId=${term.id}`).set(headers);
    assert.equal(summary.status, 200);
    assert.equal(summary.body.data.status, 'provisional');
    assert.equal(summary.body.data.totals.assessmentCount, 3);
    assert.equal(summary.body.data.totals.students, 1);
    assert.equal(summary.body.data.totals.earnedPoints, 73);
    assert.equal(summary.body.data.totals.possiblePoints, 130);
    assert.equal(summary.body.data.totals.percent, 56.15);
    const subjectSummary = summary.body.data.bySubject.find((item) => item.subjectId === subject.id);
    assert.equal(subjectSummary.assessmentCount, 2);
    assert.equal(subjectSummary.students, 1);
    assert.equal(subjectSummary.percent, 76.67);
    assert.ok(repo.marks.filter((mark) => mark.termId === term.id).every((mark) => mark.state === 'draft'));
    const changedScale = await request(app).put('/api/grading/bands').set(headers).send({
      bands: [
        { code: 'F', nameEn: 'Needs support', nameAm: 'ድጋፍ ያስፈልጋል', minPercent: 0 },
        { code: 'B', nameEn: 'Good', nameAm: 'ጥሩ', minPercent: 70 },
        { code: 'A', nameEn: 'Excellent', nameAm: 'በጣም ጥሩ', minPercent: 85 }
      ]
    });
    assert.equal(changedScale.status, 200);
    assert.equal((await request(app).get('/api/grading/policy').set(headers)).body.data.confirmedAt, null);
    assert.equal(repo.audit.at(-1).action, 'grading_policy.invalidated');
    const reportPolicy = await request(app).put('/api/grading/policy').set(headers)
      .send({ scoringMethod: 'points_weighted' });
    assert.equal(reportPolicy.status, 200);
    const beforeMarksPublished = await request(app).post(`/api/report-cards/students/${studentOne}/drafts`)
      .set(headers).send({ termId: term.id });
    assert.equal(beforeMarksPublished.status, 409);
    assert.equal(beforeMarksPublished.body.error.code, 'REPORT_WORKFLOW_CONFLICT');

    const principalToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'principal',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000096', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const publisherToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'principal',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000095', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const principalHeaders = { Authorization: 'Bearer ' + principalToken };
    const publisherHeaders = { Authorization: 'Bearer ' + publisherToken };
    for (const mark of repo.marks.filter((item) => item.termId === term.id)) {
      assert.equal((await request(app).post(`/api/marks/${mark.id}/submit`).set(headers)).status, 200);
      assert.equal((await request(app).post(`/api/marks/${mark.id}/approve`).set(principalHeaders)).status, 200);
      assert.equal((await request(app).post(`/api/marks/${mark.id}/publish`).set(principalHeaders)).status, 409);
      assert.equal((await request(app).post(`/api/marks/${mark.id}/publish`).set(publisherHeaders)).status, 200);
    }
    const reportDraft = await request(app).post(`/api/report-cards/students/${studentOne}/drafts`)
      .set(headers).send({ termId: term.id });
    assert.equal(reportDraft.status, 201);
    assert.equal(reportDraft.body.data.status, 'draft');
    let reportId = reportDraft.body.data.id;
    const invalidatedDraftScale = await request(app).put('/api/grading/bands').set(headers).send({
      bands: [
        { code: 'F', nameEn: 'Needs support', nameAm: 'ድጋፍ ያስፈልጋል', minPercent: 0 },
        { code: 'B', nameEn: 'Good', nameAm: 'ጥሩ', minPercent: 70 },
        { code: 'A', nameEn: 'Excellent', nameAm: 'በጣም ጥሩ', minPercent: 85 }
      ]
    });
    assert.equal(invalidatedDraftScale.status, 200);
    const staleReportSubmit = await request(app).post(`/api/report-cards/${reportId}/submit`).set(headers);
    assert.equal(staleReportSubmit.status, 409);
    const reconfirmedReportPolicy = await request(app).put('/api/grading/policy').set(headers)
      .send({ scoringMethod: 'points_weighted' });
    assert.equal(reconfirmedReportPolicy.status, 200);
    const refreshedDraft = await request(app).post(`/api/report-cards/students/${studentOne}/drafts`)
      .set(headers).send({ termId: term.id });
    assert.equal(refreshedDraft.status, 201);
    assert.equal(refreshedDraft.body.data.revision, 2);
    reportId = refreshedDraft.body.data.id;
    assert.equal((await request(app).post(`/api/report-cards/${reportId}/submit`).set(headers)).status, 200);
    const selfApprovedReport = await request(app).post(`/api/report-cards/${reportId}/approve`).set(headers);
    assert.equal(selfApprovedReport.status, 409);
    const approvedReport = await request(app).post(`/api/report-cards/${reportId}/approve`).set(principalHeaders);
    assert.equal(approvedReport.status, 200);
    assert.equal(approvedReport.body.data.status, 'approved');
    const selfPublishedReport = await request(app).post(`/api/report-cards/${reportId}/publish`).set(principalHeaders);
    assert.equal(selfPublishedReport.status, 409);
    const publishedReport = await request(app).post(`/api/report-cards/${reportId}/publish`).set(publisherHeaders);
    assert.equal(publishedReport.status, 200);
    assert.equal(publishedReport.body.data.status, 'published');
    const officialReport = await request(app)
      .get(`/api/report-cards/students/${studentOne}?termId=${term.id}`).set(headers);
    assert.equal(officialReport.body.data.workflow.status, 'published');
    assert.equal(officialReport.body.data.workflow.revision, 2);
    const duplicateRevision = await request(app).post(`/api/report-cards/students/${studentOne}/drafts`)
      .set(headers).send({ termId: term.id });
    assert.equal(duplicateRevision.status, 409);
    assert.equal(repo.audit.filter((item) => item.action.startsWith('term_report.')).length, 5);
    const gradingChangeAfterPublish = await request(app).put('/api/grading/bands').set(headers).send({
      bands: [
        { code: 'F', nameEn: 'Needs support', nameAm: 'ድጋፍ ያስፈልጋል', minPercent: 0 },
        { code: 'B', nameEn: 'Good', nameAm: 'ጥሩ', minPercent: 70 },
        { code: 'A', nameEn: 'Excellent', nameAm: 'በጣም ጥሩ', minPercent: 85 }
      ]
    });
    assert.equal(gradingChangeAfterPublish.status, 200);
    assert.equal((await request(app).put('/api/grading/policy').set(headers)
      .send({ scoringMethod: 'equal_subject_weighted' })).status, 200);
    const currentPreviewWithOfficialSnapshot = await request(app)
      .get(`/api/report-cards/students/${studentOne}?termId=${term.id}`).set(headers);
    assert.equal(currentPreviewWithOfficialSnapshot.body.data.overallPercent, 63.34);
    assert.equal(currentPreviewWithOfficialSnapshot.body.data.workflow.status, 'published');
    assert.equal(currentPreviewWithOfficialSnapshot.body.data.workflow.snapshot.overallPercent, 56.15);
    const amendmentDeniedToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'academic_head',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000094', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const markToAmend = repo.marks.find((item) =>
      item.termId === term.id && item.assessmentName === 'Science test 1');
    assert.ok(markToAmend);
    const amendmentEndpoint = `/api/marks/${markToAmend.id}/amend`;
    assert.equal((await request(app).post(amendmentEndpoint)
      .set({ Authorization: 'Bearer ' + amendmentDeniedToken })
      .send({ value: 17, maxValue: 20, reason: 'Correcting a data-entry error' })).status, 403);
    assert.equal((await request(app).post(amendmentEndpoint).set(principalHeaders)
      .send({ value: 17, maxValue: 20, reason: 'bad' })).status, 400);
    const amendment = await request(app).post(amendmentEndpoint).set(principalHeaders)
      .send({ value: 17, maxValue: 20, reason: 'Correcting a data-entry error' });
    assert.equal(amendment.status, 200);
    assert.equal(amendment.body.data.value, 17);
    assert.equal(amendment.body.data.state, 'draft');
    assert.equal(amendment.body.data.approvedBy, null);
    assert.equal(amendment.body.data.publishedBy, null);
    const amendmentAudit = repo.audit.at(-1);
    assert.equal(amendmentAudit.action, 'mark.amended');
    assert.deepEqual(amendmentAudit.before, {
      value: 18, maxValue: 20, state: 'locked',
      approvedBy: '90000000-0000-4000-8000-000000000096',
      publishedBy: '90000000-0000-4000-8000-000000000095'
    });
    assert.deepEqual(amendmentAudit.after, {
      value: 17, maxValue: 20, state: 'draft', reason: 'Correcting a data-entry error'
    });
    const reportAfterAmendment = await request(app)
      .get(`/api/report-cards/students/${studentOne}?termId=${term.id}`).set(headers);
    assert.equal(reportAfterAmendment.body.data.workflow.status, 'published');
    assert.equal(reportAfterAmendment.body.data.workflow.snapshot.overallPercent, 56.15);
    assert.notEqual(
      reportAfterAmendment.body.data.sourceMarkFingerprint,
      reportAfterAmendment.body.data.workflow.snapshot.sourceMarkFingerprint
    );
    const previousPublishedRevision = repo.termReportRevisions.find((item) =>
      item.id === reportAfterAmendment.body.data.workflow.id);
    const previousPublishedSnapshot = JSON.stringify(previousPublishedRevision.snapshot);
    assert.equal((await request(app).post(`/api/marks/${markToAmend.id}/submit`).set(headers)).status, 200);
    assert.equal((await request(app).post(`/api/marks/${markToAmend.id}/approve`).set(principalHeaders)).status, 200);
    assert.equal((await request(app).post(`/api/marks/${markToAmend.id}/publish`).set(publisherHeaders)).status, 200);
    const missingReportReason = await request(app).post(`/api/report-cards/students/${studentOne}/drafts`)
      .set(headers).send({ termId: term.id });
    assert.equal(missingReportReason.status, 400);
    const postCorrectionDraft = await request(app).post(`/api/report-cards/students/${studentOne}/drafts`)
      .set(headers).send({ termId: term.id, amendmentReason: 'Correcting a published mark' });
    assert.equal(postCorrectionDraft.status, 201);
    assert.equal(postCorrectionDraft.body.data.revision, 3);
    assert.equal(postCorrectionDraft.body.data.amendmentReason, 'Correcting a published mark');
    assert.equal(JSON.stringify(previousPublishedRevision.snapshot), previousPublishedSnapshot);
    assert.equal(previousPublishedRevision.status, 'published');
    assert.equal(repo.audit.at(-1).action, 'term_report.draft_created');
    assert.equal(repo.audit.at(-1).after.amendmentReason, 'Correcting a published mark');
    const secondMark = repo.marks.find((item) =>
      item.termId === term.id && item.assessmentName === 'Science test 2');
    const secondAmendment = await request(app).post(`/api/marks/${secondMark.id}/amend`)
      .set(principalHeaders).send({ value: 4, maxValue: 10, reason: 'Correcting another entry' });
    assert.equal(secondAmendment.status, 200);
    const staleDraftSubmit = await request(app)
      .post(`/api/report-cards/${postCorrectionDraft.body.data.id}/submit`).set(headers);
    assert.equal(staleDraftSubmit.status, 409);
    const missingTerm = await request(app)
      .get('/api/marks/summary?termId=00000000-0000-4000-8000-000000000099').set(headers);
    assert.equal(missingTerm.status, 403);
    const invalidTerm = await request(app).get('/api/marks/summary?termId=not-a-uuid').set(headers);
    assert.equal(invalidTerm.status, 400);
    const emptyTerm = await request(app).post('/api/terms').set(headers).send({
      name: 'Term 2', startDate: '2027-01-16', endDate: '2027-02-15'
    });
    assert.equal(emptyTerm.status, 201);
    const emptySummary = await request(app)
      .get(`/api/marks/summary?termId=${emptyTerm.body.data.id}`).set(headers);
    assert.equal(emptySummary.status, 200);
    assert.deepEqual(emptySummary.body.data.totals, {
      assessmentCount: 0, students: 0, earnedPoints: 0, possiblePoints: 0, percent: null
    });
    assert.deepEqual(emptySummary.body.data.bySubject, []);
    const teacherToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'subject_teacher',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000098', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const teacherSummary = await request(app).get(`/api/marks/summary?termId=${term.id}`)
      .set({ Authorization: 'Bearer ' + teacherToken });
    assert.equal(teacherSummary.status, 200);
    assert.equal(teacherSummary.body.data.totals.assessmentCount, 0);
    assert.deepEqual(teacherSummary.body.data.bySubject, []);
    const teacherPolicyUpdate = await request(app).put('/api/grading/policy')
      .set({ Authorization: 'Bearer ' + teacherToken }).send({ scoringMethod: 'points_weighted' });
    assert.equal(teacherPolicyUpdate.status, 403);

    const invalidScale = await request(app).put('/api/grading/bands').set(headers).send({
      bands: [{ code: 'A', nameEn: 'A', nameAm: 'A', minPercent: 50 }]
    });
    assert.equal(invalidScale.status, 400);
    assert.equal(invalidScale.body.error.code, 'VALIDATION_ERROR');
  });

  it('issues campus invoices, accepts partial payments, returns receipts and records immutable reversals', async () => {
    const headers = { Authorization: 'Bearer ' + token };
    const feeItem = await request(app).post('/api/fees/items').set(headers).send({
      code: 'TUITION-TEST', nameEn: 'Term tuition', nameAm: 'የትምህርት ክፍያ',
      amount: 1250.5, currencyCode: 'ETB'
    });
    assert.equal(feeItem.status, 201);
    assert.equal(feeItem.body.data.isActive, true);
    const invoice = await request(app).post('/api/fees/invoices').set(headers).send({
      studentId: studentOne, dueDate: '2026-12-01',
      lines: [{ feeItemId: feeItem.body.data.id, quantity: 2 }]
    });
    assert.equal(invoice.status, 201);
    assert.equal(invoice.body.data.totalAmount, 2501);
    assert.equal(invoice.body.data.balanceDue, 2501);
    assert.equal(invoice.body.data.status, 'issued');
    assert.equal(repo.audit.at(-1).action, 'fee_invoice.issued');
    const noShiftPayment = await request(app).post(`/api/fees/invoices/${invoice.body.data.id}/payments`)
      .set(headers).send({ amount: 100, method: 'cash' });
    assert.equal(noShiftPayment.status, 409);
    assert.equal(noShiftPayment.body.error.code, 'FEE_CONFLICT');
    const openedShift = await request(app).post('/api/fees/shifts').set(headers)
      .send({ openingFloat: 100, currencyCode: 'ETB' });
    assert.equal(openedShift.status, 201);
    assert.equal(openedShift.body.data.status, 'open');
    assert.equal((await request(app).get('/api/fees/shifts/current').set(headers))
      .body.data.id, openedShift.body.data.id);
    const duplicateShift = await request(app).post('/api/fees/shifts').set(headers)
      .send({ openingFloat: 0, currencyCode: 'ETB' });
    assert.equal(duplicateShift.status, 409);

    const firstPayment = await request(app).post(`/api/fees/invoices/${invoice.body.data.id}/payments`)
      .set(headers).send({ amount: 1000, method: 'cash', reference: '' });
    assert.equal(firstPayment.status, 201);
    assert.equal(firstPayment.body.data.balanceDue, 1501);
    assert.match(firstPayment.body.data.receiptNumber, /^RCP-[A-F0-9]{12}$/);
    const receipt = await request(app).get(`/api/fees/receipts/${firstPayment.body.data.receiptNumber}`).set(headers);
    assert.equal(receipt.status, 200);
    assert.equal(receipt.body.data.invoiceNumber, invoice.body.data.invoiceNumber);
    assert.equal(receipt.body.data.invoiceTotal, 2501);

    const overpayment = await request(app).post(`/api/fees/invoices/${invoice.body.data.id}/payments`)
      .set(headers).send({ amount: 1501.01, method: 'bank_transfer', reference: 'BANK-OVERPAY' });
    assert.equal(overpayment.status, 409);
    assert.equal(overpayment.body.error.code, 'FEE_CONFLICT');

    const completed = await request(app).post(`/api/fees/invoices/${invoice.body.data.id}/payments`)
      .set(headers).send({ amount: 1501, method: 'bank_transfer', reference: 'BANK-001' });
    assert.equal(completed.status, 201);
    assert.equal((await request(app).get('/api/fees/invoices').set(headers))
      .body.data.find((item) => item.id === invoice.body.data.id).status, 'paid');

    const reversal = await request(app).post(`/api/fees/payments/${firstPayment.body.data.id}/reversals`)
      .set(headers).send({ amount: 250, reason: 'Corrected duplicate tender entry.' });
    assert.equal(reversal.status, 201);
    assert.equal(reversal.body.data.receiptNumber, null);
    const updated = (await request(app).get('/api/fees/invoices').set(headers))
      .body.data.find((item) => item.id === invoice.body.data.id);
    assert.equal(updated.status, 'partially_paid');
    assert.equal(updated.balanceDue, 250);
    assert.equal(updated.payments.length, 3);
    assert.equal(repo.audit.at(-1).action, 'fee_payment.reversed');

    const excessReversal = await request(app).post(`/api/fees/payments/${firstPayment.body.data.id}/reversals`)
      .set(headers).send({ amount: 751, reason: 'Exceeds original payment.' });
    assert.equal(excessReversal.status, 409);

    const voidCandidate = await request(app).post('/api/fees/invoices').set(headers).send({
      studentId: studentOne, lines: [{ feeItemId: feeItem.body.data.id, quantity: 1 }]
    });
    const voided = await request(app).post(`/api/fees/invoices/${voidCandidate.body.data.id}/void`)
      .set(headers).send({ reason: 'Invoice created for the wrong billing period.' });
    assert.equal(voided.status, 200);
    assert.equal(voided.body.data.status, 'void');
    assert.equal(repo.audit.at(-1).action, 'fee_invoice.voided');
    const voidPayment = await request(app).post(`/api/fees/invoices/${voidCandidate.body.data.id}/payments`)
      .set(headers).send({ amount: 100, method: 'cash' });
    assert.equal(voidPayment.status, 409);

    const paidVoid = await request(app).post(`/api/fees/invoices/${invoice.body.data.id}/void`)
      .set(headers).send({ reason: 'Cannot void after payments.' });
    assert.equal(paidVoid.status, 409);

    const missingExpenseReference = await request(app).post('/api/fees/expenses').set(headers).send({
      category: 'Supplies', description: 'Office supplies', amount: 30,
      currencyCode: 'ETB', method: 'bank_transfer'
    });
    assert.equal(missingExpenseReference.status, 400);
    const expense = await request(app).post('/api/fees/expenses').set(headers).send({
      category: 'Supplies', description: 'Office supplies', amount: 20,
      currencyCode: 'ETB', method: 'cash'
    });
    assert.equal(expense.status, 201);
    assert.equal(expense.body.data.cashierShiftId, openedShift.body.data.id);
    assert.equal(repo.audit.at(-1).action, 'fee_expense.recorded');
    const summary = await request(app).get(
      `/api/fees/summary?from=${openedShift.body.data.recordedOn}&to=${openedShift.body.data.recordedOn}`
    ).set(headers);
    assert.equal(summary.status, 200);
    assert.deepEqual(summary.body.data.totals, [{
      currencyCode: 'ETB', payments: 2501, reversals: 250,
      income: 2251, expenses: 20, net: 2231
    }]);
    const expenses = await request(app).get(
      `/api/fees/expenses?from=${openedShift.body.data.recordedOn}&to=${openedShift.body.data.recordedOn}`
    ).set(headers);
    assert.equal(expenses.body.data.length, 1);
    assert.equal(expenses.body.data[0].id, expense.body.data.id);
    const closeShift = await request(app).post(`/api/fees/shifts/${openedShift.body.data.id}/close`)
      .set(headers).send({ closingCash: 829 });
    assert.equal(closeShift.status, 200);
    assert.equal(closeShift.body.data.expectedCash, 830);
    assert.equal(closeShift.body.data.variance, -1);
    assert.equal(closeShift.body.data.status, 'closed');
    assert.equal(repo.audit.at(-1).action, 'cashier_shift.closed');
    const closedShiftPayment = await request(app).post(`/api/fees/invoices/${voidCandidate.body.data.id}/payments`)
      .set(headers).send({ amount: 1, method: 'cash' });
    assert.equal(closedShiftPayment.status, 409);
  });

  it('publishes bilingual campus announcements and validates the school event calendar', async () => {
    const headers = { Authorization: 'Bearer ' + token };
    const announcement = await request(app).post('/api/communications/announcements')
      .set(headers).send({
        titleEn: 'Parent meeting', titleAm: 'የወላጅ ስብሰባ',
        bodyEn: 'The school meeting is on Friday.', bodyAm: 'የትምህርት ቤቱ ስብሰባ አርብ ይካሄዳል።'
      });
    assert.equal(announcement.status, 201);
    assert.equal(announcement.body.data.campusId, campusId);
    assert.equal(repo.audit.at(-1).action, 'campus_announcement.published');
    const announcements = await request(app).get('/api/communications/announcements').set(headers);
    assert.equal(announcements.status, 200);
    assert.equal(announcements.body.data[0].titleAm, 'የወላጅ ስብሰባ');
    const announcementInbox = await request(app).get('/api/notifications').set(headers);
    assert.equal(announcementInbox.status, 200);
    assert.equal(announcementInbox.body.data.unreadCount, 1);
    assert.equal(announcementInbox.body.data.items[0].titleAm, 'የወላጅ ስብሰባ');
    const markedRead = await request(app)
      .patch(`/api/notifications/${announcementInbox.body.data.items[0].id}/read`).set(headers);
    assert.equal(markedRead.status, 200);
    assert.ok(markedRead.body.data.readAt);
    assert.equal((await request(app).get('/api/notifications').set(headers)).body.data.unreadCount, 0);

    const event = await request(app).post('/api/communications/events').set(headers).send({
      titleEn: 'Science fair', titleAm: 'የሳይንስ አውደ ርዕይ',
      descriptionEn: 'Student projects', descriptionAm: 'የተማሪዎች ፕሮጀክቶች',
      startsOn: '2026-11-14', endsOn: '2026-11-14', startsAt: '09:00',
      endsAt: '12:30', location: 'Main hall'
    });
    assert.equal(event.status, 201);
    assert.equal(event.body.data.startsAt, '09:00');
    assert.equal(repo.audit.at(-1).action, 'campus_event.created');
    const calendar = await request(app).get('/api/communications/events?from=2026-11-01&to=2026-11-30')
      .set(headers);
    assert.equal(calendar.status, 200);
    assert.equal(calendar.body.data.length, 1);
    assert.equal(calendar.body.data[0].location, 'Main hall');
    const eventInbox = await request(app).get('/api/notifications').set(headers);
    assert.equal(eventInbox.body.data.unreadCount, 1);
    assert.equal(eventInbox.body.data.items[0].titleEn, 'Science fair');

    const invalidEvent = await request(app).post('/api/communications/events').set(headers).send({
      titleEn: 'Invalid event', titleAm: 'የተሳሳተ ዝግጅት',
      startsOn: '2026-11-15', endsOn: '2026-11-14',
      startsAt: '12:00', endsAt: '11:00'
    });
    assert.equal(invalidEvent.status, 400);
    assert.equal(invalidEvent.body.error.code, 'VALIDATION_ERROR');
    const teacherToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'subject_teacher',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000002', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const forbidden = await request(app).post('/api/communications/announcements')
      .set({ Authorization: `Bearer ${teacherToken}` }).send({
        titleEn: 'Restricted', titleAm: 'የተከለከለ',
        bodyEn: 'No permission', bodyAm: 'ፈቃድ የለም'
      });
    assert.equal(forbidden.status, 403);
      const otherUserInbox = await request(app).get('/api/notifications')
        .set({ Authorization: `Bearer ${teacherToken}` });
      assert.equal(otherUserInbox.status, 200);
      assert.equal(otherUserInbox.body.data.items.length, 0);
      const otherUserRead = await request(app)
        .patch(`/api/notifications/${eventInbox.body.data.items[0].id}/read`)
        .set({ Authorization: `Bearer ${teacherToken}` });
      assert.equal(otherUserRead.status, 404);
  });

  it('supports staff records, department-scoped assignments, class isolation, leave approval and attendance export', async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const department = await request(app).post('/api/departments').set(headers).send({
      name: 'Science Department', description: 'Science teaching staff'
    });
    assert.equal(department.status, 201);
    const teacherId = 'a0000000-0000-4000-8000-000000000001';
    repo.users.push({
      id: teacherId, orgId: '20000000-0000-4000-8000-000000000001',
      name: 'Teacher Demo', email: 'teacher@school.local', role: 'subject_teacher',
      campusIds: [campusId], activeCampusId: campusId, isActive: true, passwordHash: 'unused'
    });
    const staff = await request(app).post('/api/staff').set(headers).send({
      userId: teacherId, departmentId: department.body.data.id,
      givenNameEn: 'Almaz', fatherNameEn: 'Kebede', grandfatherNameEn: 'Haile',
      givenNameAm: 'አልማዝ', fatherNameAm: 'ከበደ', grandfatherNameAm: 'ኃይሌ',
      jobTitle: 'Science Teacher', qualification: 'BSc', employmentStatus: 'active'
    });
    assert.equal(staff.status, 201);
    assert.equal(staff.body.data.teachingAssignmentCount, 0);
    const secondSection = await request(app).post('/api/sections').set(headers).send({
      gradeLevelId: '60000000-0000-4000-8000-000000000001', name: 'Grade 7B', capacity: 30
    });
    assert.equal(secondSection.status, 201);
    const period = await request(app).post('/api/timetable/periods').set(headers).send({
      shift: 'morning', periodNumber: 3, startsAt: '09:00', endsAt: '09:45'
    });
    assert.equal(period.status, 201);
    const room = await request(app).post('/api/timetable/rooms').set(headers).send({
      name: 'Room 101', capacity: 30
    });
    assert.equal(room.status, 201);
    const otherClassStudentId = 'b0000000-0000-4000-8000-000000000001';
    repo.students.push({
      id: otherClassStudentId, campusId, studentNo: 'OTHER-001',
      givenNameAm: 'ሌላ', fatherNameAm: 'ክፍል', grandfatherNameAm: 'ተማሪ',
      givenNameEn: 'Other', fatherNameEn: 'Class', grandfatherNameEn: 'Student',
      gender: 'other', sectionName: 'Grade 7B', status: 'enrolled'
    });
    const assignment = await request(app).post('/api/teaching-assignments').set(headers).send({
      staffId: staff.body.data.id, sectionId, subjectId: '61000000-0000-4000-8000-000000000001',
      dayOfWeek: 2, periodNumber: 3, roomId: room.body.data.id
    });
    assert.equal(assignment.status, 201);
    assert.equal(assignment.body.data.roomName, 'Room 101');
    const collision = await request(app).post('/api/teaching-assignments').set(headers).send({
      staffId: staff.body.data.id, sectionId: secondSection.body.data.id,
      subjectId: '61000000-0000-4000-8000-000000000001', dayOfWeek: 2, periodNumber: 3
    });
    assert.equal(collision.status, 409);
    assert.equal(collision.body.error.code, 'SCHEDULE_CONFLICT');
    const secondStaff = await request(app).post('/api/staff').set(headers).send({
      givenNameEn: 'Mekdes', fatherNameEn: 'Tesfaye', grandfatherNameEn: 'Abebe',
      givenNameAm: 'መቅደስ', fatherNameAm: 'ተስፋዬ', grandfatherNameAm: 'አበበ',
      jobTitle: 'Science Teacher'
    });
    assert.equal(secondStaff.status, 201);
    const roomCollision = await request(app).post('/api/teaching-assignments').set(headers).send({
      staffId: secondStaff.body.data.id, sectionId: secondSection.body.data.id,
      subjectId: '61000000-0000-4000-8000-000000000001',
      dayOfWeek: 2, periodNumber: 3, roomId: room.body.data.id
    });
    assert.equal(roomCollision.status, 409);
    assert.equal(roomCollision.body.error.code, 'SCHEDULE_CONFLICT');
    const sectionCollision = await request(app).post('/api/teaching-assignments').set(headers).send({
      staffId: secondStaff.body.data.id, sectionId,
      subjectId: '61000000-0000-4000-8000-000000000001', dayOfWeek: 2, periodNumber: 3
    });
    assert.equal(sectionCollision.status, 409);
    assert.equal(sectionCollision.body.error.code, 'SCHEDULE_CONFLICT');
    const teacherToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'subject_teacher',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: teacherId, expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const teacherHeaders = { Authorization: `Bearer ${teacherToken}` };
    const activeYear = repo.academicYears.find((year) => year.status === 'active');
    const lessonPlan = await request(app).post('/api/lesson-plans').set(teacherHeaders).send({
      teachingAssignmentId: assignment.body.data.id, curriculumUnitId: null,
      plannedOn: activeYear.startDate, titleEn: 'Science introduction',
      titleAm: 'የሳይንስ መግቢያ', objectivesEn: 'Describe the topic.',
      objectivesAm: 'ርዕሱን ይግለጹ።', activitiesEn: 'Discuss examples.',
      activitiesAm: 'ምሳሌዎችን ይወያዩ።', resources: 'Textbook'
    });
    assert.equal(lessonPlan.status, 201);
    assert.equal(lessonPlan.body.data.teachingAssignmentId, assignment.body.data.id);
    const teacherLessonPlans = await request(app).get('/api/lesson-plans').set(teacherHeaders);
    assert.ok(teacherLessonPlans.body.data.some((item) => item.id === lessonPlan.body.data.id));
    const completedPlan = await request(app).put(`/api/lesson-plans/${lessonPlan.body.data.id}`)
      .set(teacherHeaders).send({ status: 'completed' });
    assert.equal(completedPlan.status, 200);
    assert.equal(completedPlan.body.data.status, 'completed');
    assert.equal(repo.audit.at(-1).action, 'lesson_plan.updated');
    const ownStaff = await request(app).get('/api/staff').set(teacherHeaders);
    assert.equal(ownStaff.status, 200);
    assert.deepEqual(ownStaff.body.data.map((row) => row.id), [staff.body.data.id]);
    const assignedSections = await request(app).get('/api/sections').set(teacherHeaders);
    assert.deepEqual(assignedSections.body.data.map((row) => row.id), [sectionId]);
    const visibleStudents = await request(app).get('/api/students').set(teacherHeaders);
    assert.equal(visibleStudents.status, 200);
    assert.ok(visibleStudents.body.data.some((student) => student.id === studentOne));
    assert.equal(visibleStudents.body.data.some((student) => student.id === otherClassStudentId), false);
    assert.ok(visibleStudents.body.data.every((student) => student.sectionName === 'Grade 7A'));
    assert.ok(visibleStudents.body.data.every((student) => student.guardianPhone == null));
    const hiddenStudent = await request(app).get(`/api/students/${otherClassStudentId}`).set(teacherHeaders);
    assert.equal(hiddenStudent.status, 404);
    let activeTerms = await repo.listTerms(campusId);
    if (!activeTerms.length) {
      const activeYear = repo.academicYears.find((year) => year.status === 'active');
      const term = await request(app).post('/api/terms').set(headers).send({
        name: 'Teacher scope term',
        startDate: activeYear.startDate, endDate: activeYear.endDate
      });
      assert.equal(term.status, 201);
      activeTerms = await repo.listTerms(campusId);
    }
    const activeTermId = activeTerms[0].id;
    const hiddenReport = await request(app)
      .get(`/api/report-cards/students/${otherClassStudentId}?termId=${activeTermId}`)
      .set(teacherHeaders);
    assert.equal(hiddenReport.status, 403);
    const unauthorizedAttendance = await request(app).post('/api/attendance').set(teacherHeaders).send({
      clientUuid: '30bd7108-70c5-448e-a05d-81c2f63c0f53', date: '2026-10-22',
      sectionId: secondSection.body.data.id, records: [{ studentId: studentOne, status: 'present' }]
    });
    assert.equal(unauthorizedAttendance.status, 403);
    const unauthorizedMark = await request(app).post('/api/marks').set(teacherHeaders).send({
      clientUuid: '30bd7108-70c5-448e-a05d-81c2f63c0f54',
      studentId: otherClassStudentId, assessmentName: 'Science quiz', maxValue: 10, value: 8
    });
    assert.equal(unauthorizedMark.status, 403);
    const ownAttendance = await request(app).post('/api/staff/attendance').set(teacherHeaders).send({
      date: '2026-10-22', status: 'present', clockIn: '08:00'
    });
    assert.equal(ownAttendance.status, 201);
    const leave = await request(app).post('/api/leave-requests').set(teacherHeaders).send({
      startDate: '2026-11-03', endDate: '2026-11-04', reason: 'Family matter'
    });
    assert.equal(leave.status, 201);
    assert.equal(leave.body.data.staffId, staff.body.data.id);
    const approved = await request(app).patch(`/api/leave-requests/${leave.body.data.id}`)
      .set(headers).send({ decision: 'approved', note: 'Approved by HR' });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.status, 'approved');
    const substitute = await request(app).post(`/api/timetable/assignments/${assignment.body.data.id}/substitutions`)
      .set(headers).send({
        substituteStaffId: secondStaff.body.data.id, date: '2026-11-03',
        leaveRequestId: leave.body.data.id, reason: 'Approved leave coverage'
      });
    assert.equal(substitute.status, 201);
    const datedTimetable = await request(app).get('/api/timetable?date=2026-11-03').set(headers);
    assert.ok(datedTimetable.body.data.some((item) =>
      item.id === assignment.body.data.id && item.isSubstitute && item.effectiveStaffId === secondStaff.body.data.id));
    const weeklyTimetable = await request(app).get('/api/timetable').set(headers);
    assert.ok(weeklyTimetable.body.data.some((item) => item.id === assignment.body.data.id && !item.isSubstitute));
    const followingWeek = await request(app).get('/api/timetable?date=2026-11-10').set(headers);
    assert.ok(followingWeek.body.data.some((item) => item.id === assignment.body.data.id && !item.isSubstitute));
    const duplicateReview = await request(app).patch(`/api/leave-requests/${leave.body.data.id}`)
      .set(headers).send({ decision: 'rejected' });
    assert.equal(duplicateReview.status, 409);
    const csv = await request(app).get('/api/staff/attendance.csv').set(headers);
    assert.equal(csv.status, 200);
    assert.match(csv.text, /Staff ID,Name,Department,Date,Status,Clock in,Clock out/);
    assert.match(csv.text, /Almaz Kebede Haile/);
  });

  it('activates a planned year, closes the previous year and audits the transition', async () => {
    const headers = { Authorization: 'Bearer ' + token };
    const years = await request(app).get('/api/academic-years').set(headers);
    const planned = years.body.data.find((year) => year.labelEc === '2020 E.C.');
    assert.ok(planned);
    const activated = await request(app).patch(`/api/academic-years/${planned.id}/activate`).set(headers);
    assert.equal(activated.status, 200);
    assert.equal(activated.body.data.status, 'active');
    assert.equal((await request(app).get('/api/academic-year').set(headers)).body.data.id, planned.id);
    assert.equal(repo.academicYears.find((year) => year.labelEc === '2019 E.C.').status, 'closed');
    assert.equal(repo.audit.at(-1).action, 'academic_year.activated');
    const foreignYear = await request(app).patch('/api/academic-years/99999999-9999-4999-8999-999999999999/activate').set(headers);
    assert.equal(foreignYear.status, 404);
  });

  it('runs the admissions funnel through protected documents, capacity-checked enrolment and student history', async () => {
    const headers = { Authorization: 'Bearer ' + token };
    const section = await request(app).post('/api/sections').set(headers).send({
      gradeLevelId: '60000000-0000-4000-8000-000000000001', name: 'Admissions 7C', capacity: 1
    });
    assert.equal(section.status, 201);
    const body = {
      givenNameAm: 'ሚሊ', fatherNameAm: 'አለሙ', grandfatherNameAm: 'አበበ',
      givenNameEn: 'Mili', fatherNameEn: 'Alemu', grandfatherNameEn: 'Abebe',
      gender: 'female', dateOfBirth: '2015-04-12',
      guardianName: 'Alemu Abebe', guardianPhone: '+251911555010',
      gradeLevelId: '60000000-0000-4000-8000-000000000001', previousSchool: 'Sunrise School'
    };
    const created = await request(app).post('/api/admissions').set(headers).send(body);
    assert.equal(created.status, 201);
    assert.equal(created.body.data.status, 'enquiry');
    assert.equal(created.body.data.documentChecklist.filter((item) => !item.complete).length, 3);
    const duplicate = await request(app).get('/api/admissions/duplicates')
      .set(headers).query({ name: 'Mili Alemu Abebe', dateOfBirth: body.dateOfBirth });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.data[0].id, created.body.data.id);
    const duplicatePhone = await request(app).get('/api/admissions/duplicates')
      .set(headers).query({ guardianPhone: body.guardianPhone });
    assert.equal(duplicatePhone.body.data.length, 1);
    const applied = await request(app).patch(`/api/admissions/${created.body.data.id}/status`)
      .set(headers).send({ status: 'application' });
    assert.equal(applied.body.data.status, 'application');
    const interview = await request(app).post(`/api/admissions/${created.body.data.id}/interview`)
      .set(headers).send({ interviewAt: '2026-11-04T10:00:00.000Z', interviewResult: 'passed' });
    assert.equal(interview.body.data.status, 'interview');
    const accepted = await request(app).patch(`/api/admissions/${created.body.data.id}/status`)
      .set(headers).send({ status: 'accepted', decisionNote: 'Interview passed' });
    assert.equal(accepted.body.data.status, 'accepted');
    const acceptedList = await request(app).get('/api/admissions').set(headers).query({ status: 'accepted' });
    assert.equal(acceptedList.status, 200);
    assert.deepEqual(acceptedList.body.data.map((item) => item.id), [created.body.data.id]);
    const invalidStatus = await request(app).get('/api/admissions').set(headers).query({ status: 'unknown' });
    assert.equal(invalidStatus.status, 400);
    const offer = await request(app).get(`/api/admissions/${created.body.data.id}/offer-letter`).set(headers);
    assert.equal(offer.status, 200);
    assert.match(offer.text, /የመግቢያ/);
    const incomplete = await request(app).post(`/api/admissions/${created.body.data.id}/enrol`)
      .set(headers).send({ sectionId: section.body.data.id });
    assert.equal(incomplete.status, 409);
    const documentBytes = Buffer.from('%PDF-1.4\nSIMS test document');
    let firstDocument;
    for (const type of ['birth_certificate', 'previous_school_report', 'guardian_id']) {
      const uploaded = await request(app).post(`/api/admissions/${created.body.data.id}/documents`)
        .query({ type, name: `${type}.pdf` }).set(headers)
        .set('Content-Type', 'application/pdf').send(documentBytes);
      assert.equal(uploaded.status, 201);
      if (!firstDocument) firstDocument = uploaded.body.data;
    }
    const downloaded = await request(app)
      .get(`/api/admissions/${created.body.data.id}/documents/${firstDocument.id}`).set(headers);
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers['content-type'], 'application/pdf');
    const enrolled = await request(app).post(`/api/admissions/${created.body.data.id}/enrol`)
      .set(headers).send({ sectionId: section.body.data.id, siblingStudentId: studentOne });
    assert.equal(enrolled.status, 201);
    assert.equal(enrolled.headers['cache-control'], 'no-store');
    assert.equal(enrolled.body.data.student.studentNo, 'UPDA-2020-00001');
    assert.equal(enrolled.body.data.student.status, 'enrolled');
    assert.equal(enrolled.body.data.student.hasPortalAccount, true);
    assert.match(enrolled.body.data.credentials.username, /^mili\.alemu\.upda\.2020\.00001\./);
    const second = await request(app).post('/api/admissions').set(headers).send({
      ...body, givenNameEn: 'Liya', guardianPhone: '+251911555011'
    });
    assert.equal(second.status, 201);
    const secondApplied = await request(app).patch(`/api/admissions/${second.body.data.id}/status`)
      .set(headers).send({ status: 'application' });
    assert.equal(secondApplied.status, 200);
    const secondAccepted = await request(app).patch(`/api/admissions/${second.body.data.id}/status`)
      .set(headers).send({ status: 'accepted' });
    assert.equal(secondAccepted.status, 200);
    for (const type of ['birth_certificate', 'previous_school_report', 'guardian_id']) {
      await request(app).post(`/api/admissions/${second.body.data.id}/documents`)
        .query({ type, name: `${type}.pdf` }).set(headers)
        .set('Content-Type', 'application/pdf').send(documentBytes).expect(201);
    }
    const full = await request(app).post(`/api/admissions/${second.body.data.id}/enrol`)
      .set(headers).send({ sectionId: section.body.data.id });
    assert.equal(full.status, 409);
    const withdrawal = await request(app).post(`/api/students/${enrolled.body.data.student.id}/withdraw`)
      .set(headers).send({ reason: 'Family relocation' });
    assert.equal(withdrawal.body.data.status, 'withdrawn');
    const readmission = await request(app).post(`/api/students/${enrolled.body.data.student.id}/readmit`)
      .set(headers).send({ sectionId, reason: 'Family returned' });
    assert.equal(readmission.body.data.status, 'enrolled');
    const transfer = await request(app).post(`/api/students/${enrolled.body.data.student.id}/transfer-out`)
      .set(headers).send({ reason: 'Moved to another region' });
    assert.equal(transfer.body.data.status, 'transferred_out');
    const certificate = await request(app)
      .get(`/api/students/${enrolled.body.data.student.id}/transfer-certificate`).set(headers);
    assert.equal(certificate.status, 200);
    assert.match(certificate.text, /Transfer Certificate/);
    const dashboard = await request(app).get('/api/admissions/dashboard').set(headers);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.data.byStatus.enrolled, 0);
    assert.equal(repo.studentStatusHistory.filter((item) => item.studentId === enrolled.body.data.student.id).length, 4);
  });

  it('records year-by-year enrolment and requires an authorized outcome for progression', async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const currentYear = repo.academicYears.find((year) => year.status === 'active');
    assert.ok(currentYear);
    let currentEnrollment = repo.enrolments.find((item) =>
      item.studentId === studentOne && item.academicYearId === currentYear.id);
    if (!currentEnrollment) {
      currentEnrollment = {
        id: '71000000-0000-4000-8000-000000000001', studentId: studentOne,
        academicYearId: currentYear.id, sectionId, status: 'active',
        enrolledOn: '2026-10-01', leftOn: null, outcome: null
      };
      repo.enrolments.push(currentEnrollment);
    } else Object.assign(currentEnrollment, { status: 'active', leftOn: null, outcome: null });
    const nextYear = {
      id: '50000000-0000-4000-8000-000000000002', campusId,
      labelEc: '2020 E.C.', startDate: '2027-09-11', endDate: '2028-09-10', status: 'planned'
    };
    const nextSection = {
      id: '70000000-0000-4000-8000-000000000002', campusId,
      academicYearId: nextYear.id, name: 'Grade 8A', gradeName: 'Grade 8',
      gradeLevelId: '60000000-0000-4000-8000-000000000002',
      isActive: true, capacity: 30
    };
    const repeatSection = {
      id: '70000000-0000-4000-8000-000000000004', campusId,
      academicYearId: nextYear.id, name: 'Grade 7B', gradeName: 'Grade 7',
      gradeLevelId: '60000000-0000-4000-8000-000000000001',
      isActive: true, capacity: 30
    };
    const gradeTwelveSection = {
      id: '70000000-0000-4000-8000-000000000003', campusId,
      academicYearId: currentYear.id, name: 'Grade 12A', gradeName: 'Grade 12',
      gradeLevelId: '60000000-0000-4000-8000-000000000012',
      isActive: true, capacity: 30
    };
    repo.academicYears.push(nextYear);
    repo.sections.push(nextSection, repeatSection, gradeTwelveSection);
    repo.gradeLevels.push({
      id: nextSection.gradeLevelId, campusId, code: 'G8',
      nameEn: 'Grade 8', nameAm: '8ኛ ክፍል', band: 'primary', sortOrder: 8
    });
    repo.gradeLevels.push({
      id: gradeTwelveSection.gradeLevelId, campusId, code: 'G12',
      nameEn: 'Grade 12', nameAm: '12ኛ ክፍል', band: 'secondary', sortOrder: 12
    });
    const studentTwoEnrollment = repo.enrolments.find((item) =>
      item.studentId === studentTwo && item.academicYearId === currentYear.id);
    if (!studentTwoEnrollment) repo.enrolments.push({
      id: randomUUID(), studentId: studentTwo, academicYearId: currentYear.id,
      sectionId, status: 'active', enrolledOn: '2026-10-01', leftOn: null, outcome: null
    });
    const studentThreeEnrollment = repo.enrolments.find((item) =>
      item.studentId === studentThree && item.academicYearId === currentYear.id);
    if (studentThreeEnrollment) studentThreeEnrollment.sectionId = gradeTwelveSection.id;
    else repo.enrolments.push({
      id: randomUUID(), studentId: studentThree, academicYearId: currentYear.id,
      sectionId: gradeTwelveSection.id, status: 'active',
      enrolledOn: '2026-10-01', leftOn: null, outcome: null
    });
    const sameYearActivation = await request(app)
      .patch(`/api/academic-years/${currentYear.id}/activate`).set(headers);
    assert.equal(sameYearActivation.status, 200);
    assert.equal(currentEnrollment.status, 'active');

    const before = await request(app).get(`/api/students/${studentOne}/enrolments`).set(headers);
    assert.equal(before.status, 200);
    assert.ok(before.body.data.some((item) => item.academicYearId === currentYear.id));

    const activated = await request(app).patch(`/api/academic-years/${nextYear.id}/activate`).set(headers);
    assert.equal(activated.status, 200);
    assert.equal(currentEnrollment.status, 'completed');
    assert.ok(currentEnrollment.leftOn);

    const promoted = await request(app).post(`/api/students/${studentOne}/progression`)
      .set(headers).send({
        outcome: 'promoted', sectionId: nextSection.id,
        reason: 'Approved by academic committee',
        overrideReason: 'Principal approved the documented exception'
      });
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.data.status, 'enrolled');
    assert.equal(promoted.body.data.sectionName, nextSection.name);
    assert.equal(repo.enrolments.find((item) => item.studentId === studentOne && item.academicYearId === nextYear.id).status, 'active');
    assert.equal(currentEnrollment.outcome, 'promoted');

    const repeated = await request(app).post(`/api/students/${studentTwo}/progression`)
      .set(headers).send({ outcome: 'repeated', sectionId: repeatSection.id, reason: 'Retain the current grade' });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.data.status, 'enrolled');
    const duplicate = await request(app).post(`/api/students/${studentOne}/progression`)
      .set(headers).send({ outcome: 'repeated', sectionId: nextSection.id, reason: 'Duplicate should not apply' });
    assert.equal(duplicate.status, 409);

    const graduated = await request(app).post(`/api/students/${studentThree}/progression`)
      .set(headers).send({ outcome: 'graduated', reason: 'Completed final grade requirements' });
    assert.equal(graduated.status, 200);
    assert.equal(graduated.body.data.status, 'graduated');
    assert.equal(repo.enrolments.some((item) => item.studentId === studentThree && item.academicYearId === nextYear.id), false);

    const history = await request(app).get(`/api/students/${studentOne}/enrolments`).set(headers);
    assert.equal(history.status, 200);
    assert.ok(history.body.data.some((item) => item.outcome === 'promoted'));
    const foreign = await request(app).get('/api/students/80000000-0000-4000-8000-000000000001/enrolments')
      .set(headers);
    assert.equal(foreign.status, 404);
  });

  it('rotates the hashed refresh token cookie and rejects reuse', async () => {
    const login = await request(app).post('/api/auth/login').send({
      login: config.DEMO_LOGIN_EMAIL, password: config.DEMO_LOGIN_PASSWORD
    });
    const firstCookie = login.headers['set-cookie'][0].split(';')[0];
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', firstCookie);
    assert.equal(refresh.status, 200);
    assert.notEqual(refresh.headers['set-cookie'][0].split(';')[0], firstCookie);
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', firstCookie);
    assert.equal(replay.status, 401);
  });

  it('creates single-use student invitations and exposes only that student in the portal', async () => {
    const studentId = '40000000-0000-4000-8000-000000000004';
    repo.students.push({
      id: studentId, campusId, studentNo: 'SIMS-004', givenNameAm: 'ሊያ',
      fatherNameAm: 'አለሙ', grandfatherNameAm: 'ተስፋዬ',
      givenNameEn: 'Liya', fatherNameEn: 'Alemu', grandfatherNameEn: 'Tesfaye',
      gender: 'female', sectionName: 'Grade 7A', status: 'enrolled'
    });
    repo.marks.push(
      { id: 'locked-result', studentId, assessmentName: 'Final exam', value: 82, maxValue: 100, state: 'locked' },
      { id: 'draft-result', studentId, assessmentName: 'Draft quiz', value: 95, maxValue: 100, state: 'draft' }
    );
    const reportSnapshot = {
      studentId, termId: 'term-portal', termName: 'Term 1',
      subjects: [{
        subjectId: 'subject-portal', subjectNameEn: 'Science', subjectNameAm: 'ሳይንስ',
        assessmentCount: 1, value: 82, maxValue: 100, percent: 82,
        band: { code: 'B', nameEn: 'Good', nameAm: 'ጥሩ' }
      }],
      totalValue: 82, totalMaxValue: 100, overallPercent: 82,
      overallBand: { code: 'B', nameEn: 'Good', nameAm: 'ጥሩ' },
      status: 'provisional', scoringMethod: 'points_weighted',
      gradingPolicyConfirmed: true, gradingPolicyConfirmedAt: '2026-10-28T00:00:00.000Z',
      sourceMarkFingerprint: 'test-fingerprint'
    };
    repo.termReportRevisions.push(
      { id: 'published-portal-report', campusId, studentId, termId: 'term-portal',
        revision: 1, status: 'published', snapshot: reportSnapshot, publishedAt: '2026-10-28T12:00:00.000Z' },
      { id: 'draft-portal-report', campusId, studentId, termId: 'term-draft',
        revision: 1, status: 'draft', snapshot: { ...reportSnapshot, termId: 'term-draft' },
        publishedAt: null }
    );
    const issued = await request(app).post('/api/account-invitations').set({ Authorization: `Bearer ${token}` })
      .send({ targetType: 'student', targetId: studentId, email: 'liya.student@example.test' });
    assert.equal(issued.status, 201);
    assert.equal(issued.body.data.role, 'student');
    const invitationToken = new URL(issued.body.data.invitationUrl).pathname.split('/').at(-1);
    const details = await request(app).get(`/api/auth/invitations/${invitationToken}`);
    assert.equal(details.status, 200);
    assert.equal(details.body.data.email, 'liya.student@example.test');
    const accepted = await request(app).post('/api/auth/invitations/accept')
      .send({ token: invitationToken, password: 'StudentPortal-2026!' });
    assert.equal(accepted.status, 201);
    assert.equal(accepted.body.data.user.role, 'student');
    const portal = await request(app).get('/api/portal/home')
      .set({ Authorization: `Bearer ${accepted.body.data.accessToken}` });
    assert.equal(portal.status, 200);
    assert.equal(portal.body.data.students.length, 1);
    assert.equal(portal.body.data.students[0].student.id, studentId);
    assert.deepEqual(portal.body.data.students[0].results.map((item) => item.assessmentName), ['Final exam']);
    assert.deepEqual(portal.body.data.students[0].reports.map((item) => ({
      revision: item.revision, termName: item.snapshot.termName
    })), [{ revision: 1, termName: 'Term 1' }]);
    assert.equal((await request(app).get('/api/dashboard')
      .set({ Authorization: `Bearer ${accepted.body.data.accessToken}` })).status, 403);
    assert.equal((await request(app).post('/api/auth/invitations/accept')
      .send({ token: invitationToken, password: 'StudentPortal-2026!' })).status, 404);
  });

  it('requires verified guardians and applies guardian visibility permissions in the portal', async () => {
    const studentId = '40000000-0000-4000-8000-000000000004';
    const linked = await request(app).post(`/api/students/${studentId}/guardians`)
      .set({ Authorization: `Bearer ${token}` })
      .send({
        givenNameAm: 'ማርያም', fatherNameAm: 'አለሙ', grandfatherNameAm: 'ተስፋዬ',
        givenNameEn: 'Mariam', fatherNameEn: 'Alemu', grandfatherNameEn: 'Tesfaye',
        phone: '+251911123456', email: 'mariam.guardian@example.test',
        relationship: 'Parent', isPrimary: true
      });
    assert.equal(linked.status, 201);
    const guardianId = linked.body.data.id;
    const beforeVerification = await request(app).post('/api/account-invitations')
      .set({ Authorization: `Bearer ${token}` })
      .send({ targetType: 'guardian', targetId: guardianId, email: 'mariam.guardian@example.test' });
    assert.equal(beforeVerification.status, 409);
    await request(app).patch(`/api/students/${studentId}/guardians/${guardianId}/access`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ isVerified: true, canViewResults: true, canViewFees: false }).expect(200);
    const emailMismatch = await request(app).post('/api/account-invitations')
      .set({ Authorization: `Bearer ${token}` })
      .send({ targetType: 'guardian', targetId: guardianId, email: 'wrong@example.test' });
    assert.equal(emailMismatch.status, 409);
    const issued = await request(app).post('/api/account-invitations')
      .set({ Authorization: `Bearer ${token}` })
      .send({ targetType: 'guardian', targetId: guardianId, email: 'mariam.guardian@example.test' });
    assert.equal(issued.status, 201);
    const invitationToken = new URL(issued.body.data.invitationUrl).pathname.split('/').at(-1);
    const accepted = await request(app).post('/api/auth/invitations/accept')
      .send({ token: invitationToken, password: 'FamilyPortal-2026!' });
    assert.equal(accepted.status, 201);
    const portal = await request(app).get('/api/portal/home')
      .set({ Authorization: `Bearer ${accepted.body.data.accessToken}` });
    assert.equal(portal.status, 200);
    assert.deepEqual(portal.body.data.students.map((item) => item.student.id), [studentId]);
    assert.equal(portal.body.data.students[0].canViewResults, true);
    assert.equal(portal.body.data.students[0].canViewFees, false);
    assert.equal(portal.body.data.students[0].fees.length, 0);
    repo.termReportRevisions.push({
      id: 'guardian-published-report', campusId, studentId, termId: 'term-guardian',
      revision: 1, status: 'published', publishedAt: '2026-10-28T12:00:00.000Z',
      snapshot: {
        studentId, termId: 'term-guardian', termName: 'Term 1', subjects: [],
        totalValue: 0, totalMaxValue: 0, overallPercent: 0, overallBand: null,
        status: 'provisional', scoringMethod: 'points_weighted',
        gradingPolicyConfirmed: true, gradingPolicyConfirmedAt: '2026-10-28T00:00:00.000Z',
        sourceMarkFingerprint: 'guardian-fingerprint'
      }
    });
    const portalWithReport = await request(app).get('/api/portal/home')
      .set({ Authorization: 'Bearer ' + accepted.body.data.accessToken });
    assert.ok(portalWithReport.body.data.students[0].reports.some((report) =>
      report.snapshot.termId === 'term-guardian'));
    await request(app).patch(`/api/students/${studentId}/guardians/${guardianId}/access`)
      .set({ Authorization: 'Bearer ' + token })
      .send({ isVerified: true, canViewResults: false, canViewFees: false }).expect(200);
    const portalWithoutResultPermission = await request(app).get('/api/portal/home')
      .set({ Authorization: 'Bearer ' + accepted.body.data.accessToken });
    assert.deepEqual(portalWithoutResultPermission.body.data.students[0].reports, []);
    assert.deepEqual(portalWithoutResultPermission.body.data.students[0].results, []);
    repo.attendance.push({
      id: 'guardian-attendance-test', campusId, date: '2026-10-28', sectionId,
      records: [{ studentId, status: 'absent' }]
    });
    const portalWithAttendance = await request(app).get('/api/portal/home')
      .set({ Authorization: 'Bearer ' + accepted.body.data.accessToken })
    assert.deepEqual(portalWithAttendance.body.data.students[0].attendance, [
      { date: '2026-10-28', status: 'absent' }
    ]);
    repo.attendance = repo.attendance.filter((session) => session.id !== 'guardian-attendance-test');
  });

  it('allows the owner to invite every supported staff role and accepts each invitation with the correct campus', async () => {
    const roles = [
      'principal', 'registrar', 'system_admin', 'academic_head', 'homeroom_teacher',
      'subject_teacher', 'hr_admin', 'accountant_cashier', 'counsellor'
    ];
    for (const [index, role] of roles.entries()) {
      const staffId = randomUUID();
      repo.staff.push({
        id: staffId, campusId, userId: null, departmentId: null,
        givenNameEn: `Invited ${role}`, fatherNameEn: 'Staff', grandfatherNameEn: 'Member',
        givenNameAm: 'የተጋበዘ', fatherNameAm: 'ሰራተኛ', grandfatherNameAm: 'አባል',
        jobTitle: 'School staff', qualification: '', employmentStatus: 'active',
        hiredOn: null, archivedAt: null
      });
      const email = `staff.role.${index}@example.test`;
      const issued = await request(app).post('/api/account-invitations')
        .set({ Authorization: 'Bearer ' + token })
        .send({ targetType: 'staff', targetId: staffId, email, role });
      assert.equal(issued.status, 201, `${role} invitation should be allowed`);
      assert.equal(issued.body.data.role, role);
      assert.equal(repo.audit.at(-1).action, 'account_invitation.created');
      const invitationToken = new URL(issued.body.data.invitationUrl).pathname.split('/').at(-1);
      const accepted = await request(app).post('/api/auth/invitations/accept')
        .send({ token: invitationToken, password: 'RoleInvitation-2026!' });
      assert.equal(accepted.status, 201, `${role} invitation should be accepted`);
      assert.equal(accepted.body.data.user.role, role);
      assert.deepEqual(accepted.body.data.user.campusIds, [campusId]);
      assert.equal(accepted.body.data.user.activeCampusId, campusId);
      assert.equal(repo.staff.find((item) => item.id === staffId).userId, accepted.body.data.user.id);
    }
  });

  it('enforces the least-privilege staff invitation matrix and rejects cross-school targets', async () => {
    const roleToken = (role) => jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role,
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: randomUUID(), expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const deniedInvitations = [
      ['system_admin', 'principal'],
      ['system_admin', 'registrar'],
      ['system_admin', 'hr_admin'],
      ['system_admin', 'academic_head'],
      ['principal', 'system_admin'],
      ['registrar', 'academic_head'],
      ['registrar', 'accountant_cashier'],
      ['hr_admin', 'academic_head'],
      ['hr_admin', 'registrar'],
      ['subject_teacher', 'homeroom_teacher']
    ];
    for (const [inviterRole, inviteeRole] of deniedInvitations) {
      const response = await request(app).post('/api/account-invitations')
        .set({ Authorization: 'Bearer ' + roleToken(inviterRole) })
        .send({
          targetType: 'staff', targetId: randomUUID(),
          email: `${inviterRole}.${inviteeRole}@example.test`, role: inviteeRole
        });
      assert.equal(response.status, 403, `${inviterRole} must not invite ${inviteeRole}`);
      if (inviterRole !== 'subject_teacher') {
        assert.equal(response.body.error.code, 'STAFF_ROLE_INVITATION_FORBIDDEN');
      }
    }
    const allowedInvitations = [
        ['system_admin', 'subject_teacher'],
        ['principal', 'academic_head'],
        ['principal', 'registrar'],
        ['principal', 'hr_admin'],
        ['registrar', 'homeroom_teacher'],
        ['hr_admin', 'accountant_cashier']
    ];
    for (const [index, [inviterRole, inviteeRole]] of allowedInvitations.entries()) {
        const staffId = randomUUID();
        repo.staff.push({
          id: staffId, campusId, userId: null, departmentId: null,
          givenNameEn: 'Allowed', fatherNameEn: inviterRole, grandfatherNameEn: 'Invite',
          givenNameAm: 'የተፈቀደ', fatherNameAm: 'ሰራተኛ', grandfatherNameAm: 'ግብዣ',
          jobTitle: 'School staff', qualification: '', employmentStatus: 'active',
          hiredOn: null, archivedAt: null
        });
        const issued = await request(app).post('/api/account-invitations')
          .set({ Authorization: 'Bearer ' + roleToken(inviterRole) })
          .send({
            targetType: 'staff', targetId: staffId,
            email: `allowed.${index}@example.test`, role: inviteeRole
          });
        assert.equal(issued.status, 201, `${inviterRole} may invite ${inviteeRole}`);
    }
    const ownerInvitation = await request(app).post('/api/account-invitations')
      .set({ Authorization: 'Bearer ' + token })
      .send({
        targetType: 'staff', targetId: randomUUID(),
        email: 'owner.cannot.invite.owner@example.test', role: 'owner_director'
      });
    assert.equal(ownerInvitation.status, 403);
    assert.equal(ownerInvitation.body.error.code, 'STAFF_ROLE_INVITATION_FORBIDDEN');

    const foreignOrganizationId = '20000000-0000-4000-8000-000000000099';
    const foreignCampusId = '30000000-0000-4000-8000-000000000099';
    const foreignStaffId = '80000000-0000-4000-8000-000000000099';
    const campusStaffId = randomUUID();
    repo.staff.push({
      id: campusStaffId, campusId, userId: null, departmentId: null,
      givenNameEn: 'Campus', fatherNameEn: 'School', grandfatherNameEn: 'Staff',
      givenNameAm: 'የግቢ', fatherNameAm: 'ትምህርት ቤት', grandfatherNameAm: 'ሰራተኛ',
      jobTitle: 'Teacher', qualification: '', employmentStatus: 'active',
      hiredOn: null, archivedAt: null
    });
    repo.campuses.push({
      id: foreignCampusId, organizationId: foreignOrganizationId,
      name: 'Other School Campus', address: '', phone: ''
    });
    repo.staff.push({
      id: foreignStaffId, campusId: foreignCampusId, userId: null, departmentId: null,
      givenNameEn: 'Foreign', fatherNameEn: 'School', grandfatherNameEn: 'Staff',
      givenNameAm: 'ሌላ', fatherNameAm: 'ትምህርት ቤት', grandfatherNameAm: 'ሰራተኛ',
      jobTitle: 'Teacher', qualification: '', employmentStatus: 'active',
      hiredOn: null, archivedAt: null
    });
    const registrarStaff = await request(app).get('/api/staff')
      .set({ Authorization: 'Bearer ' + roleToken('registrar') });
    assert.equal(registrarStaff.status, 200);
    assert.ok(registrarStaff.body.data.some((item) => item.id === campusStaffId));
    assert.ok(!registrarStaff.body.data.some((item) => item.id === foreignStaffId));
    const foreignInvitation = await request(app).post('/api/account-invitations')
      .set({ Authorization: 'Bearer ' + token })
      .send({
        targetType: 'staff', targetId: foreignStaffId,
        email: 'foreign.school.staff@example.test', role: 'subject_teacher'
      });
    assert.equal(foreignInvitation.status, 409);
    assert.equal(repo.staff.find((item) => item.id === foreignStaffId).userId, null);
  });

  it('links an invited staff login to its campus staff record', async () => {
    const staffId = '80000000-0000-4000-8000-000000000001';
    repo.staff.push({
      id: staffId, campusId, userId: null, departmentId: null,
      givenNameEn: 'Hana', fatherNameEn: 'Bekele', grandfatherNameEn: 'Desta',
      givenNameAm: 'ሀና', fatherNameAm: 'በቀለ', grandfatherNameAm: 'ደስታ',
      jobTitle: 'Mathematics teacher', qualification: 'B.Ed.', employmentStatus: 'active',
      hiredOn: null, archivedAt: null
    });
    const issued = await request(app).post('/api/account-invitations')
      .set({ Authorization: 'Bearer ' + token })
      .send({
        targetType: 'staff', targetId: staffId, email: 'hana.teacher@example.test',
        role: 'subject_teacher'
      });
    assert.equal(issued.status, 201);
    const invitationToken = new URL(issued.body.data.invitationUrl).pathname.split('/').at(-1);
    const accepted = await request(app).post('/api/auth/invitations/accept')
      .send({ token: invitationToken, password: 'TeacherPortal-2026!' });
    assert.equal(accepted.status, 201);
    assert.equal(repo.staff.find((item) => item.id === staffId).userId, accepted.body.data.user.id);
    assert.equal(accepted.body.data.user.role, 'subject_teacher');
  });

  it('rejects terminated staff invitations and invalidates pending invitations when employment ends', async () => {
    const terminatedStaffId = '80000000-0000-4000-8000-000000000002';
    repo.staff.push({
      id: terminatedStaffId, campusId, userId: null, departmentId: null,
      givenNameEn: 'Former', fatherNameEn: 'Staff', grandfatherNameEn: 'Member',
      givenNameAm: 'የቀድሞ', fatherNameAm: 'ሰራተኛ', grandfatherNameAm: 'አባል',
      jobTitle: 'Teacher', qualification: 'B.Ed.', employmentStatus: 'terminated',
      hiredOn: null, archivedAt: null
    });
    const terminatedInvitation = await request(app).post('/api/account-invitations')
      .set('Authorization', 'Bearer ' + token)
      .send({
        targetType: 'staff', targetId: terminatedStaffId, email: 'former.staff@example.test',
        role: 'subject_teacher'
      });
    assert.equal(terminatedInvitation.status, 409);

    const activeStaffId = '80000000-0000-4000-8000-000000000003';
    repo.staff.push({
      id: activeStaffId, campusId, userId: null, departmentId: null,
      givenNameEn: 'Active', fatherNameEn: 'Staff', grandfatherNameEn: 'Member',
      givenNameAm: 'ንቁ', fatherNameAm: 'ሰራተኛ', grandfatherNameAm: 'አባል',
      jobTitle: 'Teacher', qualification: 'B.Ed.', employmentStatus: 'active',
      hiredOn: null, archivedAt: null
    });
    const issued = await request(app).post('/api/account-invitations')
      .set('Authorization', 'Bearer ' + token)
      .send({
        targetType: 'staff', targetId: activeStaffId, email: 'active.staff@example.test',
        role: 'subject_teacher'
      });
    assert.equal(issued.status, 201);
    const invitationToken = new URL(issued.body.data.invitationUrl).pathname.split('/').at(-1);
    repo.staff.find((item) => item.id === activeStaffId).employmentStatus = 'terminated';
    assert.equal((await request(app).get(`/api/auth/invitations/${invitationToken}`)).status, 404);
    assert.equal((await request(app).post('/api/auth/invitations/accept')
      .send({ token: invitationToken, password: 'TeacherPortal-2026!' })).status, 404);
  });

  it('applies the expected hardening headers and refresh-cookie protections', async () => {
    const health = await request(app).get('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.headers['x-powered-by'], undefined);
    assert.ok(health.headers['x-frame-options'] === 'SAMEORIGIN' || /DENY/i.test(health.headers['x-frame-options'] ?? ''));
    const login = await request(app).post('/api/auth/login').send({
      login: config.DEMO_LOGIN_EMAIL, password: config.DEMO_LOGIN_PASSWORD
    });
    const cookie = login.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\/api\/auth/i);
    assert.ok(!/Secure/i.test(cookie));
  });

  it('onboards a school, activates its plan, enforces limits and completes export-first closure', async () => {
    const platformToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'super_admin',
      campusIds: [], activeCampusId: null
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000099', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const platformHeaders = { Authorization: `Bearer ${platformToken}` };
    const credentials = {
      schoolName: 'Northstar Private School',
      ownerName: 'Northstar Owner',
      ownerEmail: 'northstar.owner@example.test',
      ownerPhone: '+251911000099',
      schoolPhone: '+251911000098',
      address: 'Addis Ababa',
      password: 'Northstar-Owner-2026!',
      confirmPassword: 'Northstar-Owner-2026!'
    };
    const mismatchedPassword = await request(app).post('/api/school-registration')
      .send({ ...credentials, confirmPassword: 'Different-Owner-2026!' });
    assert.equal(mismatchedPassword.status, 400);
    const registration = await request(app).post('/api/school-registration').send(credentials);
    assert.equal(registration.status, 201);
    const organizationId = registration.body.data.organizationId;
    assert.equal(registration.body.data.status, 'active');
    assert.equal(registration.body.data.trialEndsAt > new Date().toISOString(), true);
    assert.match(registration.body.data.message, /trial is active/);
    const newOwnerLogin = await request(app).post('/api/auth/login').send({
      login: credentials.ownerEmail, password: credentials.password
    });
    assert.equal(newOwnerLogin.status, 200);
    const newOwner = repo.users.find((user) => user.orgId === organizationId);
    assert.ok(newOwner);
    const newOwnerHeaders = { Authorization: `Bearer ${newOwnerLogin.body.data.accessToken}` };
    assert.equal((await repo.isOrganizationOperational(organizationId)), true);
    assert.equal((await request(app).get('/api/dashboard').set(newOwnerHeaders)).status, 200);
    const invalidPendingOwnerPassword = await request(app).post('/api/auth/login').send({
      login: credentials.ownerEmail, password: 'Definitely-Wrong-Password!'
    });
    assert.equal(invalidPendingOwnerPassword.status, 401);
    assert.equal(invalidPendingOwnerPassword.body.error.code, 'INVALID_CREDENTIALS');

    const schoolList = await request(app).get('/api/platform').set(platformHeaders);
    assert.equal(schoolList.status, 200);
    assert.equal(schoolList.body.data.schools.find((school) =>
      school.id === organizationId).status, 'active');
    assert.equal(schoolList.body.data.organizationId, '20000000-0000-4000-8000-000000000001');
    assert.equal((await request(app).patch('/api/platform/schools/00000000-0000-4000-8000-000000000001/status')
      .set(platformHeaders).send({ status: 'active' })).status, 404);
    assert.equal((await request(app).patch(`/api/platform/schools/${organizationId}/status`)
      .set(platformHeaders).send({ status: 'active' })).status, 200);

    const plan = await request(app).put('/api/platform/subscription-plans/small-school')
      .set(platformHeaders).send({
        name: 'Small School', description: 'One-student capacity test',
        monthlyPrice: 100, currencyCode: 'ETB', trialDays: 30,
        studentLimit: 1, staffLimit: 2, siteLimit: 1,
        modules: ['academic_setup', 'attendance', 'student_information', 'staff'], isActive: true
      });
    assert.equal(plan.status, 200);
    const assigned = await request(app).put(`/api/platform/schools/${organizationId}/plan`)
      .set(platformHeaders).send({ planCode: 'small-school' });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    assert.equal(assigned.body.data.status, 'trialing');
    assert.ok(assigned.body.data.trialEndsAt);
    assert.equal((await request(app).post('/api/auth/login').send({
      login: credentials.ownerEmail, password: credentials.password
    })).status, 200);
    const invoice = await request(app).post(`/api/platform/schools/${organizationId}/invoices`)
      .set(platformHeaders).send({ amount: 100, dueOn: '2026-12-01' });
    assert.equal(invoice.status, 201);
    const payment = await request(app)
      .post(`/api/platform/subscription-invoices/${invoice.body.data.id}/payments`)
      .set(platformHeaders).send({ amount: 100, receivedOn: '2026-11-01', reference: 'BANK-001' });
    assert.equal(payment.status, 201);

    const ownerLogin = await request(app).post('/api/auth/login').send({
      login: credentials.ownerEmail, password: credentials.password
    });
    assert.equal(ownerLogin.status, 200);
    const ownerHeaders = { Authorization: `Bearer ${ownerLogin.body.data.accessToken}` };
    const subscription = await request(app).get('/api/school/subscription').set(ownerHeaders);
    assert.equal(subscription.status, 200);
    assert.equal(subscription.body.data.status, 'active');
    assert.equal(subscription.body.data.plan.code, 'small-school');

    const owner = repo.users.find((user) => user.orgId === organizationId);
    repo.students.push({
      id: 'b0000000-0000-4000-8000-000000000099', campusId: owner.activeCampusId,
      studentNo: 'FULL-001', archivedAt: null
    });
    repo.sections.push({
      id: 'c0000000-0000-4000-8000-000000000099', campusId: owner.activeCampusId,
      name: 'Grade 1A', isActive: true
    });
    const overLimitStudent = await request(app).post('/api/students').set(ownerHeaders).send({
      studentNo: 'FULL-002', givenNameAm: 'ሀ', fatherNameAm: 'ለ', grandfatherNameAm: 'ሐ',
      givenNameEn: 'One', fatherNameEn: 'More', grandfatherNameEn: 'Student',
      gender: 'female', sectionName: 'Grade 1A'
    });
    assert.equal(overLimitStudent.status, 409);
    assert.equal(overLimitStudent.body.error.code, 'PLAN_LIMIT_REACHED');
    repo.staff.push(
      { id: 'd0000000-0000-4000-8000-000000000091', campusId: owner.activeCampusId,
        employmentStatus: 'active', archivedAt: null },
      { id: 'd0000000-0000-4000-8000-000000000092', campusId: owner.activeCampusId,
        employmentStatus: 'active', archivedAt: null }
    );
    const overLimitStaff = await request(app).post('/api/staff').set(ownerHeaders).send({
      givenNameEn: 'One', fatherNameEn: 'More', grandfatherNameEn: 'Staff',
      givenNameAm: 'ሀ', fatherNameAm: 'ለ', grandfatherNameAm: 'ሐ',
      jobTitle: 'Teacher'
    });
    assert.equal(overLimitStaff.status, 409);
    assert.equal(overLimitStaff.body.error.code, 'PLAN_LIMIT_REACHED');

    const closure = await request(app).post('/api/school/closure').set(ownerHeaders)
      .send({ reason: 'The school is closing at the end of the academic year.' });
    assert.equal(closure.status, 202);
    const exportResponse = await request(app).get('/api/school/export').set(ownerHeaders);
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers['content-disposition'], /attachment/);
    assert.equal(exportResponse.body.exportFormatVersion, 1);
    for (const section of ['users', 'campuses', 'academicYears', 'students', 'enrolments',
      'guardians', 'staff', 'attendance', 'marks', 'feeInvoices', 'feePayments',
      'admissions', 'admissionDocuments', 'auditLog', 'subscriptions']) {
      assert.ok(Array.isArray(exportResponse.body[section]), `Missing export section: ${section}`);
    }
    assert.ok(!Object.hasOwn(exportResponse.body.users[0], 'passwordHash'));
    assert.match(exportResponse.body.securityNotice, /refresh tokens/);
    const closures = await request(app).get('/api/platform/closures').set(platformHeaders);
    assert.equal(closures.status, 200);
    const exportedClosure = closures.body.data.find((item) => item.id === closure.body.data.id);
    assert.equal(exportedClosure.status, 'exported');
    const approved = await request(app).post(`/api/platform/closures/${closure.body.data.id}/approve`)
      .set(platformHeaders).send({ retentionDays: 90, financialRetentionDays: 2555 });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.status, 'retention');
    assert.ok(approved.body.data.financialRetentionUntil);
    const closedSchoolAccess = await request(app).get('/api/dashboard').set(ownerHeaders);
    assert.equal(closedSchoolAccess.status, 401);
    assert.equal(closedSchoolAccess.body.error.code, 'SESSION_CAMPUS_UNAVAILABLE');
    assert.equal((await request(app).post('/api/auth/refresh')
      .set('Cookie', ownerLogin.headers['set-cookie'][0])).status, 403);
    assert.ok(repo.audit.some((record) => record.action === 'school.closure_approved' &&
      record.entityId === closure.body.data.id));
    const activeSchoolStudent = repo.students.find((student) =>
      student.campusId === owner.activeCampusId);
    const demoStudentBefore = repo.students.find((student) =>
      student.id === '40000000-0000-4000-8000-000000000001');
    assert.equal((await request(app).post(`/api/platform/closures/${closure.body.data.id}/pseudonymize`)
      .set(platformHeaders).send({ confirmation: 'PSEUDONYMIZE' })).status, 409);
    repo.closureRequests.find((item) => item.id === closure.body.data.id).retentionUntil =
      new Date(Date.now() - 1000).toISOString();
    const pseudonymized = await request(app)
      .post(`/api/platform/closures/${closure.body.data.id}/pseudonymize`)
      .set(platformHeaders).send({ confirmation: 'PSEUDONYMIZE' });
    assert.equal(pseudonymized.status, 200, JSON.stringify(pseudonymized.body));
    assert.equal(pseudonymized.body.data.status, 'pseudonymized');
    assert.equal(activeSchoolStudent.givenNameEn, 'Former student');
    assert.equal(activeSchoolStudent.guardianPhone, null);
    assert.equal(demoStudentBefore.givenNameEn, 'Sara');
    assert.equal(repo.users.find((user) => user.orgId === organizationId).isActive, false);
    assert.equal(repo.closureRequests.find((item) => item.id === closure.body.data.id).status, 'pseudonymized');
    assert.ok(repo.audit.some((record) =>
      record.action === 'school.closure_personal_data_pseudonymized' &&
      record.entityId === closure.body.data.id));
  });
  it('completes public admissions and the protected student records lifecycle', async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const publicLink = await request(app).get('/api/admissions/public-link').set(headers);
    assert.equal(publicLink.status, 200);
    const publicToken = publicLink.body.data.token;
    const publicInfo = await request(app).get(`/api/public/admissions/${publicToken}`);
    assert.equal(publicInfo.status, 200);
    assert.ok(publicInfo.body.data.grades.length > 0);
    const application = {
      givenNameAm: 'ሀና', fatherNameAm: 'ገብረ', grandfatherNameAm: 'ተስፋዬ',
      givenNameEn: 'Hana', fatherNameEn: 'Gebre', grandfatherNameEn: 'Tesfaye',
      gender: 'female', dateOfBirth: '2015-04-12', guardianName: 'Marta Gebre',
      guardianPhone: '+251911234567', guardianEmail: null,
      gradeLevelId: publicInfo.body.data.grades[0].id, previousSchool: 'Example Primary',
      privacyConsent: true
    };
    const submission = await request(app).post(`/api/public/admissions/${publicToken}`).send(application);
    assert.equal(submission.status, 201);
    const submittedRecord = repo.admissions.find((item) => item.id === submission.body.data.reference);
    assert.equal(submittedRecord.status, 'application');
    assert.equal(submittedRecord.publicSubmission, true);
    assert.ok(submittedRecord.privacyConsentAt);
    assert.equal((await request(app).post(`/api/public/admissions/${publicToken}`)
      .send({ ...application, privacyConsent: false })).status, 400);

    const photoBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const photo = await request(app).post(`/api/students/${studentOne}/documents?type=photo&name=portrait.png`)
      .set(headers).set('Content-Type', 'image/png').send(photoBytes);
    assert.equal(photo.status, 201);
    const docs = await request(app).get(`/api/students/${studentOne}/documents`).set(headers);
    assert.equal(docs.status, 200);
    assert.equal(docs.body.data[0].documentType, 'photo');
    const downloaded = await request(app)
      .get(`/api/students/${studentOne}/documents/${photo.body.data.id}`).set(headers);
    assert.equal(downloaded.status, 200);
    assert.deepEqual(downloaded.body, photoBytes);
    const invalidPhoto = await request(app).post(`/api/students/${studentOne}/documents?type=photo&name=invalid.jpg`)
      .set(headers).set('Content-Type', 'image/jpeg').send(Buffer.from('not an image'));
    assert.equal(invalidPhoto.status, 400);

    const allergySave = await request(app).put(`/api/students/${studentOne}/sensitive-data`)
      .set(headers).send({ allergies: 'Peanut allergy' });
    assert.equal(allergySave.status, 200);
    assert.equal(allergySave.body.data.allergies, 'Peanut allergy');
    assert.ok(repo.studentSensitive.get(studentOne).allergiesEnc.startsWith('v1.'));
    assert.ok(!JSON.stringify(repo.studentSensitive.get(studentOne)).includes('Peanut allergy'));

    const sourceSection = repo.sections.find((section) => section.campusId === campusId);
    const activeYear = repo.academicYears.find((year) =>
      year.campusId === campusId && year.status === 'active');
    const currentEnrollment = repo.enrolments.find((enrollment) =>
      enrollment.studentId === studentOne && enrollment.academicYearId === activeYear?.id &&
      enrollment.status === 'active');
    assert.ok(sourceSection && activeYear && currentEnrollment);
    const destination = { ...sourceSection, id: randomUUID(), name: 'Transfer Test Section',
      academicYearId: activeYear.id, isActive: true, capacity: null };
    repo.sections.push(destination);
    const sectionChange = await request(app).post(`/api/students/${studentOne}/section-transfer`)
      .set(headers).send({ sectionId: destination.id, reason: 'Approved family request' });
    assert.equal(sectionChange.status, 200);
    assert.equal(sectionChange.body.data.sectionName, destination.name);
    assert.equal((await request(app).get(`/api/students/${studentOne}/section-transfers`)
      .set(headers)).body.data[0].toSection, destination.name);

    const discipline = await request(app).post(`/api/students/${studentOne}/discipline`)
      .set(headers).send({
        recordedOn: '2026-10-29', category: 'Attendance support',
        details: 'Private incident detail', actionTaken: 'Guardian meeting'
      });
    assert.equal(discipline.status, 201);
    assert.equal(discipline.body.data.details, 'Private incident detail');
    const storedDiscipline = repo.studentDisciplineRecords.find((item) =>
      item.id === discipline.body.data.id);
    assert.ok(storedDiscipline.detailsEnc.startsWith('v1.'));
    assert.ok(!JSON.stringify(storedDiscipline).includes('Private incident detail'));
    assert.equal((await request(app).get(`/api/students/${studentOne}/discipline`)
      .set(headers)).body.data.length, 1);

    const consent = await request(app).post(`/api/students/${studentOne}/documents?type=transfer_consent&name=guardian-consent.pdf`)
      .set(headers).set('Content-Type', 'application/pdf').send(Buffer.from('%PDF-1.7 guardian signed consent'));
    assert.equal(consent.status, 201);
    const transferPackage = await request(app).post(`/api/students/${studentOne}/transfer-packages`)
      .set(headers).send({
        recipientSchool: 'Receiving Private School', guardianName: 'Marta Gebre',
        guardianRelationship: 'Mother', consentRecordedOn: '2026-10-29',
        consentDocumentId: consent.body.data.id
      });
    assert.equal(transferPackage.status, 201);
    const approval = await request(app).post(
      `/api/students/${studentOne}/transfer-packages/${transferPackage.body.data.id}/approve`
    ).set(headers);
    assert.equal(approval.status, 200);
    const transferToken = new URL(approval.body.data.shareUrl).pathname.split('/').at(-1);
    const packet = await request(app).get(`/api/public/student-transfers/${transferToken}`);
    assert.equal(packet.status, 200);
    assert.equal(packet.headers['cache-control'], 'no-store');
    assert.equal(packet.body.data.recipientSchool, 'Receiving Private School');
    assert.equal(packet.body.data.guardianConsent.guardianName, 'Marta Gebre');
    assert.ok(packet.body.data.academicHistory.length > 0);
    assert.equal((await request(app).get('/api/alumni').set(headers)).status, 200);
  });
});
