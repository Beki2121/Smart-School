import { randomUUID } from 'node:crypto';
import { now, planLimitError, setupConflict } from '../shared.js';
import { mapOrganization } from '../platform.mappers.js';

export const memoryPlatformBundle = {
  async isOrganizationOperational(organizationId) {
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
  async registerSchool(data, passwordHash) {
    if (this.users.some((user) => user.email?.toLowerCase() === data.ownerEmail)) {
      throw setupConflict('An account already uses this email address.');
    }
    const organizationId = randomUUID();
    const campusId = randomUUID();
    const userId = randomUUID();
    const plan = this.subscriptionPlans.find((item) => item.code === 'starter');
    if (!plan?.isActive) throw new Error('The active starter subscription plan is not configured.');
    const activatedAt = now();
    const trialEndsAt = new Date(Date.now() + plan.trialDays * 86400000).toISOString();
    const organization = {
      id: organizationId, name: data.schoolName, status: 'active',
      preferredLocale: data.locale, currencyCode: data.currencyCode,
      branding: { logoUrl: '', primaryColor: '#0f766e' }, requestedAt: activatedAt,
      activatedAt, suspendedAt: null, closedAt: null, trialEndsAt
    };
    const campus = {
      id: campusId, organizationId, name: data.schoolName, address: data.address,
      phone: data.schoolPhone, timezone: data.timezone, isActive: true
    };
    const user = {
      id: userId, orgId: organizationId, name: data.ownerName, email: data.ownerEmail,
      phone: data.ownerPhone, passwordHash, role: 'owner_director', campusIds: [campusId],
      activeCampusId: campusId, isActive: true, mustChangePassword: false
    };
    this.organizations.push(organization);
    this.campuses.push(campus);
    this.users.push(user);
    this.subscriptions.push({
      id: randomUUID(), organizationId, planId: plan.id, status: 'trialing',
      trialStartedAt: activatedAt, trialEndsAt, periodStartedAt: null, periodEndsAt: null
    });
    await this.appendAudit({
      sub: userId, orgId: organizationId, activeCampusId: campusId
    }, 'school.registration_activated', 'organization', organizationId, null, {
      schoolName: data.schoolName, ownerEmail: data.ownerEmail,
      status: 'active', subscriptionStatus: 'trialing', trialEndsAt
    });
    return { organizationId, status: 'active', trialEndsAt };
  },
  async listPlatformSchools() {
    return this.organizations.map((organization) => ({
      ...organization,
      owner: (() => {
        const owner = this.users.find((user) =>
          user.orgId === organization.id && user.role === 'owner_director');
        return owner ? { name: owner.name, email: owner.email ?? '' } : null;
      })(),
      campuses: this.campuses.filter((campus) => campus.organizationId === organization.id)
        .map(({ id, name }) => ({ id, name })),
      studentCount: this.students.filter((student) =>
        this.campuses.some((campus) => campus.id === student.campusId &&
          campus.organizationId === organization.id && !student.archivedAt)).length,
      subscription: (() => {
        const subscription = this.subscriptions.find((item) => item.organizationId === organization.id);
        const plan = subscription && this.subscriptionPlans.find((item) => item.id === subscription.planId);
        return subscription ? {
          status: subscription.status, trialEndsAt: subscription.trialEndsAt ?? null,
          planCode: plan?.code ?? '', planName: plan?.name ?? ''
        } : null;
      })()
    }));
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
    await this.appendAudit(actor, `school.${status}`, 'organization', organizationId, before, { status });
    return organization;
  },
  async listSubscriptionPlans() { return this.subscriptionPlans; },
  async assignOrganizationPlan(organizationId, planCode, actor) {
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    const plan = this.subscriptionPlans.find((item) => item.code === planCode && item.isActive);
    if (!subscription || !plan) return null;
    const before = {
      planId: subscription.planId, status: subscription.status,
      trialEndsAt: subscription.trialEndsAt, periodEndsAt: subscription.periodEndsAt
    };
    subscription.planId = plan.id;
    await this.appendAudit(actor, 'school.plan_assigned', 'organization_subscription',
      subscription.id, before, {
        planCode, status: subscription.status,
        trialEndsAt: subscription.trialEndsAt, periodEndsAt: subscription.periodEndsAt
      });
    return this.getOrganizationSubscription(organizationId);
  },
  async saveSubscriptionPlan(data, actor) {
    let plan = this.subscriptionPlans.find((item) => item.code === data.code);
    const before = plan ? { ...plan } : null;
    if (plan) Object.assign(plan, data);
    else {
      plan = { id: randomUUID(), ...data };
      this.subscriptionPlans.push(plan);
    }
    await this.appendAudit(actor, 'subscription_plan.saved', 'subscription_plan', plan.id, before, plan);
    return plan;
  },
  async getOrganizationSettings(organizationId) {
    return this.organizations.find((item) => item.id === organizationId) ?? null;
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
    return organization;
  },
  async listClosureRequests() {
    return this.closureRequests.map((item) => ({
      ...item,
      schoolName: this.organizations.find((organization) =>
        organization.id === item.organizationId)?.name ?? ''
    }));
  },
  async getOrganizationSubscription(organizationId) {
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    if (!subscription) return null;
    return {
      ...subscription,
      plan: this.subscriptionPlans.find((item) => item.id === subscription.planId) ?? null,
      invoices: this.subscriptionInvoices.filter((item) => item.organizationId === organizationId)
    };
  },
  async createSubscriptionInvoice(organizationId, data, actor) {
    const organization = this.organizations.find((item) => item.id === organizationId);
    if (!organization || organization.status === 'platform') return null;
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    const invoice = {
      id: randomUUID(), organizationId, subscriptionId: subscription?.id ?? null,
      invoiceNumber: `SS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`,
      amount: data.amount, currencyCode: data.currencyCode,
      status: 'issued', dueOn: data.dueOn, issuedBy: actor.sub, issuedAt: now(), payments: []
    };
    this.subscriptionInvoices.push(invoice);
    await this.appendAudit(actor, 'subscription_invoice.issued', 'subscription_invoice',
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
    invoice.payments.push(payment);
    const paidTotal = invoice.payments.reduce((sum, item) => sum + item.amount, 0);
    if (paidTotal >= invoice.amount) {
      invoice.status = 'paid';
      invoice.paidAt = now();
      const subscription = this.subscriptions.find((item) => item.id === invoice.subscriptionId);
      if (subscription) {
        subscription.status = 'active';
        subscription.periodStartedAt = now();
        subscription.periodEndsAt = new Date(Date.now() + 30 * 86400000).toISOString();
      }
    }
    await this.appendAudit(actor, 'subscription_payment.recorded', 'subscription_payment',
      payment.id, null, payment);
    return payment;
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
