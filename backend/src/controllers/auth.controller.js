import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { logger } from '../logger.js';
import {
  clearRefreshCookie, createRefreshSecret, getRefreshCookie, hashRefreshSecret,
  issueAccessToken, publicUser, refreshExpiresAt, setRefreshCookie
} from '../auth.js';
import {
  invitationAcceptanceSchema, loginSchema, passwordChangeSchema,
  passwordResetRequestSchema, passwordResetSchema
} from '../schemas/auth.schema.js';
import { switchBranchSchema } from '../schemas/platform.schema.js';

export function createAuthController({ repo, config, mailer, parse }) {
  return {
    login: async (request, response, next) => {
      try {
        const input = parse(loginSchema, request.body);
        const failures = repo.loginFailures?.get(input.login)?.count ?? 0;
        const locked = failures >= 5 &&
          Date.now() - repo.loginFailures.get(input.login).since < 15 * 60_000;
        if (locked) return response.status(429).json({ error: { code: 'LOGIN_LOCKED', message: 'Too many attempts. Try again in 15 minutes.' } });
        const user = await repo.findUserByLogin(input.login);
        const valid = user && await bcrypt.compare(input.password, user.passwordHash);
        if (!valid) {
          const count = await repo.recordLoginFailure(input.login);
          await repo.appendAudit({
            sub: user?.id ?? 'unknown', orgId: user?.orgId ?? null,
            activeCampusId: user?.activeCampusId ?? null
          }, 'auth.login_failed', 'user', user?.id ?? null, null, null);
          return response.status(count >= 5 ? 429 : 401).json({
            error: { code: count >= 5 ? 'LOGIN_LOCKED' : 'INVALID_CREDENTIALS', message: count >= 5 ? 'Too many attempts. Try again in 15 minutes.' : 'Invalid login or password.' }
          });
        }
        if (!user.isActive) return response.status(403).json({
          error: { code: 'ACCOUNT_INACTIVE', message: 'This account is inactive. Contact your school administrator.' }
        });
        if (user.role !== 'super_admin' && !await repo.isOrganizationOperational(user.orgId)) {
          return response.status(403).json({
            error: { code: 'SCHOOL_INACTIVE', message: 'School access is suspended, closed, or the subscription has expired.' }
          });
        }
        if (user.role !== 'super_admin' &&
          (!user.activeCampusId || !user.campusIds.includes(user.activeCampusId))) {
          return response.status(403).json({
            error: { code: 'CAMPUS_ACCESS_REQUIRED', message: 'No active campus access is assigned to this account.' }
          });
        }
        await repo.clearLoginFailures(input.login);
        const token = issueAccessToken(user, config);
        const refresh = createRefreshSecret();
        await repo.storeRefreshToken(refresh.hash, user.id, refreshExpiresAt(), user.activeCampusId);
        await repo.appendAudit({
          sub: user.id, orgId: user.orgId, activeCampusId: user.activeCampusId
        }, 'auth.login', 'user', user.id, null, null);
        setRefreshCookie(response, refresh.value, config.NODE_ENV === 'production');
        response.json({ data: { accessToken: token, user: publicUser(user) } });
      } catch (error) { next(error); }
    },
    requestPasswordReset: async (request, response, next) => {
      try {
        const { email } = parse(passwordResetRequestSchema, request.body);
        if (!mailer) return response.status(503).json({
          error: { code: 'PASSWORD_RESET_DELIVERY_UNAVAILABLE', message: 'Password reset delivery is not configured. Contact your school administrator.' }
        });
        const token = randomBytes(32).toString('base64url');
        const tokenHash = createHash('sha256').update(token).digest('hex');
        const user = await repo.createPasswordReset(
          email, tokenHash, new Date(Date.now() + 30 * 60_000).toISOString()
        );
        if (user) {
          const resetUrl = `${config.WEB_ORIGIN.replace(/\/+$/, '')}/reset-password/${token}`;
          try {
            await mailer.sendPasswordResetEmail({ email: user.email, name: user.name, resetUrl });
          } catch (error) {
            await repo.revokePasswordResetToken(tokenHash);
            logger.error({
              event: 'auth.password_reset_email_failed', userId: user.userId,
              errorName: error.name, errorCode: error.code ?? 'SMTP_DELIVERY_FAILED'
            }, 'Password reset email delivery failed');
          }
        }
        response.status(202).json({
          data: { message: 'If an active account uses that email, password reset instructions will be sent.' }
        });
      } catch (error) { next(error); }
    },
    resetPassword: async (request, response, next) => {
      try {
        const input = parse(passwordResetSchema, request.body);
        const tokenHash = createHash('sha256').update(input.token).digest('hex');
        const passwordHash = await bcrypt.hash(input.password, 12);
        const user = await repo.completePasswordReset(tokenHash, passwordHash);
        if (!user) return response.status(400).json({
          error: { code: 'PASSWORD_RESET_INVALID', message: 'This password reset link is invalid or expired. Request a new one.' }
        });
        clearRefreshCookie(response, config.NODE_ENV === 'production');
        response.status(204).end();
      } catch (error) { next(error); }
    },
    refreshSession: async (request, response, next) => {
      try {
        const value = getRefreshCookie(request);
        if (!value) return response.status(401).json({ error: { code: 'REFRESH_REQUIRED', message: 'Sign in again.' } });
        const user = await repo.consumeRefreshToken(hashRefreshSecret(value));
        if (!user) {
          clearRefreshCookie(response, config.NODE_ENV === 'production');
          return response.status(401).json({ error: { code: 'REFRESH_INVALID', message: 'Refresh token is expired or already used.' } });
        }
        if (!user.isActive || (user.role !== 'super_admin' && !await repo.isOrganizationOperational(user.orgId))) {
          clearRefreshCookie(response, config.NODE_ENV === 'production');
          return response.status(403).json({
            error: { code: 'SCHOOL_INACTIVE', message: 'School access is suspended, closed, or the subscription has expired.' }
          });
        }
        if (user.role !== 'super_admin' && user.branchActive === false) {
          clearRefreshCookie(response, config.NODE_ENV === 'production');
          return response.status(401).json({
            error: { code: 'SESSION_CAMPUS_UNAVAILABLE', message: 'This session branch is no longer active. Sign in again or choose another branch.' }
          });
        }
        const refresh = createRefreshSecret();
        await repo.storeRefreshToken(refresh.hash, user.id, refreshExpiresAt(), user.activeCampusId);
        await repo.appendAudit({
          sub: user.id, orgId: user.orgId, activeCampusId: user.activeCampusId ?? null
        }, 'auth.session_refreshed', 'user', user.id, null, null);
        setRefreshCookie(response, refresh.value, config.NODE_ENV === 'production');
        response.json({ data: { accessToken: issueAccessToken(user, config), user: publicUser(user) } });
      } catch (error) { next(error); }
    },
    switchBranch: async (request, response, next) => {
      try {
        const { campusId } = parse(switchBranchSchema, request.body);
        if (!request.user.campusIds.includes(campusId)) return response.status(403).json({
          error: { code: 'BRANCH_ACCESS_DENIED', message: 'You do not have access to this active branch.' }
        });
        const value = getRefreshCookie(request);
        if (!value) return response.status(401).json({
          error: { code: 'REFRESH_REQUIRED', message: 'Sign in again before switching branches.' }
        });
        const refresh = createRefreshSecret();
        const user = await repo.switchRefreshTokenCampus(
          hashRefreshSecret(value), request.user.sub, campusId, refresh.hash,
          refreshExpiresAt(), request.user
        );
        if (!user) {
          clearRefreshCookie(response, config.NODE_ENV === 'production');
          return response.status(401).json({
            error: { code: 'REFRESH_INVALID', message: 'Refresh token is expired, already used, or no longer valid for this branch.' }
          });
        }
        setRefreshCookie(response, refresh.value, config.NODE_ENV === 'production');
        response.json({ data: { accessToken: issueAccessToken(user, config), user: publicUser(user) } });
      } catch (error) { next(error); }
    },
    logout: async (request, response, next) => {
      try {
        const value = getRefreshCookie(request);
        if (value) {
          const user = await repo.revokeRefreshToken(hashRefreshSecret(value));
          if (user) await repo.appendAudit({
            sub: user.id, orgId: user.orgId, activeCampusId: user.activeCampusId ?? null
          }, 'auth.logout', 'user', user.id, null, null);
        }
        clearRefreshCookie(response, config.NODE_ENV === 'production');
        response.status(204).end();
      } catch (error) { next(error); }
    },
    getInvitation: async (request, response, next) => {
      try {
        const tokenHash = createHash('sha256').update(request.params.token).digest('hex');
        const invitation = await repo.getAccountInvitation(tokenHash);
        if (!invitation) return response.status(404).json({
          error: { code: 'INVITATION_UNAVAILABLE', message: 'This invitation is invalid, expired, or already used.' }
        });
        response.json({ data: invitation });
      } catch (error) { next(error); }
    },
    acceptInvitation: async (request, response, next) => {
      try {
        const input = parse(invitationAcceptanceSchema, request.body);
        const tokenHash = createHash('sha256').update(input.token).digest('hex');
        const passwordHash = await bcrypt.hash(input.password, 12);
        const user = await repo.acceptAccountInvitation(tokenHash, passwordHash);
        if (!user) return response.status(404).json({
          error: { code: 'INVITATION_UNAVAILABLE', message: 'This invitation is invalid, expired, or already used.' }
        });
        const accessToken = issueAccessToken(user, config);
        const refresh = createRefreshSecret();
        await repo.storeRefreshToken(refresh.hash, user.id, refreshExpiresAt(), user.activeCampusId);
        setRefreshCookie(response, refresh.value, config.NODE_ENV === 'production');
        response.status(201).json({ data: { accessToken, user: publicUser(user) } });
      } catch (error) { next(error); }
    },
    changePassword: async (request, response, next) => {
      try {
        const input = parse(passwordChangeSchema, request.body);
        const user = await repo.changePassword(
          request.user.sub, input.currentPassword, input.newPassword, request.user
        );
        if (!user) return response.status(400).json({
          error: { code: 'CURRENT_PASSWORD_INVALID', message: 'The current password is incorrect.' }
        });
        const accessToken = issueAccessToken(user, config);
        const refresh = createRefreshSecret();
        await repo.storeRefreshToken(refresh.hash, user.id, refreshExpiresAt(), user.activeCampusId);
        setRefreshCookie(response, refresh.value, config.NODE_ENV === 'production');
        response.json({ data: { accessToken, user: publicUser(user) } });
      } catch (error) { next(error); }
    },
    getCurrentUser: async (request, response, next) => {
      try {
        const user = await repo.findUserById(request.user.sub);
        if (!user || !user.isActive) return response.status(401).json({ error: { code: 'USER_INACTIVE', message: 'Account is unavailable.' } });
        response.json({ data: publicUser(user) });
      } catch (error) { next(error); }
    }
  };
}
