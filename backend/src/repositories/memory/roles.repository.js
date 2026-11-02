import { randomUUID } from 'node:crypto';
import { invalidatePermissionCache } from '../../middleware/permissions.js';
import { now, organizationAdministratorConflict } from '../shared.js';

const platformOrganizationId = '00000000-0000-4000-8000-000000000001';

function rolePermissions(repo, roleId) {
  return repo.rolePermissions.filter((item) => item.roleId === roleId)
    .map((item) => item.permissionKey).sort();
}

function roleFor(repo, organizationId, roleKey) {
  return repo.roles.find((role) => role.key === roleKey &&
    (role.organizationId === organizationId || role.organizationId === null)) ?? null;
}

function accountShape(user) {
  return {
    id: user.id, name: user.name, email: user.email ?? null, role: user.role,
    isActive: Boolean(user.isActive), campusIds: [...(user.campusIds ?? [])]
  };
}

function invalidateRole(repo, organizationId, roleKey) {
  invalidatePermissionCache(repo, organizationId, roleKey);
}

function revokeUserSessions(repo, userId) {
  const timestamp = now();
  for (const [hash, token] of repo.refreshTokens) {
    if (token.userId === userId) repo.refreshTokens.delete(hash);
  }
  for (const session of repo.authSessions.values()) {
    if (session.userId === userId) session.revokedAt = timestamp;
  }
}

function platformUser(repo, userId) {
  return repo.users.find((user) => user.id === userId &&
    user.orgId === platformOrganizationId && user.role === 'super_admin') ?? null;
}

function platformConflict() {
  const error = new Error('At least one active platform administrator must remain.');
  error.code = 'PLATFORM_LAST_ADMIN';
  error.status = 409;
  return error;
}

