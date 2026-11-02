import { createRolesController } from '../controllers/roles.controller.js';

export function registerRoleRoutes(app, dependencies) {
  const controller = createRolesController(dependencies);
  app.get('/api/roles', dependencies.requirePermission('accounts.manage'), controller.listRoles);
  app.post('/api/roles', dependencies.requirePermission('accounts.manage'), controller.createRole);
  app.put('/api/roles/:roleKey/permissions',
    dependencies.requirePermission('accounts.manage'), controller.updateRolePermissions);
  app.put('/api/accounts/:userId/role',
    dependencies.requirePermission('accounts.manage'), controller.assignRole);
  app.get('/api/accounts/:userId/permissions',
    dependencies.requirePermission('accounts.manage'), controller.effectivePermissions);
  app.get('/api/platform/users',
    dependencies.requirePermission('platform.view'), controller.listPlatformUsers);
  app.post('/api/platform/users/invitations',
    dependencies.requirePermission('platform.manage'), controller.invitePlatformUser);
  app.patch('/api/platform/users/:userId',
    dependencies.requirePermission('platform.manage'), controller.updatePlatformUser);
  app.patch('/api/platform/users/:userId/status',
    dependencies.requirePermission('platform.manage'), controller.setPlatformUserStatus);
  app.put('/api/platform/users/:userId/role',
    dependencies.requirePermission('platform.manage'), controller.assignPlatformRole);
}
