import { randomUUID } from 'node:crypto';
import { invalidatePermissionCache } from '../../middleware/permissions.js';
import { auditRow, organizationAdministratorConflict, setupConflict } from '../shared.js';

const platformOrganizationId = '00000000-0000-4000-8000-000000000001';

function mapRole(row, permissions = []) {
  return {
    id: row.id, organizationId: row.organization_id, key: row.key,
    name: row.name, isSystem: Boolean(row.is_system), permissions
  };
}

function mapAccount(row, campusIds = []) {
  return {
    id: row.id, name: row.name, email: row.email, role: row.role,
    isActive: Boolean(row.is_active), campusIds
  };
}

function accountPermissions(db, roleId) {
  return db('role_permissions').where({ role_id: roleId })
    .orderBy('permission_key').pluck('permission_key');
}

async function findRole(query, organizationId, roleKey, lock = false) {
  let roles = query('roles').where({ key: roleKey }).where((builder) => {
    builder.where({ organization_id: organizationId }).orWhereNull('organization_id');
  }).orderByRaw('organization_id IS NULL ASC');
  if (lock) roles = roles.forUpdate();
  return roles.first();
}

async function listedAccount(db, user) {
  const campuses = await db('user_campuses as uc').join('campuses as c', 'c.id', 'uc.campus_id')
    .where({ 'uc.user_id': user.id, 'uc.is_active': true })
    .select('uc.campus_id');
  return mapAccount(user, campuses.map((item) => item.campus_id));
}

function platformAdminConflict() {
  const error = new Error('At least one active platform administrator must remain.');
  error.code = 'PLATFORM_LAST_ADMIN';
  error.status = 409;
  return error;
}