export const memoryRolesBundle = {
  async getRolePermissions(organizationId, roleKey) {
    const role = roleFor(this, organizationId, roleKey);
    return role ? rolePermissions(this, role.id) : [];
  },
  async getUserEffectivePermissions(organizationId, roleKey) {
    return this.getRolePermissions(organizationId, roleKey);
  },
  async listRolesAndPermissions(organizationId) {
    return {
      roles: this.roles.filter((role) =>
        role.organizationId === null || role.organizationId === organizationId)
        .map((role) => ({
          id: role.id, organizationId: role.organizationId, key: role.key,
          name: role.name, isSystem: role.isSystem,
          permissions: rolePermissions(this, role.id)
        })).sort((left, right) => left.name.localeCompare(right.name)),
      permissions: this.permissions.map((permission) => ({
        key: permission.key, description: permission.description
      })).sort((left, right) => left.key.localeCompare(right.key))
    };
  },
  async createOrganizationRole(organizationId, input, actor) {
    const key = `custom_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const role = {
      id: randomUUID(), organizationId, key, name: input.name, isSystem: false
    };
    this.roles.push(role);
    for (const permissionKey of input.permissions) {
      this.rolePermissions.push({ roleId: role.id, permissionKey });
    }
    await this.appendAudit(actor, 'role.created', 'role', role.id, null, {
      organizationId, role: { key, name: role.name, permissions: [...input.permissions].sort() }
    });
    invalidateRole(this, organizationId, key);
    return { ...role, permissions: [...input.permissions].sort() };
  },
  async updateOrganizationRolePermissions(organizationId, roleKey, permissions, actor) {
    const role = this.roles.find((item) =>
      item.organizationId === organizationId && item.key === roleKey && !item.isSystem);
    if (!role) return null;
    const before = rolePermissions(this, role.id);
    this.rolePermissions = this.rolePermissions.filter((item) => item.roleId !== role.id);
    for (const permissionKey of permissions) {
      this.rolePermissions.push({ roleId: role.id, permissionKey });
    }
    await this.appendAudit(actor, 'role.permissions_updated', 'role', role.id,
      { permissions: before }, { permissions: [...permissions].sort() });
    invalidateRole(this, organizationId, roleKey);
    return { ...role, permissions: [...permissions].sort() };
  },
  async assignOrganizationRole(organizationId, userId, roleKey, actor) {
    const user = this.users.find((item) =>
      item.id === userId && item.orgId === organizationId && item.role !== 'super_admin');
    const role = roleFor(this, organizationId, roleKey);
    if (!user || !role || roleKey === 'super_admin' ||
        rolePermissions(this, role.id).some((permission) => permission.startsWith('platform.'))) return null;
    if (user.role === 'owner_director' && user.isActive && roleKey !== 'owner_director' &&
        this.users.filter((item) => item.orgId === organizationId &&
          item.role === 'owner_director' && item.isActive).length <= 1) {
      throw organizationAdministratorConflict();
    }
    const before = user.role;
    if (before !== roleKey) {
      user.role = roleKey;
      user.authVersion = Number(user.authVersion ?? 0) + 1;
      revokeUserSessions(this, userId);
      await this.appendAudit(actor, 'user.role_assigned', 'user', userId,
        { role: before }, { role: roleKey });
    }
    return accountShape(user);
  },
  async getAccountEffectivePermissions(organizationId, userId) {
    const user = this.users.find((item) => item.id === userId &&
      item.orgId === organizationId && item.role !== 'super_admin');
    if (!user) return null;
    return { userId, role: user.role, permissions: await this.getRolePermissions(organizationId, user.role) };
  },
  async listPlatformUsers() {
    return this.users.filter((user) =>
      user.orgId === platformOrganizationId && user.role === 'super_admin')
      .map(accountShape).sort((left, right) => left.name.localeCompare(right.name));
  },
  async createPlatformUserInvitation(invitation, actor) {
    if (this.users.some((user) => user.email?.toLowerCase() === invitation.email.toLowerCase()) ||
        this.accountInvitations.some((item) => item.email.toLowerCase() === invitation.email.toLowerCase() &&
          item.acceptedAt === null && new Date(item.expiresAt).getTime() > Date.now())) {
      const error = new Error('An active account or invitation already uses this email.');
      error.code = 'SETUP_CONFLICT';
      error.status = 409;
      throw error;
    }
    const record = {
      id: invitation.id, orgId: platformOrganizationId, campusId: null,
      email: invitation.email, role: invitation.role, targetType: 'platform_administrator',
      targetId: platformOrganizationId, targetName: invitation.name,
      tokenHash: invitation.tokenHash, expiresAt: invitation.expiresAt,
      acceptedAt: null, createdBy: actor.sub
    };
    this.accountInvitations.push(record);
    await this.appendAudit(actor, 'platform_user.invited', 'account_invitation',
      invitation.id, null, { email: invitation.email, role: invitation.role });
    return { id: invitation.id, email: invitation.email, name: invitation.name,
      role: invitation.role, expiresAt: invitation.expiresAt };
  },
  async updatePlatformUser(userId, input, actor) {
    const user = platformUser(this, userId);
    if (!user) return null;
    if (input.email && this.users.some((item) =>
      item.id !== userId && item.email?.toLowerCase() === input.email.toLowerCase())) {
      const error = new Error('An account already uses this email address.');
      error.code = 'SETUP_CONFLICT';
      error.status = 409;
      throw error;
    }
    const before = { name: user.name, email: user.email ?? null };
    Object.assign(user, input);
    await this.appendAudit(actor, 'platform_user.updated', 'user', userId, before, {
      name: user.name, email: user.email ?? null
    });
    return accountShape(user);
  },
  async setPlatformUserStatus(userId, isActive, actor) {
    const user = platformUser(this, userId);
    if (!user) return null;
    if (user.isActive && !isActive && this.users.filter((item) =>
      item.orgId === platformOrganizationId && item.role === 'super_admin' && item.isActive).length <= 1) {
      throw platformConflict();
    }
    if (Boolean(user.isActive) !== isActive) {
      const previous = Boolean(user.isActive);
      user.isActive = isActive;
      user.authVersion = Number(user.authVersion ?? 0) + 1;
      if (!isActive) revokeUserSessions(this, userId);
      await this.appendAudit(actor, isActive ? 'platform_user.activated' : 'platform_user.deactivated',
        'user', userId, { isActive: previous }, { isActive });
    }
    return accountShape(user);
  },
  async assignPlatformRole(userId, roleKey, actor) {
    const user = this.users.find((item) => item.id === userId &&
      item.orgId === platformOrganizationId);
    if (!user || roleKey !== 'super_admin') return null;
    const before = user.role;
    if (before !== roleKey) {
      user.role = roleKey;
      user.authVersion = Number(user.authVersion ?? 0) + 1;
      revokeUserSessions(this, userId);
      await this.appendAudit(actor, 'platform_user.role_assigned', 'user', userId,
        { role: before }, { role: roleKey });
    }
    return accountShape(user);
  }
};
