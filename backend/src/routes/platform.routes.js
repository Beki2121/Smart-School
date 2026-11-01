import { createPlatformController } from '../controllers/platform.controller.js';

export function registerPlatformRoutes(app, dependencies) {
  const controller = createPlatformController(dependencies);
  app.get('/api/platform', dependencies.requirePermission('platform.view'), controller.getOverview);
  app.get('/api/platform/schools', dependencies.requirePermission('platform.view'), controller.listSchools);
  app.get(
    '/api/platform/schools/:organizationId/subscription',
    dependencies.requirePermission('platform.view'), controller.getSubscription
  );
  app.patch(
    '/api/platform/schools/:organizationId/status',
    dependencies.requirePermission('platform.manage'), controller.updateOrganizationStatus
  );
  app.put(
    '/api/platform/schools/:organizationId/plan',
    dependencies.requirePermission('platform.manage'), controller.assignPlan
  );
  app.get(
    '/api/platform/subscription-plans',
    dependencies.requirePermission('platform.view'), controller.listSubscriptionPlans
  );
  app.put(
    '/api/platform/subscription-plans/:code',
    dependencies.requirePermission('platform.manage'), controller.saveSubscriptionPlan
  );
  app.post(
    '/api/platform/schools/:organizationId/invoices',
    dependencies.requirePermission('platform.manage'), controller.createSubscriptionInvoice
  );
  app.post(
    '/api/platform/subscription-invoices/:invoiceId/payments',
    dependencies.requirePermission('platform.manage'), controller.recordSubscriptionPayment
  );
  app.get(
    '/api/platform/closures',
    dependencies.requirePermission('platform.view'), controller.listClosureRequests
  );
  app.post(
    '/api/platform/closures/:closureId/approve',
    dependencies.requirePermission('platform.manage'), controller.approveClosure
  );
  app.post(
    '/api/platform/closures/:closureId/pseudonymize',
    dependencies.requirePermission('platform.manage'), controller.pseudonymizeClosure
  );
}

export function registerPlatformLicenceRoutes(app, dependencies) {
  const controller = createPlatformController(dependencies);
  app.post(
    '/api/platform/licence/verify',
    dependencies.requirePermission('platform.manage'), controller.verifyLicence
  );
  app.post(
    '/api/platform/license/verify',
    dependencies.requirePermission('platform.manage'), controller.verifyLicence
  );
}