export const mysqlRolesBundle = {
  async getRolePermissions(organizationId, roleKey) {
    const role = await findRole(this.db, organizationId, roleKey);
    return role ? accountPermissions(this.db, role.id) : [];
  },
  async getUserEffectivePermissions(organizationId, roleKey) {
    return this.getRolePermissions(organizationId, roleKey);
  },
  async listRolesAndPermissions(organizationId) {
    const roleRows = await this.db('roles').whereNull('organization_id')
      .orWhere({ organization_id: organizationId }).orderBy('name').select('*');
    const permissionRows = await this.db('permissions').orderBy('key')
      .select('key', 'description');
    const assignments = roleRows.length ? await this.db('role_permissions')
      .whereIn('role_id', roleRows.map((role) => role.id))
      .select('role_id', 'permission_key') : [];
    const byRole = new Map();
    for (const assignment of assignments) {
      const permissions = byRole.get(assignment.role_id) ?? [];
      permissions.push(assignment.permission_key);
      byRole.set(assignment.role_id, permissions);
    }
    return {
      roles: roleRows.map((role) => mapRole(role,
        (byRole.get(role.id) ?? []).sort((a, b) => a.localeCompare(b)))),
      permissions: permissionRows.map((permission) => ({
        key: permission.key, description: permission.description
      }))
    };
  },
  async createOrganizationRole(organizationId, input, actor) {
    const id = randomUUID();
    const key = `custom_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    await this.db.transaction(async (trx) => {
      const rows = await trx('permissions').whereIn('key', input.permissions).select('key');
      if (rows.length !== input.permissions.length) throw setupConflict('Unknown permission key.');
      await trx('roles').insert({
        id, organization_id: organizationId, key, name: input.name, is_system: false
      });
      if (input.permissions.length) await trx('role_permissions').insert(
        input.permissions.map((permission_key) => ({ role_id: id, permission_key }))
      );
      await trx('audit_log').insert(auditRow(actor, 'role.created', 'role', id, null, {
        organizationId, role: { key, name: input.name, permissions: [...input.permissions].sort() }
      }));
    });
    invalidatePermissionCache(this, organizationId, key);
    return { id, organizationId, key, name: input.name, isSystem: false,
      permissions: [...input.permissions].sort() };
  },
  async updateOrganizationRolePermissions(organizationId, roleKey, permissions, actor) {
    const updated = await this.db.transaction(async (trx) => {
      const role = await trx('roles').where({
        organization_id: organizationId, key: roleKey, is_system: false
      }).forUpdate().first();
      if (!role) return null;
      const validPermissions = await trx('permissions').whereIn('key', permissions).select('key');
      if (validPermissions.length !== permissions.length) throw setupConflict('Unknown permission key.');
      const before = await accountPermissions(trx, role.id);
      await trx('role_permissions').where({ role_id: role.id }).delete();
      if (permissions.length) await trx('role_permissions').insert(
        permissions.map((permission_key) => ({ role_id: role.id, permission_key }))
      );
      await trx('audit_log').insert(auditRow(actor, 'role.permissions_updated', 'role', role.id,
        { permissions: before }, { permissions: [...permissions].sort() }));
      return mapRole(role, [...permissions].sort());
    });
    if (updated) invalidatePermissionCache(this, organizationId, roleKey);
    return updated;
  },
  async assignOrganizationRole(organizationId, userId, roleKey, actor) {
    return this.db.transaction(async (trx) => {
      await trx('organizations').where({ id: organizationId }).forUpdate().first('id');
      const user = await trx('users').where({
        id: userId, organization_id: organizationId
      }).whereNot('role', 'super_admin').forUpdate().first('id', 'role', 'is_active');
      const role = await findRole(trx, organizationId, roleKey, true);
      if (!user || !role || role.organization_id === null && roleKey.startsWith('platform_')) return null;
      const permissions = await accountPermissions(trx, role.id);
      if (permissions.some((permission) => permission.startsWith('platform.'))) return null;
      if (user.role === 'owner_director' && user.is_active && roleKey !== 'owner_director') {
        const activeAdministrators = await trx('users').where({
          organization_id: organizationId, role: 'owner_director', is_active: true
        }).forUpdate().select('id');
        if (activeAdministrators.length <= 1) throw organizationAdministratorConflict();
      }
      if (user.role !== roleKey) {
        await trx('users').where({ id: userId, organization_id: organizationId })
          .update({ role: roleKey, auth_version: trx.raw('auth_version + 1') });
        await trx('refresh_tokens').where({ user_id: userId }).whereNull('revoked_at')
          .update({ revoked_at: trx.fn.now() });
        await trx('auth_sessions').where({ user_id: userId }).whereNull('revoked_at')
          .update({ revoked_at: trx.fn.now() });
        await trx('audit_log').insert(auditRow(actor, 'user.role_assigned', 'user', userId,
          { role: user.role }, { role: roleKey }));
      }
      const updated = await trx('users').where({ id: userId }).first();
      return listedAccount(trx, updated);
    });
  },
  async getAccountEffectivePermissions(organizationId, userId) {
    const user = await this.db('users').where({
      id: userId, organization_id: organizationId
    }).whereNot('role', 'super_admin').first('id', 'role');
    if (!user) return null;
    return { userId, role: user.role,
      permissions: await this.getRolePermissions(organizationId, user.role) };
  },
  async listPlatformUsers(organizationId = platformOrganizationId) {
    const users = await this.db('users').where({
      organization_id: organizationId, role: 'super_admin'
    }).orderBy('name').select('id', 'name', 'email', 'role', 'is_active');
    return Promise.all(users.map((user) => listedAccount(this.db, user)));
  },
  async createPlatformUserInvitation(invitation, actor) {
    const exists = await this.db('users').whereRaw('LOWER(email) = ?', [
      invitation.email.toLowerCase()
    ]).first('id');
    if (exists) throw setupConflict('An account already uses this email address.');
    const pending = await this.db('account_invitations').whereRaw('LOWER(email) = ?', [
      invitation.email.toLowerCase()
    ]).whereNull('accepted_at').where('expires_at', '>', this.db.fn.now()).first('id');
    if (pending) throw setupConflict('An active invitation already uses this email address.');
    await this.db.transaction(async (trx) => {
      await trx('account_invitations').insert({
        id: invitation.id, organization_id: platformOrganizationId, campus_id: null,
        email: invitation.email, role: invitation.role,
        target_type: 'platform_administrator', target_id: platformOrganizationId,
        target_name: invitation.name, token_hash: invitation.tokenHash,
        expires_at: invitation.expiresAt, accepted_at: null, created_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'platform_user.invited',
        'account_invitation', invitation.id, null, {
          email: invitation.email, role: invitation.role
        }));
    });
    return { id: invitation.id, email: invitation.email, name: invitation.name,
      role: invitation.role, expiresAt: invitation.expiresAt };
  },
  async updatePlatformUser(userId, input, actor) {
    return this.db.transaction(async (trx) => {
      const user = await trx('users').where({
        id: userId, organization_id: platformOrganizationId, role: 'super_admin'
      }).forUpdate().first('id', 'name', 'email');
      if (!user) return null;
      if (input.email) {
        const duplicate = await trx('users').whereRaw('LOWER(email) = ?', [
          input.email.toLowerCase()
        ]).whereNot('id', userId).first('id');
        if (duplicate) throw setupConflict('An account already uses this email address.');
      }
      const after = { name: input.name ?? user.name, email: input.email ?? user.email };
      await trx('users').where({ id: userId }).update(after);
      await trx('audit_log').insert(auditRow(actor, 'platform_user.updated', 'user', userId,
        { name: user.name, email: user.email }, after));
      const updated = await trx('users').where({ id: userId }).first();
      return listedAccount(trx, updated);
    });
  },
  async setPlatformUserStatus(userId, isActive, actor) {
    return this.db.transaction(async (trx) => {
      const user = await trx('users').where({
        id: userId, organization_id: platformOrganizationId, role: 'super_admin'
      }).forUpdate().first('id', 'name', 'email', 'role', 'is_active');
      if (!user) return null;
      if (user.is_active && !isActive) {
        const activeUsers = await trx('users').where({
          organization_id: platformOrganizationId, role: 'super_admin', is_active: true
        }).forUpdate().select('id');
        if (activeUsers.length <= 1) throw platformAdminConflict();
      }
      if (Boolean(user.is_active) !== isActive) {
        await trx('users').where({ id: userId }).update({
          is_active: isActive, auth_version: trx.raw('auth_version + 1')
        });
        if (!isActive) {
          await trx('refresh_tokens').where({ user_id: userId }).whereNull('revoked_at')
            .update({ revoked_at: trx.fn.now() });
          await trx('auth_sessions').where({ user_id: userId }).whereNull('revoked_at')
            .update({ revoked_at: trx.fn.now() });
        }
        await trx('audit_log').insert(auditRow(actor,
          isActive ? 'platform_user.activated' : 'platform_user.deactivated',
          'user', userId, { isActive: Boolean(user.is_active) }, { isActive }));
      }
      const updated = await trx('users').where({ id: userId }).first();
      return listedAccount(trx, updated);
    });
  },
  async assignPlatformRole(userId, roleKey, actor) {
    return this.db.transaction(async (trx) => {
      const user = await trx('users').where({
        id: userId, organization_id: platformOrganizationId
      }).forUpdate().first('id', 'role');
      if (!user || roleKey !== 'super_admin') return null;
      const role = await findRole(trx, platformOrganizationId, roleKey, true);
      if (!role || role.organization_id !== null) return null;
      if (user.role !== roleKey) {
        await trx('users').where({ id: userId }).update({
          role: roleKey, auth_version: trx.raw('auth_version + 1')
        });
        await trx('refresh_tokens').where({ user_id: userId }).whereNull('revoked_at')
          .update({ revoked_at: trx.fn.now() });
        await trx('auth_sessions').where({ user_id: userId }).whereNull('revoked_at')
          .update({ revoked_at: trx.fn.now() });
        await trx('audit_log').insert(auditRow(actor, 'platform_user.role_assigned',
          'user', userId, { role: user.role }, { role: roleKey }));
      }
      const updated = await trx('users').where({ id: userId }).first();
      return listedAccount(trx, updated);
    });
  }
};
