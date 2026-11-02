import express from 'express';
import { createPlatformController } from '../controllers/platform.controller.js';

export function registerPlatformRoutes(app, dependencies) {
  const controller = createPlatformController(dependencies);
  app.post(
    '/api/platform/schools',
    dependencies.requirePermission('platform.manage'), controller.createPlatformSchool
  );
  app.post(
    '/api/platform/schools/:organizationId/admin-invitation/regenerate',
    dependencies.requirePermission('platform.manage'),
    controller.regenerateSchoolAdministratorInvitation
  );
  app.get('/api/school/branches', dependencies.requirePermission('school.branches.manage'), controller.listOrganizationBranches);
  app.post('/api/school/branches', dependencies.requirePermission('school.branches.manage'), controller.createOrganizationBranch);
  app.patch(
    '/api/school/branches/:branchId',
    dependencies.requirePermission('school.branches.manage'), controller.updateOrganizationBranch
  );
  app.get('/api/platform', dependencies.requirePermission('platform.view'), controller.getOverview);
  app.get('/api/platform/settings', dependencies.requirePermission('platform.view'), controller.getPlatformSettings);
  app.put('/api/platform/settings', dependencies.requirePermission('platform.manage'), controller.updatePlatformSettings);
  app.get(
    '/api/platform/reports/revenue.csv',
    dependencies.requirePermission('platform.view'), controller.getRevenueReport
  );
  app.get(
    '/api/platform/reports/outstanding',
    dependencies.requirePermission('platform.view'), controller.getOutstandingReport
  );
  app.get(
    '/api/platform/reports/outstanding.csv',
    dependencies.requirePermission('platform.view'), controller.getOutstandingReportCsv
  );
  app.post(
    '/api/platform/subscription-payments/:paymentId/refunds',
    dependencies.requirePermission('platform.manage'), controller.refundSubscriptionPayment
  );
  app.put(
    '/api/platform/schools/:organizationId/logo',
    dependencies.requirePermission('platform.manage'),
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '2mb' }),
    controller.uploadSchoolLogo
  );
  app.get(
    '/api/platform/schools/:organizationId/logo',
    dependencies.requirePermission('platform.view'), controller.getSchoolLogo
  );
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
