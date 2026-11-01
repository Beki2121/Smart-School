import { createAccountsController } from '../controllers/accounts.controller.js';

export function registerAccountRoutes(app, dependencies) {
  const controller = createAccountsController(dependencies);
  app.get('/api/accounts', dependencies.requirePermission('accounts.manage'), controller.listOrganizationAccounts);
  app.patch(
    '/api/accounts/:userId/status', dependencies.requirePermission('accounts.manage'),
    controller.setOrganizationAccountStatus
  );
}

export function registerAccountInvitationRoute(app, dependencies) {
  const controller = createAccountsController(dependencies);
  app.post(
    '/api/account-invitations', dependencies.requirePermission('accounts.manage'),
    controller.createAccountInvitation
  );
}
