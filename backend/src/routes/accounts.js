import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  accountInvitationSchema, accountStatusSchema, staffInvitationRoles
} from '../schemas/accounts.js';

const staffInvitationRolesByInviter = {
  owner_director: staffInvitationRoles,
  system_admin: ['registrar', 'system_admin', 'homeroom_teacher', 'subject_teacher', 'hr_admin', 'accountant_cashier', 'counsellor'],
  principal: ['academic_head', 'registrar', 'homeroom_teacher', 'subject_teacher', 'hr_admin', 'accountant_cashier', 'counsellor'],
  registrar: ['homeroom_teacher', 'subject_teacher', 'counsellor'],
  hr_admin: ['homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor']
};

function canInviteStaffRole(inviterRole, inviteeRole, permissionRoles) {
  if (!staffInvitationRolesByInviter[inviterRole]?.includes(inviteeRole)) return false;
  if (inviterRole === 'owner_director') return true;
  return !['accounts.manage', 'platform.manage'].some((permission) =>
    permissionRoles[permission]?.includes(inviteeRole));
}

export function registerAccountRoutes(app, { repo, parse, requirePermission }) {
  app.get('/api/accounts', requirePermission('accounts.manage'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listOrganizationAccounts(request.user.orgId) });
    } catch (error) { next(error); }
  });

  app.patch('/api/accounts/:userId/status', requirePermission('accounts.manage'), async (request, response, next) => {
    try {
      const userId = parse(z.string().uuid(), request.params.userId);
      const { isActive } = parse(accountStatusSchema, request.body);
      const account = await repo.setOrganizationAccountStatus(
        request.user.orgId, userId, isActive, request.user
      );
      if (!account) return response.status(404).json({
        error: { code: 'ACCOUNT_NOT_FOUND', message: 'Account not found in this school.' }
      });
      response.json({ data: account });
    } catch (error) { next(error); }
  });
}

export function registerAccountInvitationRoute(
  app, { repo, config, parse, requirePermission, permissionRoles }
) {
  app.post('/api/account-invitations', requirePermission('accounts.manage'), async (request, response, next) => {
    try {
      const input = parse(accountInvitationSchema, request.body);
      if (input.targetType === 'staff' &&
          !canInviteStaffRole(request.user.role, input.role, permissionRoles)) {
        return response.status(403).json({
          error: {
            code: 'STAFF_ROLE_INVITATION_FORBIDDEN',
            message: 'Your role cannot invite an account with this staff role.'
          }
        });
      }
      const token = randomBytes(32).toString('base64url');
      const invitation = await repo.createAccountInvitation({
        id: randomUUID(), targetType: input.targetType, targetId: input.targetId,
        email: input.email,
        role: input.targetType === 'staff' ? input.role : input.targetType === 'student' ? 'student' : 'parent_guardian',
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      }, request.user);
      const webOrigin = config.WEB_ORIGIN.replace(/\/+$/, '');
      response.status(201).json({ data: { ...invitation, invitationUrl: `${webOrigin}/invite/${token}` } });
    } catch (error) { next(error); }
  });
}
