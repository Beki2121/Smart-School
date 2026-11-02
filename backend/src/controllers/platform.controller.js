import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { verifyLicenceDocument } from '../licence.js';
import {
  closureApprovalSchema, closurePseudonymizationSchema, organizationBranchCreateSchema,
  organizationBranchUpdateSchema, organizationStatusSchema, platformSchoolCreateSchema,
  subscriptionAssignmentSchema, subscriptionInvoiceSchema, subscriptionPaymentSchema,
  subscriptionPlanSchema
} from '../schemas/platform.schema.js';

const organizationIdSchema = z.string().uuid();

export function createPlatformController({ repo, config, parse }) {
  return {
    listOrganizationBranches: async (request, response, next) => {
      try { response.json({ data: await repo.listOrganizationBranches(request.user.orgId) }); }
      catch (error) { next(error); }
    },
    createOrganizationBranch: async (request, response, next) => {
      try {
        const branch = await repo.createOrganizationBranch(
          parse(organizationBranchCreateSchema, request.body), request.user
        );
        response.status(201).json({ data: branch });
      } catch (error) { next(error); }
    },
    updateOrganizationBranch: async (request, response, next) => {
      try {
        const branchId = parse(organizationIdSchema, request.params.branchId);
        const branch = await repo.updateOrganizationBranch(
          branchId, parse(organizationBranchUpdateSchema, request.body), request.user
        );
        if (!branch) return response.status(404).json({
          error: { code: 'BRANCH_NOT_FOUND', message: 'Branch not found in this school.' }
        });
        response.json({ data: branch });
      } catch (error) { next(error); }
    },
    createPlatformSchool: async (request, response, next) => {
      try {
        const input = parse(platformSchoolCreateSchema, request.body);
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        const result = await repo.createPlatformSchool(input, {
          id: randomUUID(), tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt
        }, request.user);
        response.set('Cache-Control', 'no-store').status(201).json({
          data: {
            ...result,
            invitationUrl: `${config.WEB_ORIGIN.replace(/\/+$/, '')}/invite/${token}`
          }
        });
      } catch (error) { next(error); }
    },
    regenerateSchoolAdministratorInvitation: async (request, response, next) => {
      try {
        const organizationId = parse(organizationIdSchema, request.params.organizationId);
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        const invitation = await repo.regenerateSchoolAdministratorInvitation(organizationId, {
          id: randomUUID(), tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt
        }, request.user);
        if (!invitation) return response.status(404).json({
          error: {
            code: 'SCHOOL_ADMIN_INVITATION_NOT_AVAILABLE',
            message: 'A pending school-administrator invitation cannot be regenerated.'
          }
        });
        response.set('Cache-Control', 'no-store').json({
          data: {
            ...invitation,
            invitationUrl: `${config.WEB_ORIGIN.replace(/\/+$/, '')}/invite/${token}`
          }
        });
      } catch (error) { next(error); }
    },
    getOverview: async (request, response, next) => {
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
    },
    listSchools: async (_request, response, next) => {
      try { response.json({ data: await repo.listPlatformSchools() }); }
      catch (error) { next(error); }
    },
    getSubscription: async (request, response, next) => {
      try {
        const organizationId = parse(organizationIdSchema, request.params.organizationId);
        const subscription = await repo.getOrganizationSubscription(organizationId);
        if (!subscription) return response.status(404).json({
          error: { code: 'SCHOOL_SUBSCRIPTION_NOT_FOUND', message: 'School subscription not found.' }
        });
        response.json({ data: subscription });
      } catch (error) { next(error); }
    },
    updateOrganizationStatus: async (request, response, next) => {
      try {
        const organizationId = parse(organizationIdSchema, request.params.organizationId);
        const input = parse(organizationStatusSchema, request.body);
        const organization = await repo.updateOrganizationStatus(organizationId, input.status, request.user);
        if (!organization) return response.status(404).json({
          error: { code: 'SCHOOL_NOT_FOUND', message: 'School tenant not found.' }
        });
        response.json({ data: organization });
      } catch (error) { next(error); }
    },
    assignPlan: async (request, response, next) => {
      try {
        const organizationId = parse(organizationIdSchema, request.params.organizationId);
        const input = parse(subscriptionAssignmentSchema, request.body);
        const subscription = await repo.assignOrganizationPlan(organizationId, input.planCode, request.user);
        if (!subscription) return response.status(404).json({
          error: { code: 'SCHOOL_OR_PLAN_NOT_FOUND', message: 'School subscription or active plan not found.' }
        });
        response.json({ data: subscription });
      } catch (error) { next(error); }
    },
    listSubscriptionPlans: async (_request, response, next) => {
      try { response.json({ data: await repo.listSubscriptionPlans() }); }
      catch (error) { next(error); }
    },
    saveSubscriptionPlan: async (request, response, next) => {
      try {
        const input = parse(subscriptionPlanSchema, { ...request.body, code: request.params.code });
        response.json({ data: await repo.saveSubscriptionPlan(input, request.user) });
      } catch (error) { next(error); }
    },
    createSubscriptionInvoice: async (request, response, next) => {
      try {
        const organizationId = parse(organizationIdSchema, request.params.organizationId);
        const input = parse(subscriptionInvoiceSchema, request.body);
        const invoice = await repo.createSubscriptionInvoice(organizationId, input, request.user);
        if (!invoice) return response.status(404).json({
          error: { code: 'SCHOOL_SUBSCRIPTION_NOT_FOUND', message: 'School subscription not found.' }
        });
        response.status(201).json({ data: invoice });
      } catch (error) { next(error); }
    },
    recordSubscriptionPayment: async (request, response, next) => {
      try {
        const invoiceId = parse(organizationIdSchema, request.params.invoiceId);
        const input = parse(subscriptionPaymentSchema, request.body);
        const payment = await repo.recordSubscriptionPayment(invoiceId, input, request.user);
        if (!payment) return response.status(409).json({
          error: { code: 'SUBSCRIPTION_PAYMENT_INVALID', message: 'Payment exceeds the invoice balance or the invoice is already paid.' }
        });
        response.status(201).json({ data: payment });
      } catch (error) { next(error); }
    },
    listClosureRequests: async (_request, response, next) => {
      try { response.json({ data: await repo.listClosureRequests() }); }
      catch (error) { next(error); }
    },
    approveClosure: async (request, response, next) => {
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
    },
    pseudonymizeClosure: async (request, response, next) => {
      try {
        const closureId = parse(organizationIdSchema, request.params.closureId);
        parse(closurePseudonymizationSchema, request.body);
        const result = await repo.pseudonymizeOrganizationClosure(closureId, request.user);
        if (!result) return response.status(409).json({
          error: { code: 'CLOSURE_RETENTION_ACTIVE', message: 'The approved retention deadline has not passed or this closure was already processed.' }
        });
        response.json({ data: result });
      } catch (error) { next(error); }
    },
    verifyLicence: async (request, response, next) => {
      try {
        const licenceValue = typeof request.body === 'string' ? request.body : (request.body?.licence ?? request.body?.license ?? request.body?.raw ?? JSON.stringify(request.body ?? {}));
        const result = verifyLicenceDocument(licenceValue, { publicKey: request.body?.publicKey ?? undefined });
        response.json({ data: result });
      } catch (error) { next(error); }
    }
  };
}
