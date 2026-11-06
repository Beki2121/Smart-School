import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  platformInvitationSchema, platformUserStatusSchema, platformUserUpdateSchema,
  roleAssignmentSchema, roleCreateSchema, rolePermissionsSchema
} from '../schemas/roles.schema.js';

const platformOrganizationId = '00000000-0000-4000-8000-000000000001';

function forbidden(response, code, message) {
  return response.status(403).json({ error: { code, message } });
}

export function createRolesController({ repo, config, parse }) {
  return {
    listRoles: async (request, response, next) => {
      try {
        response.json({ data: await repo.listRolesAndPermissions(request.user.orgId) });
      } catch (error) { next(error); }
    },
    createRole: async (request, response, next) => {
      try {
        const input = parse(roleCreateSchema, request.body);
        const grantable = new Set(await repo.getUserEffectivePermissions(request.user.orgId, request.user.role));
        if (input.permissions.some((permission) => !grantable.has(permission) ||
            permission.startsWith('platform.'))) {
          return forbidden(response, 'PERMISSION_GRANT_FORBIDDEN',
            'You cannot grant permissions that you do not hold.');
        }
        const role = await repo.createOrganizationRole(request.user.orgId, input, request.user);
        response.status(201).json({ data: role });
      } catch (error) { next(error); }
    },
    updateRolePermissions: async (request, response, next) => {
      try {
        const input = parse(rolePermissionsSchema, request.body);
        const grantable = new Set(await repo.getUserEffectivePermissions(request.user.orgId, request.user.role));
        if (input.permissions.some((permission) => !grantable.has(permission) ||
            permission.startsWith('platform.'))) {
          return forbidden(response, 'PERMISSION_GRANT_FORBIDDEN',
            'You cannot grant permissions that you do not hold.');
        }
        const role = await repo.updateOrganizationRolePermissions(
          request.user.orgId, request.params.roleKey, input.permissions, request.user
        );
        if (!role) return response.status(404).json({
          error: { code: 'CUSTOM_ROLE_NOT_FOUND', message: 'Editable school role not found.' }
        });
        response.json({ data: role });
      } catch (error) { next(error); }
    },
    assignRole: async (request, response, next) => {
      try {
        const { role } = parse(roleAssignmentSchema, request.body);
        const grantable = new Set(await repo.getUserEffectivePermissions(
          request.user.orgId, request.user.role
        ));
        const requested = await repo.getUserEffectivePermissions(request.user.orgId, role);
        if (requested.some((permission) => !grantable.has(permission) ||
            permission.startsWith('platform.'))) {
          return forbidden(response, 'ROLE_ASSIGNMENT_FORBIDDEN',
            'You cannot assign a role with permissions that you do not hold.');
        }
        const account = await repo.assignOrganizationRole(
          request.user.orgId, request.params.userId, role, request.user
        );
        if (!account) return response.status(404).json({
          error: { code: 'ACCOUNT_OR_ROLE_NOT_FOUND', message: 'Account or school role not found.' }
        });
        response.json({ data: account });
      } catch (error) { next(error); }
    },
    effectivePermissions: async (request, response, next) => {
      try {
        const permissions = await repo.getAccountEffectivePermissions(
          request.user.orgId, request.params.userId
        );
        if (!permissions) return response.status(404).json({
          error: { code: 'ACCOUNT_NOT_FOUND', message: 'Account not found in this school.' }
        });
        response.json({ data: permissions });
      } catch (error) { next(error); }
    },
    listPlatformUsers: async (request, response, next) => {
      try {
        response.json({ data: await repo.listPlatformUsers(platformOrganizationId) });
      } catch (error) { next(error); }
    },
    invitePlatformUser: async (request, response, next) => {
      try {
        const input = parse(platformInvitationSchema, request.body);
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        const invitation = await repo.createPlatformUserInvitation({
          id: randomUUID(), name: input.name, email: input.email, role: input.role,
          tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt
        }, request.user);
        response.set('Cache-Control', 'no-store').status(201).json({ data: {
          ...invitation,
          invitationUrl: `${config.WEB_ORIGIN.replace(/\/+$/, '')}/invite/${token}`
        } });
      } catch (error) { next(error); }
    },
    updatePlatformUser: async (request, response, next) => {
      try {
        const input = parse(platformUserUpdateSchema, request.body);
        const user = await repo.updatePlatformUser(request.params.userId, input, request.user);
        if (!user) return response.status(404).json({
          error: { code: 'PLATFORM_USER_NOT_FOUND', message: 'Platform user not found.' }
        });
        response.json({ data: user });
      } catch (error) { next(error); }
    },
    setPlatformUserStatus: async (request, response, next) => {
      try {
        const { isActive } = parse(platformUserStatusSchema, request.body);
        const user = await repo.setPlatformUserStatus(
          request.params.userId, isActive, request.user
        );
        if (!user) return response.status(404).json({
          error: { code: 'PLATFORM_USER_NOT_FOUND', message: 'Platform user not found.' }
        });
        response.json({ data: user });
      } catch (error) { next(error); }
    },
    assignPlatformRole: async (request, response, next) => {
      try {
        const { role } = parse(roleAssignmentSchema, request.body);
        if (!['super_admin', 'support_staff'].includes(role)) {
          return forbidden(response, 'PLATFORM_ROLE_FORBIDDEN',
            'The selected platform role is not assignable.');
        }
        const user = await repo.assignPlatformRole(request.params.userId, role, request.user);
        if (!user) return response.status(404).json({
          error: { code: 'PLATFORM_USER_NOT_FOUND', message: 'Platform user not found.' }
        });
        response.json({ data: user });
      } catch (error) { next(error); }
    }
  };
}
