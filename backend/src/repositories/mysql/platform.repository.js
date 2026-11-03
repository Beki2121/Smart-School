import { randomUUID } from 'node:crypto';
import { decryptSensitiveValue, encryptSensitiveValue } from '../../secure-fields.js';
import {
  auditRow, billingPeriodEnd, now, planLimitError, planLimitsExceededError, setupConflict
} from '../shared.js';
import {
  fromMysqlDateTime, mapOrganization, mapSubscriptionPlan, toMysqlDateTime
} from '../platform.mappers.js';

const createSchoolCode = () => `SCH-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;

export const mysqlPlatformBundle = {
  async isOrganizationOperational(organizationId) {
    await this.refreshExpiredSubscriptions();
    const organization = await this.db('organizations').where({ id: organizationId }).first('status');
    if (organization?.status !== 'active') return false;
    const subscription = await this.db('organization_subscriptions')
      .where({ organization_id: organizationId }).orderBy('created_at', 'desc').first();
    if (!subscription) return true;
    const periodEndsAt = fromMysqlDateTime(subscription.period_ends_at);
    const trialEndsAt = fromMysqlDateTime(subscription.trial_ends_at);
    if (subscription.status === 'active') return !periodEndsAt || new Date(periodEndsAt) > new Date();
    return subscription.status === 'trialing' && Boolean(trialEndsAt) && new Date(trialEndsAt) > new Date();
  },
  async isModuleEnabled(organizationId, moduleCode) {
    const subscription = await this.db('organization_subscriptions as os')
      .join('subscription_plans as sp', 'sp.id', 'os.plan_id')
      .where('os.organization_id', organizationId).orderBy('os.created_at', 'desc')
      .select('sp.code', 'sp.modules_json').first();
    if (!subscription) return true;
    if (subscription.code === 'legacy') return true;
    let modules;
    try { modules = JSON.parse(subscription.modules_json); }
    catch (error) { throw new Error('Subscription plan module configuration is invalid.', { cause: error }); }
    return Array.isArray(modules) && modules.includes(moduleCode);
  },
  async listOrganizationBranches(organizationId) {
    const rows = await this.db('campuses').where({ organization_id: organizationId })
      .orderBy('name').select('id', 'organization_id', 'name', 'address', 'phone', 'timezone', 'is_active');
    return rows.map((row) => ({
      id: row.id, organizationId: row.organization_id, name: row.name,
      address: row.address ?? '', phone: row.phone ?? '', timezone: row.timezone,
      isActive: Boolean(row.is_active)
    }));
  },
  async createOrganizationBranch(data, actor) {
    return this.db.transaction(async (trx) => {
      const organization = await trx('organizations').where({ id: actor.orgId })
        .forUpdate().first('id', 'status');
      if (!organization || organization.status !== 'active') return null;
      const subscription = await trx('organization_subscriptions as os')
        .join('subscription_plans as sp', 'sp.id', 'os.plan_id')
        .where('os.organization_id', actor.orgId).orderBy('os.created_at', 'desc')
        .first('sp.site_limit');
      const [{ total }] = await trx('campuses').where({
        organization_id: actor.orgId, is_active: true
      }).count({ total: '*' });
      if (subscription?.site_limit != null && Number(total) >= Number(subscription.site_limit)) {
        throw planLimitError('branch', Number(subscription.site_limit));
      }
      const id = randomUUID();
      await trx('campuses').insert({
        id, organization_id: actor.orgId, name: data.name,
        address: data.address ?? '', phone: data.phone ?? '',
        timezone: 'Africa/Addis_Ababa', is_active: true
      });
      const administrators = await trx('users').where({
        organization_id: actor.orgId, role: 'owner_director'
      }).select('id');
      if (administrators.length) {
        await trx('user_campuses').insert(administrators.map(({ id: userId }) => ({
          user_id: userId, campus_id: id, is_active: true
        })));
      }
      await trx('audit_log').insert(auditRow(actor, 'school.branch_created', 'campus', id, null, {
        name: data.name, isActive: true
      }));
      const row = await trx('campuses').where({ id }).first();
      return {
        id: row.id, organizationId: row.organization_id, name: row.name,
        address: row.address ?? '', phone: row.phone ?? '', timezone: row.timezone,
        isActive: Boolean(row.is_active)
      };
    });
  },
  async updateOrganizationBranch(branchId, data, actor) {
    return this.db.transaction(async (trx) => {
      const organization = await trx('organizations').where({ id: actor.orgId })
        .forUpdate().first('id');
      if (!organization) return null;
      const branch = await trx('campuses').where({
        id: branchId, organization_id: actor.orgId
      }).forUpdate().first();
      if (!branch) return null;
      const nextIsActive = data.isActive ?? Boolean(branch.is_active);
      if (nextIsActive && !branch.is_active) {
        const subscription = await trx('organization_subscriptions as os')
          .join('subscription_plans as sp', 'sp.id', 'os.plan_id')
          .where('os.organization_id', actor.orgId).orderBy('os.created_at', 'desc')
          .first('sp.site_limit');
        const [{ total }] = await trx('campuses').where({
          organization_id: actor.orgId, is_active: true
        }).count({ total: '*' });
        if (subscription?.site_limit != null && Number(total) >= Number(subscription.site_limit)) {
          throw planLimitError('branch', Number(subscription.site_limit));
        }
      }
      if (!nextIsActive && branch.is_active) {
        const [{ total }] = await trx('campuses').where({
          organization_id: actor.orgId, is_active: true
        }).count({ total: '*' });
        if (Number(total) <= 1) throw setupConflict('The last active branch cannot be deactivated.');
      }
      const before = { name: branch.name, isActive: Boolean(branch.is_active) };
      await trx('campuses').where({ id: branchId }).update({
        ...(data.name === undefined ? {} : { name: data.name }),
        is_active: nextIsActive
      });
      const after = { name: data.name ?? branch.name, isActive: nextIsActive };
      await trx('audit_log').insert(auditRow(actor, 'school.branch_updated', 'campus', branchId, before, after));
      return {
        id: branch.id, organizationId: branch.organization_id, name: after.name,
        address: branch.address ?? '', phone: branch.phone ?? '',
        timezone: branch.timezone, isActive: after.isActive
      };
    });
  },
  async createPlatformSchool(data, invitation, actor) {
    const organizationId = randomUUID();
    const campusId = randomUUID();
    const subscriptionId = randomUUID();
    const plan = await this.db('subscription_plans').where({ code: 'starter', is_active: true })
      .first('id', 'trial_days');
    if (!plan) throw new Error('The active starter subscription plan is not configured.');
    const trialEndsAt = new Date(Date.now() + Number(plan.trial_days) * 86400000);
    const schoolActor = { ...actor, orgId: organizationId, activeCampusId: null };
    const campusActor = { ...schoolActor, activeCampusId: campusId };
    try {
      await this.db.transaction(async (trx) => {
        const existingUser = await trx('users')
          .whereRaw('LOWER(email) = ?', [data.ownerEmail.toLowerCase()]).first('id');
        if (existingUser) throw setupConflict('An account already uses this email address.');
        await trx('organizations').insert({
          id: organizationId, name: data.schoolName, status: 'active',
          school_code: createSchoolCode(),
          preferred_locale: data.locale, currency_code: data.currencyCode,
          branding_json: JSON.stringify({ logoUrl: '', primaryColor: '#0f766e' }),
          academic_configuration_json: JSON.stringify(data.academicConfiguration ?? {}),
          requested_at: trx.fn.now(), activated_at: trx.fn.now()
        });
        await trx('campuses').insert({
          id: campusId, organization_id: organizationId, name: 'Main Branch',
          address: data.address, phone: data.schoolPhone, timezone: data.timezone,
          is_active: true
        });
        await trx('organization_subscriptions').insert({
          id: subscriptionId, organization_id: organizationId,
          plan_id: plan.id, status: 'trialing',
          trial_started_at: trx.fn.now(), trial_ends_at: trialEndsAt
        });
        await this.assertUserCapacity(organizationId, 1, null, trx);
        await trx('account_invitations').insert({
          id: invitation.id, organization_id: organizationId, campus_id: campusId,
          email: data.ownerEmail, role: 'owner_director',
          target_type: 'school_administrator', target_id: organizationId,
          target_name: data.ownerName, token_hash: invitation.tokenHash,
          expires_at: toMysqlDateTime(invitation.expiresAt), accepted_at: null, created_by: actor.sub
        });
        await trx('audit_log').insert(auditRow(schoolActor,
          'school.platform_created', 'organization', organizationId, null, {
          schoolName: data.schoolName, ownerEmail: data.ownerEmail,
          status: 'active', subscriptionStatus: 'trialing', trialEndsAt: trialEndsAt.toISOString()
        }));
        await trx('audit_log').insert(auditRow(campusActor,
          'account_invitation.created', 'account_invitation', invitation.id, null, {
            email: data.ownerEmail, role: 'owner_director',
            targetType: 'school_administrator', targetId: organizationId,
            expiresAt: invitation.expiresAt
          }));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('An account already uses this email address.');
      throw error;
    }
    return {
      organizationId, status: 'active', trialEndsAt: trialEndsAt.toISOString(),
      invitation: {
        id: invitation.id, email: data.ownerEmail, role: 'owner_director',
        name: data.ownerName, expiresAt: invitation.expiresAt
      }
    };
  },
  async listPlatformSchools() {
    await this.refreshExpiredSubscriptions();
    const organizations = await this.db('organizations').whereNot({ status: 'platform' })
      .select('*').orderBy('created_at', 'desc');
    const results = [];
    for (const row of organizations) {
      const campuses = await this.db('campuses').where({ organization_id: row.id })
        .select('id', 'name');
      const owner = await this.db('users').where({
        organization_id: row.id, role: 'owner_director'
      }).first('name', 'email');
      const adminInvitation = await this.db('account_invitations').where({
        organization_id: row.id, target_type: 'school_administrator', target_id: row.id
      }).whereNull('accepted_at').first('id');
      const studentCount = await this.db('students as s')
        .join('campuses as c', 'c.id', 's.campus_id')
        .where('c.organization_id', row.id).whereNull('s.archived_at').count({ total: 's.id' }).first();
      const activeUsers = await this.db('users').where({
        organization_id: row.id, is_active: true
      }).count({ total: '*' }).first();
      const pendingInvitations = await this.db('account_invitations')
        .where({ organization_id: row.id }).whereNull('accepted_at')
        .where('expires_at', '>', this.db.fn.now()).count({ total: '*' }).first();
      const subscription = await this.db('organization_subscriptions as os')
        .join('subscription_plans as sp', 'sp.id', 'os.plan_id')
        .where({ 'os.organization_id': row.id })
        .orderBy('os.created_at', 'desc')
        .select('os.status', 'os.trial_ends_at', 'os.period_ends_at', 'sp.code', 'sp.name').first();
      results.push({
        ...mapOrganization(row),
        owner: owner ? { name: owner.name, email: owner.email } : null,
        adminInvitationAvailable: Boolean(adminInvitation),
        campuses, studentCount: Number(studentCount.total),
        userCount: Number(activeUsers.total) + Number(pendingInvitations.total),
        subscription: subscription ? {
          status: subscription.status, trialEndsAt: subscription.trial_ends_at,
          periodEndsAt: subscription.period_ends_at,
          planCode: subscription.code, planName: subscription.name,
          expiryWarning: this.subscriptionExpiryWarning({
            status: subscription.status, trial_ends_at: subscription.trial_ends_at,
            period_ends_at: subscription.period_ends_at
          })
        } : null
      });
    }
    return results;
  },
  async refreshExpiredSubscriptions(organizationId = null) {
    const timestamp = new Date();
    await this.db.transaction(async (trx) => {
      const expiredQuery = trx('organization_subscriptions').where(function () {
        this.where(function () {
          this.where('status', 'trialing').whereNotNull('trial_ends_at')
            .where('trial_ends_at', '<=', timestamp);
        }).orWhere(function () {
          this.where('status', 'active').whereNotNull('period_ends_at')
            .where('period_ends_at', '<=', timestamp);
        });
      }).forUpdate().select('id', 'organization_id', 'status', 'trial_ends_at', 'period_ends_at');
      if (organizationId) expiredQuery.where({ organization_id: organizationId });
      const expired = await expiredQuery;
      for (const subscription of expired) {
        const before = {
          status: subscription.status,
          trialEndsAt: fromMysqlDateTime(subscription.trial_ends_at),
          periodEndsAt: fromMysqlDateTime(subscription.period_ends_at)
        };
        await trx('organization_subscriptions').where({ id: subscription.id })
          .update({ status: 'expired' });
        await trx('audit_log').insert(auditRow({
          sub: null, orgId: subscription.organization_id, activeCampusId: null
        }, 'subscription.expired', 'organization_subscription', subscription.id, before, {
          ...before, status: 'expired'
        }));
      }
    });
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
    const nowDate = new Date(nowMs);
    const thirtyDaysFromNow = new Date(nowMs + 30 * 86400000);
    const subscriptionQuery = this.db('organization_subscriptions as os')
      .join('organizations as o', 'o.id', 'os.organization_id')
      .select('os.id', 'os.organization_id', 'os.status', 'os.trial_ends_at',
        'os.period_ends_at', 'o.name');
    if (organizationId) subscriptionQuery.where('os.organization_id', organizationId);
    const subscriptions = await subscriptionQuery.where(function () {
        this.where(function () {
          this.where('os.status', 'trialing').whereNotNull('os.trial_ends_at')
            .where('os.trial_ends_at', '>', nowDate)
            .where('os.trial_ends_at', '<=', thirtyDaysFromNow);
        }).orWhere(function () {
          this.where('os.status', 'active').whereNotNull('os.period_ends_at')
            .where('os.period_ends_at', '>', nowDate)
            .where('os.period_ends_at', '<=', thirtyDaysFromNow);
        }).orWhere(function () {
          this.where('os.status', 'expired').whereNotExists(function () {
            this.select('sen.id').from('subscription_expiry_notices as sen')
              .whereColumn('sen.subscription_id', 'os.id')
              .where('sen.threshold_days', 0)
              .whereRaw('sen.expiry_at = COALESCE(os.period_ends_at, os.trial_ends_at)');
          });
        });
      });
    for (const subscription of subscriptions) {
      const expiryAt = subscription.status === 'trialing'
        ? fromMysqlDateTime(subscription.trial_ends_at)
        : subscription.status === 'active'
          ? fromMysqlDateTime(subscription.period_ends_at)
          : subscription.status === 'expired'
            ? fromMysqlDateTime(subscription.period_ends_at ?? subscription.trial_ends_at) : null;
      if (!expiryAt) continue;
      const expiryMs = Date.parse(expiryAt);
      const thresholds = subscription.status === 'expired' || expiryMs <= nowMs
        ? [0] : [30, 7, 1].filter((days) => expiryMs <= nowMs + days * 86400000);
      for (const thresholdDays of thresholds) {
        const recipients = await this.db.transaction(async (trx) => {
          const current = await trx('organization_subscriptions').where({
            id: subscription.id
          }).forUpdate().first('id');
          if (!current) return [];
          const existingNotice = await trx('subscription_expiry_notices').where({
            subscription_id: subscription.id,
            expiry_at: toMysqlDateTime(expiryAt),
            threshold_days: thresholdDays
          }).first('id');
          if (existingNotice) return [];

          const noticeId = randomUUID();
          const admins = await trx('users').where({
            organization_id: subscription.organization_id, is_active: true
          }).whereIn('role', ['owner_director', 'group_executive', 'principal'])
            .select('id', 'name', 'email');
          await trx('subscription_expiry_notices').insert({
            id: noticeId, subscription_id: subscription.id,
            organization_id: subscription.organization_id,
            expiry_at: toMysqlDateTime(expiryAt), threshold_days: thresholdDays
          });
          const thresholdText = thresholdDays === 0 ? 'has expired'
            : `expires in ${thresholdDays} day${thresholdDays === 1 ? '' : 's'}`;
          if (admins.length) {
            await trx('user_notifications').insert(admins.map(({ id: userId }) => ({
              id: randomUUID(), campus_id: null,
              organization_id: subscription.organization_id, user_id: userId,
              source_type: 'subscription_expiry', source_id: noticeId,
              title_en: 'Subscription expiry', title_am: 'የደንበኝነት ጊዜ ማብቂያ',
              body_en: `Your subscription ${thresholdText} on ${expiryAt.slice(0, 10)}.`,
              body_am: `የደንበኝነት ጊዜዎ ${thresholdDays === 0 ? 'አብቅቷል' : `በ${thresholdDays} ቀን ውስጥ ያበቃል`}.`
            })));
          }
          await trx('audit_log').insert(auditRow({
            sub: null, orgId: subscription.organization_id, activeCampusId: null
          }, 'subscription.expiry_notice_sent', 'subscription_expiry_notice', noticeId, null, {
            expiryAt, thresholdDays, recipientCount: admins.length
          }));
          return admins;
        });
        if (mailConfigured) {
          for (const recipient of recipients) {
            if (!recipient.email) continue;
            try {
              await mailer.sendSubscriptionExpiryEmail({
                email: recipient.email, name: recipient.name,
                schoolName: subscription.name, expiryAt, thresholdDays
              });
            } catch (error) {
              logger?.warn({ errorCode: error.code ?? 'SMTP_DELIVERY_FAILED' },
                'Subscription expiry email delivery failed');
            }
          }
        }
      }
    }
    if (mailConfigurationError) throw mailConfigurationError;
  },
  async getPlatformDashboard() {
    await this.refreshExpiredSubscriptions();
    const [schools, plans, payments, refunds, invoices, staffRows, storageRows, subscriptionRows] =
      await Promise.all([
        this.listPlatformSchools(),
        this.listSubscriptionPlans(),
        this.db('subscription_payments as p').join('subscription_invoices as i', 'i.id', 'p.invoice_id')
          .select('i.organization_id', 'p.invoice_id', 'p.amount', 'p.received_on'),
        this.db('subscription_refunds').select('organization_id', 'payment_id', 'amount'),
        this.db('subscription_invoices').select('id', 'organization_id', 'amount', 'status'),
        this.db('staff as s').join('campuses as c', 'c.id', 's.campus_id')
          .count({ total: 's.id' }).first(),
        this.db('organizations').whereNot({ status: 'platform' }).select('id', 'logo_size_bytes'),
        this.db('organization_subscriptions').select(
          'organization_id', 'status', 'trial_ends_at', 'period_ends_at'
        )
      ]);
    const admissionStorage = await this.db('admission_documents as ad')
      .join('admissions as a', 'a.id', 'ad.admission_id')
      .join('campuses as c', 'c.id', 'a.campus_id')
      .select('c.organization_id').sum({ total: 'ad.size_bytes' }).groupBy('c.organization_id');
    const studentStorage = await this.db('student_documents as sd')
      .join('students as s', 's.id', 'sd.student_id')
      .join('campuses as c', 'c.id', 's.campus_id')
      .select('c.organization_id').sum({ total: 'sd.size_bytes' }).groupBy('c.organization_id');
    const refundsTotal = refunds.reduce((sum, refund) => sum + Number(refund.amount), 0);
    const paidInvoiceTotals = new Map();
    for (const payment of payments) {
      const invoiceId = payment.invoice_id;
      paidInvoiceTotals.set(invoiceId, (paidInvoiceTotals.get(invoiceId) ?? 0) + Number(payment.amount));
    }
    const outstanding = invoices.reduce((sum, invoice) => sum + Math.max(0,
      Number(invoice.amount) - (paidInvoiceTotals.get(invoice.id) ?? 0)), 0);
    const revenueCollected = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const currentMonth = new Date().toISOString().slice(0, 7);
    const currentMonthRevenue = payments.filter((payment) =>
      String(payment.received_on).slice(0, 7) === currentMonth)
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const storageBySchool = schools.map((school) => {
      const logoBytes = Number(storageRows.find((row) => row.id === school.id)?.logo_size_bytes ?? 0);
      const studentBytes = Number(studentStorage.find((row) =>
        row.organization_id === school.id)?.total ?? 0);
      const admissionBytes = Number(admissionStorage.find((row) =>
        row.organization_id === school.id)?.total ?? 0);
      const plan = this.db('organization_subscriptions as os')
        .join('subscription_plans as sp', 'sp.id', 'os.plan_id')
        .where({ 'os.organization_id': school.id }).select('sp.storage_limit_bytes').first();
      return { organizationId: school.id, usedBytes: logoBytes + studentBytes + admissionBytes, plan };
    });
    const limits = await Promise.all(storageBySchool.map((item) => item.plan));
    storageBySchool.forEach((item, index) => {
      item.limitBytes = limits[index]?.storage_limit_bytes == null
        ? null : Number(limits[index].storage_limit_bytes);
      delete item.plan;
    });
    const expiringSubscriptions = subscriptionRows.filter((subscription) => {
      const expiry = subscription.status === 'trialing' ? subscription.trial_ends_at
        : subscription.status === 'active' ? subscription.period_ends_at : null;
      const time = expiry ? new Date(expiry).getTime() : 0;
      return time > Date.now() && time <= Date.now() + 30 * 86400000;
    }).length;
    const dbCheck = await this.db.raw('SELECT 1 AS reachable');
    return {
      generatedAt: now(), database: { reachable: Boolean(dbCheck), checkedAt: now() },
      totals: {
        schools: schools.length,
        pending: schools.filter((school) => school.status === 'pending').length,
        active: schools.filter((school) => school.status === 'active').length,
        suspended: schools.filter((school) => school.status === 'suspended').length,
        students: schools.reduce((sum, school) => sum + school.studentCount, 0),
        staff: Number(staffRows.total),
        activeSubscriptions: subscriptionRows.filter((item) => item.status === 'active').length,
        expiredSubscriptions: subscriptionRows.filter((item) => item.status === 'expired').length,
        trialingSubscriptions: subscriptionRows.filter((item) => item.status === 'trialing').length,
        expiringSubscriptions, revenueCollected, currentMonthRevenue, outstanding,
        refunds: refundsTotal, netRevenue: revenueCollected - refundsTotal,
        storageUsedBytes: storageBySchool.reduce((sum, school) => sum + school.usedBytes, 0)
      },
      storageBySchool, schools, plans
    };
  },
  async updateOrganizationStatus(organizationId, status, actor) {
    return this.db.transaction(async (trx) => {
      const organization = await trx('organizations').where({ id: organizationId })
        .whereNot({ status: 'platform' }).forUpdate().first();
      if (!organization) return null;
      const before = { status: organization.status };
      const update = {
        status, activated_at: status === 'active' ? trx.fn.now() : organization.activated_at,
        suspended_at: status === 'suspended' ? trx.fn.now() : null
      };
      await trx('organizations').where({ id: organizationId }).update(update);
      await trx('campuses').where({ organization_id: organizationId })
        .update({ is_active: status === 'active' });
      if (status === 'active') {
        const subscription = await trx('organization_subscriptions')
          .where({ organization_id: organizationId, status: 'pending' }).first();
        if (subscription) {
          const plan = await trx('subscription_plans').where({ id: subscription.plan_id }).first();
          const trialEndsAt = new Date(Date.now() + Number(plan.trial_days) * 86400000);
          await trx('organization_subscriptions').where({ id: subscription.id }).update({
            status: 'trialing', trial_started_at: trx.fn.now(), trial_ends_at: trialEndsAt
          });
        }
      }
      await trx('audit_log').insert(auditRow({
        ...actor, orgId: organizationId, activeCampusId: null
      }, `school.${status}`,
        'organization', organizationId, before, { status }));
      const updated = await trx('organizations').where({ id: organizationId }).first();
      return mapOrganization(updated);
    });
  },
  async listSubscriptionPlans() {
    const rows = await this.db('subscription_plans').orderBy('monthly_price').orderBy('name');
    return rows.map(mapSubscriptionPlan);
  },
  async saveSubscriptionPlan(data, actor) {
    let result;
    await this.db.transaction(async (trx) => {
      const existing = await trx('subscription_plans').where({ code: data.code }).forUpdate().first();
      const before = existing ? mapSubscriptionPlan(existing) : null;
      const savedData = {
        ...data,
        maxUsers: data.maxUsers === undefined
          ? (existing ? before.maxUsers : 50) : data.maxUsers,
        storageLimitBytes: data.storageLimitBytes === undefined
          ? (existing ? before.storageLimitBytes : 1073741824) : data.storageLimitBytes
      };
      if (existing) {
        const subscriptions = await trx('organization_subscriptions')
          .where({ plan_id: existing.id }).select('organization_id');
        for (const { organization_id: organizationId } of subscriptions) {
          await this.assertPlanFitsOrganization(savedData, organizationId, trx);
        }
      }
      const values = {
        name: savedData.name, description: savedData.description, monthly_price: savedData.monthlyPrice,
        currency_code: savedData.currencyCode, trial_days: savedData.trialDays,
        student_limit: savedData.studentLimit, staff_limit: savedData.staffLimit,
        site_limit: savedData.siteLimit, billing_cycle: savedData.billingCycle,
        max_users: savedData.maxUsers, storage_limit_bytes: savedData.storageLimitBytes,
        modules_json: JSON.stringify(savedData.modules), is_active: savedData.isActive
      };
      if (existing) {
        await trx('subscription_plans').where({ id: existing.id }).update(values);
        result = { id: existing.id, code: savedData.code, ...savedData };
      } else {
        result = { id: randomUUID(), code: savedData.code, ...savedData };
        await trx('subscription_plans').insert({
          id: result.id, code: result.code, ...values
        });
      }
      await trx('audit_log').insert(auditRow(actor, 'subscription_plan.saved',
        'subscription_plan', result.id, before, result));
    });
    return result;
  },
  async assignOrganizationPlan(organizationId, planCode, actor) {
    const assigned = await this.db.transaction(async (trx) => {
      const plan = await trx('subscription_plans').where({ code: planCode, is_active: true }).first();
      const subscription = await trx('organization_subscriptions')
        .where({ organization_id: organizationId }).orderBy('created_at', 'desc').forUpdate().first();
      if (!plan || !subscription) return false;
      await this.assertPlanFitsOrganization(mapSubscriptionPlan(plan), organizationId, trx);
      const before = { planId: subscription.plan_id, status: subscription.status };
      await trx('organization_subscriptions').where({ id: subscription.id }).update({
        plan_id: plan.id
      });
      await trx('audit_log').insert(auditRow({
        ...actor, orgId: organizationId, activeCampusId: null
      }, 'school.plan_assigned',
        'organization_subscription', subscription.id, before, {
          planCode, status: subscription.status,
          trialEndsAt: fromMysqlDateTime(subscription.trial_ends_at),
          periodEndsAt: fromMysqlDateTime(subscription.period_ends_at)
        }));
      return true;
    });
    return assigned ? this.getOrganizationSubscription(organizationId) : null;
  },
  async assertPlanFitsOrganization(plan, organizationId, query = this.db) {
    const [students, staff, branches, users, pending] = await Promise.all([
      query('students as s').join('campuses as c', 'c.id', 's.campus_id')
        .where('c.organization_id', organizationId).whereNull('s.archived_at')
        .count({ total: 's.id' }).first(),
      query('staff as s').join('campuses as c', 'c.id', 's.campus_id')
        .where('c.organization_id', organizationId).whereNot('s.employment_status', 'terminated')
        .count({ total: 's.id' }).first(),
      query('campuses').where({ organization_id: organizationId, is_active: true })
        .count({ total: '*' }).first(),
      query('users').where({ organization_id: organizationId, is_active: true })
        .count({ total: '*' }).first(),
      query('account_invitations').where({ organization_id: organizationId })
        .whereNull('accepted_at').where('expires_at', '>', query.fn.now())
        .count({ total: '*' }).first()
    ]);
    const storage = await this.getOrganizationStorageUsage(organizationId, query);
    const checks = [
      ['student', plan.studentLimit, Number(students.total)],
      ['staff', plan.staffLimit, Number(staff.total)],
      ['branch', plan.siteLimit, Number(branches.total)],
      ['user', plan.maxUsers, Number(users.total) + Number(pending.total)],
      ['storage', plan.storageLimitBytes, storage]
    ];
    const exceeded = checks.filter(([, limit, current]) => limit != null && current > limit)
      .map(([resource, limit, current]) => ({ resource, limit, current }));
    if (exceeded.length) throw planLimitsExceededError(exceeded);
  },
  async getOrganizationSettings(organizationId) {
    const row = await this.db('organizations').where({ id: organizationId }).first();
    return row ? mapOrganization(row) : null;
  },
  async updateOrganizationSettings(data, actor) {
    const before = await this.getOrganizationSettings(actor.orgId);
    if (!before) return null;
    const values = {
      preferred_locale: data.preferredLocale, currency_code: data.currencyCode,
      branding_json: JSON.stringify(data.branding)
    };
    await this.db.transaction(async (trx) => {
      await trx('organizations').where({ id: actor.orgId }).update(values);
      await trx('audit_log').insert(auditRow(actor, 'school.settings_updated',
        'organization', actor.orgId, {
          preferredLocale: before.preferredLocale, currencyCode: before.currencyCode,
          branding: before.branding
        }, data));
    });
    return this.getOrganizationSettings(actor.orgId);
  },
  async getPlatformSettings() {
    const row = await this.db('platform_global_settings').where({ id: 'global' }).first();
    if (!row) throw new Error('Platform global settings have not been initialized.');
    return {
      defaultLocale: row.default_locale, currencyCode: row.currency_code,
      dateFormat: row.date_format, calendarType: row.calendar_type,
      smtpHost: row.smtp_host, smtpPort: Number(row.smtp_port),
      smtpSecure: Boolean(row.smtp_secure), smtpUser: row.smtp_user,
      smtpFrom: row.smtp_from,
      smtpPasswordConfigured: Boolean(row.smtp_password_ciphertext),
      smtpConfigured: Boolean(row.smtp_host && row.smtp_user && row.smtp_password_ciphertext)
    };
  },
  async updatePlatformSettings(data, actor) {
    const before = await this.getPlatformSettings();
    const values = {
      default_locale: data.defaultLocale, currency_code: data.currencyCode,
      date_format: data.dateFormat, calendar_type: data.calendarType
    };
    for (const [key, column] of [
      ['smtpHost', 'smtp_host'], ['smtpPort', 'smtp_port'], ['smtpSecure', 'smtp_secure'],
      ['smtpUser', 'smtp_user'], ['smtpFrom', 'smtp_from']
    ]) {
      if (data[key] !== undefined) values[column] = data[key];
    }
    if (data.smtpPassword) {
      values.smtp_password_ciphertext = encryptSensitiveValue(data.smtpPassword, this.sensitiveDataKey);
    }
    const after = {
      ...before, ...Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'smtpPassword')),
      smtpPasswordConfigured: Boolean(data.smtpPassword || before.smtpPasswordConfigured)
    };
    await this.db.transaction(async (trx) => {
      await trx('platform_global_settings').where({ id: 'global' }).update(values);
      await trx('audit_log').insert(auditRow(actor, 'platform.settings_updated',
        'platform_settings', 'global', before, after));
    });
    return this.getPlatformSettings();
  },
  async getMailTransportSettings() {
    const row = await this.db('platform_global_settings').where({ id: 'global' }).first();
    if (!row?.smtp_host || !row.smtp_user || !row.smtp_password_ciphertext) return null;
    return {
      SMTP_HOST: row.smtp_host, SMTP_PORT: Number(row.smtp_port),
      SMTP_SECURE: Boolean(row.smtp_secure), SMTP_USER: row.smtp_user,
      SMTP_PASSWORD: row.smtp_password_ciphertext
        ? decryptSensitiveValue(row.smtp_password_ciphertext, this.sensitiveDataKey) : '',
      SMTP_FROM: row.smtp_from
    };
  },
  async getOrganizationStorageUsage(organizationId, query = this.db) {
    const [organization, studentDocs, admissionDocs, assignmentDocs] = await Promise.all([
      query('organizations').where({ id: organizationId }).first('logo_size_bytes'),
      query('student_documents as sd')
        .join('students as s', 's.id', 'sd.student_id')
        .join('campuses as c', 'c.id', 's.campus_id')
        .where('c.organization_id', organizationId).sum({ total: 'sd.size_bytes' }).first(),
      query('admission_documents as ad')
        .join('admissions as a', 'a.id', 'ad.admission_id')
        .join('campuses as c', 'c.id', 'a.campus_id')
        .where('c.organization_id', organizationId).sum({ total: 'ad.size_bytes' }).first(),
      query('assignment_attachments').where({ organization_id: organizationId })
        .sum({ total: 'size_bytes' }).first()
    ]);
    return Number(organization?.logo_size_bytes ?? 0) +
      Number(studentDocs?.total ?? 0) + Number(admissionDocs?.total ?? 0) +
      Number(assignmentDocs?.total ?? 0);
  },
  async assertStorageCapacity(organizationId, additionalBytes, replaceBytes = 0, query = this.db) {
    const subscription = await query('organization_subscriptions as os')
      .join('subscription_plans as sp', 'sp.id', 'os.plan_id')
      .where('os.organization_id', organizationId).orderBy('os.created_at', 'desc')
      .forUpdate().select('sp.storage_limit_bytes').first();
    if (subscription?.storage_limit_bytes == null) return;
    const usedBytes = await this.getOrganizationStorageUsage(organizationId, query);
    if (usedBytes - replaceBytes + additionalBytes > Number(subscription.storage_limit_bytes)) {
      throw planLimitError('storage', Number(subscription.storage_limit_bytes));
    }
  },
  async saveOrganizationLogo(organizationId, data, actor) {
    return this.db.transaction(async (trx) => {
      const organization = await trx('organizations').where({ id: organizationId })
        .whereNot({ status: 'platform' })
        .forUpdate().first('id', 'logo_mime_type', 'logo_size_bytes');
      if (!organization) return null;
      await this.assertStorageCapacity(organizationId, data.content.length,
        Number(organization.logo_size_bytes ?? 0), trx);
      const before = {
        logoMimeType: organization.logo_mime_type,
        logoSizeBytes: Number(organization.logo_size_bytes ?? 0)
      };
      await trx('organizations').where({ id: organizationId }).update({
        logo_data: data.content.toString('base64'),
        logo_mime_type: data.mimeType, logo_size_bytes: data.content.length
      });
      await trx('audit_log').insert(auditRow({
        ...actor, orgId: organizationId, activeCampusId: null
      }, 'school.logo_updated', 'organization', organizationId, before, {
          logoMimeType: data.mimeType, logoSizeBytes: data.content.length
        }));
      return { mimeType: data.mimeType, sizeBytes: data.content.length };
    });
  },
  async getOrganizationLogo(organizationId) {
    const row = await this.db('organizations').where({ id: organizationId })
      .whereNotNull('logo_data').first('logo_data', 'logo_mime_type');
    return row ? {
      mimeType: row.logo_mime_type, content: Buffer.from(row.logo_data, 'base64')
    } : null;
  },
  async getSubscriptionRevenueReport() {
    const invoices = await this.db('subscription_invoices as i')
      .join('organizations as o', 'o.id', 'i.organization_id')
      .whereNot({ 'o.status': 'platform' })
      .select('i.id', 'i.organization_id', 'i.invoice_number', 'i.currency_code',
        'i.amount', 'i.status', 'o.name as school_name');
    const ids = invoices.map((invoice) => invoice.id);
    const [payments, refunds] = ids.length ? await Promise.all([
      this.db('subscription_payments').whereIn('invoice_id', ids).select('invoice_id', 'amount'),
      this.db('subscription_refunds').whereIn('payment_id',
        this.db('subscription_payments').whereIn('invoice_id', ids).select('id'))
        .select('payment_id', 'amount')
    ]) : [[], []];
    const paymentIds = ids.length ? await this.db('subscription_payments')
      .whereIn('invoice_id', ids).select('id', 'invoice_id') : [];
    const refundTotals = new Map();
    const paymentToInvoice = new Map(paymentIds.map((payment) => [payment.id, payment.invoice_id]));
    for (const refund of refunds) {
      const invoiceId = paymentToInvoice.get(refund.payment_id);
      refundTotals.set(invoiceId, (refundTotals.get(invoiceId) ?? 0) + Number(refund.amount));
    }
    const paidTotals = new Map();
    for (const payment of payments) {
      paidTotals.set(payment.invoice_id, (paidTotals.get(payment.invoice_id) ?? 0) + Number(payment.amount));
    }
    return invoices.map((invoice) => {
      const paid = paidTotals.get(invoice.id) ?? 0;
      const refunded = refundTotals.get(invoice.id) ?? 0;
      return {
        organizationId: invoice.organization_id, schoolName: invoice.school_name,
        invoiceNumber: invoice.invoice_number, currencyCode: invoice.currency_code,
        invoiceAmount: Number(invoice.amount), paidAmount: paid,
        outstandingAmount: Number(invoice.amount) - paid, refundedAmount: refunded,
        netRevenue: paid - refunded, status: invoice.status
      };
    });
  },
  async getSubscriptionOutstandingReport({ from, to } = {}) {
    const invoicesQuery = this.db('subscription_invoices as i')
      .join('organizations as o', 'o.id', 'i.organization_id')
      .whereNot({ 'o.status': 'platform' })
      .select('i.id', 'i.organization_id', 'o.name as school_name',
        'i.invoice_number', 'i.currency_code', 'i.amount', 'i.issued_at', 'i.due_on')
      .orderBy('i.issued_at').orderBy('i.invoice_number');
    if (from) invoicesQuery.where('i.issued_at', '>=', from);
    if (to) {
      const exclusiveEnd = new Date(`${to}T00:00:00.000Z`);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
      invoicesQuery.where('i.issued_at', '<', exclusiveEnd);
    }
    const invoices = await invoicesQuery;
    const invoiceIds = invoices.map((invoice) => invoice.id);
    const paidRows = invoiceIds.length
      ? await this.db('subscription_payments').whereIn('invoice_id', invoiceIds)
        .select('invoice_id').sum({ total: 'amount' }).groupBy('invoice_id')
      : [];
    const paidByInvoice = new Map(paidRows.map((row) =>
      [row.invoice_id, Number(row.total)]));
    const items = invoices.flatMap((invoice) => {
      const invoiceAmount = Number(invoice.amount);
      const paidAmount = paidByInvoice.get(invoice.id) ?? 0;
      const outstandingAmount = Math.max(0, invoiceAmount - paidAmount);
      if (!outstandingAmount) return [];
      return [{
        organizationId: invoice.organization_id,
        schoolName: invoice.school_name,
        invoiceNumber: invoice.invoice_number, currencyCode: invoice.currency_code,
        issuedOn: fromMysqlDateTime(invoice.issued_at).slice(0, 10),
        dueOn: invoice.due_on ? String(invoice.due_on).slice(0, 10) : null,
        invoiceAmount, paidAmount, outstandingAmount
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
  async getOrganizationSubscription(organizationId) {
    await this.refreshExpiredSubscriptions();
    const subscription = await this.db('organization_subscriptions as os')
      .join('subscription_plans as sp', 'sp.id', 'os.plan_id')
      .where({ 'os.organization_id': organizationId })
      .orderBy('os.created_at', 'desc').select('os.*', 'sp.code as plan_code',
        'sp.name as plan_name', 'sp.description as plan_description',
        'sp.monthly_price', 'sp.currency_code', 'sp.trial_days', 'sp.student_limit',
        'sp.staff_limit', 'sp.site_limit', 'sp.billing_cycle', 'sp.max_users',
        'sp.storage_limit_bytes', 'sp.modules_json').first();
    if (!subscription) return null;
    const invoices = await this.db('subscription_invoices')
      .where({ organization_id: organizationId }).orderBy('issued_at', 'desc');
    const payments = invoices.length ? await this.db('subscription_payments')
      .whereIn('invoice_id', invoices.map((invoice) => invoice.id))
      .orderBy('received_on', 'desc') : [];
    const refunds = payments.length ? await this.db('subscription_refunds')
      .whereIn('payment_id', payments.map((payment) => payment.id))
      .select('id', 'payment_id', 'amount', 'reason', 'recorded_at') : [];
    const refundsByPayment = new Map();
    for (const refund of refunds) {
      const entries = refundsByPayment.get(refund.payment_id) ?? [];
      entries.push({
        id: refund.id, amount: Number(refund.amount), reason: refund.reason,
        recordedAt: fromMysqlDateTime(refund.recorded_at)
      });
      refundsByPayment.set(refund.payment_id, entries);
    }
    const paymentsByInvoice = new Map();
    for (const payment of payments) {
      const entries = paymentsByInvoice.get(payment.invoice_id) ?? [];
      entries.push({
        id: payment.id, amount: Number(payment.amount), reference: payment.reference,
        receivedOn: String(payment.received_on).slice(0, 10)
      });
      paymentsByInvoice.set(payment.invoice_id, entries);
    }
    return {
      id: subscription.id, status: subscription.status,
      trialStartedAt: subscription.trial_started_at, trialEndsAt: subscription.trial_ends_at,
      periodStartedAt: subscription.period_started_at, periodEndsAt: subscription.period_ends_at,
      expiryWarning: this.subscriptionExpiryWarning(subscription),
      plan: mapSubscriptionPlan({
        id: subscription.plan_id, code: subscription.plan_code, name: subscription.plan_name,
        description: subscription.plan_description, monthly_price: subscription.monthly_price,
        currency_code: subscription.currency_code, trial_days: subscription.trial_days,
        student_limit: subscription.student_limit, staff_limit: subscription.staff_limit,
        site_limit: subscription.site_limit, billing_cycle: subscription.billing_cycle,
        max_users: subscription.max_users, storage_limit_bytes: subscription.storage_limit_bytes,
        modules_json: subscription.modules_json
      }),
      invoices: invoices.map((invoice) => ({
        id: invoice.id, invoiceNumber: invoice.invoice_number, amount: Number(invoice.amount),
        currencyCode: invoice.currency_code, status: invoice.status, dueOn: invoice.due_on,
        issuedAt: fromMysqlDateTime(invoice.issued_at), paidAt: fromMysqlDateTime(invoice.paid_at),
        payments: (paymentsByInvoice.get(invoice.id) ?? []).map((payment) => ({
          ...payment,
          refunds: refundsByPayment.get(payment.id) ?? [],
          refundedAmount: (refundsByPayment.get(payment.id) ?? [])
            .reduce((sum, refund) => sum + refund.amount, 0)
        }))
      }))
    };
  },
  subscriptionExpiryWarning(subscription) {
    const expiry = subscription.status === 'trialing' ? fromMysqlDateTime(subscription.trial_ends_at)
      : subscription.status === 'active' ? fromMysqlDateTime(subscription.period_ends_at) : null;
    return expiry && new Date(expiry).getTime() > Date.now() &&
      new Date(expiry).getTime() <= Date.now() + 30 * 86400000 ? expiry : null;
  },
  async createSubscriptionInvoice(organizationId, data, actor) {
    const organization = await this.db('organizations').where({ id: organizationId })
      .whereNot({ status: 'platform' }).first('id');
    if (!organization) return null;
    const subscription = await this.db('organization_subscriptions')
      .where({ organization_id: organizationId }).orderBy('created_at', 'desc').first();
    if (!subscription) return null;
    const plan = await this.db('subscription_plans').where({ id: subscription.plan_id }).first();
    const id = randomUUID();
    const invoiceNumber = `SS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const invoice = {
      id, organizationId, subscriptionId: subscription.id, invoiceNumber,
      amount: data.amount, currencyCode: data.currencyCode ?? plan.currency_code,
      status: 'issued', dueOn: data.dueOn, issuedBy: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await trx('subscription_invoices').insert({
        id, organization_id: organizationId, subscription_id: subscription.id,
        invoice_number: invoiceNumber, amount: invoice.amount,
        currency_code: invoice.currencyCode, status: 'issued',
        due_on: invoice.dueOn, issued_by: actor.sub
      });
      await trx('audit_log').insert(auditRow({
        ...actor, orgId: organizationId, activeCampusId: null
      }, 'subscription_invoice.issued',
        'subscription_invoice', id, null, invoice));
    });
    return invoice;
  },
  async recordSubscriptionPayment(invoiceId, data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const invoice = await trx('subscription_invoices').where({ id: invoiceId }).forUpdate().first();
      if (!invoice || invoice.status === 'paid') return null;
      const existing = await trx('subscription_payments').where({ invoice_id: invoiceId })
        .sum({ paid: 'amount' }).first();
      const outstanding = Number(invoice.amount) - Number(existing.paid ?? 0);
      const subscription = await trx('organization_subscriptions')
        .where({ id: invoice.subscription_id }).forUpdate()
        .first('status', 'period_started_at', 'period_ends_at', 'plan_id');
      const before = {
        invoiceStatus: invoice.status, paidAmount: Number(existing.paid ?? 0),
        subscriptionStatus: subscription?.status ?? null,
        periodStartedAt: fromMysqlDateTime(subscription?.period_started_at),
        periodEndsAt: fromMysqlDateTime(subscription?.period_ends_at)
      };
      const invoiceWillBePaid = Math.round(data.amount * 100) === Math.round(outstanding * 100);
      let periodStartedAt = null;
      let periodEndsAt = null;
      let billingCycle = 'monthly';
      if (data.amount <= 0 || data.amount > outstanding) return null;
      const payment = {
        id, invoiceId, amount: data.amount, reference: data.reference,
        note: data.note, receivedOn: data.receivedOn, recordedBy: actor.sub
      };
      await trx('subscription_payments').insert({
        id, invoice_id: invoiceId, amount: data.amount,
        reference: data.reference, note: data.note, received_on: data.receivedOn,
        recorded_by: actor.sub
      });
      if (invoiceWillBePaid) {
        await trx('subscription_invoices').where({ id: invoiceId }).update({
          status: 'paid', paid_at: trx.fn.now()
        });
        const plan = await trx('subscription_plans').where({ id: subscription.plan_id })
          .first('billing_cycle');
        billingCycle = plan?.billing_cycle ?? 'monthly';
        const priorPeriodEnd = fromMysqlDateTime(subscription.period_ends_at);
        periodStartedAt = priorPeriodEnd && new Date(priorPeriodEnd) > new Date()
          ? new Date(priorPeriodEnd) : new Date();
        periodEndsAt = billingPeriodEnd(periodStartedAt, billingCycle);
        await trx('organization_subscriptions').where({ id: invoice.subscription_id }).update({
          status: 'active', period_started_at: periodStartedAt,
          period_ends_at: toMysqlDateTime(periodEndsAt)
        });
      }
      await trx('audit_log').insert(auditRow({
        ...actor, orgId: invoice.organization_id, activeCampusId: null
      }, 'subscription_payment.recorded', 'subscription_payment', id, before, {
        payment, invoiceStatus: invoiceWillBePaid ? 'paid' : invoice.status,
        paidAmount: Number(existing.paid ?? 0) + data.amount,
        subscriptionStatus: invoiceWillBePaid ? 'active' : (subscription?.status ?? null),
        periodStartedAt: invoiceWillBePaid ? periodStartedAt.toISOString()
          : fromMysqlDateTime(subscription?.period_started_at),
        periodEndsAt: invoiceWillBePaid ? periodEndsAt
          : fromMysqlDateTime(subscription?.period_ends_at)
      }));
      return payment;
    });
  },
  async refundSubscriptionPayment(paymentId, data, actor) {
    const refundId = randomUUID();
    return this.db.transaction(async (trx) => {
      const payment = await trx('subscription_payments').where({ id: paymentId })
        .forUpdate().first('id', 'amount', 'invoice_id');
      if (!payment) return null;
      const invoice = await trx('subscription_invoices').where({
        id: payment.invoice_id
      }).first('organization_id');
      if (!invoice) return null;
      const priorRefund = await trx('subscription_refunds').where({ payment_id: paymentId })
        .sum({ total: 'amount' }).first();
      const refundedAmount = Number(priorRefund.total ?? 0);
      if (data.amount > Number(payment.amount) - refundedAmount) return null;
      const refund = {
        id: refundId, organizationId: invoice.organization_id, paymentId,
        invoiceId: payment.invoice_id, amount: data.amount, reason: data.reason,
        recordedBy: actor.sub, recordedAt: now()
      };
      await trx('subscription_refunds').insert({
        id: refundId, organization_id: invoice.organization_id, payment_id: paymentId,
        amount: data.amount, reason: data.reason, recorded_by: actor.sub
      });
      await trx('audit_log').insert(auditRow({
        ...actor, orgId: invoice.organization_id, activeCampusId: null
      }, 'subscription_payment.refunded', 'subscription_refund', refundId, {
        refundedAmount, paymentAmount: Number(payment.amount)
      }, { ...refund, refundedAmount: refundedAmount + data.amount }));
      return refund;
    });
  },
  async requestOrganizationClosure(data, actor) {
    const id = randomUUID();
    const closure = {
      id, organizationId: actor.orgId, status: 'requested',
      reason: data.reason, requestedBy: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await trx('organization_closure_requests').insert({
        id, organization_id: actor.orgId, status: 'requested',
        reason: data.reason, requested_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'school.closure_requested',
        'organization_closure', id, null, { reason: data.reason, status: 'requested' }));
    });
    return closure;
  },
  async listClosureRequests() {
    const rows = await this.db('organization_closure_requests as cr')
      .join('organizations as o', 'o.id', 'cr.organization_id')
      .leftJoin('users as u', 'u.id', 'cr.requested_by')
      .select('cr.*', 'o.name as school_name', 'u.name as requester_name')
      .orderBy('cr.requested_at', 'desc');
    return rows.map((row) => ({
      id: row.id, organizationId: row.organization_id, schoolName: row.school_name,
      status: row.status, reason: row.reason, requestedBy: row.requested_by,
      requesterName: row.requester_name ?? '', requestedAt: fromMysqlDateTime(row.requested_at),
      exportedAt: fromMysqlDateTime(row.exported_at),
      approvedAt: fromMysqlDateTime(row.approved_at),
      retentionUntil: fromMysqlDateTime(row.retention_until),
      financialRetentionUntil: fromMysqlDateTime(row.financial_retention_until),
      completedAt: fromMysqlDateTime(row.completed_at)
    }));
  },
  async getOrganizationExport(organizationId) {
    return this.db.transaction(async (trx) => {
    const organizationRow = await trx('organizations').where({ id: organizationId }).first();
    if (!organizationRow) return null;
    const campuses = await trx('campuses').where({ organization_id: organizationId });
    const campusIds = campuses.map((campus) => campus.id);
    const organizationRows = (table) => trx(table)
      .where({ organization_id: organizationId }).select('*');
    const campusRows = (table) => campusIds.length
      ? trx(table).whereIn('campus_id', campusIds).select('*') : [];
    const [users, academicYears, grades, sections, students, staff, admissions,
      attendanceSessions, invoices, feeItems, departments, subjects, guardians,
      subscriptions, subscriptionInvoices, roles, auditLog] = await Promise.all([
      trx('users').where({ organization_id: organizationId })
        .select('id', 'organization_id', 'name', 'email', 'phone', 'role',
          'preferred_locale', 'preferred_calendar', 'is_active', 'username',
          'must_change_password', 'created_at', 'updated_at'),
      campusRows('academic_years'), campusRows('grade_levels'), campusRows('sections'),
      campusRows('students'), campusRows('staff'), organizationRows('admissions'),
      campusRows('attendance_sessions'), campusRows('invoices'), campusRows('fee_items'),
      campusRows('departments'), campusRows('subjects'), organizationRows('guardians'),
      organizationRows('organization_subscriptions'),
      organizationRows('subscription_invoices'), organizationRows('roles'),
      organizationRows('audit_log')
    ]);
    const ids = (rows) => rows.map((row) => row.id);
    const academicYearIds = ids(academicYears);
    const gradeIds = ids(grades);
    const studentIds = ids(students);
    const admissionIds = ids(admissions);
    const attendanceSessionIds = ids(attendanceSessions);
    const invoiceIds = ids(invoices);
    const roleIds = ids(roles);
    const relatedRows = (table, column, values) => values.length
      ? trx(table).whereIn(column, values).select('*') : [];
    const [terms, gradeSubjects, schoolCalendarEntries, curriculumUnits, lessonPlans,
      promotionRules, enrolments, studentGuardians, studentSiblings,
      attendanceRecords, attendanceCorrectionRequests, invoiceLines, feePayments,
      feeExpenses, cashierShifts, admissionDocuments, admissionCounters,
      subscriptionPayments, subscriptionPlans, rolePermissions, accountInvitations,
      userCampuses, platformClosureRequests, studentDocuments, transferPackages] = await Promise.all([
      relatedRows('terms', 'academic_year_id', academicYearIds),
      relatedRows('grade_subjects', 'grade_level_id', gradeIds),
      campusRows('school_calendar_entries'),
      campusRows('curriculum_units'),
      campusRows('lesson_plans'),
      campusRows('promotion_rules'),
      relatedRows('enrolments', 'student_id', studentIds),
      relatedRows('student_guardians', 'student_id', studentIds),
      campusRows('student_siblings'),
      relatedRows('attendance_records', 'session_id', attendanceSessionIds),
      campusRows('attendance_correction_requests'),
      relatedRows('invoice_lines', 'invoice_id', invoiceIds),
      relatedRows('fee_payments', 'invoice_id', invoiceIds),
      campusRows('fee_expenses'), campusRows('cashier_shifts'),
      relatedRows('admission_documents', 'admission_id', admissionIds),
      relatedRows('admission_counters', 'campus_id', campusIds),
      relatedRows('subscription_payments', 'invoice_id',
        ids(subscriptionInvoices)),
      relatedRows('subscription_plans', 'id', subscriptions.map((item) => item.plan_id)),
      relatedRows('role_permissions', 'role_id', roleIds),
      organizationRows('account_invitations'),
      relatedRows('user_campuses', 'user_id', users.map((item) => item.id)),
      organizationRows('organization_closure_requests'),
      relatedRows('student_documents', 'student_id', studentIds),
      relatedRows('student_transfer_packages', 'student_id', studentIds)
    ]);
    const documentFiles = await Promise.all(admissionDocuments.map(async (document) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(document.storage_key)) {
        throw new Error('An admission document has an invalid storage key; the school export was stopped.');
      }
      const content = await readFile(path.join(this.privateDocumentsDir, document.storage_key));
      return { ...document, contentBase64: content.toString('base64') };
    }));
    const studentDocumentFiles = await Promise.all(studentDocuments.map(async (document) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(document.storage_key)) {
        throw new Error('A student document has an invalid storage key; the school export was stopped.');
      }
      const content = await readFile(path.join(this.privateDocumentsDir, document.storage_key));
      return { ...document, contentBase64: content.toString('base64') };
    }));
    const safeTransferPackages = transferPackages.map(({ share_token_hash: _tokenHash, ...item }) => item);
    const [gradeBands, academicPolicies, homeroomAssignments, teachingAssignments,
      staffAttendance, leaveRequests, staffMessages, timetablePeriods, rooms,
      timetableSubstitutions, announcements, events, commendations,
      emergencyContacts, studentStatusHistory, termReportRevisions,
      sectionTransfers, disciplineRecords,
      notifications, marks] = await Promise.all([
      campusRows('grading_bands'), campusRows('campus_academic_policies'),
      campusRows('homeroom_assignments'), campusRows('teaching_assignments'),
      campusRows('staff_attendance'), campusRows('leave_requests'),
      campusRows('staff_messages'), campusRows('timetable_periods'), campusRows('rooms'),
      campusRows('timetable_substitutions'), campusRows('campus_announcements'),
      campusRows('campus_events'), campusRows('student_commendations'),
      campusRows('student_emergency_contacts'), campusRows('student_status_history'),
      campusRows('term_report_revisions'), campusRows('student_section_transfers'),
      campusRows('student_discipline_records'), campusRows('user_notifications'),
      campusRows('marks')
    ]);
    return {
      exportFormatVersion: 1, exportedAt: new Date().toISOString(),
      organization: mapOrganization(organizationRow), campuses, users, userCampuses,
      academicYears, terms, grades, gradeSubjects, sections, subjects,
      schoolCalendarEntries, curriculumUnits, lessonPlans, promotionRules, students,
      enrolments, guardians, studentGuardians, studentSiblings, staff, departments,
      teachingAssignments, homeroomAssignments, attendanceSessions, attendanceRecords,
      attendanceCorrectionRequests, staffAttendance, leaveRequests, marks,
      gradeBands, academicPolicies, termReportRevisions, feeItems, invoices,
      invoiceLines, feePayments, feeExpenses, cashierShifts, admissions,
      admissionDocuments: documentFiles, studentDocuments: studentDocumentFiles,
      studentTransferPackages: safeTransferPackages, studentSectionTransfers: sectionTransfers,
      studentDisciplineRecords: disciplineRecords, admissionCounters, studentStatusHistory,
      studentEmergencyContacts: emergencyContacts, studentCommendations: commendations,
      announcements, events, staffMessages, timetablePeriods, rooms,
      timetableSubstitutions, notifications, auditLog, roles, rolePermissions,
      accountInvitations: accountInvitations.map(({ token_hash: _tokenHash, ...item }) => item),
      subscriptions, subscriptionPlans, subscriptionInvoices, subscriptionPayments,
      closureRequests: platformClosureRequests,
      securityNotice: 'Passwords, refresh tokens, and account-invitation token hashes are intentionally excluded.'
    };
    });
  },
  async markOrganizationExported(organizationId, actor) {
    const closure = await this.db('organization_closure_requests')
      .where({ organization_id: organizationId, status: 'requested' })
      .orderBy('requested_at', 'desc').first();
    if (!closure) return null;
    await this.db.transaction(async (trx) => {
      await trx('organization_closure_requests').where({ id: closure.id }).update({
        status: 'exported', exported_at: trx.fn.now()
      });
      await trx('audit_log').insert(auditRow(actor, 'school.data_exported',
        'organization_closure', closure.id, { status: 'requested' }, { status: 'exported' }));
    });
    return { id: closure.id, organizationId, status: 'exported' };
  },
  async approveOrganizationClosure(closureId, retentionDays, financialRetentionDays, actor) {
    return this.db.transaction(async (trx) => {
      const closure = await trx('organization_closure_requests').where({
        id: closureId, status: 'exported'
      }).forUpdate().first();
      if (!closure || !closure.exported_at) return null;
      const retentionUntil = new Date(Date.now() + retentionDays * 86400000);
      const financialRetentionUntil = new Date(Date.now() + financialRetentionDays * 86400000);
      await trx('organization_closure_requests').where({ id: closureId }).update({
        status: 'retention', approved_at: trx.fn.now(),
        retention_until: retentionUntil, financial_retention_until: financialRetentionUntil,
        reviewed_by: actor.sub
      });
      await trx('organizations').where({ id: closure.organization_id }).update({
        status: 'closed', closed_at: trx.fn.now(), closure_retention_until: retentionUntil
      });
      await trx('campuses').where({ organization_id: closure.organization_id }).update({ is_active: false });
      await trx('audit_log').insert(auditRow(actor, 'school.closure_approved',
        'organization_closure', closureId, { status: 'exported' },
        {
          status: 'retention', retentionUntil: retentionUntil.toISOString(),
          financialRetentionUntil: financialRetentionUntil.toISOString()
        }));
      return {
        id: closureId, organizationId: closure.organization_id,
        status: 'retention', retentionUntil: retentionUntil.toISOString(),
        financialRetentionUntil: financialRetentionUntil.toISOString()
      };
    });
  },
  async pseudonymizeOrganizationClosure(closureId, actor) {
    return this.db.transaction(async (trx) => {
      const closure = await trx('organization_closure_requests').where({
        id: closureId, status: 'retention'
      }).whereRaw('retention_until <= CURRENT_TIMESTAMP').forUpdate().first();
      if (!closure) return null;
      const campuses = await trx('campuses').where({
        organization_id: closure.organization_id
      }).pluck('id');
      const students = campuses.length
        ? await trx('students').whereIn('campus_id', campuses).select('id')
        : [];
      const studentIds = students.map((student) => student.id);
      const users = await trx('users').where({
        organization_id: closure.organization_id
      }).select('id');
      const userIds = users.map((user) => user.id);
      const admissionDocuments = campuses.length
        ? await trx('admission_documents as d')
          .join('admissions as a', 'a.id', 'd.admission_id')
          .whereIn('a.campus_id', campuses).select('d.storage_key')
        : [];
      const studentDocuments = campuses.length
        ? await trx('student_documents').whereIn('campus_id', campuses).select('storage_key')
        : [];
      const documents = [...admissionDocuments, ...studentDocuments];
      for (const document of documents) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(document.storage_key)) {
          throw new Error('Closure cleanup stopped because a private student or admission document has an invalid storage key.');
        }
        try {
          await unlink(path.join(this.privateDocumentsDir, document.storage_key));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      if (campuses.length) {
        await trx('admission_documents').whereIn('admission_id',
          trx('admissions').select('id').whereIn('campus_id', campuses)).del();
        await trx('student_transfer_packages').whereIn('campus_id', campuses).del();
        await trx('student_documents').whereIn('campus_id', campuses).del();
        await trx('student_discipline_records').whereIn('campus_id', campuses).del();
        await trx('student_section_transfers').whereIn('campus_id', campuses).del();
        await trx('students').whereIn('campus_id', campuses).update({
          student_no: trx.raw("CONCAT('ANON-', RIGHT(REPLACE(id, '-', ''), 24))"),
          given_name_am: 'የተደበቀ', father_name_am: 'የተደበቀ',
          grandfather_name_am: 'የተደበቀ', given_name_en: 'Former student',
          father_name_en: 'Former student', grandfather_name_en: 'Former student',
          gender: 'other', date_of_birth: null, section_name: null,
          guardian_phone: null, previous_school: null,
          id_number_enc: null, id_number_hash: null, health_notes_enc: null,
          special_needs_enc: null, allergies_enc: null, archived_at: trx.fn.now()
        });
        await trx('admissions').whereIn('campus_id', campuses).update({
          given_name_am: 'የተደበቀ', father_name_am: 'የተደበቀ',
          grandfather_name_am: 'የተደበቀ', given_name_en: 'Former applicant',
          father_name_en: 'Former applicant', grandfather_name_en: 'Former applicant',
          gender: 'other', date_of_birth: null, guardian_name: 'Former guardian',
          guardian_phone: 'REDACTED', guardian_email: null, previous_school: null,
          decision_note: null, required_documents: JSON.stringify([]),
          student_id: null, sibling_student_id: null
        });
        await trx('guardians').where({ organization_id: closure.organization_id }).update({
          given_name_am: 'የተደበቀ', father_name_am: 'የተደበቀ',
          grandfather_name_am: 'የተደበቀ', given_name_en: 'Former guardian',
          father_name_en: 'Former guardian', grandfather_name_en: 'Former guardian',
          phone: 'REDACTED', email: null, national_id_enc: null, national_id_hash: null
        });
        await trx('student_guardians').whereIn('student_id', studentIds).del();
        await trx('student_siblings').whereIn('campus_id', campuses).del();
        await trx('student_emergency_contacts').whereIn('campus_id', campuses).del();
        await trx('student_status_history').whereIn('campus_id', campuses).update({ reason: null });
        await trx('leave_requests').whereIn('campus_id', campuses).update({
          reason: 'Details removed during approved school closure.', review_note: null
        });
        await trx('staff_messages').whereIn('campus_id', campuses).update({
          title: 'School record',
          body: 'Message details removed during approved school closure.'
        });
        await trx('campus_announcements').whereIn('campus_id', campuses).update({
          title_en: 'School announcement', title_am: 'የትምህርት ቤት ማስታወቂያ',
          body_en: 'Details removed during approved school closure.',
          body_am: 'በተፈቀደው የትምህርት ቤት መዝጊያ ሂደት ዝርዝሮች ተወግደዋል။'
        });
        await trx('campus_events').whereIn('campus_id', campuses).update({
          title_en: 'School event', title_am: 'የትምህርት ቤት ዝግጅት',
          description_en: 'Details removed during approved school closure.',
          description_am: 'በተፈቀደው የትምህርት ቤት መዝጊያ ሂደት ዝርዝሮች ተወግደዋል።',
          location: ''
        });
        await trx('attendance_records').whereIn('student_id', studentIds).update({ reason: null });
        await trx('attendance_correction_requests').whereIn('campus_id', campuses).update({
          reason: 'Personal details removed during approved school closure.', review_note: null
        });
        await trx('student_commendations').whereIn('campus_id', campuses).update({
          title_en: 'Recognition', title_am: 'እውቅና',
          description_en: '', description_am: ''
        });
        await trx('term_report_revisions').whereIn('student_id', studentIds)
          .update({ report_json: JSON.stringify({ redacted: true }) });
        await trx('fee_payments').whereIn('campus_id', campuses)
          .update({ reference: null, reason: null });
        await trx('fee_expenses').whereIn('campus_id', campuses).update({
          description: 'Description withheld after school closure.', reference: null
        });
        await trx('staff').whereIn('campus_id', campuses).update({
          given_name_en: 'Former staff', father_name_en: 'Former staff',
          grandfather_name_en: 'Former staff', given_name_am: 'የተደበቀ',
          father_name_am: 'የተደበቀ', grandfather_name_am: 'የተደበቀ',
          job_title: 'Former staff', qualification: null,
          employment_status: 'terminated', archived_at: trx.fn.now()
        });
        await trx('user_notifications').whereIn('campus_id', campuses).del();
      }
      if (userIds.length) {
        await trx('refresh_tokens').whereIn('user_id', userIds).del();
        await trx('account_invitations').where({
          organization_id: closure.organization_id
        }).del();
        await trx('users').where({ organization_id: closure.organization_id }).update({
          name: trx.raw("CONCAT('Former account ', RIGHT(REPLACE(id, '-', ''), 8))"),
          email: null, phone: null, username: null, is_active: false,
          password_hash: randomUUID()
        });
      }
      await trx('audit_log').where({ organization_id: closure.organization_id })
        .update({ before_json: null, after_json: null });
      await trx('organization_closure_requests').where({ id: closureId }).update({
        status: 'pseudonymized', reason: 'Personal details removed during approved school closure.',
        completed_at: trx.fn.now()
      });
      await trx('audit_log').insert(auditRow(actor, 'school.closure_personal_data_pseudonymized',
        'organization_closure', closureId, { status: 'retention' }, {
          status: 'pseudonymized', pseudonymizedStudentCount: studentIds.length,
          retainedFinancialData: true,
          financialRetentionUntil: fromMysqlDateTime(closure.financial_retention_until)
        }));
      return {
        id: closureId, organizationId: closure.organization_id, status: 'pseudonymized',
        pseudonymizedAt: now(), students: studentIds.length
      };
    });
  }
};
