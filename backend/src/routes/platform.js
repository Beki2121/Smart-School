import { z } from 'zod';
import { verifyLicenceDocument } from '../licence.js';
import {
  closureApprovalSchema, closurePseudonymizationSchema, organizationStatusSchema,
  subscriptionAssignmentSchema, subscriptionInvoiceSchema, subscriptionPaymentSchema,
  subscriptionPlanSchema
} from '../schemas/platform.js';

const organizationIdSchema = z.string().uuid();

export function registerPlatformRoutes(app, { repo, parse, requirePermission }) {
  app.get('/api/platform', requirePermission('platform.view'), async (request, response, next) => {
    try {
      const schools = await repo.listPlatformSchools();
      const plans = await repo.listSubscriptionPlans();
      response.json({ data: {
        organizationId: request.user.orgId,
        totals: {
          schools: schools.length,
          pending: schools.filter((school) => school.status === 'pending').length,
          active: schools.filter((school) => school.status === 'active').length,
          suspended: schools.filter((school) => school.status === 'suspended').length,
          students: schools.reduce((sum, school) => sum + school.studentCount, 0)
        },
        schools, plans
      } });
    } catch (error) { next(error); }
  });

  app.get('/api/platform/schools', requirePermission('platform.view'), async (_request, response, next) => {
    try { response.json({ data: await repo.listPlatformSchools() }); }
    catch (error) { next(error); }
  });

  app.get('/api/platform/schools/:organizationId/subscription', requirePermission('platform.view'), async (request, response, next) => {
    try {
      const organizationId = parse(organizationIdSchema, request.params.organizationId);
      const subscription = await repo.getOrganizationSubscription(organizationId);
      if (!subscription) return response.status(404).json({
        error: { code: 'SCHOOL_SUBSCRIPTION_NOT_FOUND', message: 'School subscription not found.' }
      });
      response.json({ data: subscription });
    } catch (error) { next(error); }
  });

  app.patch('/api/platform/schools/:organizationId/status', requirePermission('platform.manage'), async (request, response, next) => {
    try {
      const organizationId = parse(organizationIdSchema, request.params.organizationId);
      const input = parse(organizationStatusSchema, request.body);
      const organization = await repo.updateOrganizationStatus(organizationId, input.status, request.user);
      if (!organization) return response.status(404).json({
        error: { code: 'SCHOOL_NOT_FOUND', message: 'School tenant not found.' }
      });
      response.json({ data: organization });
    } catch (error) { next(error); }
  });

  app.put('/api/platform/schools/:organizationId/plan', requirePermission('platform.manage'), async (request, response, next) => {
    try {
      const organizationId = parse(organizationIdSchema, request.params.organizationId);
      const input = parse(subscriptionAssignmentSchema, request.body);
      const subscription = await repo.assignOrganizationPlan(organizationId, input.planCode, request.user);
      if (!subscription) return response.status(404).json({
        error: { code: 'SCHOOL_OR_PLAN_NOT_FOUND', message: 'School subscription or active plan not found.' }
      });
      response.json({ data: subscription });
    } catch (error) { next(error); }
  });

  app.get('/api/platform/subscription-plans', requirePermission('platform.view'), async (_request, response, next) => {
    try { response.json({ data: await repo.listSubscriptionPlans() }); }
    catch (error) { next(error); }
  });

  app.put('/api/platform/subscription-plans/:code', requirePermission('platform.manage'), async (request, response, next) => {
    try {
      const input = parse(subscriptionPlanSchema, { ...request.body, code: request.params.code });
      response.json({ data: await repo.saveSubscriptionPlan(input, request.user) });
    } catch (error) { next(error); }
  });

  app.post('/api/platform/schools/:organizationId/invoices', requirePermission('platform.manage'), async (request, response, next) => {
    try {
      const organizationId = parse(organizationIdSchema, request.params.organizationId);
      const input = parse(subscriptionInvoiceSchema, request.body);
      const invoice = await repo.createSubscriptionInvoice(organizationId, input, request.user);
      if (!invoice) return response.status(404).json({
        error: { code: 'SCHOOL_SUBSCRIPTION_NOT_FOUND', message: 'School subscription not found.' }
      });
      response.status(201).json({ data: invoice });
    } catch (error) { next(error); }
  });

  app.post('/api/platform/subscription-invoices/:invoiceId/payments', requirePermission('platform.manage'), async (request, response, next) => {
    try {
      const invoiceId = parse(organizationIdSchema, request.params.invoiceId);
      const input = parse(subscriptionPaymentSchema, request.body);
      const payment = await repo.recordSubscriptionPayment(invoiceId, input, request.user);
      if (!payment) return response.status(409).json({
        error: { code: 'SUBSCRIPTION_PAYMENT_INVALID', message: 'Payment exceeds the invoice balance or the invoice is already paid.' }
      });
      response.status(201).json({ data: payment });
    } catch (error) { next(error); }
  });

  app.get('/api/platform/closures', requirePermission('platform.view'), async (_request, response, next) => {
    try { response.json({ data: await repo.listClosureRequests() }); }
    catch (error) { next(error); }
  });

  app.post('/api/platform/closures/:closureId/approve', requirePermission('platform.manage'), async (request, response, next) => {
    try {
      const closureId = parse(organizationIdSchema, request.params.closureId);
      const input = parse(closureApprovalSchema, request.body);
      const closure = await repo.approveOrganizationClosure(
        closureId, input.retentionDays, input.financialRetentionDays, request.user
      );
      if (!closure) return response.status(409).json({
        error: { code: 'SCHOOL_EXPORT_REQUIRED', message: 'A completed school data export is required before closure.' }
      });
      response.json({ data: closure });
    } catch (error) { next(error); }
  });

  app.post('/api/platform/closures/:closureId/pseudonymize', requirePermission('platform.manage'), async (request, response, next) => {
    try {
      const closureId = parse(organizationIdSchema, request.params.closureId);
      parse(closurePseudonymizationSchema, request.body);
      const result = await repo.pseudonymizeOrganizationClosure(closureId, request.user);
      if (!result) return response.status(409).json({
        error: { code: 'CLOSURE_RETENTION_ACTIVE', message: 'The approved retention deadline has not passed or this closure was already processed.' }
      });
      response.json({ data: result });
    } catch (error) { next(error); }
  });
}

export function registerPlatformLicenceRoutes(app, { requirePermission }) {
  app.post('/api/platform/licence/verify', requirePermission('platform.manage'), async (request, response, next) => {
    try {
      const licenceValue = typeof request.body === 'string' ? request.body : (request.body?.licence ?? request.body?.license ?? request.body?.raw ?? JSON.stringify(request.body ?? {}));
      const result = verifyLicenceDocument(licenceValue, { publicKey: request.body?.publicKey ?? undefined });
      response.json({ data: result });
    } catch (error) { next(error); }
  });

  app.post('/api/platform/license/verify', requirePermission('platform.manage'), async (request, response, next) => {
    try {
      const licenceValue = typeof request.body === 'string' ? request.body : (request.body?.licence ?? request.body?.license ?? request.body?.raw ?? JSON.stringify(request.body ?? {}));
      const result = verifyLicenceDocument(licenceValue, { publicKey: request.body?.publicKey ?? undefined });
      response.json({ data: result });
    } catch (error) { next(error); }
  });
}
