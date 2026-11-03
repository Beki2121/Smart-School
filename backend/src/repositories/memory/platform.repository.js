import { randomUUID } from 'node:crypto';
import { decryptSensitiveValue, encryptSensitiveValue } from '../../secure-fields.js';
import {
  billingPeriodEnd, now, planLimitError, planLimitsExceededError, setupConflict
} from '../shared.js';
import { mapOrganization } from '../platform.mappers.js';

const schoolCode = () => `SCH-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;

export const memoryPlatformBundle = {
  async isOrganizationOperational(organizationId) {
    await this.refreshExpiredSubscriptions();
    const organization = this.organizations.find((item) => item.id === organizationId);
    if (!organization || organization.status !== 'active') return false;
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    if (!subscription) return true;
    const paidPeriodValid = subscription.status === 'active' &&
      (!subscription.periodEndsAt || new Date(subscription.periodEndsAt) > new Date());
    const trialValid = subscription.status === 'trialing' &&
      Boolean(subscription.trialEndsAt) && new Date(subscription.trialEndsAt) > new Date();
    return paidPeriodValid || trialValid;
  },
  async processSubscriptionExpiryNotifications(mailer = null, logger = null, organizationId = null) {
    await this.refreshExpiredSubscriptions(organizationId);
    const nowMs = Date.now();
    let mailConfigured = false;
    let mailConfigurationError = null;
    if (mailer) {
      try {
        mailConfigured = await mailer.isConfigured();
      } catch {
        mailConfigurationError = Object.assign(
          new Error('Configured SMTP credentials could not be decrypted.'),
          { code: 'SMTP_CREDENTIALS_UNAVAILABLE' }
        );
      }
    }
    const queuedEmails = [];
    for (const subscription of this.subscriptions.filter((item) =>
      !organizationId || item.organizationId === organizationId)) {
      const expiryAt = subscription.status === 'trialing' ? subscription.trialEndsAt
        : subscription.status === 'active' ? subscription.periodEndsAt
          : subscription.status === 'expired'
            ? subscription.periodEndsAt ?? subscription.trialEndsAt : null;
      if (!expiryAt) continue;
      const expiryMs = Date.parse(expiryAt);
      const thresholds = subscription.status === 'expired' || expiryMs <= nowMs
        ? [0] : [30, 7, 1].filter((days) => expiryMs <= nowMs + days * 86400000);
      for (const thresholdDays of thresholds) {
        const alreadyCreated = this.subscriptionExpiryNotices.some((notice) =>
          notice.subscriptionId === subscription.id && notice.expiryAt === expiryAt &&
          notice.thresholdDays === thresholdDays);
        if (alreadyCreated) continue;
        const organization = this.organizations.find((item) =>
          item.id === subscription.organizationId);
        if (!organization) continue;
        const noticeId = randomUUID();
        const thresholdText = thresholdDays === 0 ? 'has expired'
          : `expires in ${thresholdDays} day${thresholdDays === 1 ? '' : 's'}`;
        const notice = {
          id: noticeId, subscriptionId: subscription.id,
          organizationId: subscription.organizationId, expiryAt, thresholdDays,
          createdAt: now()
        };
        const recipients = this.users.filter((user) =>
          user.orgId === subscription.organizationId && user.isActive !== false &&
          ['owner_director', 'group_executive', 'principal'].includes(user.role));
        this.subscriptionExpiryNotices.push(notice);
        for (const recipient of recipients) {
          this.userNotifications.unshift({
            id: randomUUID(), campusId: null, organizationId: subscription.organizationId,
            userId: recipient.id, sourceType: 'subscription_expiry', sourceId: noticeId,
            titleEn: 'Subscription expiry', titleAm: 'የደንበኝነት ጊዜ ማብቂያ',
            bodyEn: `Your subscription ${thresholdText} on ${new Date(expiryAt).toLocaleDateString('en-CA')}.`,
            bodyAm: `የደንበኝነት ጊዜዎ ${thresholdDays === 0 ? 'አብቅቷል' : `በ${thresholdDays} ቀን ውስጥ ያበቃል`}.`,
            readAt: null, createdAt: notice.createdAt
          });
          if (mailConfigured && recipient.email) queuedEmails.push({
            email: recipient.email, name: recipient.name, schoolName: organization.name,
            expiryAt, thresholdDays
          });
        }
        try {
          await this.appendAudit({
            sub: null, orgId: subscription.organizationId, activeCampusId: null
          }, 'subscription.expiry_notice_sent', 'subscription_expiry_notice', noticeId, null, {
            expiryAt, thresholdDays, recipientCount: recipients.length
          });
        } catch (error) {
          this.subscriptionExpiryNotices = this.subscriptionExpiryNotices.filter((item) =>
            item.id !== noticeId);
          this.userNotifications = this.userNotifications.filter((item) =>
            item.sourceId !== noticeId);
          throw error;
        }
      }
    }
    for (const message of queuedEmails) {
      try {
        await mailer.sendSubscriptionExpiryEmail(message);
      } catch (error) {
        logger?.warn({ errorCode: error.code ?? 'SMTP_DELIVERY_FAILED' },
          'Subscription expiry email delivery failed');
      }
    }
    if (mailConfigurationError) throw mailConfigurationError;
  },
  async isModuleEnabled(organizationId, moduleCode) {
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    if (!subscription) return true;
    const plan = this.subscriptionPlans.find((item) => item.id === subscription.planId);
    return plan?.code === 'legacy' || Boolean(plan?.modules.includes(moduleCode));
  },
  async listOrganizationBranches(organizationId) {
    return this.campuses.filter((campus) => campus.organizationId === organizationId)
      .map((campus) => ({
        id: campus.id, organizationId, name: campus.name,
        address: campus.address ?? '', phone: campus.phone ?? '',
        timezone: campus.timezone ?? 'Africa/Addis_Ababa', isActive: campus.isActive !== false
      })).sort((left, right) => left.name.localeCompare(right.name));
  },
  async createOrganizationBranch(data, actor) {
    const organization = this.organizations.find((item) => item.id === actor.orgId);
    if (!organization || organization.status !== 'active') return null;
    const subscription = this.subscriptions.find((item) => item.organizationId === actor.orgId);
    const plan = subscription && this.subscriptionPlans.find((item) => item.id === subscription.planId);
    const activeCount = this.campuses.filter((item) =>
      item.organizationId === actor.orgId && item.isActive !== false).length;
    if (plan?.siteLimit != null && activeCount >= plan.siteLimit) {
      throw planLimitError('branch', plan.siteLimit);
    }
    const campus = {
      id: randomUUID(), organizationId: actor.orgId, name: data.name,
      address: data.address ?? '', phone: data.phone ?? '',
      timezone: 'Africa/Addis_Ababa', isActive: true
    };
    const administrators = this.users.filter((user) =>
      user.orgId === actor.orgId && user.role === 'owner_director');
    const beforeMemberships = administrators.map((user) => ({
      user, campusIds: [...(user.campusIds ?? [])]
    }));
    this.campuses.push(campus);
    for (const { user } of beforeMemberships) {
      user.campusIds = [...new Set([...(user.campusIds ?? []), campus.id])];
    }
    try {
      await this.appendAudit(actor, 'school.branch_created', 'campus', campus.id, null, {
        name: campus.name, isActive: true
      });
    } catch (error) {
      this.campuses.splice(this.campuses.indexOf(campus), 1);
      for (const { user, campusIds } of beforeMemberships) user.campusIds = campusIds;
      throw error;
    }
    return (await this.listOrganizationBranches(actor.orgId)).find((item) => item.id === campus.id);
  },
  async updateOrganizationBranch(branchId, data, actor) {
    const campus = this.campuses.find((item) =>
      item.id === branchId && item.organizationId === actor.orgId);
    if (!campus) return null;
    const nextIsActive = data.isActive ?? campus.isActive !== false;
    if (nextIsActive && campus.isActive === false) {
      const subscription = this.subscriptions.find((item) => item.organizationId === actor.orgId);
      const plan = subscription && this.subscriptionPlans.find((item) => item.id === subscription.planId);
      const activeCount = this.campuses.filter((item) =>
        item.organizationId === actor.orgId && item.isActive !== false).length;
      if (plan?.siteLimit != null && activeCount >= plan.siteLimit) {
        throw planLimitError('branch', plan.siteLimit);
      }
    }
    if (!nextIsActive && campus.isActive !== false &&
        this.campuses.filter((item) =>
          item.organizationId === actor.orgId && item.isActive !== false).length <= 1) {
      throw setupConflict('The last active branch cannot be deactivated.');
    }
    const before = {
      name: campus.name, isActive: campus.isActive !== false
    };
    if (data.name !== undefined) campus.name = data.name;
    campus.isActive = nextIsActive;
    try {
      await this.appendAudit(actor, 'school.branch_updated', 'campus', campus.id, before, {
        name: campus.name, isActive: campus.isActive
      });
    } catch (error) {
      campus.name = before.name;
      campus.isActive = before.isActive;
      throw error;
    }
    return (await this.listOrganizationBranches(actor.orgId)).find((item) => item.id === campus.id);
  },
  async createPlatformSchool(data, invitation, actor) {
    if (this.users.some((user) => user.email?.toLowerCase() === data.ownerEmail)) {
      throw setupConflict('An account already uses this email address.');
    }
    const organizationId = randomUUID();
    const campusId = randomUUID();
    const plan = this.subscriptionPlans.find((item) => item.code === 'starter');
    if (!plan?.isActive) throw new Error('The active starter subscription plan is not configured.');
    const activatedAt = now();
    const trialEndsAt = new Date(Date.now() + plan.trialDays * 86400000).toISOString();
    const organization = {
      id: organizationId, name: data.schoolName, status: 'active',
      schoolCode: schoolCode(),
      preferredLocale: data.locale, currencyCode: data.currencyCode,
      branding: { logoUrl: '', primaryColor: '#0f766e' },
      academicConfiguration: data.academicConfiguration ?? {},
      logoData: null, logoMimeType: null, logoSizeBytes: 0, requestedAt: activatedAt,
      activatedAt, suspendedAt: null, closedAt: null, trialEndsAt
    };
    const campus = {
      id: campusId, organizationId, name: 'Main Branch', address: data.address,
      phone: data.schoolPhone, timezone: data.timezone, isActive: true
    };
    const invitationRecord = {
      id: invitation.id, orgId: organizationId, campusId, email: data.ownerEmail,
      role: 'owner_director', targetType: 'school_administrator', targetId: organizationId,
      targetName: data.ownerName, tokenHash: invitation.tokenHash,
      expiresAt: invitation.expiresAt, acceptedAt: null, createdBy: actor.sub
    };
    const lengths = {
      organizations: this.organizations.length, campuses: this.campuses.length,
      subscriptions: this.subscriptions.length, invitations: this.accountInvitations.length,
      audit: this.audit.length
    };
    this.organizations.push(organization);
    this.campuses.push(campus);
    this.subscriptions.push({
      id: randomUUID(), organizationId, planId: plan.id, status: 'trialing',
      trialStartedAt: activatedAt, trialEndsAt, periodStartedAt: null, periodEndsAt: null
    });
    const schoolActor = { ...actor, orgId: organizationId, activeCampusId: null };
    const campusActor = { ...schoolActor, activeCampusId: campusId };
    try {
      await this.assertUserCapacity(organizationId, 1);
      this.accountInvitations.push(invitationRecord);
      await this.appendAudit(schoolActor, 'school.platform_created', 'organization', organizationId, null, {
        schoolName: data.schoolName, ownerEmail: data.ownerEmail,
        status: 'active', subscriptionStatus: 'trialing', trialEndsAt
      });
      await this.appendAudit(campusActor, 'account_invitation.created', 'account_invitation',
        invitation.id, null, {
          email: data.ownerEmail, role: invitationRecord.role,
          targetType: invitationRecord.targetType, targetId: organizationId,
          expiresAt: invitation.expiresAt
        });
    } catch (error) {
      this.organizations.length = lengths.organizations;
      this.campuses.length = lengths.campuses;
      this.subscriptions.length = lengths.subscriptions;
      this.accountInvitations.length = lengths.invitations;
      this.audit.length = lengths.audit;
      throw error;
    }
    return {
      organizationId, status: 'active', trialEndsAt,
      invitation: {
        id: invitation.id, email: data.ownerEmail, role: invitationRecord.role,
        name: data.ownerName, expiresAt: invitation.expiresAt
      }
    };
  },
  async listPlatformSchools() {
    await this.refreshExpiredSubscriptions();
    return this.organizations.filter((organization) => organization.status !== 'platform').map((organization) => ({
      ...mapOrganization(organization),
      owner: (() => {
        const owner = this.users.find((user) =>
          user.orgId === organization.id && user.role === 'owner_director');
        return owner ? { name: owner.name, email: owner.email ?? '' } : null;
      })(),
      adminInvitationAvailable: this.accountInvitations.some((invitation) =>
        invitation.orgId === organization.id &&
        invitation.targetType === 'school_administrator' &&
        invitation.targetId === organization.id && invitation.acceptedAt === null),
      campuses: this.campuses.filter((campus) => campus.organizationId === organization.id)
        .map(({ id, name }) => ({ id, name })),
      studentCount: this.students.filter((student) =>
        this.campuses.some((campus) => campus.id === student.campusId &&
          campus.organizationId === organization.id && !student.archivedAt)).length,
      userCount: this.users.filter((user) =>
        user.orgId === organization.id && user.isActive !== false).length +
        this.accountInvitations.filter((item) => item.orgId === organization.id &&
          item.acceptedAt === null && Date.parse(item.expiresAt) > Date.now()).length,
      subscription: (() => {
        const subscription = this.subscriptions.find((item) => item.organizationId === organization.id);
        const plan = subscription && this.subscriptionPlans.find((item) => item.id === subscription.planId);
        return subscription ? {
          status: subscription.status, trialEndsAt: subscription.trialEndsAt ?? null,
          periodEndsAt: subscription.periodEndsAt ?? null,
          planCode: plan?.code ?? '', planName: plan?.name ?? '',
          expiryWarning: this.subscriptionExpiryWarning(subscription)
        } : null
      })()
    }));
  },
  async refreshExpiredSubscriptions(organizationId = null) {
    const timestamp = Date.now();
    for (const subscription of this.subscriptions.filter((item) =>
      !organizationId || item.organizationId === organizationId)) {
      const expiry = subscription.status === 'trialing' ? subscription.trialEndsAt
        : subscription.status === 'active' ? subscription.periodEndsAt : null;
      if (!expiry || Date.parse(expiry) > timestamp) continue;
      const before = { status: subscription.status, trialEndsAt: subscription.trialEndsAt ?? null,
        periodEndsAt: subscription.periodEndsAt ?? null };
      subscription.status = 'expired';
      try {
        await this.appendAudit({
          sub: null, orgId: subscription.organizationId, activeCampusId: null
        }, 'subscription.expired', 'organization_subscription', subscription.id, before, {
          ...before, status: 'expired'
        });
      } catch (error) {
        subscription.status = before.status;
        throw error;
      }
    }
  },
  subscriptionExpiryWarning(subscription) {
    const expiry = subscription.status === 'trialing' ? subscription.trialEndsAt
      : subscription.status === 'active' ? subscription.periodEndsAt : null;
    return expiry && Date.parse(expiry) > Date.now() &&
      Date.parse(expiry) <= Date.now() + 30 * 86400000 ? expiry : null;
  },
  async updateOrganizationStatus(organizationId, status, actor) {
    const organization = this.organizations.find((item) => item.id === organizationId);
    if (!organization || organization.status === 'platform') return null;
    const before = { status: organization.status };
    organization.status = status;
    organization.activatedAt = status === 'active' ? now() : organization.activatedAt;
    organization.suspendedAt = status === 'suspended' ? now() : null;
    for (const campus of this.campuses.filter((item) => item.organizationId === organizationId)) {
      campus.isActive = status === 'active';
    }
    if (status === 'active') {
      const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
      if (subscription?.status === 'pending') {
        const plan = this.subscriptionPlans.find((item) => item.id === subscription.planId);
        subscription.status = 'trialing';
        subscription.trialStartedAt = now();
        subscription.trialEndsAt = new Date(Date.now() + plan.trialDays * 86400000).toISOString();
        organization.trialEndsAt = subscription.trialEndsAt;
      }
    }
    await this.appendAudit({ ...actor, orgId: organizationId, activeCampusId: null },
      `school.${status}`, 'organization', organizationId, before, { status });
    return organization;
  },
  async listSubscriptionPlans() { return this.subscriptionPlans; },
  async assignOrganizationPlan(organizationId, planCode, actor) {
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    const plan = this.subscriptionPlans.find((item) => item.code === planCode && item.isActive);
    if (!subscription || !plan) return null;
    await this.assertPlanFitsOrganization(plan, organizationId);
    const before = {
      planId: subscription.planId, status: subscription.status,
      trialEndsAt: subscription.trialEndsAt, periodEndsAt: subscription.periodEndsAt
    };
    subscription.planId = plan.id;
    await this.appendAudit({ ...actor, orgId: organizationId, activeCampusId: null },
      'school.plan_assigned', 'organization_subscription',
      subscription.id, before, {
        planCode, status: subscription.status,
        trialEndsAt: subscription.trialEndsAt, periodEndsAt: subscription.periodEndsAt
      });
    return this.getOrganizationSubscription(organizationId);
  },
  async saveSubscriptionPlan(data, actor) {
    let plan = this.subscriptionPlans.find((item) => item.code === data.code);
    const before = plan ? { ...plan } : null;
    const savedData = {
      ...data,
      maxUsers: data.maxUsers === undefined ? (plan ? plan.maxUsers : 50) : data.maxUsers,
      storageLimitBytes: data.storageLimitBytes === undefined
        ? (plan ? plan.storageLimitBytes : 1073741824) : data.storageLimitBytes
    };
    const assignedOrganizationIds = plan ? this.subscriptions
      .filter((subscription) => subscription.planId === plan.id)
      .map((subscription) => subscription.organizationId) : [];
    for (const organizationId of assignedOrganizationIds) {
      await this.assertPlanFitsOrganization(savedData, organizationId);
    }
    if (plan) Object.assign(plan, savedData);
    else {
      plan = { id: randomUUID(), ...savedData };
      this.subscriptionPlans.push(plan);
    }
    await this.appendAudit(actor, 'subscription_plan.saved', 'subscription_plan', plan.id, before, plan);
    return plan;
  },
  async assertPlanFitsOrganization(plan, organizationId) {
    const campusIds = new Set(this.campuses.filter((campus) =>
      campus.organizationId === organizationId).map((campus) => campus.id));
    const checks = [
      ['student', plan.studentLimit, this.students.filter((item) =>
        campusIds.has(item.campusId) && !item.archivedAt).length],
      ['staff', plan.staffLimit, this.staff.filter((item) =>
        campusIds.has(item.campusId) && item.employmentStatus !== 'terminated' &&
        !item.archivedAt).length],
      ['branch', plan.siteLimit, this.campuses.filter((item) =>
        item.organizationId === organizationId && item.isActive !== false).length],
      ['user', plan.maxUsers, this.users.filter((item) =>
        item.orgId === organizationId && item.isActive !== false).length +
        this.accountInvitations.filter((item) => item.orgId === organizationId &&
          item.acceptedAt === null && Date.parse(item.expiresAt) > Date.now()).length],
      ['storage', plan.storageLimitBytes, this.getOrganizationStorageUsage(organizationId)]
    ];
    const exceeded = checks.filter(([, limit, current]) => limit != null && current > limit)
      .map(([resource, limit, current]) => ({ resource, limit, current }));
    if (exceeded.length) throw planLimitsExceededError(exceeded);
  },
  async getOrganizationSettings(organizationId) {
    const organization = this.organizations.find((item) => item.id === organizationId);
    return organization ? mapOrganization(organization) : null;
  },
  async updateOrganizationSettings(data, actor) {
    const organization = this.organizations.find((item) => item.id === actor.orgId);
    if (!organization) return null;
    const before = {
      preferredLocale: organization.preferredLocale, currencyCode: organization.currencyCode,
      branding: organization.branding
    };
    Object.assign(organization, data);
    await this.appendAudit(actor, 'school.settings_updated', 'organization', organization.id, before, data);
    return mapOrganization(organization);
  },
  async listClosureRequests() {
    return this.closureRequests.map((item) => ({
      ...item,
      schoolName: this.organizations.find((organization) =>
        organization.id === item.organizationId)?.name ?? ''
    }));
  },
  async getOrganizationSubscription(organizationId) {
    await this.refreshExpiredSubscriptions();
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    if (!subscription) return null;
    const plan = this.subscriptionPlans.find((item) => item.id === subscription.planId) ?? null;
    return {
      ...subscription,
      expiryWarning: this.subscriptionExpiryWarning(subscription),
      plan,
      invoices: this.subscriptionInvoices.filter((item) => item.organizationId === organizationId)
        .map((invoice) => ({
          ...invoice, payments: invoice.payments.map((payment) => ({
            ...payment,
            refundedAmount: this.subscriptionRefunds.filter((refund) =>
              refund.paymentId === payment.id).reduce((sum, refund) => sum + refund.amount, 0)
          }))
        }))
    };
  },
  async createSubscriptionInvoice(organizationId, data, actor) {
    const organization = this.organizations.find((item) => item.id === organizationId);
    if (!organization || organization.status === 'platform') return null;
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    const plan = subscription && this.subscriptionPlans.find((item) => item.id === subscription.planId);
    const invoice = {
      id: randomUUID(), organizationId, subscriptionId: subscription?.id ?? null,
      invoiceNumber: `SS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`,
      amount: data.amount, currencyCode: data.currencyCode ?? plan?.currencyCode ?? organization.currencyCode,
      status: 'issued', dueOn: data.dueOn, issuedBy: actor.sub, issuedAt: now(), payments: []
    };
    this.subscriptionInvoices.push(invoice);
    await this.appendAudit({ ...actor, orgId: organizationId, activeCampusId: null },
      'subscription_invoice.issued', 'subscription_invoice',
      invoice.id, null, invoice);
    return invoice;
  },
  async recordSubscriptionPayment(invoiceId, data, actor) {
    const invoice = this.subscriptionInvoices.find((item) => item.id === invoiceId);
    if (!invoice || invoice.status === 'paid' || data.amount <= 0 ||
      data.amount > invoice.amount - invoice.payments.reduce((sum, item) => sum + item.amount, 0)) return null;
    const payment = {
      id: randomUUID(), invoiceId, amount: data.amount, reference: data.reference,
      note: data.note, receivedOn: data.receivedOn, recordedBy: actor.sub, recordedAt: now()
    };
    const subscription = this.subscriptions.find((item) => item.id === invoice.subscriptionId);
    const before = {
      invoiceStatus: invoice.status,
      paidAmount: invoice.payments.reduce((sum, item) => sum + item.amount, 0),
      subscriptionStatus: subscription?.status ?? null,
      periodStartedAt: subscription?.periodStartedAt ?? null,
      periodEndsAt: subscription?.periodEndsAt ?? null
    };
    invoice.payments.push(payment);
    const paidTotal = invoice.payments.reduce((sum, item) => sum + item.amount, 0);
    if (paidTotal >= invoice.amount) {
      invoice.status = 'paid';
      invoice.paidAt = now();
      if (subscription) {
        subscription.status = 'active';
        subscription.periodStartedAt = now();
        const periodStart = Date.parse(subscription.periodEndsAt) > Date.now()
          ? subscription.periodEndsAt : subscription.periodStartedAt;
        subscription.periodEndsAt = billingPeriodEnd(periodStart,
          this.subscriptionPlans.find((plan) => plan.id === subscription.planId)?.billingCycle ?? 'monthly');
      }
    }
    this.subscriptionPayments.push(payment);
    await this.appendAudit({ ...actor, orgId: invoice.organizationId, activeCampusId: null },
      'subscription_payment.recorded', 'subscription_payment',
      payment.id, before, {
        payment, invoiceStatus: invoice.status,
        paidAmount: paidTotal, subscriptionStatus: subscription?.status ?? null,
        periodStartedAt: subscription?.periodStartedAt ?? null,
        periodEndsAt: subscription?.periodEndsAt ?? null
      });
    return payment;
  },
  async refundSubscriptionPayment(paymentId, data, actor) {
    const payment = this.subscriptionPayments.find((item) => item.id === paymentId);
    if (!payment) return null;
    const invoice = this.subscriptionInvoices.find((item) => item.id === payment.invoiceId);
    if (!invoice) return null;
    const refunded = this.subscriptionRefunds.filter((item) => item.paymentId === paymentId)
      .reduce((sum, item) => sum + item.amount, 0);
    if (data.amount > payment.amount - refunded) return null;
    const refund = {
      id: randomUUID(), organizationId: invoice.organizationId, paymentId,
      invoiceId: invoice.id, amount: data.amount, reason: data.reason,
      recordedBy: actor.sub, recordedAt: now()
    };
    const before = { refundedAmount: refunded, paymentAmount: payment.amount };
    this.subscriptionRefunds.push(refund);
    try {
      await this.appendAudit({
        ...actor, orgId: invoice.organizationId, activeCampusId: null
      }, 'subscription_payment.refunded', 'subscription_refund', refund.id, before, {
        ...refund, refundedAmount: refunded + data.amount
      });
    } catch (error) {
      this.subscriptionRefunds.pop();
      throw error;
    }
    return refund;
  },
  async getPlatformDashboard() {
    await this.refreshExpiredSubscriptions();
    const schools = await this.listPlatformSchools();
    const currentMonth = new Date().toISOString().slice(0, 7);
    const payments = this.subscriptionInvoices.flatMap((invoice) =>
      invoice.payments.map((payment) => ({ ...payment, organizationId: invoice.organizationId })));
    const revenueCollected = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const refunds = this.subscriptionRefunds.reduce((sum, refund) => sum + refund.amount, 0);
    const outstanding = this.subscriptionInvoices.reduce((sum, invoice) => sum + Math.max(0,
      invoice.amount - invoice.payments.reduce((paid, payment) => paid + payment.amount, 0)), 0);
    const storageBySchool = this.organizations.map((organization) => ({
      organizationId: organization.id, usedBytes: this.getOrganizationStorageUsage(organization.id),
      limitBytes: this.subscriptions.find((item) => item.organizationId === organization.id) &&
        this.subscriptionPlans.find((plan) => plan.id === this.subscriptions
          .find((item) => item.organizationId === organization.id)?.planId)?.storageLimitBytes
    }));
    return {
      generatedAt: now(), database: { reachable: true, checkedAt: now() },
      totals: {
        schools: schools.length,
        pending: schools.filter((school) => school.status === 'pending').length,
        active: schools.filter((school) => school.status === 'active').length,
        suspended: schools.filter((school) => school.status === 'suspended').length,
        students: schools.reduce((sum, school) => sum + school.studentCount, 0),
        staff: this.staff.length,
        activeSubscriptions: this.subscriptions.filter((item) => item.status === 'active').length,
        expiredSubscriptions: this.subscriptions.filter((item) => item.status === 'expired').length,
        trialingSubscriptions: this.subscriptions.filter((item) => item.status === 'trialing').length,
        expiringSubscriptions: this.subscriptions.filter((item) =>
          this.subscriptionExpiryWarning(item)).length,
        revenueCollected, currentMonthRevenue: payments
          .filter((payment) => payment.receivedOn?.startsWith(currentMonth))
          .reduce((sum, payment) => sum + payment.amount, 0),
        outstanding, refunds, netRevenue: revenueCollected - refunds,
        storageUsedBytes: storageBySchool.reduce((sum, school) => sum + school.usedBytes, 0)
      },
      storageBySchool,
      schools,
      plans: await this.listSubscriptionPlans()
    };
  },
  getOrganizationStorageUsage(organizationId) {
    const campusIds = new Set(this.campuses.filter((campus) =>
      campus.organizationId === organizationId).map((campus) => campus.id));
    const studentBytes = this.studentDocuments.filter((document) =>
      this.students.some((student) => student.id === document.studentId &&
        campusIds.has(student.campusId))).reduce((sum, document) => sum + document.sizeBytes, 0);
    const admissionBytes = this.admissionDocuments.filter((document) =>
      this.admissions.some((admission) => admission.id === document.admissionId &&
        campusIds.has(admission.campusId))).reduce((sum, document) => sum + document.sizeBytes, 0);
    const assignmentBytes = this.assignmentAttachments
      .filter((attachment) => attachment.organizationId === organizationId)
      .reduce((sum, attachment) => sum + attachment.sizeBytes, 0);
    const organization = this.organizations.find((item) => item.id === organizationId);
    return studentBytes + admissionBytes + assignmentBytes + Number(organization?.logoSizeBytes ?? 0);
  },
  async assertStorageCapacity(organizationId, additionalBytes, replaceBytes = 0) {
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    const plan = subscription && this.subscriptionPlans.find((item) => item.id === subscription.planId);
    if (plan?.storageLimitBytes == null) return;
    if (this.getOrganizationStorageUsage(organizationId) - replaceBytes + additionalBytes >
        plan.storageLimitBytes) throw planLimitError('storage', plan.storageLimitBytes);
  },
  async getPlatformSettings() {
    const { smtpPasswordCiphertext, ...settings } = this.globalSettings;
    return {
      ...settings, smtpPasswordConfigured: Boolean(smtpPasswordCiphertext),
      smtpConfigured: Boolean(settings.smtpHost && settings.smtpUser &&
        (smtpPasswordCiphertext || this.smtpPassword))
    };
  },
  async updatePlatformSettings(data, actor) {
    const before = await this.getPlatformSettings();
    const original = { ...this.globalSettings };
    const next = { ...this.globalSettings, ...data };
    if (data.smtpPassword) {
      next.smtpPasswordCiphertext = encryptSensitiveValue(data.smtpPassword, this.sensitiveDataKey);
    }
    delete next.smtpPassword;
    const { smtpPasswordCiphertext, ...safeNext } = next;
    this.globalSettings = next;
    try {
      await this.appendAudit(actor, 'platform.settings_updated', 'platform_settings', 'global',
        before, { ...safeNext, smtpPasswordConfigured: Boolean(smtpPasswordCiphertext) });
    } catch (error) {
      this.globalSettings = original;
      throw error;
    }
    return this.getPlatformSettings();
  },
  async getMailTransportSettings() {
    const settings = this.globalSettings;
    if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPasswordCiphertext) return null;
    return {
      SMTP_HOST: settings.smtpHost, SMTP_PORT: settings.smtpPort,
      SMTP_SECURE: settings.smtpSecure, SMTP_USER: settings.smtpUser,
      SMTP_PASSWORD: settings.smtpPasswordCiphertext
        ? decryptSensitiveValue(settings.smtpPasswordCiphertext, this.sensitiveDataKey) : '',
      SMTP_FROM: settings.smtpFrom
    };
  },
  async saveOrganizationLogo(organizationId, data, actor) {
    const organization = this.organizations.find((item) =>
      item.id === organizationId && item.status !== 'platform');
    if (!organization) return null;
    await this.assertStorageCapacity(organizationId, data.content.length, organization.logoSizeBytes ?? 0);
    const before = {
      logoMimeType: organization.logoMimeType ?? null,
      logoSizeBytes: organization.logoSizeBytes ?? 0
    };
    const previousData = organization.logoData ?? null;
    organization.logoData = data.content.toString('base64');
    organization.logoMimeType = data.mimeType;
    organization.logoSizeBytes = data.content.length;
    try {
      await this.appendAudit({ ...actor, orgId: organizationId, activeCampusId: null },
        'school.logo_updated', 'organization', organizationId, before, {
        logoMimeType: data.mimeType, logoSizeBytes: data.content.length
      });
    } catch (error) {
      organization.logoData = previousData;
      organization.logoMimeType = before.logoMimeType;
      organization.logoSizeBytes = before.logoSizeBytes;
      throw error;
    }
    return { mimeType: organization.logoMimeType, sizeBytes: organization.logoSizeBytes };
  },
  async getOrganizationLogo(organizationId) {
    const organization = this.organizations.find((item) => item.id === organizationId);
    return organization?.logoData ? {
      mimeType: organization.logoMimeType,
      content: Buffer.from(organization.logoData, 'base64')
    } : null;
  },
  async getSubscriptionRevenueReport() {
    return this.subscriptionInvoices.map((invoice) => {
      const paid = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
      const refunded = this.subscriptionRefunds.filter((item) => item.invoiceId === invoice.id)
        .reduce((sum, item) => sum + item.amount, 0);
      return {
        organizationId: invoice.organizationId,
        schoolName: this.organizations.find((item) => item.id === invoice.organizationId)?.name ?? '',
        invoiceNumber: invoice.invoiceNumber, currencyCode: invoice.currencyCode,
        invoiceAmount: invoice.amount, paidAmount: paid, outstandingAmount: invoice.amount - paid,
        refundedAmount: refunded, netRevenue: paid - refunded, status: invoice.status
      };
    });
  },
  async getSubscriptionOutstandingReport({ from, to } = {}) {
    const items = this.subscriptionInvoices.flatMap((invoice) => {
      const issuedOn = String(invoice.issuedAt ?? '').slice(0, 10);
      if ((from && issuedOn < from) || (to && issuedOn > to)) return [];
      const paidAmount = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
      const outstandingAmount = Math.max(0, invoice.amount - paidAmount);
      if (!outstandingAmount) return [];
      return [{
        organizationId: invoice.organizationId,
        schoolName: this.organizations.find((item) =>
          item.id === invoice.organizationId)?.name ?? '',
        invoiceNumber: invoice.invoiceNumber, currencyCode: invoice.currencyCode,
        issuedOn, dueOn: invoice.dueOn ?? null,
        invoiceAmount: invoice.amount, paidAmount, outstandingAmount
      }];
    });
    const totalsByCurrency = new Map();
    for (const item of items) {
      const total = totalsByCurrency.get(item.currencyCode) ?? {
        currencyCode: item.currencyCode, invoiceCount: 0, outstandingAmount: 0
      };
      total.invoiceCount += 1;
      total.outstandingAmount += item.outstandingAmount;
      totalsByCurrency.set(item.currencyCode, total);
    }
    return {
      from: from ?? null, to: to ?? null,
      totals: [...totalsByCurrency.values()].sort((left, right) =>
        left.currencyCode.localeCompare(right.currencyCode)),
      items
    };
  },
  async requestOrganizationClosure(data, actor) {
    const closure = {
      id: randomUUID(), organizationId: actor.orgId, status: 'requested',
      reason: data.reason, requestedBy: actor.sub, requestedAt: now(),
      exportedAt: null, approvedAt: null, retentionUntil: null
    };
    this.closureRequests.push(closure);
    await this.appendAudit(actor, 'school.closure_requested', 'organization_closure',
      closure.id, null, { reason: data.reason, status: closure.status });
    return closure;
  },
  async getOrganizationExport(organizationId) {
    const organization = this.organizations.find((item) => item.id === organizationId);
    if (!organization) return null;
    const campuses = this.campuses.filter((item) => item.organizationId === organizationId);
    const campusIds = new Set(campuses.map((item) => item.id));
    const students = this.students.filter((item) => campusIds.has(item.campusId));
    const studentIds = new Set(students.map((item) => item.id));
    const academicYears = this.academicYears.filter((item) => campusIds.has(item.campusId));
    const yearIds = new Set(academicYears.map((item) => item.id));
    const admissions = this.admissions.filter((item) => campusIds.has(item.campusId));
    const admissionIds = new Set(admissions.map((item) => item.id));
    const invoices = this.feeInvoices.filter((item) => campusIds.has(item.campusId));
    const campusItems = (items) => items.filter((item) => campusIds.has(item.campusId));
    return {
      exportFormatVersion: 1, exportedAt: now(), organization: mapOrganization(organization), campuses,
      users: this.users.filter((item) => item.orgId === organizationId)
        .map(({ passwordHash: _hash, ...item }) => item),
      academicYears, terms: academicYears.flatMap((year) =>
        (year.terms ?? []).map((term) => ({ ...term, academicYearId: year.id }))),
      grades: this.gradeLevels.filter((item) => campusIds.has(item.campusId)),
      sections: this.sections.filter((item) => campusIds.has(item.campusId)),
      subjects: this.subjects.filter((item) => campusIds.has(item.campusId)),
      schoolCalendarEntries: campusItems(this.schoolCalendarEntries),
      curriculumUnits: campusItems(this.curriculumUnits),
      lessonPlans: campusItems(this.lessonPlans),
      promotionRules: campusItems(this.promotionRules),
      gradeSubjects: this.gradeSubjects.filter((item) =>
        this.gradeLevels.some((grade) => grade.id === item.gradeLevelId && campusIds.has(grade.campusId))),
      students, enrolments: this.enrolments.filter((item) =>
        studentIds.has(item.studentId) || yearIds.has(item.academicYearId)),
      guardians: this.guardians.filter((item) => item.organizationId === organizationId),
      studentGuardians: this.studentGuardians.filter((item) => studentIds.has(item.studentId)),
      studentSiblings: campusItems(this.studentSiblingLinks),
      staff: campusItems(this.staff), departments: campusItems(this.departments),
      teachingAssignments: campusItems(this.teachingAssignments),
      homeroomAssignments: campusItems(this.homeroomAssignments),
      attendance: this.attendance.filter((item) => campusIds.has(item.campusId)),
      attendanceCorrectionRequests: this.attendanceCorrectionRequests.filter((item) => campusIds.has(item.campusId)),
      staffAttendance: campusItems(this.staffAttendance), leaveRequests: campusItems(this.leaveRequests),
      staffMessages: campusItems(this.staffMessages),
      marks: this.marks.filter((item) => campusIds.has(item.campusId)),
      gradingBands: campusItems(this.gradingBands),
      gradingPolicies: campusItems(this.gradingPolicies),
      termReportRevisions: this.termReportRevisions.filter((item) => campusIds.has(item.campusId)),
      feeItems: this.feeItems.filter((item) => campusIds.has(item.campusId)),
      feeInvoices: invoices,
      invoiceLines: invoices.flatMap((item) => item.lines ?? []),
      feePayments: this.feePayments.filter((item) => campusIds.has(item.campusId)),
      cashierShifts: campusItems(this.cashierShifts), feeExpenses: campusItems(this.feeExpenses),
      admissions,
      admissionDocuments: this.admissionDocuments.filter((item) => admissionIds.has(item.admissionId))
        .map(({ content, ...item }) => ({ ...item, contentBase64: content.toString('base64') })),
      studentDocuments: this.studentDocuments.filter((item) => studentIds.has(item.studentId))
        .map(({ content, ...item }) => ({ ...item, contentBase64: content.toString('base64') })),
      studentTransferPackages: this.studentTransferPackages.filter((item) => studentIds.has(item.studentId))
        .map(({ shareTokenHash: _tokenHash, ...item }) => item),
      studentSectionTransfers: this.studentSectionTransfers.filter((item) => studentIds.has(item.studentId)),
      studentDisciplineRecords: this.studentDisciplineRecords.filter((item) => studentIds.has(item.studentId)),
      admissionCounters: [...this.admissionCounters.entries()]
        .filter(([campusId]) => campusIds.has(campusId))
        .map(([campusId, value]) => ({ campusId, ...value })),
      studentStatusHistory: campusItems(this.studentStatusHistory),
      studentEmergencyContacts: campusItems(this.studentEmergencyContacts),
      studentCommendations: campusItems(this.studentCommendations),
      announcements: campusItems(this.campusAnnouncements), events: campusItems(this.campusEvents),
      timetablePeriods: campusItems(this.timetablePeriods), rooms: campusItems(this.rooms),
      timetableSubstitutions: campusItems(this.timetableSubstitutions),
      notifications: campusItems(this.userNotifications),
      auditLog: this.audit.filter((item) => item.orgId === organizationId),
      accountInvitations: this.accountInvitations.filter((item) => item.orgId === organizationId)
        .map(({ tokenHash: _tokenHash, ...item }) => item),
      subscriptions: this.subscriptions.filter((item) => item.organizationId === organizationId),
      subscriptionPlans: this.subscriptionPlans.filter((plan) =>
        this.subscriptions.some((subscription) =>
          subscription.organizationId === organizationId && subscription.planId === plan.id)),
      subscriptionInvoices: this.subscriptionInvoices.filter((item) => item.organizationId === organizationId),
      subscriptionPayments: this.subscriptionPayments.filter((payment) =>
        this.subscriptionInvoices.some((invoice) =>
          invoice.organizationId === organizationId && invoice.id === payment.invoiceId)),
      closureRequests: this.closureRequests.filter((item) => item.organizationId === organizationId),
      protectedStudentData: [...this.studentSensitive.entries()]
        .filter(([studentId]) => studentIds.has(studentId))
        .map(([studentId, values]) => ({ studentId, ...values })),
      securityNotice: 'Passwords, refresh tokens, and account-invitation token hashes are intentionally excluded.'
    };
  },
  async markOrganizationExported(organizationId, actor) {
    const closure = this.closureRequests.filter((item) => item.organizationId === organizationId)
      .filter((item) => item.status === 'requested')
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
    if (!closure) return null;
    closure.exportedAt = now();
    closure.status = 'exported';
    await this.appendAudit(actor, 'school.data_exported', 'organization_closure',
      closure.id, { status: 'requested' }, { status: 'exported' });
    return closure;
  },
  async approveOrganizationClosure(closureId, retentionDays, financialRetentionDays, actor) {
    const closure = this.closureRequests.find((item) => item.id === closureId);
    if (!closure || closure.status !== 'exported' || !closure.exportedAt) return null;
    const retentionUntil = new Date(Date.now() + retentionDays * 86400000).toISOString();
    const financialRetentionUntil = new Date(Date.now() + financialRetentionDays * 86400000).toISOString();
    closure.status = 'retention';
    closure.approvedAt = now();
    closure.retentionUntil = retentionUntil;
    closure.financialRetentionUntil = financialRetentionUntil;
    const organization = this.organizations.find((item) => item.id === closure.organizationId);
    if (organization) {
      organization.status = 'closed';
      organization.closedAt = now();
      organization.closureRetentionUntil = retentionUntil;
    }
    await this.updateOrganizationStatus(closure.organizationId, 'closed', actor);
    await this.appendAudit(actor, 'school.closure_approved', 'organization_closure',
      closure.id, { status: 'exported' }, {
        status: closure.status, retentionUntil, financialRetentionUntil
      });
    return closure;
  },
  async pseudonymizeOrganizationClosure(closureId, actor) {
    const closure = this.closureRequests.find((item) => item.id === closureId);
    if (!closure || closure.status !== 'retention' ||
        !closure.retentionUntil || Date.parse(closure.retentionUntil) > Date.now()) return null;
    const campusIds = new Set(this.campuses
      .filter((campus) => campus.organizationId === closure.organizationId).map((campus) => campus.id));
    const students = this.students.filter((student) => campusIds.has(student.campusId));
    const studentIds = new Set(students.map((student) => student.id));
    const pseudonymizedName = (id, prefix) => `${prefix} ${String(id).slice(-8)}`;
    for (const student of students) {
      student.studentNo = `ANON-${String(student.id).replace(/-/g, '').slice(-24)}`;
      student.givenNameAm = student.fatherNameAm = student.grandfatherNameAm = 'የተደበቀ';
      student.givenNameEn = student.fatherNameEn = student.grandfatherNameEn = 'Former student';
      student.gender = 'other';
      student.dateOfBirth = null;
      student.sectionName = null;
      student.guardianPhone = null;
      student.previousSchool = null;
      student.idNumberEnc = student.idNumberHash = null;
      student.healthNotesEnc = student.specialNeedsEnc = null;
      student.archivedAt ??= now();
    }
    for (const guardian of this.guardians.filter((item) => item.organizationId === closure.organizationId)) {
      guardian.givenNameAm = guardian.fatherNameAm = guardian.grandfatherNameAm = 'የተደበቀ';
      guardian.givenNameEn = guardian.fatherNameEn = guardian.grandfatherNameEn = 'Former guardian';
      guardian.phone = 'REDACTED';
      guardian.email = null;
      guardian.nationalIdEnc = guardian.nationalIdHash = null;
    }
    for (const admission of this.admissions.filter((item) => campusIds.has(item.campusId))) {
      admission.givenNameAm = admission.fatherNameAm = admission.grandfatherNameAm = 'የተደበቀ';
      admission.givenNameEn = admission.fatherNameEn = admission.grandfatherNameEn = 'Former applicant';
      admission.gender = 'other';
      admission.dateOfBirth = null;
      admission.guardianName = 'Former guardian';
      admission.guardianPhone = 'REDACTED';
      admission.guardianEmail = null;
      admission.previousSchool = null;
      admission.decisionNote = null;
      admission.requiredDocuments = [];
    }
    for (const user of this.users.filter((item) => item.orgId === closure.organizationId)) {
      user.name = pseudonymizedName(user.id, 'Former account');
      user.email = null;
      user.phone = null;
      user.username = null;
      user.isActive = false;
      user.passwordHash = randomUUID();
    }
    for (const staff of this.staff.filter((item) => campusIds.has(item.campusId))) {
      staff.givenNameEn = staff.fatherNameEn = staff.grandfatherNameEn = 'Former staff';
      staff.givenNameAm = staff.fatherNameAm = staff.grandfatherNameAm = 'የተደበቀ';
      staff.qualification = null;
      staff.jobTitle = 'Former staff';
      staff.employmentStatus = 'terminated';
    }
    this.studentGuardians = this.studentGuardians
      .filter((item) => !studentIds.has(item.studentId));
    this.studentSiblingLinks = this.studentSiblingLinks.filter((item) =>
      !studentIds.has(item.studentId) && !studentIds.has(item.siblingStudentId));
    this.studentSensitive = new Map([...this.studentSensitive.entries()]
      .filter(([studentId]) => !studentIds.has(studentId)));
    this.studentEmergencyContacts = this.studentEmergencyContacts
      .filter((item) => !studentIds.has(item.studentId));
    this.admissionDocuments = this.admissionDocuments
      .filter((item) => !this.admissions.some((admission) =>
        campusIds.has(admission.campusId) && admission.id === item.admissionId));
    this.studentDocuments = this.studentDocuments.filter((item) => !studentIds.has(item.studentId));
    this.studentTransferPackages = this.studentTransferPackages.filter((item) => !studentIds.has(item.studentId));
    this.studentSectionTransfers = this.studentSectionTransfers.filter((item) => !studentIds.has(item.studentId));
    this.studentDisciplineRecords = this.studentDisciplineRecords.filter((item) => !studentIds.has(item.studentId));
    for (const item of this.studentStatusHistory.filter((record) => studentIds.has(record.studentId))) {
      item.reason = null;
    }
    for (const item of this.attendance.filter((record) => studentIds.has(record.studentId))) {
      item.reason = null;
    }
    for (const item of this.attendanceCorrectionRequests.filter((record) => studentIds.has(record.studentId))) {
      item.reason = 'Personal details removed during approved school closure.';
      item.reviewNote = null;
    }
    for (const item of this.studentCommendations.filter((record) => studentIds.has(record.studentId))) {
      item.titleEn = 'Recognition';
      item.titleAm = 'እውቅና';
      item.descriptionEn = item.descriptionAm = '';
    }
    for (const item of this.leaveRequests.filter((record) => campusIds.has(record.campusId))) {
      item.reason = 'Details removed during approved school closure.';
      item.reviewNote = null;
    }
    for (const item of this.staffMessages.filter((record) => campusIds.has(record.campusId))) {
      item.title = 'School record';
      item.body = 'Message details removed during approved school closure.';
    }
    for (const item of this.campusAnnouncements.filter((record) => campusIds.has(record.campusId))) {
      item.titleEn = 'School announcement';
      item.titleAm = 'የትምህርት ቤት ማስታወቂያ';
      item.bodyEn = 'Details removed during approved school closure.';
      item.bodyAm = 'በተፈቀደው የትምህርት ቤት መዝጊያ ሂደት ዝርዝሮች ተወግደዋል።';
    }
    for (const item of this.campusEvents.filter((record) => campusIds.has(record.campusId))) {
      item.titleEn = 'School event';
      item.titleAm = 'የትምህርት ቤት ዝግጅት';
      item.descriptionEn = 'Details removed during approved school closure.';
      item.descriptionAm = 'በተፈቀደው የትምህርት ቤት መዝጊያ ሂደት ዝርዝሮች ተወግደዋል።';
      item.location = '';
    }
    for (const item of this.feeExpenses.filter((record) => campusIds.has(record.campusId))) {
      item.description = 'Description withheld after school closure.';
      item.reference = null;
    }
    for (const item of this.termReportRevisions.filter((record) => studentIds.has(record.studentId))) {
      item.snapshot = { redacted: true };
    }
    for (const item of this.feePayments.filter((record) => campusIds.has(record.campusId))) {
      item.reference = null;
      item.reason = null;
    }
    for (const item of this.audit.filter((record) => record.organizationId === closure.organizationId)) {
      item.before = null;
      item.after = null;
    }
    this.accountInvitations = this.accountInvitations
      .filter((item) => item.orgId !== closure.organizationId);
    this.userNotifications = this.userNotifications
      .filter((item) => !campusIds.has(item.campusId));
    closure.reason = 'Personal details removed during approved school closure.';
    closure.status = 'pseudonymized';
    closure.completedAt = now();
    await this.appendAudit(actor, 'school.closure_personal_data_pseudonymized',
      'organization_closure', closure.id, { status: 'retention' }, {
        status: closure.status, retainedFinancialData: true,
        financialRetentionUntil: closure.financialRetentionUntil
      });
    return {
      id: closure.id, organizationId: closure.organizationId, status: closure.status,
      pseudonymizedAt: closure.completedAt, students: students.length
    };
  }
};
