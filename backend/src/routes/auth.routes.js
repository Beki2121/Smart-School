import rateLimit from 'express-rate-limit';
import { createAuthController } from '../controllers/auth.controller.js';

export function registerPublicAuthRoutes(app, dependencies) {
  const controller = createAuthController(dependencies);
  app.post('/api/auth/login', controller.login);
  app.post('/api/auth/password/forgot', rateLimit({
    windowMs: 60 * 60_000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false
  }), controller.requestPasswordReset);
  app.post('/api/auth/password/reset', rateLimit({
    windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false
  }), controller.resetPassword);
  app.post('/api/auth/refresh', controller.refreshSession);
  app.post('/api/auth/logout', controller.logout);
  app.get('/api/auth/invitations/:token', controller.getInvitation);
  app.post('/api/auth/invitations/accept', controller.acceptInvitation);
}

export function registerAuthenticatedAuthRoutes(app, dependencies) {
  const controller = createAuthController(dependencies);
  app.post(
    '/api/auth/switch-branch',
    dependencies.requirePermission('account.view'),
    rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }),
    controller.switchBranch
  );
  app.post('/api/auth/password/change', controller.changePassword);
  app.get('/api/auth/me', dependencies.requirePermission('account.view'), controller.getCurrentUser);
}
