import { randomUUID } from 'node:crypto';
import { auditRow, now, planLimitError, setupConflict } from '../shared.js';
import {
  fromMysqlDateTime, mapOrganization, mapSubscriptionPlan, toMysqlDateTime
} from '../platform.mappers.js';

export const mysqlPlatformBundle = {
  async isOrganizationOperational(organizationId) {
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
    try {
      await this.db.transaction(async (trx) => {
        const existingUser = await trx('users')
          .whereRaw('LOWER(email) = ?', [data.ownerEmail.toLowerCase()]).first('id');
        if (existingUser) throw setupConflict('An account already uses this email address.');
        await trx('organizations').insert({
          id: organizationId, name: data.schoolName, status: 'active',
          preferred_locale: data.locale, currency_code: data.currencyCode,
          branding_json: JSON.stringify({ logoUrl: '', primaryColor: '#0f766e' }),
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
        await trx('account_invitations').insert({
          id: invitation.id, organization_id: organizationId, campus_id: campusId,
          email: data.ownerEmail, role: 'owner_director',
          target_type: 'school_administrator', target_id: organizationId,
          target_name: data.ownerName, token_hash: invitation.tokenHash,
          expires_at: toMysqlDateTime(invitation.expiresAt), accepted_at: null, created_by: actor.sub
        });
        await trx('audit_log').insert(auditRow(actor,
          'school.platform_created', 'organization', organizationId, null, {
          schoolName: data.schoolName, ownerEmail: data.ownerEmail,
          status: 'active', subscriptionStatus: 'trialing', trialEndsAt: trialEndsAt.toISOString()
        }));
        await trx('audit_log').insert(auditRow(actor,
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
      const subscription = await this.db('organization_subscriptions as os')
        .join('subscription_plans as sp', 'sp.id', 'os.plan_id')
        .where({ 'os.organization_id': row.id })
        .orderBy('os.created_at', 'desc')
        .select('os.status', 'os.trial_ends_at', 'sp.code', 'sp.name').first();
      results.push({
        ...mapOrganization(row),
        owner: owner ? { name: owner.name, email: owner.email } : null,
        adminInvitationAvailable: Boolean(adminInvitation),
        campuses, studentCount: Number(studentCount.total),
        subscription: subscription ? {
          status: subscription.status, trialEndsAt: subscription.trial_ends_at,
          planCode: subscription.code, planName: subscription.name
        } : null
      });
    }
    return results;
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
      await trx('audit_log').insert(auditRow(actor, `school.${status}`,
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
      const values = {
        name: data.name, description: data.description, monthly_price: data.monthlyPrice,
        currency_code: data.currencyCode, trial_days: data.trialDays,
        student_limit: data.studentLimit, staff_limit: data.staffLimit,
        site_limit: data.siteLimit, modules_json: JSON.stringify(data.modules), is_active: data.isActive
      };
      if (existing) {
        await trx('subscription_plans').where({ id: existing.id }).update(values);
        result = { id: existing.id, code: data.code, ...data };
      } else {
        result = { id: randomUUID(), code: data.code, ...data };
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
      const before = { planId: subscription.plan_id, status: subscription.status };
      await trx('organization_subscriptions').where({ id: subscription.id }).update({
        plan_id: plan.id
      });
      await trx('audit_log').insert(auditRow(actor, 'school.plan_assigned',
        'organization_subscription', subscription.id, before, {
          planCode, status: subscription.status,
          trialEndsAt: fromMysqlDateTime(subscription.trial_ends_at),
          periodEndsAt: fromMysqlDateTime(subscription.period_ends_at)
        }));
      return true;
    });
    return assigned ? this.getOrganizationSubscription(organizationId) : null;
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
  async getOrganizationSubscription(organizationId) {
    const subscription = await this.db('organization_subscriptions as os')
      .join('subscription_plans as sp', 'sp.id', 'os.plan_id')
      .where({ 'os.organization_id': organizationId })
      .orderBy('os.created_at', 'desc').select('os.*', 'sp.code as plan_code',
        'sp.name as plan_name', 'sp.description as plan_description',
        'sp.monthly_price', 'sp.currency_code', 'sp.trial_days', 'sp.student_limit',
        'sp.staff_limit', 'sp.site_limit', 'sp.modules_json').first();
    if (!subscription) return null;
    const invoices = await this.db('subscription_invoices')
      .where({ organization_id: organizationId }).orderBy('issued_at', 'desc');
    const payments = invoices.length ? await this.db('subscription_payments')
      .whereIn('invoice_id', invoices.map((invoice) => invoice.id))
      .orderBy('received_on', 'desc') : [];
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
      plan: mapSubscriptionPlan({
        id: subscription.plan_id, code: subscription.plan_code, name: subscription.plan_name,
        description: subscription.plan_description, monthly_price: subscription.monthly_price,
        currency_code: subscription.currency_code, trial_days: subscription.trial_days,
        student_limit: subscription.student_limit, staff_limit: subscription.staff_limit,
        site_limit: subscription.site_limit, modules_json: subscription.modules_json
      }),
      invoices: invoices.map((invoice) => ({
        id: invoice.id, invoiceNumber: invoice.invoice_number, amount: Number(invoice.amount),
        currencyCode: invoice.currency_code, status: invoice.status, dueOn: invoice.due_on,
        issuedAt: fromMysqlDateTime(invoice.issued_at), paidAt: fromMysqlDateTime(invoice.paid_at),
        payments: paymentsByInvoice.get(invoice.id) ?? []
      }))
    };
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
      await trx('audit_log').insert(auditRow(actor, 'subscription_invoice.issued',
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
      if (data.amount === outstanding) {
        await trx('subscription_invoices').where({ id: invoiceId }).update({
          status: 'paid', paid_at: trx.fn.now()
        });
        await trx('organization_subscriptions').where({ id: invoice.subscription_id }).update({
          status: 'active', period_started_at: trx.fn.now(),
          period_ends_at: trx.raw('DATE_ADD(GREATEST(COALESCE(period_ends_at, NOW()), NOW()), INTERVAL 1 MONTH)')
        });
      }
      await trx('audit_log').insert(auditRow(actor, 'subscription_payment.recorded',
        'subscription_payment', id, null, payment));
      return payment;
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
