import bcrypt from 'bcrypt';
import knexFactory from 'knex';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_GRADING_BANDS, getGradeTemplate, isUpperSecondaryGrade } from './school-curriculum.js';
import {
  decryptSensitiveValue, encryptSensitiveValue, hashSensitiveIdentifier
} from './secure-fields.js';
import { memoryCommunicationsBundle } from './repositories/memory/communications.repository.js';
import { mysqlCommunicationsBundle } from './repositories/mysql/communications.repository.js';
import { composeRepositoryBundles } from './repositories/compose-bundles.js';
import { memoryStaffBundle } from './repositories/memory/staff.repository.js';
import { mysqlStaffBundle } from './repositories/mysql/staff.repository.js';
import { memoryFeesBundle } from './repositories/memory/fees.repository.js';
import { mysqlFeesBundle } from './repositories/mysql/fees.repository.js';
import {
  addisDate, auditRow, campusScopeError, now, planLimitError, scheduleConflict, setupConflict
} from './repositories/shared.js';
import { formatStaffName, mapStaff } from './repositories/staff.mappers.js';

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function studentName(student) {
  return `${student.givenNameEn} ${student.fatherNameEn} ${student.grandfatherNameEn}`.trim();
}
function normalizeImportValue(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
function studentImportReports(rows, sections, existingStudents) {
  const reports = rows.map(({ rowNumber, data }) => ({
    rowNumber, eligible: true, errors: [], warnings: []
  }));
  const reportByRow = new Map(reports.map((report) => [report.rowNumber, report]));
  const sectionCounts = new Map();
  for (const section of sections) {
    const key = normalizeImportValue(section.name);
    sectionCounts.set(key, (sectionCounts.get(key) ?? 0) + 1);
  }
  const existingStudentNumbers = new Set(existingStudents.map((student) =>
    normalizeImportValue(student.studentNo)));
  const existingIdentities = new Set(existingStudents.flatMap((student) =>
    student.dateOfBirth ? [
      `${normalizeImportValue([student.givenNameEn, student.fatherNameEn, student.grandfatherNameEn].join(' '))}|${String(student.dateOfBirth).slice(0, 10)}`,
      `${normalizeImportValue([student.givenNameAm, student.fatherNameAm, student.grandfatherNameAm].join(' '))}|${String(student.dateOfBirth).slice(0, 10)}`
    ] : []));
  const existingPhones = new Set(existingStudents.map((student) =>
    String(student.guardianPhone ?? '').replace(/\D/g, '')).filter(Boolean));
  const seenNumbers = new Map();
  const seenIdentities = new Map();
  const seenPhones = new Set();
  const addError = (report, field, message) => {
    report.eligible = false;
    report.errors.push({ field, message });
  };
  for (const { rowNumber, data } of rows) {
    const report = reportByRow.get(rowNumber);
    const sectionKey = normalizeImportValue(data.sectionName);
    const sectionCount = sectionCounts.get(sectionKey) ?? 0;
    if (sectionCount === 0) addError(report, 'sectionName', 'Section is not active in this campus and academic year.');
    else if (sectionCount > 1) addError(report, 'sectionName', 'Section name is ambiguous; use a unique active section name.');

    const studentNumber = normalizeImportValue(data.studentNo);
    if (existingStudentNumbers.has(studentNumber)) {
      addError(report, 'studentNo', 'Student ID already exists at this campus.');
    }
    if (seenNumbers.has(studentNumber)) {
      addError(report, 'studentNo', `Student ID is repeated on row ${seenNumbers.get(studentNumber)}.`);
    } else {
      seenNumbers.set(studentNumber, rowNumber);
    }

    if (data.dateOfBirth) {
      const identities = [
        `${normalizeImportValue([data.givenNameEn, data.fatherNameEn, data.grandfatherNameEn].join(' '))}|${data.dateOfBirth}`,
        `${normalizeImportValue([data.givenNameAm, data.fatherNameAm, data.grandfatherNameAm].join(' '))}|${data.dateOfBirth}`
      ];
      const duplicateIdentity = identities.some((identity) =>
        existingIdentities.has(identity) || seenIdentities.has(identity));
      if (duplicateIdentity) addError(report, 'dateOfBirth', 'A student with the same name and date of birth already exists.');
      for (const identity of identities) seenIdentities.set(identity, rowNumber);
    }

    const phone = String(data.guardianPhone ?? '').replace(/\D/g, '');
    if (phone && (existingPhones.has(phone) || seenPhones.has(phone))) {
      report.warnings.push({
        field: 'guardianPhone',
        message: 'Guardian phone is already linked to another student; sibling records may share a phone.'
      });
    }
    if (phone) seenPhones.add(phone);
  }
  return reports;
}
function usernamePart(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'student';
}
async function generateStudentCredentials(student, usernameExists) {
  const base = [student.givenNameEn, student.fatherNameEn, student.studentNo]
    .map(usernamePart).join('.').slice(0, 70).replace(/\.+$/g, '');
  let username = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    username = `${base}.${randomBytes(4).toString('hex')}`;
    if (!await usernameExists(username)) break;
    username = '';
  }
  if (!username) throw new Error('Unable to generate a unique student username.');
  const temporaryPassword = randomBytes(18).toString('hex');
  return {
    username, temporaryPassword, studentName: studentName(student),
    passwordHash: await bcrypt.hash(temporaryPassword, 12)
  };
}
const weekdayNumber = (date) => {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
};

const attendanceCorrectionWindowOpen = (date) => {
  const [year, month, day] = date.split('-').map(Number);
  const attendanceDayStart = Date.UTC(year, month - 1, day) - 3 * 60 * 60 * 1000;
  return Date.now() <= attendanceDayStart + 48 * 60 * 60 * 1000;
};

export class MemoryRepository {
  constructor({ users, campuses, sections, academicYears, gradeLevels = [], subjects = [], staff = [], departments = [], sensitiveDataKey = '' }) {
    this.users = users;
    this.campuses = campuses;
    for (const campus of campuses) campus.admissionsPublicToken ??= randomBytes(32).toString('hex');
    this.organizations = [];
    this.subscriptionPlans = [{
      id: randomUUID(), code: 'starter', name: 'Starter', description: 'Initial private-school trial plan',
      monthlyPrice: 0, currencyCode: 'ETB', trialDays: 30, studentLimit: 100,
      staffLimit: 20, siteLimit: 1, modules: [
        'academic_setup', 'student_information', 'admissions', 'attendance',
        'marks', 'fees', 'staff', 'timetable', 'communications'
      ],
      isActive: true
    }];
    this.subscriptions = [];
    const demoUser = users.find((user) => user.orgId && user.role !== 'super_admin');
    const demoCampusIds = new Set(demoUser?.campusIds ?? [demoUser?.activeCampusId].filter(Boolean));
    const demoCampuses = campuses.filter((campus) =>
      campus.organizationId === demoUser?.orgId ||
      (!campus.organizationId && demoCampusIds.has(campus.id)));
    for (const campus of demoCampuses) campus.organizationId ??= demoUser.orgId;
    if (demoUser) {
      this.organizations.push({
        id: demoUser.orgId, name: demoCampuses[0]?.organizationName ?? demoCampuses[0]?.name ?? 'School',
        status: 'active', preferredLocale: 'en', currencyCode: 'ETB',
        branding: { logoUrl: '', primaryColor: '#0f766e' }, requestedAt: null,
        activatedAt: now(), suspendedAt: null, closedAt: null
      });
      this.subscriptions.push({
        id: randomUUID(), organizationId: demoUser.orgId, planId: this.subscriptionPlans[0].id,
        status: 'active', trialStartedAt: null, trialEndsAt: null,
        periodStartedAt: null, periodEndsAt: null
      });
    }
    this.subscriptionInvoices = [];
    this.subscriptionPayments = [];
    this.closureRequests = [];
    this.sections = sections;
    this.academicYears = academicYears;
    this.gradeLevels = gradeLevels;
    this.gradeSubjects = [];
    this.schoolCalendarEntries = [];
    this.curriculumUnits = [];
    this.lessonPlans = [];
    this.promotionRules = [];
    this.subjects = subjects;
    this.staff = staff;
    this.departments = departments;
    this.timetablePeriods = [];
    this.rooms = [];
    this.timetableSubstitutions = [];
    this.admissions = [];
    this.admissionDocuments = [];
    this.studentStatusHistory = [];
    this.studentSiblingLinks = [];
    this.studentCommendations = [];
    this.studentEmergencyContacts = [];
    this.guardians = [];
    this.studentGuardians = [];
    this.admissionCounters = new Map();
    this.teachingAssignments = [];
    this.homeroomAssignments = [];
    this.staffAttendance = [];
    this.leaveRequests = [];
    this.staffMessages = [];
    this.campusAnnouncements = [];
    this.campusEvents = [];
    this.userNotifications = [];
    this.students = [];
    this.enrolments = [];
    this.studentSensitive = new Map();
    this.studentDocuments = [];
    this.studentSectionTransfers = [];
    this.studentDisciplineRecords = [];
    this.studentTransferPackages = [];
    this.sensitiveDataKey = sensitiveDataKey;
    this.attendance = [];
    this.attendanceCorrectionRequests = [];
    this.marks = [];
    this.gradingBands = [];
    this.gradingPolicies = [];
    this.termReportRevisions = [];
    this.feeItems = [];
    this.feeInvoices = [];
    this.feePayments = [];
    this.cashierShifts = [];
    this.feeExpenses = [];
    this.audit = [];
    this.loginFailures = new Map();
    this.refreshTokens = new Map();
    this.passwordResetTokens = new Map();
    this.accountInvitations = [];
    this.mode = 'memory';
  }

  async findUserByLogin(login) {
    const user = this.users.find((user) =>
      user.email?.toLowerCase() === login.toLowerCase() ||
      user.username?.toLowerCase() === login.toLowerCase() || user.phone === login) ?? null;
    if (!user) return null;
    return {
      ...user,
      accountActive: Boolean(user.isActive),
      authVersion: Number(user.authVersion ?? 0),
      isActive: Boolean(user.isActive)
    };
  }
  async findUserById(id) {
    const user = this.users.find((item) => item.id === id);
    if (!user) return null;
    const organization = this.organizations.find((item) => item.id === user.orgId);
    return {
      ...user,
      accountActive: Boolean(user.isActive),
      authVersion: Number(user.authVersion ?? 0),
      isActive: user.isActive &&
        (user.role === 'super_admin' || !organization || organization.status === 'active')
    };
  }
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
  }
  async isModuleEnabled(organizationId, moduleCode) {
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    if (!subscription) return true;
    const plan = this.subscriptionPlans.find((item) => item.id === subscription.planId);
    return plan?.code === 'legacy' || Boolean(plan?.modules.includes(moduleCode));
  }
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
  }
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
  }
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
  }
  async listSubscriptionPlans() { return this.subscriptionPlans; }
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
  }
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
  }
  async getOrganizationSettings(organizationId) {
    return this.organizations.find((item) => item.id === organizationId) ?? null;
  }
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
  }
  async listClosureRequests() {
    return this.closureRequests.map((item) => ({
      ...item,
      schoolName: this.organizations.find((organization) =>
        organization.id === item.organizationId)?.name ?? ''
    }));
  }
  async getOrganizationSubscription(organizationId) {
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    if (!subscription) return null;
    return {
      ...subscription,
      plan: this.subscriptionPlans.find((item) => item.id === subscription.planId) ?? null,
      invoices: this.subscriptionInvoices.filter((item) => item.organizationId === organizationId)
    };
  }
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
  }
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
  }
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
  }
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
  }
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
  }
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
  }
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
  async createAccountInvitation(invitation, actor) {
    const existingUser = this.users.find((user) => user.email?.toLowerCase() === invitation.email.toLowerCase());
    if (existingUser) throw setupConflict('An account already uses this email address.');
    const target = this.findInvitationTarget(invitation, actor);
    if (!target) throw setupConflict('The selected person is not eligible for an account invitation.');
    const nowIso = now();
    this.accountInvitations
      .filter((item) => item.targetType === invitation.targetType && item.targetId === invitation.targetId &&
        item.acceptedAt === null)
      .forEach((item) => { item.expiresAt = nowIso; });
    const record = {
      id: invitation.id, orgId: actor.orgId, campusId: actor.activeCampusId,
      email: invitation.email, role: invitation.role, targetType: invitation.targetType,
      targetId: invitation.targetId, tokenHash: invitation.tokenHash,
      expiresAt: invitation.expiresAt, acceptedAt: null, createdBy: actor.sub
    };
    this.accountInvitations.push(record);
    await this.appendAudit(actor, 'account_invitation.created', 'account_invitation', record.id, null, {
      email: record.email, role: record.role, targetType: record.targetType, targetId: record.targetId,
      expiresAt: record.expiresAt
    });
    return { id: record.id, email: record.email, role: record.role, name: target.name, expiresAt: record.expiresAt };
  }
  findInvitationTarget(invitation, actor) {
    if (invitation.targetType === 'staff') {
      const target = this.staff.find((item) => item.id === invitation.targetId &&
        item.campusId === actor.activeCampusId && item.employmentStatus !== 'terminated' &&
        !item.archivedAt && !item.userId);
      return target ? { name: `${target.givenNameEn} ${target.fatherNameEn} ${target.grandfatherNameEn}` } : null;
    }
    if (invitation.targetType === 'student') {
      const target = this.students.find((item) => item.id === invitation.targetId &&
        item.campusId === actor.activeCampusId && item.status === 'enrolled' && !item.archivedAt && !item.userId);
      return target ? { name: `${target.givenNameEn} ${target.fatherNameEn} ${target.grandfatherNameEn}` } : null;
    }
    const target = this.guardians.find((item) => item.id === invitation.targetId &&
      item.orgId === actor.orgId && !item.userId);
    const verifiedLink = this.studentGuardians.some((link) => link.guardianId === invitation.targetId &&
      link.isVerified && this.students.some((student) => student.id === link.studentId &&
        student.campusId === actor.activeCampusId && !student.archivedAt));
    if (invitation.targetType === 'guardian' &&
      (!target?.email || target.email.toLowerCase() !== invitation.email.toLowerCase())) return null;
    return target && verifiedLink
      ? { name: `${target.givenNameEn} ${target.fatherNameEn} ${target.grandfatherNameEn}` }
      : null;
  }
  async getAccountInvitation(tokenHash) {
    const invitation = this.accountInvitations.find((item) => item.tokenHash === tokenHash &&
      !item.acceptedAt && new Date(item.expiresAt) > new Date());
    if (!invitation) return null;
    const target = this.findInvitationTarget(invitation, {
      orgId: invitation.orgId, activeCampusId: invitation.campusId
    });
    return target ? { email: invitation.email, role: invitation.role, name: target.name, expiresAt: invitation.expiresAt } : null;
  }
  async acceptAccountInvitation(tokenHash, passwordHash) {
    const invitation = this.accountInvitations.find((item) => item.tokenHash === tokenHash &&
      !item.acceptedAt && new Date(item.expiresAt) > new Date());
    if (!invitation) return null;
    if (this.users.some((user) => user.email?.toLowerCase() === invitation.email.toLowerCase())) {
      throw setupConflict('An account already uses this email address.');
    }
    const actor = { orgId: invitation.orgId, activeCampusId: invitation.campusId };
    const target = this.findInvitationTarget(invitation, actor);
    if (!target) return null;
    const userId = randomUUID();
    const campusIds = invitation.targetType === 'guardian'
      ? [...new Set(this.studentGuardians.filter((link) =>
        link.guardianId === invitation.targetId && link.isVerified)
        .map((link) => this.students.find((student) => student.id === link.studentId)?.campusId)
        .filter((campusId) => campusId && (campusId === invitation.campusId ||
          this.campuses.some((campus) => campus.id === campusId && campus.organizationId === invitation.orgId))))]
      : [invitation.campusId];
    const user = {
      id: userId, orgId: invitation.orgId, name: target.name, email: invitation.email,
      phone: null, passwordHash, role: invitation.role, campusIds,
      activeCampusId: invitation.campusId, isActive: true
    };
    this.users.push(user);
    if (invitation.targetType === 'staff') {
      const staff = this.staff.find((item) => item.id === invitation.targetId);
      if (!staff || staff.userId) { this.users.pop(); return null; }
      staff.userId = userId;
    } else if (invitation.targetType === 'student') {
      const student = this.students.find((item) => item.id === invitation.targetId);
      if (!student || student.userId) { this.users.pop(); return null; }
      student.userId = userId;
    } else {
      const guardian = this.guardians.find((item) => item.id === invitation.targetId);
      if (!guardian || guardian.userId) { this.users.pop(); return null; }
      guardian.userId = userId;
    }
    invitation.acceptedAt = now();
    await this.appendAudit({ sub: userId, orgId: invitation.orgId, activeCampusId: invitation.campusId },
      'account_invitation.accepted', 'user', userId, null, {
        email: invitation.email, role: invitation.role, targetType: invitation.targetType, targetId: invitation.targetId
      });
    return user;
  }
  async verifyStudentGuardian(studentId, guardianId, access, actor) {
    const student = this.students.find((item) => item.id === studentId &&
      item.campusId === actor.activeCampusId && !item.archivedAt);
    const link = this.studentGuardians.find((item) =>
      item.studentId === studentId && item.guardianId === guardianId);
    if (!student || !link) return null;
    const before = { isVerified: link.isVerified, canViewResults: link.canViewResults, canViewFees: link.canViewFees };
    Object.assign(link, { isVerified: access.isVerified, canViewResults: access.canViewResults, canViewFees: access.canViewFees });
    await this.appendAudit(actor, 'student.guardian_access_updated', 'student_guardian', studentId, before, {
      guardianId, ...access
    });
    return { ...link };
  }
  async getPortalHome(actor) {
    if (actor.role === 'student') {
      const student = this.students.find((item) => item.userId === actor.sub &&
        item.campusId === actor.activeCampusId && !item.archivedAt);
      return {
        role: actor.role,
        students: student ? [{
          student: portalStudentView(student), canViewResults: true, canViewFees: false,
          results: this.portalResults(student.id),
          reports: this.portalPublishedReports(student.id, student.campusId),
          attendance: this.portalAttendance(student.id, student.campusId), fees: []
        }] : []
      };
    }
    if (actor.role === 'parent_guardian') {
      const guardian = this.guardians.find((item) => item.userId === actor.sub && item.orgId === actor.orgId);
      if (!guardian) return { role: actor.role, students: [] };
      const students = this.studentGuardians.filter((link) => link.guardianId === guardian.id && link.isVerified)
        .map((link) => this.students.find((student) =>
          student.id === link.studentId && !student.archivedAt &&
          (actor.campusIds ?? []).includes(student.campusId)) && ({
          student: portalStudentView(this.students.find((student) => student.id === link.studentId)),
          canViewResults: Boolean(link.canViewResults), canViewFees: Boolean(link.canViewFees),
          results: link.canViewResults ? this.portalResults(link.studentId) : [],
          reports: link.canViewResults
            ? this.portalPublishedReports(link.studentId, this.students.find((student) =>
              student.id === link.studentId)?.campusId) : [],
          attendance: this.portalAttendance(link.studentId, actor.activeCampusId),
          fees: link.canViewFees ? this.portalFees(link.studentId) : []
        })).filter(Boolean);
      return { role: actor.role, students };
    }
    return { role: actor.role, students: [] };
  }
  portalResults(studentId) {
    return this.marks.filter((item) => item.studentId === studentId && item.state === 'locked')
      .slice(-20).reverse().map((item) => ({
        assessmentName: item.assessmentName, value: item.value, maxValue: item.maxValue
      }));
  }
  portalPublishedReports(studentId, campusId) {
    return this.termReportRevisions.filter((item) =>
      item.studentId === studentId && item.campusId === campusId && item.status === 'published')
      .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
      .slice(0, 20).map(portalPublishedReportView);
  }
  portalFees(studentId) {
    return this.feeInvoices.filter((item) => item.studentId === studentId && item.status !== 'void')
      .slice(-20).reverse().map((item) => ({
        invoiceNumber: item.invoiceNumber, totalAmount: item.totalAmount,
        dueDate: item.dueDate, status: item.status, currencyCode: item.currencyCode
      }));
  }
  portalAttendance(studentId, campusId) {
    return this.attendance.flatMap((session) => {
      if (session.campusId !== campusId) return [];
      return (session.records ?? [])
        .filter((record) => record.studentId === studentId)
        .map((record) => ({ date: session.date, status: record.status }));
    })
      .slice(-20).reverse();
  }
  async recordLoginFailure(login) {
    const item = this.loginFailures.get(login) ?? { count: 0, since: Date.now() };
    if (Date.now() - item.since > 15 * 60_000) {
      item.count = 0;
      item.since = Date.now();
    }
    item.count += 1;
    this.loginFailures.set(login, item);
    return item.count;
  }
  async clearLoginFailures(login) { this.loginFailures.delete(login); }
  async changePassword(userId, currentPassword, newPassword, actor) {
    const user = this.users.find((item) => item.id === userId);
    if (!user || !await bcrypt.compare(currentPassword, user.passwordHash)) return null;
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw setupConflict('Choose a password different from your temporary password.');
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.mustChangePassword = false;
    user.authVersion = Number(user.authVersion ?? 0) + 1;
    for (const [tokenHash, token] of this.refreshTokens) {
      if (token.userId === userId) this.refreshTokens.delete(tokenHash);
    }
    await this.appendAudit(actor, 'user.password_changed', 'user', userId, null, null);
    return user;
  }
  async createPasswordReset(email, tokenHash, expiresAt) {
    const user = this.users.find((item) =>
      item.email?.toLowerCase() === email.toLowerCase() && item.isActive);
    if (!user) return null;
    for (const [hash, reset] of this.passwordResetTokens) {
      if (reset.userId === user.id) this.passwordResetTokens.delete(hash);
    }
    this.passwordResetTokens.set(tokenHash, { userId: user.id, expiresAt });
    await this.appendAudit({
      sub: user.id, orgId: user.orgId, activeCampusId: user.activeCampusId ?? null
    }, 'auth.password_reset_requested', 'user', user.id, null, null);
    return { userId: user.id, name: user.name, email: user.email };
  }
  async revokePasswordResetToken(tokenHash) {
    this.passwordResetTokens.delete(tokenHash);
  }
  async completePasswordReset(tokenHash, passwordHash) {
    const reset = this.passwordResetTokens.get(tokenHash);
    if (!reset || new Date(reset.expiresAt) <= new Date()) return null;
    const user = this.users.find((item) => item.id === reset.userId && item.isActive);
    this.passwordResetTokens.delete(tokenHash);
    if (!user) return null;
    user.passwordHash = passwordHash;
    user.mustChangePassword = false;
    user.authVersion = Number(user.authVersion ?? 0) + 1;
    for (const [hash, item] of this.passwordResetTokens) {
      if (item.userId === user.id) this.passwordResetTokens.delete(hash);
    }
    for (const [hash, item] of this.refreshTokens) {
      if (item.userId === user.id) this.refreshTokens.delete(hash);
    }
    await this.appendAudit({
      sub: user.id, orgId: user.orgId, activeCampusId: user.activeCampusId ?? null
    }, 'auth.password_reset_completed', 'user', user.id, null, null);
    return user;
  }
  async storeRefreshToken(tokenHash, userId, expiresAt) {
    this.refreshTokens.set(tokenHash, { userId, expiresAt });
  }
  async consumeRefreshToken(tokenHash) {
    const row = this.refreshTokens.get(tokenHash);
    if (!row || new Date(row.expiresAt) <= new Date()) return null;
    this.refreshTokens.delete(tokenHash);
    return this.findUserById(row.userId);
  }
  async revokeRefreshToken(tokenHash) {
    const token = this.refreshTokens.get(tokenHash);
    this.refreshTokens.delete(tokenHash);
    return token ? this.findUserById(token.userId) : null;
  }
  async listOrganizationAccounts(organizationId) {
    return this.users.filter((user) => user.orgId === organizationId && user.role !== 'super_admin').map((user) => ({
      id: user.id, name: user.name, email: user.email, role: user.role,
      isActive: Boolean(user.isActive), campusIds: [...(user.campusIds ?? [])]
    })).sort((left, right) => left.name.localeCompare(right.name));
  }
  async setOrganizationAccountStatus(organizationId, userId, isActive, actor) {
    const user = this.users.find((item) =>
      item.id === userId && item.orgId === organizationId && item.role !== 'super_admin');
    if (!user) return null;
    if (userId === actor.sub && !isActive) {
      throw setupConflict('You cannot deactivate your own account.');
    }
    if (Boolean(user.isActive) === isActive) {
      return {
        id: user.id, name: user.name, email: user.email, role: user.role,
        isActive: Boolean(user.isActive), campusIds: [...(user.campusIds ?? [])]
      };
    }
    const previousIsActive = Boolean(user.isActive);
    user.isActive = isActive;
    user.authVersion = Number(user.authVersion ?? 0) + 1;
    if (!isActive) {
      for (const [hash, token] of this.refreshTokens) {
        if (token.userId === userId) this.refreshTokens.delete(hash);
      }
    }
    await this.appendAudit(actor, isActive ? 'user.activated' : 'user.deactivated',
      'user', userId, { isActive: previousIsActive }, { isActive });
    return {
      id: user.id, name: user.name, email: user.email, role: user.role,
      isActive: Boolean(user.isActive), campusIds: [...(user.campusIds ?? [])]
    };
  }
  async listStudents(campusId) {
    return this.students.filter((student) => student.campusId === campusId && !student.archivedAt)
      .map((student) => {
        const section = this.sections.find((item) =>
          item.campusId === campusId && item.name === student.sectionName);
        return {
          ...student, sectionId: section?.id ?? null,
          gradeLevelId: section?.gradeLevelId ?? null, stream: section?.stream ?? null
        };
      });
  }
  async listStudentsFor(actor) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible === null) return (await this.listStudents(actor.activeCampusId)).map((student) => studentForActor(student, actor));
    const names = new Set(this.sections.filter((section) => accessible.has(section.id)).map((section) => section.name));
    return (await this.listStudents(actor.activeCampusId))
      .filter((student) => names.has(student.sectionName))
      .map((student) => studentForActor(student, actor));
  }
  async updateStudentProfile(studentId, data, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const changedFields = Object.keys(data).filter((field) => student[field] !== data[field]);
    Object.assign(student, data);
    await this.appendAudit(actor, 'student.profile_updated', 'student', student.id, null, { fields: changedFields });
    return student;
  }
  async getStudentSensitiveData(studentId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const stored = this.studentSensitive.get(studentId) ?? {};
    const data = {
      idNumber: decryptSensitiveValue(stored.idNumberEnc, this.sensitiveDataKey),
      healthNotes: decryptSensitiveValue(stored.healthNotesEnc, this.sensitiveDataKey),
      specialNeeds: decryptSensitiveValue(stored.specialNeedsEnc, this.sensitiveDataKey),
      allergies: decryptSensitiveValue(stored.allergiesEnc, this.sensitiveDataKey)
    };
    await this.appendAudit(actor, 'student.sensitive_data_viewed', 'student', studentId, null, {
      fields: Object.keys(data)
    });
    return data;
  }
  async updateStudentSensitiveData(studentId, data, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const previous = this.studentSensitive.get(studentId) ?? {};
    const next = {
      idNumberEnc: Object.hasOwn(data, 'idNumber')
        ? encryptSensitiveValue(data.idNumber, this.sensitiveDataKey) : previous.idNumberEnc ?? null,
      idNumberHash: Object.hasOwn(data, 'idNumber')
        ? hashSensitiveIdentifier(data.idNumber, this.sensitiveDataKey) : previous.idNumberHash ?? null,
      healthNotesEnc: Object.hasOwn(data, 'healthNotes')
        ? encryptSensitiveValue(data.healthNotes, this.sensitiveDataKey) : previous.healthNotesEnc ?? null,
      specialNeedsEnc: Object.hasOwn(data, 'specialNeeds')
        ? encryptSensitiveValue(data.specialNeeds, this.sensitiveDataKey) : previous.specialNeedsEnc ?? null,
      allergiesEnc: Object.hasOwn(data, 'allergies')
        ? encryptSensitiveValue(data.allergies, this.sensitiveDataKey) : previous.allergiesEnc ?? null
    };
    this.studentSensitive.set(studentId, next);
    await this.appendAudit(actor, 'student.sensitive_data_updated', 'student', studentId, null, {
      fields: Object.keys(data)
    });
    return {
      idNumber: decryptSensitiveValue(next.idNumberEnc, this.sensitiveDataKey),
      healthNotes: decryptSensitiveValue(next.healthNotesEnc, this.sensitiveDataKey),
      specialNeeds: decryptSensitiveValue(next.specialNeedsEnc, this.sensitiveDataKey),
      allergies: decryptSensitiveValue(next.allergiesEnc, this.sensitiveDataKey)
    };
  }
  async listStudentEmergencyContacts(studentId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const contacts = this.studentEmergencyContacts
      .filter((item) => item.studentId === studentId && item.campusId === actor.activeCampusId)
      .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt))
      .map((item) => ({
        id: item.id, studentId, name: decryptSensitiveValue(item.nameEnc, this.sensitiveDataKey),
        phone: decryptSensitiveValue(item.phoneEnc, this.sensitiveDataKey),
        relationship: item.relationship, priority: item.priority, createdAt: item.createdAt
      }));
    await this.appendAudit(actor, 'student.emergency_contacts_viewed', 'student', studentId, null, {
      count: contacts.length
    });
    return contacts;
  }
  async addStudentEmergencyContact(studentId, data, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const contact = {
      id: randomUUID(), studentId, campusId: actor.activeCampusId,
      nameEnc: encryptSensitiveValue(data.name, this.sensitiveDataKey),
      phoneEnc: encryptSensitiveValue(data.phone, this.sensitiveDataKey),
      relationship: data.relationship, priority: data.priority, createdAt: now()
    };
    this.studentEmergencyContacts.push(contact);
    await this.appendAudit(actor, 'student.emergency_contact_added', 'student_emergency_contact',
      contact.id, null, {
        studentId, fields: ['name', 'phone', 'relationship', 'priority'], priority: data.priority
      });
    return {
      id: contact.id, studentId, name: data.name, phone: data.phone,
      relationship: data.relationship, priority: data.priority, createdAt: contact.createdAt
    };
  }
  async removeStudentEmergencyContact(studentId, contactId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return false;
    const index = this.studentEmergencyContacts.findIndex((item) =>
      item.id === contactId && item.studentId === studentId && item.campusId === actor.activeCampusId);
    if (index < 0) return false;
    const [contact] = this.studentEmergencyContacts.splice(index, 1);
    await this.appendAudit(actor, 'student.emergency_contact_removed', 'student_emergency_contact',
      contact.id, null, { studentId });
    return true;
  }
  async listStudentGuardians(studentId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    return this.studentGuardians.filter((link) => link.studentId === studentId)
      .map((link) => {
        const guardian = this.guardians.find((item) => item.id === link.guardianId && item.orgId === actor.orgId);
        return guardian ? mapStudentGuardian({ ...guardian, relationship: link.relationship, isPrimary: link.isPrimary,
            isVerified: Boolean(link.isVerified), canViewResults: Boolean(link.canViewResults),
            canViewFees: Boolean(link.canViewFees) }) : null;
      }).filter(Boolean);
  }
  async listStudentCommendations(studentId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    return this.studentCommendations.filter((item) =>
      item.studentId === studentId && item.campusId === actor.activeCampusId)
      .sort((a, b) => b.recordedOn.localeCompare(a.recordedOn) || b.createdAt.localeCompare(a.createdAt));
  }
  async createStudentCommendation(studentId, data, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const commendation = {
      id: randomUUID(), campusId: actor.activeCampusId, studentId, ...data,
      createdBy: actor.sub, createdAt: now()
    };
    this.studentCommendations.push(commendation);
    await this.appendAudit(actor, 'student.commendation.created', 'student_commendation',
      commendation.id, null, {
        studentId, recordedOn: data.recordedOn, titleEn: data.titleEn, titleAm: data.titleAm
      });
    return commendation;
  }
  async addStudentGuardian(studentId, data, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) {
      const error = new Error('Student is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    if (data.isPrimary) {
      this.studentGuardians.filter((link) => link.studentId === studentId).forEach((link) => { link.isPrimary = false; });
    }
    const guardian = {
      id: randomUUID(), orgId: actor.orgId,
      givenNameAm: data.givenNameAm, fatherNameAm: data.fatherNameAm,
      grandfatherNameAm: data.grandfatherNameAm, givenNameEn: data.givenNameEn,
      fatherNameEn: data.fatherNameEn, grandfatherNameEn: data.grandfatherNameEn,
      phone: data.phone, email: data.email ?? null, userId: null
    };
    const link = {
      studentId, guardianId: guardian.id, relationship: data.relationship, isPrimary: data.isPrimary,
      isVerified: false, canViewResults: false, canViewFees: false
    };
    this.guardians.push(guardian);
    this.studentGuardians.push(link);
    await this.appendAudit(actor, 'student.guardian_linked', 'student', studentId, null,
      { guardianId: guardian.id, relationship: data.relationship, isPrimary: data.isPrimary });
    return mapStudentGuardian({ ...guardian, relationship: data.relationship, isPrimary: data.isPrimary,
      isVerified: false, canViewResults: false, canViewFees: false });
  }
  async removeStudentGuardian(studentId, guardianId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return false;
    const index = this.studentGuardians.findIndex((link) =>
      link.studentId === studentId && link.guardianId === guardianId);
    if (index < 0) return false;
    const [link] = this.studentGuardians.splice(index, 1);
    await this.appendAudit(actor, 'student.guardian_unlinked', 'student', studentId, null,
      { guardianId, relationship: link.relationship });
    return true;
  }
  async createStudent(data, actor) {
    await this.assertStudentCapacity(actor.orgId, 1);
    const section = this.sections.find((item) =>
      item.campusId === actor.activeCampusId && item.name === data.sectionName && item.isActive);
    if (!section) {
      const error = new Error('Section is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const duplicate = this.students.some((student) =>
      student.campusId === actor.activeCampusId && student.studentNo === data.studentNo);
    if (duplicate) {
      const error = new Error('Student number is already in use at this campus.');
      error.code = 'STUDENT_NO_CONFLICT';
      throw error;
    }
    const student = {
      id: randomUUID(), ...data, campusId: actor.activeCampusId,
      status: 'enrolled', createdAt: now()
    };
    const credentials = await generateStudentCredentials(student, (username) =>
      this.users.some((user) => user.username?.toLowerCase() === username.toLowerCase()));
    const user = {
      id: randomUUID(), orgId: actor.orgId, name: studentName(student),
      email: null, phone: null, username: credentials.username,
      passwordHash: credentials.passwordHash, role: 'student',
      campusIds: [actor.activeCampusId], activeCampusId: actor.activeCampusId,
      isActive: true, mustChangePassword: true
    };
    student.userId = user.id;
    student.hasPortalAccount = true;
    this.users.push(user);
    this.students.unshift(student);
    const academicYear = this.academicYears.find((item) =>
      item.campusId === actor.activeCampusId && item.status === 'active' &&
      (!section.academicYearId || item.id === section.academicYearId));
    if (academicYear) this.enrolments.push({
      id: randomUUID(), studentId: student.id, academicYearId: academicYear.id,
      sectionId: section.id, status: 'active', enrolledOn: addisDate(), leftOn: null, outcome: null
    });
    await this.appendAudit(actor, 'student.created', 'student', student.id, null,
      { studentNo: student.studentNo, sectionName: student.sectionName, fields: Object.keys(data) });
    await this.appendAudit(actor, 'student.account_created', 'user', user.id, null, {
      studentId: student.id, username: user.username
    });
    return { student, credentials: {
      username: user.username, temporaryPassword: credentials.temporaryPassword,
      studentName: credentials.studentName
    } };
  }
  async assertStudentCapacity(organizationId, additional = 1) {
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    const plan = subscription && this.subscriptionPlans.find((item) => item.id === subscription.planId);
    if (plan?.studentLimit == null) return;
    const campusIds = new Set(this.campuses.filter((campus) =>
      campus.organizationId === organizationId).map((campus) => campus.id));
    const count = this.students.filter((student) =>
      campusIds.has(student.campusId) && !student.archivedAt).length;
    if (count + additional > plan.studentLimit) throw planLimitError('student', plan.studentLimit);
  }
  async previewStudentImport(rows, actor) {
    const sections = this.sections.filter((section) =>
      section.campusId === actor.activeCampusId && section.isActive !== false);
    const existingStudents = this.students.filter((student) =>
      student.campusId === actor.activeCampusId && !student.archivedAt);
    return studentImportReports(rows, sections, existingStudents);
  }
  async importStudents(rows, actor) {
    const reports = await this.previewStudentImport(rows, actor);
    const eligibleRows = rows.filter((row) =>
      reports.find((report) => report.rowNumber === row.rowNumber)?.eligible);
    await this.assertStudentCapacity(actor.orgId, eligibleRows.length);
    const stagedStudents = await Promise.all(eligibleRows.map(async ({ rowNumber, data }) => {
      const generated = await generateStudentCredentials(data, (username) =>
        this.users.some((user) => user.username?.toLowerCase() === username.toLowerCase()));
      const user = {
        id: randomUUID(), orgId: actor.orgId, name: studentName(data),
        email: null, phone: null, username: generated.username,
        passwordHash: generated.passwordHash, role: 'student',
        campusIds: [actor.activeCampusId], activeCampusId: actor.activeCampusId,
        isActive: true, mustChangePassword: true
      };
      const student = {
        id: randomUUID(), ...data, campusId: actor.activeCampusId,
        status: 'enrolled', createdAt: now(), userId: user.id, hasPortalAccount: true
      };
      return { rowNumber, student, user, credentials: {
        studentName: generated.studentName, username: generated.username,
        temporaryPassword: generated.temporaryPassword
      } };
    }));
    this.users.push(...stagedStudents.map((entry) => entry.user));
    this.students.unshift(...stagedStudents.map((entry) => entry.student));
    for (const entry of stagedStudents) {
      const section = this.sections.find((item) =>
        item.campusId === actor.activeCampusId && item.isActive &&
        item.name === entry.student.sectionName);
      const academicYear = section && this.academicYears.find((item) =>
        item.campusId === actor.activeCampusId && item.status === 'active' &&
        (!section.academicYearId || item.id === section.academicYearId));
      if (section && academicYear) this.enrolments.push({
        id: randomUUID(), studentId: entry.student.id, academicYearId: academicYear.id,
        sectionId: section.id, status: 'active', enrolledOn: addisDate(), leftOn: null, outcome: null
      });
      await this.appendAudit(actor, 'student.created', 'student', entry.student.id, null, {
        studentNo: entry.student.studentNo, sectionName: entry.student.sectionName,
        fields: Object.keys(entry.student).filter((field) => !['id', 'campusId', 'status', 'createdAt', 'userId', 'hasPortalAccount'].includes(field))
      });
      await this.appendAudit(actor, 'student.account_created', 'user', entry.user.id, null, {
        studentId: entry.student.id, username: entry.user.username
      });
    }
    return { reports, createdCount: stagedStudents.length, credentials: stagedStudents.map((entry) => ({
      rowNumber: entry.rowNumber, studentNo: entry.student.studentNo, ...entry.credentials
    })) };
  }
  async hasStudents(campusId, ids) {
    const found = this.students.filter((s) => s.campusId === campusId && ids.includes(s.id));
    return found.length === ids.length;
  }
  async listSections(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    return this.sections.filter((section) => section.campusId === campusId && section.isActive &&
      (accessible === null || accessible.has(section.id)));
  }
  async accessibleSectionIds(actor) {
    if (!['homeroom_teacher', 'subject_teacher'].includes(actor.role)) return null;
    const staff = this.staff.find((item) =>
      item.userId === actor.sub && item.campusId === actor.activeCampusId);
    if (!staff) return new Set();
    return new Set([
      ...this.teachingAssignments.filter((item) => item.staffId === staff.id && item.isActive)
        .map((item) => item.sectionId),
      ...this.homeroomAssignments.filter((item) => item.staffId === staff.id)
        .map((item) => item.sectionId)
    ]);
  }
  async hasSection(campusId, sectionId) {
    return this.sections.some((section) => section.campusId === campusId && section.id === sectionId && section.isActive);
  }
  async hasStudentsInSection(campusId, sectionId, ids) {
    const section = this.sections.find((item) => item.campusId === campusId && item.id === sectionId && item.isActive);
    if (!section) return false;
    const found = this.students.filter((student) =>
      student.campusId === campusId && student.sectionName === section.name && ids.includes(student.id));
    return found.length === ids.length;
  }
  async hasStudentsInSections(campusId, sectionIds, ids) {
    const allowed = new Set(sectionIds);
    const sectionNames = new Set(this.sections.filter((section) => allowed.has(section.id)).map((section) => section.name));
    const rows = this.students.filter((student) =>
      student.campusId === campusId && sectionNames.has(student.sectionName) && ids.includes(student.id));
    return rows.length === ids.length;
  }
  async listRoster(actor, sectionId) {
    const section = this.sections.find((item) =>
      item.id === sectionId && item.campusId === actor.activeCampusId && item.isActive);
    const accessible = await this.accessibleSectionIds(actor);
    if (!section || (accessible && !accessible.has(sectionId))) throw campusScopeError('Section is not accessible.');
    return (await this.listStudents(actor.activeCampusId))
      .filter((student) => student.sectionName === section.name);
  }
  async getAcademicYear(campusId) {
    return this.academicYears.find((year) => year.campusId === campusId && year.status === 'active') ?? null;
  }
  async listAcademicYears(campusId) {
    return this.academicYears.filter((year) => year.campusId === campusId);
  }
  async createAcademicYear(data, actor) {
    if (this.academicYears.some((year) => year.campusId === actor.activeCampusId && year.labelEc === data.labelEc)) {
      throw setupConflict('Academic-year label already exists at this campus.');
    }
    const year = {
      id: randomUUID(), campusId: actor.activeCampusId, ...data, status: 'planned'
    };
    this.academicYears.push(year);
    await this.appendAudit(actor, 'academic_year.created', 'academic_year', year.id, null, year);
    return year;
  }
  async activateAcademicYear(yearId, actor) {
    const year = this.academicYears.find((item) =>
      item.id === yearId && item.campusId === actor.activeCampusId);
    if (!year) return null;
    const before = this.academicYears
      .filter((item) => item.campusId === actor.activeCampusId && item.status === 'active')
      .map(({ id, labelEc }) => ({ id, labelEc }));
    for (const item of this.academicYears) {
      if (item.campusId === actor.activeCampusId && item.status === 'active') {
        item.status = 'closed';
        if (item.id !== yearId) {
          this.enrolments.filter((enrolment) =>
            enrolment.academicYearId === item.id && enrolment.status === 'active')
            .forEach((enrolment) => {
              enrolment.status = 'completed';
              enrolment.leftOn = addisDate();
            });
          for (const term of item.terms ?? []) term.isCurrent = false;
        }
      }
    }
    year.status = 'active';
    await this.appendAudit(actor, 'academic_year.activated', 'academic_year', year.id, before, year);
    return year;
  }
  async listTerms(campusId) {
    return this.academicYears.filter((year) => year.campusId === campusId)
      .flatMap((year) => (year.terms ?? []).map((term) => ({
        ...term, academicYearId: year.id, periodType: term.periodType ?? 'term'
      })));
  }
  async createTerm(data, actor) {
    const year = await this.getAcademicYear(actor.activeCampusId);
    if (!year) throw setupConflict('Create or activate an academic year before adding terms.');
    if (data.startDate < year.startDate || data.endDate > year.endDate) {
      const error = new Error('Term dates must be within the active academic year.');
      error.status = 400;
      error.code = 'TERM_OUTSIDE_ACADEMIC_YEAR';
      throw error;
    }
    year.terms ??= [];
    if (year.terms.some((term) => term.name.toLowerCase() === data.name.toLowerCase())) {
      throw setupConflict('Term name already exists in the active academic year.');
    }
    const term = { id: randomUUID(), ...data, periodType: data.periodType ?? 'term', isCurrent: year.terms.length === 0 };
    year.terms.push(term);
    await this.appendAudit(actor, 'term.created', 'term', term.id, null, term);
    return { ...term, academicYearId: year.id };
  }
  async setCurrentTerm(termId, actor) {
    const activeYear = await this.getAcademicYear(actor.activeCampusId);
    if (!activeYear) return null;
    const terms = activeYear.terms ?? [];
    const selected = terms.find((term) => term.id === termId);
    if (!selected) return null;
    const previous = terms.find((term) => term.isCurrent);
    for (const term of terms) term.isCurrent = term.id === termId;
    await this.appendAudit(actor, 'term.current_changed', 'term', termId,
      previous ? { id: previous.id, isCurrent: true } : null,
      { id: termId, isCurrent: true });
    return { ...selected, academicYearId: activeYear.id };
  }
  async listSchoolCalendarEntries(campusId, { from, to } = {}) {
    return this.schoolCalendarEntries.filter((entry) => entry.campusId === campusId &&
      (!from || entry.endDate >= from) && (!to || entry.startDate <= to))
      .sort((left, right) => left.startDate.localeCompare(right.startDate));
  }
  async createSchoolCalendarEntry(data, actor) {
    const year = data.academicYearId
      ? this.academicYears.find((item) => item.id === data.academicYearId &&
        item.campusId === actor.activeCampusId)
      : null;
    if (data.academicYearId && !year) throw campusScopeError('Academic year is outside the active campus.');
    if (year && (data.startDate < year.startDate || data.endDate > year.endDate)) {
      throw setupConflict('Calendar dates must fall within the selected academic year.');
    }
    if (['holiday', 'closure'].includes(data.entryType) && !data.isNonInstructionalDay) {
      throw setupConflict('Holidays and closures must be marked as non-instructional days.');
    }
    const entry = {
      id: randomUUID(), campusId: actor.activeCampusId, ...data,
      academicYearId: data.academicYearId ?? null, createdBy: actor.sub,
      createdAt: now(), updatedAt: now()
    };
    this.schoolCalendarEntries.push(entry);
    await this.appendAudit(actor, 'school_calendar_entry.created', 'school_calendar_entry', entry.id, null, entry);
    return entry;
  }
  async updateSchoolCalendarEntry(id, data, actor) {
    const entry = this.schoolCalendarEntries.find((item) =>
      item.id === id && item.campusId === actor.activeCampusId);
    if (!entry) return null;
    const next = { ...entry, ...data };
    const year = next.academicYearId
      ? this.academicYears.find((item) => item.id === next.academicYearId &&
        item.campusId === actor.activeCampusId)
      : null;
    if (next.academicYearId && !year) throw campusScopeError('Academic year is outside the active campus.');
    if (year && (next.startDate < year.startDate || next.endDate > year.endDate)) {
      throw setupConflict('Calendar dates must fall within the selected academic year.');
    }
    if (['holiday', 'closure'].includes(next.entryType) && !next.isNonInstructionalDay) {
      throw setupConflict('Holidays and closures must be marked as non-instructional days.');
    }
    const before = { ...entry };
    Object.assign(entry, next, { updatedAt: now() });
    await this.appendAudit(actor, 'school_calendar_entry.updated', 'school_calendar_entry', id, before, entry);
    return entry;
  }
  async deleteSchoolCalendarEntry(id, actor) {
    const index = this.schoolCalendarEntries.findIndex((item) =>
      item.id === id && item.campusId === actor.activeCampusId);
    if (index < 0) return false;
    const [entry] = this.schoolCalendarEntries.splice(index, 1);
    await this.appendAudit(actor, 'school_calendar_entry.deleted', 'school_calendar_entry', id, entry, null);
    return true;
  }
  async listCurriculumUnits(campusId, { academicYearId, gradeLevelId, subjectId } = {}) {
    return this.curriculumUnits.filter((unit) => unit.campusId === campusId &&
      (!academicYearId || unit.academicYearId === academicYearId) &&
      (!gradeLevelId || unit.gradeLevelId === gradeLevelId) &&
      (!subjectId || unit.subjectId === subjectId))
      .sort((left, right) => left.unitNumber - right.unitNumber);
  }
  async saveCurriculumUnit(data, actor, unitId = null) {
    const grade = this.gradeLevels.find((item) =>
      item.id === data.gradeLevelId && item.campusId === actor.activeCampusId);
    const subject = this.subjects.find((item) =>
      item.id === data.subjectId && item.campusId === actor.activeCampusId);
    const year = this.academicYears.find((item) =>
      item.id === data.academicYearId && item.campusId === actor.activeCampusId);
    if (!grade || !subject || !year) throw campusScopeError('Curriculum grade, subject or year is outside the active campus.');
    if (data.stream !== 'all' && !isUpperSecondaryGrade(grade.code)) {
      throw setupConflict('Only Grades 11 and 12 can use subject streams.');
    }
    const mapping = this.gradeSubjects.find((item) =>
      item.gradeLevelId === grade.id && item.subjectId === subject.id &&
      (item.stream === 'all' || item.stream === data.stream));
    if (!mapping) throw setupConflict('The subject is not mapped to this grade and stream.');
    if ((data.plannedStart && data.plannedStart < year.startDate) ||
        (data.plannedEnd && data.plannedEnd > year.endDate)) {
      throw setupConflict('Curriculum dates must fall within the selected academic year.');
    }
    const duplicate = this.curriculumUnits.find((item) =>
      item.id !== unitId && item.academicYearId === year.id &&
      item.gradeLevelId === grade.id && item.subjectId === subject.id &&
      item.stream === data.stream && item.unitNumber === data.unitNumber);
    if (duplicate) throw setupConflict('Unit number already exists for this grade, subject and stream.');
    let unit;
    if (unitId) {
      unit = this.curriculumUnits.find((item) =>
        item.id === unitId && item.campusId === actor.activeCampusId);
      if (!unit) return null;
      const before = { ...unit };
      Object.assign(unit, data, { updatedAt: now() });
      await this.appendAudit(actor, 'curriculum_unit.updated', 'curriculum_unit', unitId, before, unit);
    } else {
      unit = {
        id: randomUUID(), campusId: actor.activeCampusId, ...data,
        plannedStart: data.plannedStart ?? null, plannedEnd: data.plannedEnd ?? null,
        createdBy: actor.sub, createdAt: now(), updatedAt: now()
      };
      this.curriculumUnits.push(unit);
      await this.appendAudit(actor, 'curriculum_unit.created', 'curriculum_unit', unit.id, null, unit);
    }
    return { ...unit, gradeName: grade.nameEn, subjectName: subject.nameEn };
  }
  async deleteCurriculumUnit(id, actor) {
    if (this.lessonPlans.some((item) => item.curriculumUnitId === id)) {
      throw setupConflict('A curriculum unit referenced by a lesson plan cannot be deleted.');
    }
    const index = this.curriculumUnits.findIndex((item) =>
      item.id === id && item.campusId === actor.activeCampusId);
    if (index < 0) return false;
    const [unit] = this.curriculumUnits.splice(index, 1);
    await this.appendAudit(actor, 'curriculum_unit.deleted', 'curriculum_unit', id, unit, null);
    return true;
  }
  async listLessonPlans(actor, { from, to, sectionId } = {}) {
    const assignments = await this.listTeachingAssignments(actor);
    const assignmentIds = new Set(assignments.map((item) => item.id));
    return this.lessonPlans.filter((plan) => plan.campusId === actor.activeCampusId &&
      assignmentIds.has(plan.teachingAssignmentId) &&
      (!from || plan.plannedOn >= from) && (!to || plan.plannedOn <= to) &&
      (!sectionId || plan.sectionId === sectionId))
      .sort((left, right) => left.plannedOn.localeCompare(right.plannedOn));
  }
  async createLessonPlan(data, actor) {
    const assignment = this.teachingAssignments.find((item) =>
      item.id === data.teachingAssignmentId && item.campusId === actor.activeCampusId && item.isActive);
    if (!assignment) throw campusScopeError('Teaching assignment is outside the active campus or inactive.');
    if (['homeroom_teacher', 'subject_teacher'].includes(actor.role)) {
      const staff = this.staff.find((item) => item.id === assignment.staffId);
      if (!staff || staff.userId !== actor.sub) throw campusScopeError('Lesson plans can only be created for your assignments.');
    }
    const section = this.sections.find((item) =>
      item.id === assignment.sectionId && item.campusId === actor.activeCampusId && item.isActive);
    const year = section && this.academicYears.find((item) =>
      item.id === section.academicYearId && item.campusId === actor.activeCampusId && item.status === 'active');
    if (!section || !year || data.plannedOn < year.startDate || data.plannedOn > year.endDate) {
      throw setupConflict('Lesson date must fall within the section active academic year.');
    }
    let unit = null;
    if (data.curriculumUnitId) {
      unit = this.curriculumUnits.find((item) => item.id === data.curriculumUnitId &&
        item.campusId === actor.activeCampusId && item.academicYearId === year.id &&
        item.gradeLevelId === section.gradeLevelId && item.subjectId === assignment.subjectId &&
        (item.stream === 'all' || item.stream === (section.stream ?? 'all')));
      if (!unit) throw campusScopeError('Curriculum unit does not match this section and subject.');
    }
    const plan = {
      id: randomUUID(), campusId: actor.activeCampusId, academicYearId: year.id,
      teachingAssignmentId: assignment.id, curriculumUnitId: unit?.id ?? null,
      sectionId: section.id, sectionName: section.name, subjectId: assignment.subjectId,
      subjectName: this.subjects.find((item) => item.id === assignment.subjectId)?.nameEn ?? '',
      teacherName: this.staff.find((item) => item.id === assignment.staffId)?.givenNameEn ?? '',
      ...data, status: 'planned', createdBy: actor.sub, completedAt: null,
      createdAt: now(), updatedAt: now()
    };
    this.lessonPlans.push(plan);
    await this.appendAudit(actor, 'lesson_plan.created', 'lesson_plan', plan.id, null, plan);
    return plan;
  }
  async updateLessonPlan(id, data, actor) {
    const plan = this.lessonPlans.find((item) =>
      item.id === id && item.campusId === actor.activeCampusId);
    if (!plan) return null;
    const assignment = this.teachingAssignments.find((item) => item.id === plan.teachingAssignmentId);
    if (['homeroom_teacher', 'subject_teacher'].includes(actor.role)) {
      const staff = assignment && this.staff.find((item) => item.id === assignment.staffId);
      if (!staff || staff.userId !== actor.sub) throw campusScopeError('Lesson plan is outside your assignments.');
    }
    if (plan.status !== 'planned') throw setupConflict('Only planned lessons can be edited.');
    const before = { ...plan };
    Object.assign(plan, data, {
      completedAt: data.status === 'completed' ? now() : plan.completedAt,
      updatedAt: now()
    });
    await this.appendAudit(actor, 'lesson_plan.updated', 'lesson_plan', id, before, plan);
    return plan;
  }
  async listPromotionRules(campusId) {
    const year = await this.getAcademicYear(campusId);
    if (!year) return [];
    return this.promotionRules.filter((rule) =>
      rule.campusId === campusId && rule.academicYearId === year.id);
  }
  async savePromotionRule(data, actor) {
    const year = await this.getAcademicYear(actor.activeCampusId);
    const grade = this.gradeLevels.find((item) =>
      item.id === data.gradeLevelId && item.campusId === actor.activeCampusId);
    if (!year || !grade) throw campusScopeError('Select a campus grade and active academic year.');
    const existing = this.promotionRules.find((item) =>
      item.campusId === actor.activeCampusId && item.academicYearId === year.id &&
      item.gradeLevelId === grade.id);
    const before = existing ? { ...existing } : null;
    const rule = {
      id: existing?.id ?? randomUUID(), campusId: actor.activeCampusId,
      academicYearId: year.id, gradeLevelId: grade.id, ...data,
      updatedBy: actor.sub, updatedAt: now()
    };
    if (existing) Object.assign(existing, rule);
    else this.promotionRules.push(rule);
    await this.appendAudit(actor, 'promotion_rule.saved', 'promotion_rule', rule.id, before, rule);
    return rule;
  }
  async evaluateStudentProgression(studentId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const targetYear = this.academicYears.find((item) =>
      item.campusId === actor.activeCampusId && item.status === 'active');
    const previous = this.enrolments.filter((item) => item.studentId === studentId)
      .map((enrolment) => ({
        enrolment, year: this.academicYears.find((year) =>
          year.id === enrolment.academicYearId && year.campusId === actor.activeCampusId)
      }))
      .filter((item) => item.year?.status === 'closed' && item.enrolment.status === 'completed')
      .sort((left, right) => right.year.endDate.localeCompare(left.year.endDate))[0];
    if (!targetYear || !previous) throw setupConflict('A completed prior year and active destination year are required.');
    const sourceSection = this.sections.find((item) => item.id === previous.enrolment.sectionId);
    const sourceGrade = this.gradeLevels.find((item) => item.id === sourceSection?.gradeLevelId);
    const rule = this.promotionRules.find((item) =>
      item.campusId === actor.activeCampusId && item.academicYearId === targetYear.id &&
      item.gradeLevelId === sourceGrade?.id);
    if (!sourceSection || !sourceGrade) throw setupConflict('The prior enrolment is missing its grade assignment.');
    if (!rule) return {
      studentId, sourceYearId: previous.year.id, targetYearId: targetYear.id,
      sourceGradeId: sourceGrade.id, sourceGrade: sourceGrade.nameEn,
      status: 'needs_configuration', rule: null, annualAveragePercent: null,
      failedRequiredSubjects: [], reason: 'Configure a promotion rule for this grade and academic year.'
    };
    const terms = previous.year.terms ?? [];
    const publishedReports = [];
    for (const term of terms) {
      const report = this.termReportRevisions.filter((item) =>
        item.studentId === studentId && item.termId === term.id &&
        item.campusId === actor.activeCampusId)
        .sort((left, right) => right.revision - left.revision)[0];
      if (!report || report.status !== 'published') {
        return {
          studentId, sourceYearId: previous.year.id, targetYearId: targetYear.id,
          sourceGradeId: sourceGrade.id, sourceGrade: sourceGrade.nameEn,
          status: 'missing_results', rule, annualAveragePercent: null,
          failedRequiredSubjects: [], reason: `A published report is missing for ${term.name}.`
        };
      }
      publishedReports.push(report.snapshot);
    }
    const requiredSubjects = this.gradeSubjects.filter((mapping) =>
      mapping.gradeLevelId === sourceGrade.id && mapping.isRequired &&
      (mapping.stream === 'all' || mapping.stream === (sourceSection.stream ?? 'all')));
    if (!publishedReports.length || !requiredSubjects.length) {
      return {
        studentId, sourceYearId: previous.year.id, targetYearId: targetYear.id,
        sourceGradeId: sourceGrade.id, sourceGrade: sourceGrade.nameEn,
        status: 'missing_results', rule, annualAveragePercent: null,
        failedRequiredSubjects: [], reason: 'Published annual reports or required subject mappings are missing.'
      };
    }
    const subjects = requiredSubjects.map((mapping) => {
      const subject = this.subjects.find((item) => item.id === mapping.subjectId);
      const rows = publishedReports.flatMap((report) =>
        (report.subjects ?? []).filter((item) => item.subjectId === mapping.subjectId));
      const value = rows.reduce((total, item) => total + Number(item.value), 0);
      const maxValue = rows.reduce((total, item) => total + Number(item.maxValue), 0);
      return {
        subjectId: mapping.subjectId, subjectName: subject?.nameEn ?? '',
        percent: maxValue ? Math.round((value / maxValue) * 10000) / 100 : null,
        value, maxValue
      };
    });
    const missingSubject = subjects.find((item) => item.percent === null);
    if (missingSubject) return {
      studentId, sourceYearId: previous.year.id, targetYearId: targetYear.id,
      sourceGradeId: sourceGrade.id, sourceGrade: sourceGrade.nameEn,
      status: 'missing_results', rule, annualAveragePercent: null,
      failedRequiredSubjects: [], reason: `Published results are missing for ${missingSubject.subjectName}.`
    };
    const policy = this.gradingPolicies.find((item) => item.campusId === actor.activeCampusId);
    const annualAveragePercent = policy?.scoringMethod === 'equal_subject_weighted'
      ? Math.round(subjects.reduce((sum, item) => sum + item.percent, 0) / subjects.length * 100) / 100
      : Math.round(subjects.reduce((sum, item) => sum + item.value, 0) /
        subjects.reduce((sum, item) => sum + item.maxValue, 0) * 10000) / 100;
    const failedRequiredSubjects = subjects.filter((item) =>
      item.percent < rule.minimumAnnualPercent);
    const eligible = annualAveragePercent >= rule.minimumAnnualPercent &&
      failedRequiredSubjects.length <= rule.maximumFailedRequiredSubjects;
    return {
      studentId, sourceYearId: previous.year.id, targetYearId: targetYear.id,
      sourceGradeId: sourceGrade.id, sourceGrade: sourceGrade.nameEn,
      status: eligible ? 'eligible' : 'ineligible', rule,
      annualAveragePercent, failedRequiredSubjects,
      reason: eligible ? '' : 'The student does not meet the configured annual promotion criteria.'
    };
  }
  async listGrades(campusId) {
    return this.gradeLevels.filter((grade) => grade.campusId === campusId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async createGrade(data, actor) {
    const template = getGradeTemplate(data.code);
    if (!template) throw setupConflict('Choose a grade from the Grade 1–12 school curriculum.');
    if (this.gradeLevels.some((grade) => grade.campusId === actor.activeCampusId && grade.code === data.code)) {
      throw setupConflict('Grade code already exists at this campus.');
    }
    const grade = { id: randomUUID(), campusId: actor.activeCampusId, ...template.grade };
    this.gradeLevels.push(grade);
    for (const item of template.subjects) {
      let subject = this.subjects.find((row) =>
        row.campusId === actor.activeCampusId && row.code === item.code);
      if (!subject) {
        subject = {
          id: randomUUID(), campusId: actor.activeCampusId,
          code: item.code, nameEn: item.nameEn, nameAm: item.nameAm
        };
        this.subjects.push(subject);
      }
      this.gradeSubjects.push({
        id: randomUUID(), gradeLevelId: grade.id, subjectId: subject.id,
        stream: item.stream, weeklyPeriods: item.weeklyPeriods, isRequired: true
      });
    }
    if (!this.gradingBands.some((band) => band.campusId === actor.activeCampusId)) {
      this.gradingBands.push(...DEFAULT_GRADING_BANDS.map((band) => ({
        id: randomUUID(), campusId: actor.activeCampusId, ...band
      })));
    }
    await this.appendAudit(actor, 'grade_level.created', 'grade_level', grade.id, null, grade);
    return grade;
  }
  async listSubjects(campusId) {
    return this.subjects.filter((subject) => subject.campusId === campusId)
      .map((subject) => ({ ...subject, category: subject.category ?? 'core' }));
  }
  async createSubject(data, actor) {
    if (this.subjects.some((subject) => subject.campusId === actor.activeCampusId && subject.code === data.code)) {
      throw setupConflict('Subject code already exists at this campus.');
    }
    const subject = { id: randomUUID(), campusId: actor.activeCampusId, ...data, category: data.category ?? 'core' };
    this.subjects.push(subject);
    await this.appendAudit(actor, 'subject.created', 'subject', subject.id, null, subject);
    return subject;
  }
  async listGradeSubjects(campusId, gradeLevelId, stream) {
    const grade = this.gradeLevels.find((item) =>
      item.id === gradeLevelId && item.campusId === campusId);
    if (!grade) throw campusScopeError('Grade is outside the active campus.');
    return this.gradeSubjects.filter((item) =>
      item.gradeLevelId === gradeLevelId && (!stream || item.stream === 'all' || item.stream === stream))
      .map((item) => {
        const subject = this.subjects.find((row) => row.id === item.subjectId);
        return subject ? { ...subject, ...item, campusId: subject.campusId } : null;
      }).filter(Boolean);
  }
  async sectionHasSubject(section, subjectId) {
    const mappings = this.gradeSubjects.filter((item) => item.gradeLevelId === section.gradeLevelId);
    return mappings.length === 0 || mappings.some((item) =>
      item.gradeLevelId === section.gradeLevelId && item.subjectId === subjectId &&
      (item.stream === 'all' || item.stream === section.stream));
  }
  async replaceGradeSubjects(gradeLevelId, data, actor) {
    const grade = this.gradeLevels.find((item) =>
      item.id === gradeLevelId && item.campusId === actor.activeCampusId);
    if (!grade) throw campusScopeError('Grade is outside the active campus.');
    const seen = new Set();
    for (const item of data.subjects) {
      const subject = this.subjects.find((row) =>
        row.id === item.subjectId && row.campusId === actor.activeCampusId);
      const key = `${item.subjectId}:${item.stream}`;
      if (!subject) throw campusScopeError('Subject is outside the active campus.');
      if (seen.has(key)) throw setupConflict('A subject cannot be added twice to the same grade stream.');
      if (item.stream !== 'all' && !isUpperSecondaryGrade(grade.code)) {
        throw setupConflict('Only Grades 11 and 12 can use subject streams.');
      }
      seen.add(key);
    }
    const before = await this.listGradeSubjects(actor.activeCampusId, gradeLevelId);
    this.gradeSubjects = this.gradeSubjects.filter((item) => item.gradeLevelId !== gradeLevelId);
    this.gradeSubjects.push(...data.subjects.map((item) => ({
      id: randomUUID(), gradeLevelId, ...item, isRequired: item.isRequired ?? true
    })));
    const after = await this.listGradeSubjects(actor.activeCampusId, gradeLevelId);
    await this.appendAudit(actor, 'grade_subjects.replaced', 'grade_level', gradeLevelId, before, after);
    return after;
  }
  async createSection(data, actor) {
    const year = await this.getAcademicYear(actor.activeCampusId);
    const grade = this.gradeLevels.find((item) =>
      item.id === data.gradeLevelId && item.campusId === actor.activeCampusId);
    if (!year || !grade) throw campusScopeError('Grade or active academic year is not available at this campus.');
    if (isUpperSecondaryGrade(grade.code) !== Boolean(data.stream)) {
      throw setupConflict(isUpperSecondaryGrade(grade.code)
        ? 'Choose a Natural Science or Social Science stream for this grade.'
        : 'Streams are only available for Grades 11 and 12.');
    }
    const duplicate = this.sections.some((section) =>
      section.campusId === actor.activeCampusId && section.name.toLowerCase() === data.name.toLowerCase());
    if (duplicate) throw setupConflict('Section name already exists in the active academic year.');
    const section = {
      id: randomUUID(), campusId: actor.activeCampusId, academicYearId: year.id,
      gradeLevelId: grade.id, gradeName: grade.nameEn, name: data.name,
      capacity: data.capacity ?? null, shift: data.shift ?? 'morning',
      stream: data.stream ?? null, isActive: true
    };
    this.sections.push(section);
    await this.appendAudit(actor, 'section.created', 'section', section.id, null, section);
    return section;
  }
  async updateSectionCapacity(sectionId, { capacity }, actor) {
    const section = this.sections.find((item) =>
      item.id === sectionId && item.campusId === actor.activeCampusId);
    if (!section) return null;
    const count = this.enrolments.filter((item) =>
      item.sectionId === sectionId && item.academicYearId === section.academicYearId && item.status === 'active').length;
    if (capacity != null && capacity < count) {
      throw setupConflict('Capacity cannot be lower than the number of active enrolments.');
    }
    const before = { capacity: section.capacity };
    section.capacity = capacity;
    await this.appendAudit(actor, 'section.capacity_updated', 'section', sectionId, before, { capacity });
    return section;
  }
  async saveAttendance(data, actor) {
    const existing = this.attendance.find((item) =>
      item.campusId === actor.activeCampusId && item.clientUuid === data.clientUuid);
    if (existing) return { ...existing, duplicate: true };
    if (!await this.hasSection(actor.activeCampusId, data.sectionId)) {
      const error = new Error('Section is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const accessibleSections = await this.accessibleSectionIds(actor);
    if (accessibleSections && !accessibleSections.has(data.sectionId)) {
      throw campusScopeError('Teacher is not assigned to this section.');
    }
    if (!await this.hasStudentsInSection(actor.activeCampusId, data.sectionId, data.records.map((r) => r.studentId))) {
      const error = new Error('Attendance includes a student outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const session = {
      id: randomUUID(), campusId: actor.activeCampusId, date: data.date,
      sectionId: data.sectionId, clientUuid: data.clientUuid,
      records: data.records, takenBy: actor.sub, createdAt: now()
    };
    this.attendance.unshift(session);
    try {
      await this.appendAudit(actor, 'attendance.recorded', 'attendance_session', session.id, null, session);
    } catch (error) {
      const index = this.attendance.indexOf(session);
      if (index >= 0) this.attendance.splice(index, 1);
      throw error;
    }
    return session;
  }
  async listAttendance(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    return this.attendance.filter((item) => item.campusId === campusId &&
      (accessible === null || accessible.has(item.sectionId)));
  }
  async getAttendanceSession(sessionId, actor) {
    const session = this.attendance.find((item) =>
      item.id === sessionId && item.campusId === actor.activeCampusId);
    if (!session) return null;
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !accessible.has(session.sectionId)) {
      throw campusScopeError('Attendance session is outside the assigned sections.');
    }
    return {
      id: session.id, date: session.date, sectionId: session.sectionId,
      records: (session.records ?? []).map((record) => {
        const student = this.students.find((item) => item.id === record.studentId);
        return {
          studentId: record.studentId,
          studentName: student ? studentName(student) : '',
          status: record.status, reason: record.reason ?? ''
        };
      })
    };
  }
  async correctAttendance(sessionId, studentId, correction, actor) {
    const session = this.attendance.find((item) =>
      item.id === sessionId && item.campusId === actor.activeCampusId);
    if (!session) return null;
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !accessible.has(session.sectionId)) {
      throw campusScopeError('Attendance session is outside the assigned sections.');
    }
    const record = (session.records ?? []).find((item) => item.studentId === studentId);
    if (!record) return null;
    if (record.status === correction.status) {
      const error = new Error('Choose a different attendance status to make a correction.');
      error.status = 409;
      error.code = 'ATTENDANCE_CORRECTION_NO_CHANGE';
      throw error;
    }
    if (!attendanceCorrectionWindowOpen(session.date)) {
      if (this.attendanceCorrectionRequests.some((item) =>
        item.campusId === actor.activeCampusId && item.sessionId === sessionId &&
        item.studentId === studentId && item.status === 'pending')) {
        throw attendanceCorrectionConflict('A correction request is already pending for this attendance record.');
      }
      const request = {
        id: randomUUID(), campusId: actor.activeCampusId, sessionId, studentId,
        attendanceDate: session.date, originalStatus: record.status,
        requestedStatus: correction.status, reason: correction.reason,
        requestedBy: actor.sub, status: 'pending', requestedAt: now(),
        reviewedBy: null, reviewNote: null, reviewedAt: null
      };
      this.attendanceCorrectionRequests.unshift(request);
      await this.appendAudit(actor, 'attendance.correction_requested',
        'attendance_correction_request', request.id, null, {
          sessionId, studentId, attendanceDate: session.date,
          originalStatus: record.status, requestedStatus: correction.status,
          reason: correction.reason
        });
      return { approvalRequired: true, request: { ...request } };
    }
    const before = { status: record.status, reason: record.reason ?? '' };
    record.status = correction.status;
    record.reason = correction.reason;
    await this.appendAudit(actor, 'attendance.corrected', 'attendance_record',
      sessionId, before, { status: record.status, reason: correction.reason });
    return this.getAttendanceSession(sessionId, actor);
  }
  async listAttendanceCorrectionRequests(actor) {
    return this.attendanceCorrectionRequests.filter((item) =>
      item.campusId === actor.activeCampusId && item.status === 'pending')
      .map((item) => ({
        ...item,
        studentName: studentName(this.students.find((student) => student.id === item.studentId) ?? {})
      }));
  }
  async reviewAttendanceCorrection(requestId, review, actor) {
    const item = this.attendanceCorrectionRequests.find((request) =>
      request.id === requestId && request.campusId === actor.activeCampusId);
    if (!item) return null;
    if (item.status !== 'pending') {
      throw attendanceCorrectionConflict('Only pending attendance correction requests can be reviewed.');
    }
    if (item.requestedBy === actor.sub) {
      throw attendanceCorrectionConflict('A correction requester cannot approve or reject their own request.');
    }
    const session = this.attendance.find((entry) =>
      entry.id === item.sessionId && entry.campusId === actor.activeCampusId);
    const record = session?.records.find((entry) => entry.studentId === item.studentId);
    if (!session || !record) return null;
    if (review.decision === 'approved' && record.status !== item.originalStatus) {
      throw attendanceCorrectionConflict('Attendance changed after this correction was requested; review the current record.');
    }
    const before = { status: item.status };
    item.status = review.decision;
    item.reviewedBy = actor.sub;
    item.reviewNote = review.note;
    item.reviewedAt = now();
    if (review.decision === 'approved') {
      const attendanceBefore = { status: record.status, reason: record.reason ?? '' };
      record.status = item.requestedStatus;
      record.reason = item.reason;
      await this.appendAudit(actor, 'attendance.corrected', 'attendance_record',
        item.sessionId, attendanceBefore, {
          status: record.status, reason: item.reason, correctionRequestId: item.id
        });
    }
    await this.appendAudit(actor, `attendance.correction_${review.decision}`,
      'attendance_correction_request', item.id, before, {
        status: item.status, reviewedBy: item.reviewedBy, reviewNote: item.reviewNote
      });
    return { ...item };
  }
  async getAttendanceSummary(campusId, from, to, actor) {
    const accessible = await this.accessibleSectionIds(actor);
    const sections = new Map(this.sections.filter((section) => section.campusId === campusId)
      .map((section) => [section.id, section.name]));
    const rows = this.attendance.filter((session) =>
      session.campusId === campusId && session.date >= from && session.date <= to &&
      (accessible === null || accessible.has(session.sectionId)))
      .flatMap((session) => (session.records ?? []).map((record) => ({
        sessionId: session.id, date: session.date, sectionId: session.sectionId,
        sectionName: sections.get(session.sectionId) ?? '', status: record.status
      })));
    return buildAttendanceSummary(rows, from, to);
  }
  async saveMark(data, actor) {
    if (!await this.hasStudents(actor.activeCampusId, [data.studentId])) {
      const error = new Error('Student is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [data.studentId])) {
      throw campusScopeError('Teacher is not assigned to this student’s section.');
    }
    if ((data.termId && !this.academicYears.some((year) =>
      year.campusId === actor.activeCampusId && year.terms?.some((term) => term.id === data.termId))) ||
      (data.subjectId && !this.subjects.some((subject) =>
        subject.id === data.subjectId && subject.campusId === actor.activeCampusId))) {
      throw campusScopeError('Term or subject is not available at this campus.');
    }
    const student = this.students.find((item) =>
      item.id === data.studentId && item.campusId === actor.activeCampusId);
    const studentSection = this.sections.find((item) =>
      item.campusId === actor.activeCampusId && item.name === student?.sectionName);
    if (data.subjectId && studentSection &&
        this.gradeSubjects.some((item) => item.gradeLevelId === studentSection.gradeLevelId) &&
        !await this.sectionHasSubject(studentSection, data.subjectId)) {
      throw setupConflict('This subject is not included in the student’s grade and stream.');
    }
    if (Boolean(data.termId) !== Boolean(data.subjectId)) {
      const error = new Error('Select both a term and subject for report-card marks.');
      error.status = 400;
      error.code = 'MARK_CONTEXT_REQUIRED';
      throw error;
    }
    const existing = this.marks.find((item) =>
      item.campusId === actor.activeCampusId && item.clientUuid === data.clientUuid);
    if (existing) return { ...existing, duplicate: true };
    const mark = {
      id: randomUUID(), campusId: actor.activeCampusId, ...data, state: 'draft',
      enteredBy: actor.sub, createdAt: now()
    };
    this.marks.unshift(mark);
    await this.appendAudit(actor, 'mark.created', 'mark', mark.id, null, mark);
    return mark;
  }
  async transitionMark(markId, targetState, actor) {
    const mark = this.marks.find((item) =>
      item.id === markId && item.campusId === actor.activeCampusId);
    if (!mark) return null;
    const accessible = await this.listMarks(actor.activeCampusId, actor);
    if (!accessible.some((item) => item.id === markId)) {
      throw campusScopeError('Mark is outside the assigned sections.');
    }
    assertMarkTransition(mark.state, targetState, mark.enteredBy, actor, mark.approvedBy);
    const before = { state: mark.state };
    mark.state = targetState;
    if (targetState === 'approved') mark.approvedBy = actor.sub;
    if (targetState === 'locked') mark.publishedBy = actor.sub;
    await this.appendAudit(actor, `mark.${targetState}`, 'mark', mark.id, before, { state: targetState });
    return mark;
  }
  async amendPublishedMark(markId, amendment, actor) {
    const mark = this.marks.find((item) =>
      item.id === markId && item.campusId === actor.activeCampusId);
    if (!mark) return null;
    const accessible = await this.listMarks(actor.activeCampusId, actor);
    if (!accessible.some((item) => item.id === markId)) {
      throw campusScopeError('Mark is outside the assigned sections.');
    }
    if (mark.state !== 'locked') throw markAmendmentConflict('Only a published mark can be corrected.');
    if (mark.value === amendment.value && mark.maxValue === amendment.maxValue) {
      throw markAmendmentConflict('Enter a changed score to create a correction.');
    }
    const before = {
      value: mark.value, maxValue: mark.maxValue, state: mark.state,
      approvedBy: mark.approvedBy ?? null, publishedBy: mark.publishedBy ?? null
    };
    mark.value = amendment.value;
    mark.maxValue = amendment.maxValue;
    mark.state = 'draft';
    mark.approvedBy = null;
    mark.publishedBy = null;
    await this.appendAudit(actor, 'mark.amended', 'mark', mark.id, before, {
      value: mark.value, maxValue: mark.maxValue, state: mark.state, reason: amendment.reason
    });
    return mark;
  }
  async listMarks(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    if (accessible === null) return this.marks.filter((item) => item.campusId === campusId);
    const sectionNames = new Set(this.sections.filter((section) => accessible.has(section.id)).map((section) => section.name));
    return this.marks.filter((item) => item.campusId === campusId &&
      sectionNames.has(this.students.find((student) => student.id === item.studentId)?.sectionName));
  }
  async getTermMarksSummary(termId, actor) {
    const term = (await this.listTerms(actor.activeCampusId)).find((item) => item.id === termId);
    if (!term) throw campusScopeError('Term is not available at this campus.');
    const subjects = new Map(this.subjects.filter((item) => item.campusId === actor.activeCampusId)
      .map((item) => [item.id, item]));
    const marks = (await this.listMarks(actor.activeCampusId, actor)).filter((item) =>
      item.termId === termId && item.subjectId && subjects.has(item.subjectId));
    return buildTermMarksSummary(term, marks, subjects);
  }
  async listGradingBands(campusId) {
    return this.gradingBands.filter((band) => band.campusId === campusId)
      .sort((a, b) => a.minPercent - b.minPercent);
  }
  async getGradingPolicy(campusId) {
    return this.gradingPolicies.find((item) => item.campusId === campusId) ?? {
      campusId, scoringMethod: 'points_weighted', confirmedBy: null, confirmedAt: null
    };
  }
  async confirmGradingPolicy(data, actor) {
    const bands = await this.listGradingBands(actor.activeCampusId);
    if (!bands.length || !bands.some((band) => band.minPercent === 0)) {
      throw setupConflict('Configure a complete grading scale, including a 0% band, before confirming policy.');
    }
    const before = await this.getGradingPolicy(actor.activeCampusId);
    const policy = {
      campusId: actor.activeCampusId, scoringMethod: data.scoringMethod,
      confirmedBy: actor.sub, confirmedAt: now()
    };
    this.gradingPolicies = this.gradingPolicies.filter((item) => item.campusId !== actor.activeCampusId)
      .concat(policy);
    await this.appendAudit(actor, 'grading_policy.confirmed', 'grading_policy', actor.activeCampusId,
      before, policy);
    return policy;
  }
  latestTermReport(studentId, termId, campusId) {
    const revision = this.termReportRevisions.filter((item) =>
      item.studentId === studentId && item.termId === termId && item.campusId === campusId)
      .sort((a, b) => b.revision - a.revision)[0];
    return revision ? termReportWorkflowView(revision) : null;
  }
  async createTermReportDraft(studentId, termId, actor, amendmentReason = null) {
    const report = await this.getStudentReportCard(studentId, termId, actor);
    if (!report.gradingPolicyConfirmed) {
      throw reportWorkflowConflict('Confirm the campus grading policy before creating an official report.');
    }
    const marks = this.marks.filter((mark) =>
      mark.campusId === actor.activeCampusId && mark.studentId === studentId &&
      mark.termId === termId && mark.subjectId);
    if (!marks.length || marks.some((mark) => mark.state !== 'locked')) {
      throw reportWorkflowConflict('All report-card marks must be published before creating an official report.');
    }
    const previous = this.termReportRevisions.filter((item) =>
      item.campusId === actor.activeCampusId && item.studentId === studentId && item.termId === termId)
      .sort((a, b) => b.revision - a.revision)[0];
    const snapshot = { ...report };
    delete snapshot.workflow;
    if (previous?.status !== 'published' &&
      previous?.snapshot.gradingPolicyConfirmedAt === report.gradingPolicyConfirmedAt &&
      previous?.snapshot.sourceMarkFingerprint === report.sourceMarkFingerprint) {
      throw reportWorkflowConflict('The current report revision must be published before another draft is created.');
    }
    if (previous?.status === 'published' && stableJson(previous.snapshot) === stableJson(snapshot)) {
      throw reportWorkflowConflict('There are no report-card changes to publish as a new revision.');
    }
    if (previous?.status === 'published' && !amendmentReason) {
      throw reportAmendmentReasonRequired();
    }
    const revision = {
      id: randomUUID(), campusId: actor.activeCampusId, studentId, termId,
      revision: (previous?.revision ?? 0) + 1, status: 'draft', snapshot,
      amendmentReason,
      createdBy: actor.sub, submittedBy: null, approvedBy: null, publishedBy: null,
      createdAt: now(), submittedAt: null, approvedAt: null, publishedAt: null
    };
    this.termReportRevisions.push(revision);
    await this.appendAudit(actor, 'term_report.draft_created', 'term_report_revision', revision.id,
      null, {
        studentId, termId, revision: revision.revision, status: revision.status,
        amendmentReason
      });
    return termReportWorkflowView(revision);
  }
  async transitionTermReport(reportId, targetState, actor) {
    const revision = this.termReportRevisions.find((item) =>
      item.id === reportId && item.campusId === actor.activeCampusId);
    if (!revision) return null;
    const policy = await this.getGradingPolicy(actor.activeCampusId);
    assertTermReportTransition(revision, targetState, actor, policy.confirmedAt);
    const currentMarks = this.marks.filter((mark) =>
      mark.campusId === actor.activeCampusId && mark.studentId === revision.studentId &&
      mark.termId === revision.termId && mark.subjectId);
    assertReportSnapshotCurrent(revision, currentMarks);
    const before = { status: revision.status };
    revision.status = targetState;
    if (targetState === 'submitted') {
      revision.submittedBy = actor.sub;
      revision.submittedAt = now();
    } else if (targetState === 'approved') {
      revision.approvedBy = actor.sub;
      revision.approvedAt = now();
    } else {
      revision.publishedBy = actor.sub;
      revision.publishedAt = now();
    }
    await this.appendAudit(actor, `term_report.${targetState}`, 'term_report_revision',
      revision.id, before, { status: targetState, revision: revision.revision });
    return termReportWorkflowView(revision);
  }
  async replaceGradingBands(data, actor) {
    const before = await this.listGradingBands(actor.activeCampusId);
    const policyBefore = await this.getGradingPolicy(actor.activeCampusId);
    const bands = data.bands.map((band) => ({
      id: randomUUID(), campusId: actor.activeCampusId, ...band
    }));
    this.gradingBands = this.gradingBands.filter((band) => band.campusId !== actor.activeCampusId)
      .concat(bands);
    this.gradingPolicies = this.gradingPolicies.map((policy) => policy.campusId === actor.activeCampusId
      ? { ...policy, confirmedBy: null, confirmedAt: null } : policy);
    await this.appendAudit(actor, 'grading_bands.replaced', 'grading_scale', actor.activeCampusId, before, bands);
    if (policyBefore.confirmedAt) {
      await this.appendAudit(actor, 'grading_policy.invalidated', 'grading_policy', actor.activeCampusId,
        policyBefore, await this.getGradingPolicy(actor.activeCampusId));
    }
    return bands;
  }
  async getStudentReportCard(studentId, termId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId);
    if (!student) throw campusScopeError('Student is outside the active campus.');
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [studentId])) {
      throw campusScopeError('Teacher is not assigned to this student’s section.');
    }
    const term = (await this.listTerms(actor.activeCampusId)).find((item) => item.id === termId);
    if (!term) throw campusScopeError('Term is not available at this campus.');
    const bands = await this.listGradingBands(actor.activeCampusId);
    const policy = await this.getGradingPolicy(actor.activeCampusId);
    const marks = (await this.listMarks(actor.activeCampusId, actor)).filter((mark) =>
      mark.studentId === studentId && mark.termId === termId && mark.subjectId);
    const subjectResults = this.subjects.filter((subject) =>
      subject.campusId === actor.activeCampusId && marks.some((mark) => mark.subjectId === subject.id))
      .map((subject) => {
        const subjectMarks = marks.filter((mark) => mark.subjectId === subject.id);
        const value = roundScore(subjectMarks.reduce((total, mark) => total + mark.value, 0));
        const maxValue = roundScore(subjectMarks.reduce((total, mark) => total + mark.maxValue, 0));
        const percent = maxValue ? Math.round((value / maxValue) * 10000) / 100 : 0;
        return { subjectId: subject.id, subjectNameEn: subject.nameEn, subjectNameAm: subject.nameAm,
          assessmentCount: subjectMarks.length, value, maxValue, percent, band: bandForPercent(bands, percent) };
      });
    const totalValue = roundScore(subjectResults.reduce((total, result) => total + result.value, 0));
    const totalMaxValue = roundScore(subjectResults.reduce((total, result) => total + result.maxValue, 0));
    const overallPercent = !subjectResults.length ? 0
      : policy.scoringMethod === 'equal_subject_weighted'
        ? Math.round(subjectResults.reduce((total, result) => total + result.percent, 0) /
          subjectResults.length * 100) / 100
        : totalMaxValue ? Math.round((totalValue / totalMaxValue) * 10000) / 100 : 0;
    return {
      studentId, termId, termName: term.name, subjects: subjectResults,
      totalValue, totalMaxValue, overallPercent,
      overallBand: bandForPercent(bands, overallPercent),
      status: 'provisional', scoringMethod: policy.scoringMethod,
      gradingPolicyConfirmed: Boolean(policy.confirmedAt),
      gradingPolicyConfirmedAt: policy.confirmedAt,
      sourceMarkFingerprint: markFingerprint(marks),
      workflow: this.latestTermReport(studentId, termId, actor.activeCampusId)
    };
  }
















  async getDashboard(campusId) {
    const students = await this.listStudents(campusId);
    const attendance = await this.listAttendance(campusId);
    const marks = await this.listMarks(campusId);
    const sectionCounts = new Map();
    const genderTotals = { female: 0, male: 0, other: 0 };
    for (const student of students) {
      const section = student.sectionName || 'Unassigned';
      sectionCounts.set(section, (sectionCounts.get(section) ?? 0) + 1);
      genderTotals[student.gender] = (genderTotals[student.gender] ?? 0) + 1;
    }
    return {
      studentCount: students.length,
      attendanceSessions: attendance.length,
      marksRecorded: marks.length,
      attendanceToday: attendance.filter((x) => x.date === addisDate()).length,
      recentStudents: students.slice(0, 5).map((student) => ({ ...student, guardianPhone: null })),
      sectionDistribution: [...sectionCounts].map(([sectionName, count]) => ({ sectionName, count })),
      genderTotals,
      mode: this.mode
    };
  }
  async appendAudit(actor, action, entityType, entityId, before, after) {
    this.audit.push({
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      actorId: actor.sub, action, entityType, entityId, before, after, createdAt: now()
    });
  }
  async getCampus(campusId) { return this.campuses.find((campus) => campus.id === campusId) ?? null; }
  async updateCampus(data, actor) {
    const campus = await this.getCampus(actor.activeCampusId);
    if (!campus) return null;
    const before = { ...campus };
    Object.assign(campus, data);
    await this.appendAudit(actor, 'school.profile_updated', 'campus', campus.id, before, campus);
    return campus;
  }
  async listTimetable(actor, { sectionId, date } = {}) {
    const weekday = date ? weekdayNumber(date) : null;
    const visible = await this.listTeachingAssignments(actor);
    const byId = new Map(visible.map((item) => [item.id, item]));
    let rows = [...visible];
    let substitutions = this.timetableSubstitutions.filter((item) =>
      date && item.campusId === actor.activeCampusId && item.date === date);
    if (date) substitutions = substitutions.filter((item) => item.dayOfWeek === weekday);
    const actorStaff = this.staff.find((item) =>
      item.userId === actor.sub && item.campusId === actor.activeCampusId);
    for (const substitution of substitutions) {
      const assignment = this.teachingAssignments.find((item) => item.id === substitution.assignmentId);
      if (!assignment) continue;
      const manager = ['owner_director', 'group_executive', 'principal', 'academic_head', 'hr_admin', 'system_admin'].includes(actor.role);
      const isOriginal = actorStaff?.id === assignment.staffId;
      const isSubstitute = actorStaff?.id === substitution.substituteStaffId;
      if (!manager && !isOriginal && !isSubstitute) continue;
      if (isOriginal) byId.delete(assignment.id);
      if (manager || isSubstitute) {
        const mapped = this.mapAssignment(assignment);
        rows = rows.filter((item) => item.id !== assignment.id);
        rows.push({
          ...mapped, effectiveStaffId: substitution.substituteStaffId,
          effectiveStaffName: formatStaffName(this.staff.find((item) => item.id === substitution.substituteStaffId)),
          isSubstitute: true, substitutionDate: substitution.date
        });
      }
    }
    return rows.filter((item) => byId.has(item.id) || item.isSubstitute)
      .filter((item) => !sectionId || item.sectionId === sectionId)
      .filter((item) => weekday == null || item.dayOfWeek === weekday)
      .sort((a, b) => (a.dayOfWeek ?? 0) - (b.dayOfWeek ?? 0) || (a.periodNumber ?? 0) - (b.periodNumber ?? 0));
  }
  async createTimetableSubstitution(assignmentId, data, actor) {
    const assignment = this.teachingAssignments.find((item) =>
      item.id === assignmentId && item.campusId === actor.activeCampusId && item.isActive && item.dayOfWeek != null);
    if (!assignment) return null;
    if (assignment.dayOfWeek !== weekdayNumber(data.date)) {
      throw setupConflict('The substitution date does not match this timetable day.');
    }
    const leave = this.leaveRequests.find((item) =>
      item.id === data.leaveRequestId && item.campusId === actor.activeCampusId &&
      item.staffId === assignment.staffId && item.status === 'approved' &&
      item.startDate <= data.date && item.endDate >= data.date);
    if (!leave) throw setupConflict('An approved leave request for the assigned teacher is required.');
    const substitute = this.staff.find((item) =>
      item.id === data.substituteStaffId && item.campusId === actor.activeCampusId &&
      !item.archivedAt && item.employmentStatus === 'active');
    if (!substitute || substitute.id === assignment.staffId) {
      throw campusScopeError('Choose a different active staff member at this campus.');
    }
    const conflict = this.teachingAssignments.some((slot) =>
      slot.isActive && slot.staffId === substitute.id && slot.dayOfWeek === assignment.dayOfWeek &&
      slot.periodNumber === assignment.periodNumber && slot.id !== assignment.id);
    const substitutionConflict = this.timetableSubstitutions.some((item) =>
      item.campusId === actor.activeCampusId && item.date === data.date &&
      item.substituteStaffId === substitute.id &&
      this.teachingAssignments.some((slot) => slot.id === item.assignmentId &&
        slot.periodNumber === assignment.periodNumber));
    if (conflict || substitutionConflict) throw scheduleConflict('The substitute already has a class at this time.');
    if (this.timetableSubstitutions.some((item) =>
      item.assignmentId === assignmentId && item.date === data.date)) {
      throw setupConflict('A substitute has already been assigned for this timetable slot and date.');
    }
    const substitution = {
      id: randomUUID(), campusId: actor.activeCampusId, assignmentId,
      substituteStaffId: substitute.id, date: data.date, dayOfWeek: assignment.dayOfWeek,
      leaveRequestId: leave.id, reason: data.reason
    };
    this.timetableSubstitutions.push(substitution);
    await this.appendAudit(actor, 'timetable.substitute_assigned', 'timetable_assignment', assignmentId,
      null, { substituteStaffId: substitute.id, date: data.date, leaveRequestId: leave.id });
    return { ...substitution, substituteName: formatStaffName(substitute) };
  }
  async listTimetablePeriods(campusId) {
    return this.timetablePeriods.filter((item) => item.campusId === campusId)
      .sort((a, b) => a.shift.localeCompare(b.shift) || a.periodNumber - b.periodNumber);
  }
  async createTimetablePeriod(data, actor) {
    if (this.timetablePeriods.some((item) => item.campusId === actor.activeCampusId &&
        item.shift === data.shift && item.periodNumber === data.periodNumber)) {
      throw setupConflict('This period number already exists for the selected shift.');
    }
    if (this.timetablePeriods.some((item) => item.campusId === actor.activeCampusId &&
        item.shift === data.shift && data.startsAt < item.endsAt && data.endsAt > item.startsAt)) {
      throw scheduleConflict('Timetable periods in the same shift cannot overlap.');
    }
    const period = { id: randomUUID(), campusId: actor.activeCampusId, ...data };
    this.timetablePeriods.push(period);
    await this.appendAudit(actor, 'timetable.period_created', 'timetable_period', period.id, null, data);
    return period;
  }
  async listRooms(campusId) {
    return this.rooms.filter((item) => item.campusId === campusId && item.isActive);
  }
  async createRoom(data, actor) {
    if (this.rooms.some((item) => item.campusId === actor.activeCampusId &&
        item.name.toLowerCase() === data.name.toLowerCase())) {
      throw setupConflict('A room with this name already exists at this campus.');
    }
    const room = { id: randomUUID(), campusId: actor.activeCampusId, ...data, isActive: true };
    this.rooms.push(room);
    await this.appendAudit(actor, 'timetable.room_created', 'room', room.id, null, data);
    return room;
  }
  async getAdmissionsDashboard(campusId) {
    const rows = this.admissions.filter((item) => item.campusId === campusId);
    const byStatus = Object.fromEntries([
      'enquiry', 'application', 'interview', 'accepted', 'waitlisted',
      'rejected', 'enrolled', 'withdrawn', 'transferred_out'
    ].map((status) => [status, rows.filter((item) => item.status === status).length]));
    const byGrade = new Map();
    for (const row of rows) {
      const grade = this.gradeLevels.find((item) => item.id === row.gradeLevelId);
      const label = grade?.nameEn ?? row.gradeLevelId;
      const current = byGrade.get(label) ?? { grade: label, total: 0, enrolled: 0 };
      current.total += 1;
      if (row.status === 'enrolled') current.enrolled += 1;
      byGrade.set(label, current);
    }
    return { total: rows.length, byStatus, byGrade: [...byGrade.values()] };
  }
  async getPublicAdmissionInfo(token) {
    const campus = this.campuses.find((item) =>
      item.admissionsPublicToken === token && item.isActive !== false);
    if (!campus || !this.academicYears.some((year) =>
      year.campusId === campus.id && year.status === 'active')) return null;
    return {
      schoolName: this.organizations.find((item) => item.id === campus.organizationId)?.name ?? campus.name,
      campusName: campus.name, address: campus.address ?? '', phone: campus.phone ?? '',
      grades: this.gradeLevels.filter((grade) => grade.campusId === campus.id)
        .map(({ id, nameEn, nameAm }) => ({ id, nameEn, nameAm }))
    };
  }
  async getAdmissionsPublicToken(campusId) {
    return this.campuses.find((item) => item.id === campusId)?.admissionsPublicToken ?? null;
  }
  async createPublicAdmission(token, data) {
    const info = await this.getPublicAdmissionInfo(token);
    const campus = this.campuses.find((item) =>
      item.admissionsPublicToken === token && item.isActive !== false);
    if (!info || !campus) return null;
    const admission = await this.createAdmission(data, {
      sub: 'public-intake', orgId: campus.organizationId,
      activeCampusId: campus.id
    });
    const row = this.admissions.find((item) => item.id === admission.id);
    row.status = 'application';
    row.publicSubmission = true;
    row.privacyConsentAt = now();
    return this.mapAdmission(row);
  }
  async listAdmissions(campusId, { status = null, query = '' } = {}) {
    const needle = query.toLocaleLowerCase();
    return this.admissions.filter((item) =>
      item.campusId === campusId && (!status || item.status === status) &&
      (!needle || [
        item.givenNameEn, item.fatherNameEn, item.grandfatherNameEn,
        item.givenNameAm, item.fatherNameAm, item.grandfatherNameAm,
        item.guardianPhone, item.guardianName
      ].some((value) => value?.toLocaleLowerCase().includes(needle))))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((item) => this.mapAdmission(item));
  }
  async getAdmission(campusId, admissionId) {
    const item = this.admissions.find((row) => row.id === admissionId && row.campusId === campusId);
    return item ? this.mapAdmission(item) : null;
  }
  async findAdmissionDuplicates(campusId, { name = '', dateOfBirth = '', guardianPhone = '' }) {
    const needle = name.trim().toLocaleLowerCase();
    const matchesName = (item) => needle && (
      `${item.givenNameEn} ${item.fatherNameEn} ${item.grandfatherNameEn}`.toLocaleLowerCase() === needle ||
      `${item.givenNameAm} ${item.fatherNameAm} ${item.grandfatherNameAm}`.toLocaleLowerCase() === needle
    );
    const admissions = this.admissions.filter((item) =>
      item.campusId === campusId && (
        (guardianPhone && item.guardianPhone === guardianPhone) ||
        (dateOfBirth && item.dateOfBirth === dateOfBirth && matchesName(item))
      )).map((item) => ({ id: item.id, type: 'admission', status: item.status, name: `${item.givenNameEn} ${item.fatherNameEn} ${item.grandfatherNameEn}`, guardianPhone: item.guardianPhone }));
    const students = this.students.filter((item) =>
      item.campusId === campusId && (
        (guardianPhone && item.guardianPhone === guardianPhone) ||
        (dateOfBirth && item.dateOfBirth === dateOfBirth && matchesName(item))
      )).map((item) => ({ id: item.id, type: 'student', status: item.status, name: `${item.givenNameEn} ${item.fatherNameEn} ${item.grandfatherNameEn}`, guardianPhone: item.guardianPhone ?? '' }));
    return [...admissions, ...students];
  }
  async createAdmission(data, actor) {
    const year = await this.getAcademicYear(actor.activeCampusId);
    const grade = this.gradeLevels.find((item) =>
      item.id === data.gradeLevelId && item.campusId === actor.activeCampusId);
    if (!year || !grade) throw campusScopeError('An active academic year and campus grade are required.');
    const admission = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      academicYearId: year.id, ...data, dateOfBirth: data.dateOfBirth ?? null,
      guardianEmail: data.guardianEmail ?? null, previousSchool: data.previousSchool ?? null,
      status: actor.sub === 'public-intake' ? 'application' : 'enquiry',
      publicSubmission: actor.sub === 'public-intake',
      privacyConsentAt: actor.sub === 'public-intake' ? now() : null,
      requiredDocuments: ['birth_certificate', 'previous_school_report', 'guardian_id'],
      interviewAt: null, interviewResult: null, decisionNote: '', sectionId: null, studentId: null,
      siblingStudentId: null, createdBy: actor.sub, createdAt: now()
    };
    this.admissions.unshift(admission);
    await this.appendAudit(actor, 'admission.created', 'admission', admission.id, null, admission);
    return this.mapAdmission(admission);
  }
  mapAdmission(item) {
    const documents = this.admissionDocuments.filter((doc) => doc.admissionId === item.id);
    return {
      ...item,
      documentChecklist: item.requiredDocuments.map((type) => ({
        type, complete: documents.some((doc) => doc.documentType === type)
      })),
      documents: documents.map((doc) => this.mapAdmissionDocument(doc)),
      gradeName: this.gradeLevels.find((grade) => grade.id === item.gradeLevelId)?.nameEn ?? '',
      studentNo: this.students.find((student) => student.id === item.studentId)?.studentNo ?? null
    };
  }
  async scheduleAdmissionInterview(admissionId, data, actor) {
    const item = this.admissions.find((row) =>
      row.id === admissionId && row.campusId === actor.activeCampusId);
    if (!item) return null;
    if (!['application', 'interview'].includes(item.status)) throw setupConflict('Only applicants may be scheduled for an interview.');
    const before = { interviewAt: item.interviewAt, interviewResult: item.interviewResult, status: item.status };
    item.status = 'interview';
    item.interviewAt = data.interviewAt;
    item.interviewResult = data.interviewResult;
    await this.appendAudit(actor, 'admission.interview_scheduled', 'admission', item.id, before, item);
    return this.mapAdmission(item);
  }
  async updateAdmissionStatus(admissionId, data, actor) {
    const item = this.admissions.find((row) =>
      row.id === admissionId && row.campusId === actor.activeCampusId);
    if (!item) return null;
    const allowed = {
      enquiry: ['application', 'rejected'], application: ['accepted', 'waitlisted', 'rejected', 'interview'],
      interview: ['accepted', 'waitlisted', 'rejected'], waitlisted: ['accepted', 'rejected']
    };
    if (!allowed[item.status]?.includes(data.status)) throw setupConflict(`Cannot move an admission from ${item.status} to ${data.status}.`);
    const before = { status: item.status, decisionNote: item.decisionNote };
    item.status = data.status;
    item.decisionNote = data.decisionNote;
    await this.appendAudit(actor, `admission.${data.status}`, 'admission', item.id, before, item);
    return this.mapAdmission(item);
  }
  async setStudentIdPattern(pattern, actor) {
    const campus = await this.getCampus(actor.activeCampusId);
    if (!campus) throw campusScopeError('Campus is not available.');
    const before = campus.studentIdPattern ?? '{CAMPUS}-{YEAR}-{SEQ}';
    campus.studentIdPattern = pattern;
    await this.appendAudit(actor, 'admission.student_id_pattern_updated', 'campus', campus.id, { pattern: before }, { pattern });
    return { pattern };
  }
  async storeAdmissionDocument(admissionId, documentType, originalName, mimeType, content, actor) {
    const admission = this.admissions.find((item) =>
      item.id === admissionId && item.campusId === actor.activeCampusId);
    if (!admission) throw campusScopeError('Admission is outside the active campus.');
    if (!isValidDocumentContent(mimeType, content)) throw invalidDocument('The document content does not match its declared file type.');
    const document = {
      id: randomUUID(), admissionId, documentType, originalName: safeFilename(originalName),
      mimeType, sizeBytes: content.length, storageKey: randomUUID(),
      sha256: createHash('sha256').update(content).digest('hex'), uploadedBy: actor.sub, createdAt: now(),
      content: Buffer.from(content)
    };
    this.admissionDocuments.push(document);
    await this.appendAudit(actor, 'admission.document_uploaded', 'admission_document', document.id, null, {
      admissionId, documentType, sizeBytes: content.length, sha256: document.sha256
    });
    return this.mapAdmissionDocument(document);
  }
  async listAdmissionDocuments(campusId, admissionId) {
    if (!this.admissions.some((item) => item.id === admissionId && item.campusId === campusId)) return [];
    return this.admissionDocuments.filter((item) => item.admissionId === admissionId)
      .map((item) => this.mapAdmissionDocument(item));
  }
  async getAdmissionDocument(campusId, admissionId, documentId) {
    if (!this.admissions.some((item) => item.id === admissionId && item.campusId === campusId)) return null;
    const document = this.admissionDocuments.find((item) =>
      item.id === documentId && item.admissionId === admissionId);
    return document ? { document: this.mapAdmissionDocument(document), content: document.content } : null;
  }
  async storeStudentDocument(studentId, documentType, originalName, mimeType, content, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) throw campusScopeError('Student is outside the active campus.');
    if (!isValidDocumentContent(mimeType, content) ||
      (documentType === 'photo' && !['image/jpeg', 'image/png'].includes(mimeType))) {
      throw invalidDocument('The student document content does not match its declared file type.');
    }
    const document = {
      id: randomUUID(), studentId, campusId: actor.activeCampusId, documentType,
      originalName: safeFilename(originalName), mimeType, sizeBytes: content.length,
      storageKey: randomUUID(), sha256: createHash('sha256').update(content).digest('hex'),
      uploadedBy: actor.sub, createdAt: now(), content: Buffer.from(content)
    };
    this.studentDocuments.push(document);
    await this.appendAudit(actor, 'student.document_uploaded', 'student_document', document.id, null, {
      studentId, documentType, sizeBytes: content.length, sha256: document.sha256
    });
    return mapStudentDocument(document);
  }
  async listStudentDocuments(studentId, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    await this.appendAudit(actor, 'student.documents_viewed', 'student', studentId, null, null);
    return this.studentDocuments.filter((item) =>
      item.studentId === studentId && item.campusId === actor.activeCampusId)
      .map(mapStudentDocument);
  }
  async getStudentDocument(studentId, documentId, actor) {
    const document = this.studentDocuments.find((item) =>
      item.id === documentId && item.studentId === studentId && item.campusId === actor.activeCampusId);
    if (!document || !this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    await this.appendAudit(actor, 'student.document_downloaded', 'student_document', documentId, null, { studentId });
    return { document: mapStudentDocument(document), content: document.content };
  }
  async createStudentTransferPackage(studentId, data, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    const consent = this.studentDocuments.find((item) =>
      item.id === data.consentDocumentId && item.studentId === studentId &&
      item.campusId === actor.activeCampusId && item.documentType === 'transfer_consent');
    if (!consent) throw setupConflict('Upload the guardian-signed transfer consent document before requesting approval.');
    const item = {
      id: randomUUID(), campusId: actor.activeCampusId, studentId,
      recipientSchool: data.recipientSchool, guardianName: data.guardianName,
      guardianRelationship: data.guardianRelationship, consentRecordedOn: data.consentRecordedOn,
      consentDocumentId: consent.id, status: 'pending', shareTokenHash: null,
      expiresAt: null, approvedBy: null, approvedAt: null, createdBy: actor.sub, createdAt: now()
    };
    this.studentTransferPackages.unshift(item);
    await this.appendAudit(actor, 'student.transfer_package_requested', 'student_transfer_package',
      item.id, null, { studentId, recipientSchool: item.recipientSchool, consentRecordedOn: item.consentRecordedOn });
    return mapStudentTransferPackage(item);
  }
  async listStudentTransferPackages(studentId, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    return this.studentTransferPackages.filter((item) =>
      item.studentId === studentId && item.campusId === actor.activeCampusId)
      .map(mapStudentTransferPackage);
  }
  async approveStudentTransferPackage(packageId, tokenHash, actor) {
    const item = this.studentTransferPackages.find((entry) =>
      entry.id === packageId && entry.campusId === actor.activeCampusId);
    if (!item) return null;
    if (!['pending', 'approved'].includes(item.status)) throw setupConflict('Only pending or approved transfer packages can receive a transfer link.');
    const previousStatus = item.status;
    item.status = 'approved';
    item.shareTokenHash = tokenHash;
    item.expiresAt = new Date(Date.now() + 72 * 60 * 60_000).toISOString();
    item.approvedBy = actor.sub;
    item.approvedAt = now();
    await this.appendAudit(actor,
      previousStatus === 'pending' ? 'student.transfer_package_approved' : 'student.transfer_link_reissued',
      'student_transfer_package', packageId, { status: previousStatus },
      { status: 'approved', expiresAt: item.expiresAt });
    return mapStudentTransferPackage(item);
  }
  async getStudentTransferPackageByTokenHash(tokenHash) {
    const item = this.studentTransferPackages.find((entry) =>
      entry.shareTokenHash === tokenHash && entry.status === 'approved' &&
      Date.parse(entry.expiresAt) > Date.now());
    if (!item) return null;
    const student = this.students.find((entry) =>
      entry.id === item.studentId && entry.campusId === item.campusId && !entry.archivedAt);
    if (!student) return null;
    const actor = { activeCampusId: item.campusId };
    const history = this.enrolments.filter((entry) => entry.studentId === item.studentId)
      .map((entry) => {
        const section = this.sections.find((row) => row.id === entry.sectionId);
        const year = this.academicYears.find((row) => row.id === entry.academicYearId);
        return section && year ? { academicYear: year.labelEc, grade: section.gradeName ?? '',
          section: section.name, status: entry.status, outcome: entry.outcome ?? null } : null;
      }).filter(Boolean);
    const campus = this.campuses.find((entry) => entry.id === actor.activeCampusId);
    return {
      recipientSchool: item.recipientSchool,
      sourceSchool: campus?.name ?? 'School',
      student: {
        studentNo: student.studentNo,
        givenNameAm: student.givenNameAm, fatherNameAm: student.fatherNameAm,
        grandfatherNameAm: student.grandfatherNameAm, givenNameEn: student.givenNameEn,
        fatherNameEn: student.fatherNameEn, grandfatherNameEn: student.grandfatherNameEn,
        gender: student.gender, dateOfBirth: student.dateOfBirth ?? null,
        previousSchool: student.previousSchool ?? null
      },
      guardianConsent: {
        guardianName: item.guardianName, relationship: item.guardianRelationship,
        recordedOn: item.consentRecordedOn
      },
      academicHistory: history
    };
  }
  mapAdmissionDocument(document) {
    const { content, ...metadata } = document;
    return metadata;
  }
  async enrolAdmission(admissionId, { sectionId, siblingStudentId = null }, actor) {
    const admission = this.admissions.find((item) =>
      item.id === admissionId && item.campusId === actor.activeCampusId);
    if (!admission) throw campusScopeError('Admission is outside the active campus.');
    if (admission.status !== 'accepted') throw setupConflict('Only accepted applicants can be enrolled.');
    if (admission.requiredDocuments.some((type) =>
      !this.admissionDocuments.some((doc) => doc.admissionId === admissionId && doc.documentType === type))) {
      throw setupConflict('All required documents must be uploaded before enrolment.');
    }
    const section = this.sections.find((item) =>
      item.id === sectionId && item.campusId === actor.activeCampusId && item.isActive &&
      item.gradeLevelId === admission.gradeLevelId);
    if (!section) throw campusScopeError('Select an active section for the applicant’s grade at this campus.');
    const enrolledCount = this.students.filter((student) =>
      student.campusId === actor.activeCampusId && student.sectionName === section.name && student.status === 'enrolled').length;
    if (section.capacity != null && enrolledCount >= section.capacity) throw setupConflict('The selected section has reached capacity.');
    if (siblingStudentId && !this.students.some((student) =>
      student.id === siblingStudentId && student.campusId === actor.activeCampusId && student.status === 'enrolled')) {
      throw campusScopeError('Sibling student is not enrolled at this campus.');
    }
    const year = this.academicYears.find((item) => item.id === admission.academicYearId);
    const count = (this.admissionCounters.get(`${actor.activeCampusId}:${admission.academicYearId}`) ?? 0) + 1;
    this.admissionCounters.set(`${actor.activeCampusId}:${admission.academicYearId}`, count);
    const campus = await this.getCampus(actor.activeCampusId);
    const studentNo = formatStudentNo(campus?.studentIdPattern, campus?.name, year?.labelEc, count);
    if (this.students.some((student) => student.campusId === actor.activeCampusId && student.studentNo === studentNo)) {
      throw setupConflict('Generated student number is already in use; review the campus ID pattern.');
    }
    const student = {
      id: randomUUID(), campusId: actor.activeCampusId, studentNo,
      givenNameAm: admission.givenNameAm, fatherNameAm: admission.fatherNameAm,
      grandfatherNameAm: admission.grandfatherNameAm, givenNameEn: admission.givenNameEn,
      fatherNameEn: admission.fatherNameEn, grandfatherNameEn: admission.grandfatherNameEn,
      gender: admission.gender, dateOfBirth: admission.dateOfBirth,
      guardianName: admission.guardianName, guardianPhone: admission.guardianPhone,
      sectionName: section.name, previousSchool: admission.previousSchool, status: 'enrolled', createdAt: now()
    };
    const generated = await generateStudentCredentials(student, (username) =>
      this.users.some((user) => user.username?.toLowerCase() === username.toLowerCase()));
    const user = {
      id: randomUUID(), orgId: actor.orgId, name: studentName(student), email: null, phone: null,
      username: generated.username, passwordHash: generated.passwordHash, role: 'student',
      campusIds: [actor.activeCampusId], activeCampusId: actor.activeCampusId,
      isActive: true, mustChangePassword: true
    };
    student.userId = user.id;
    student.hasPortalAccount = true;
    this.users.push(user);
    this.students.unshift(student);
    this.enrolments.push({
      id: randomUUID(), studentId: student.id, academicYearId: admission.academicYearId,
      sectionId: section.id, status: 'active', enrolledOn: addisDate(), leftOn: null, outcome: null
    });
    admission.sectionId = section.id;
    admission.studentId = student.id;
    admission.siblingStudentId = siblingStudentId;
    admission.status = 'enrolled';
    this.studentStatusHistory.unshift({
      id: randomUUID(), studentId: student.id, campusId: actor.activeCampusId,
      status: 'enrolled', reason: `Admission ${admission.id}`, recordedBy: actor.sub, createdAt: now()
    });
    if (siblingStudentId) this.studentSiblingLinks.push(
      { studentId: student.id, siblingStudentId, campusId: actor.activeCampusId, relationship: 'sibling' },
      { studentId: siblingStudentId, siblingStudentId: student.id, campusId: actor.activeCampusId, relationship: 'sibling' }
    );
    await this.appendAudit(actor, 'admission.enrolled', 'student', student.id, { admissionId, status: 'accepted' }, {
      studentNo, sectionId, siblingStudentId
    });
    await this.appendAudit(actor, 'student.account_created', 'user', user.id, null, {
      studentId: student.id, username: user.username
    });
    return {
      student, admission: this.mapAdmission(admission),
      credentials: {
        username: user.username, temporaryPassword: generated.temporaryPassword,
        studentName: generated.studentName
      }
    };
  }
  async changeStudentStatus(studentId, status, reason, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId);
    if (!student) return null;
    if (student.status !== 'enrolled') throw setupConflict('Only an enrolled student can be withdrawn or transferred.');
    const before = { status: student.status, sectionName: student.sectionName };
    student.status = status;
    this.enrolments.filter((item) => item.studentId === studentId && item.status === 'active')
      .forEach((item) => {
        item.status = 'withdrawn';
        item.leftOn = addisDate();
        item.outcome = status;
      });
    const linkedAdmission = this.admissions.find((item) => item.studentId === studentId);
    if (linkedAdmission) linkedAdmission.status = status;
    this.studentStatusHistory.unshift({
      id: randomUUID(), studentId, campusId: actor.activeCampusId,
      status, reason, recordedBy: actor.sub, createdAt: now()
    });
    await this.appendAudit(actor, `student.${status}`, 'student', studentId, before, student);
    return student;
  }
  async readmitStudent(studentId, { sectionId, reason }, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId);
    if (!student) return null;
    if (student.status !== 'withdrawn') throw setupConflict('Only a withdrawn student can be readmitted.');
    const section = this.sections.find((item) =>
      item.id === sectionId && item.campusId === actor.activeCampusId && item.isActive);
    if (!section) throw campusScopeError('Select an active section at this campus.');
    const count = this.students.filter((item) =>
      item.campusId === actor.activeCampusId && item.sectionName === section.name && item.status === 'enrolled').length;
    if (section.capacity != null && count >= section.capacity) throw setupConflict('The selected section has reached capacity.');
    const before = { status: student.status, sectionName: student.sectionName };
    student.status = 'enrolled';
    student.sectionName = section.name;
    const academicYear = this.academicYears.find((item) =>
      item.campusId === actor.activeCampusId && item.status === 'active' &&
      (!section.academicYearId || section.academicYearId === item.id));
    if (academicYear) {
      const existing = this.enrolments.find((item) =>
        item.studentId === studentId && item.academicYearId === academicYear.id);
      if (existing) Object.assign(existing, {
        sectionId: section.id, status: 'active', enrolledOn: addisDate(), leftOn: null, outcome: null
      });
      else this.enrolments.push({
        id: randomUUID(), studentId, academicYearId: academicYear.id, sectionId: section.id,
        status: 'active', enrolledOn: addisDate(), leftOn: null, outcome: null
      });
    }
    const linkedAdmission = this.admissions.find((item) => item.studentId === studentId);
    if (linkedAdmission) linkedAdmission.status = 'enrolled';
    this.studentStatusHistory.unshift({
      id: randomUUID(), studentId, campusId: actor.activeCampusId,
      status: 'enrolled', reason, recordedBy: actor.sub, createdAt: now()
    });
    await this.appendAudit(actor, 'student.readmitted', 'student', studentId, before, student);
    return student;
  }
  async listStudentEnrollmentHistory(studentId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [studentId])) {
      throw campusScopeError('Teacher is not assigned to this student’s active section.');
    }
    return this.enrolments.filter((item) => item.studentId === studentId)
      .map((item) => {
        const section = this.sections.find((entry) => entry.id === item.sectionId &&
          entry.campusId === actor.activeCampusId);
        const year = this.academicYears.find((entry) => entry.id === item.academicYearId &&
          entry.campusId === actor.activeCampusId);
        const grade = this.gradeLevels.find((entry) => entry.id === section?.gradeLevelId);
        return section && year ? {
          id: item.id, academicYearId: year.id, academicYear: year.labelEc,
          gradeLevelId: grade?.id ?? null, gradeNameEn: grade?.nameEn ?? section.gradeName ?? null,
          gradeNameAm: grade?.nameAm ?? null, sectionId: section.id, sectionName: section.name,
          status: item.status, enrolledOn: item.enrolledOn, leftOn: item.leftOn ?? null,
          outcome: item.outcome ?? null, sortDate: year.startDate
        } : null;
      }).filter(Boolean)
      .sort((a, b) => b.sortDate.localeCompare(a.sortDate))
      .map(({ sortDate, ...record }) => record);
  }
  async transferStudentSection(studentId, { sectionId, reason }, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    if (student.status !== 'enrolled') throw setupConflict('Only enrolled students can transfer sections.');
    const currentYear = this.academicYears.find((year) =>
      year.campusId === actor.activeCampusId && year.status === 'active');
    const enrollment = currentYear && this.enrolments.find((item) =>
      item.studentId === studentId && item.academicYearId === currentYear.id && item.status === 'active');
    const destination = this.sections.find((item) =>
      item.id === sectionId && item.campusId === actor.activeCampusId && item.isActive &&
      item.academicYearId === currentYear?.id);
    if (!enrollment || !destination) throw campusScopeError('Select a section in the active academic year at this campus.');
    if (enrollment.sectionId === destination.id) throw setupConflict('Student is already assigned to this section.');
    const count = this.enrolments.filter((item) =>
      item.sectionId === destination.id && item.status === 'active').length;
    if (destination.capacity != null && count >= destination.capacity) throw setupConflict('The selected section has reached capacity.');
    const sourceSectionId = enrollment.sectionId;
    enrollment.sectionId = destination.id;
    student.sectionName = destination.name;
    const transfer = {
      id: randomUUID(), campusId: actor.activeCampusId, studentId, academicYearId: currentYear.id,
      fromSectionId: sourceSectionId, toSectionId: destination.id,
      reason, recordedBy: actor.sub, createdAt: now()
    };
    this.studentSectionTransfers.unshift(transfer);
    await this.appendAudit(actor, 'student.section_transferred', 'student', studentId,
      { sectionId: sourceSectionId }, { sectionId: destination.id, reason });
    return { ...student };
  }
  async listStudentSectionTransfers(studentId, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    return this.studentSectionTransfers.filter((item) =>
      item.studentId === studentId && item.campusId === actor.activeCampusId)
      .map((item) => ({
        ...item,
        fromSection: this.sections.find((section) => section.id === item.fromSectionId)?.name ?? '',
        toSection: this.sections.find((section) => section.id === item.toSectionId)?.name ?? ''
      }));
  }
  async listStudentDisciplineRecords(studentId, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    const rows = this.studentDisciplineRecords.filter((item) =>
      item.studentId === studentId && item.campusId === actor.activeCampusId);
    await this.appendAudit(actor, 'student.discipline_viewed', 'student', studentId, null, { count: rows.length });
    return rows.map((item) => mapStudentDisciplineRecord(item, this.sensitiveDataKey));
  }
  async createStudentDisciplineRecord(studentId, data, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    const record = {
      id: randomUUID(), campusId: actor.activeCampusId, studentId,
      recordedOn: data.recordedOn, category: data.category,
      detailsEnc: encryptSensitiveValue(data.details, this.sensitiveDataKey),
      actionTakenEnc: encryptSensitiveValue(data.actionTaken ?? null, this.sensitiveDataKey),
      recordedBy: actor.sub, createdAt: now()
    };
    this.studentDisciplineRecords.unshift(record);
    await this.appendAudit(actor, 'student.discipline_recorded', 'student_discipline_record',
      record.id, null, { studentId, recordedOn: data.recordedOn, category: data.category });
    return mapStudentDisciplineRecord(record, this.sensitiveDataKey);
  }
  async advanceStudent(studentId, { outcome, sectionId, reason, overrideReason }, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    if (student.status !== 'enrolled') throw setupConflict('Only an enrolled student can progress to a new academic year.');
    const year = this.academicYears.find((item) =>
      item.campusId === actor.activeCampusId && item.status === 'active');
    if (!year) throw setupConflict('Activate the destination academic year before recording progression.');
    if (this.enrolments.some((item) => item.studentId === studentId && item.academicYearId === year.id)) {
      throw setupConflict('The student already has an enrolment in the active academic year.');
    }
    const previous = this.enrolments.filter((item) => item.studentId === studentId)
      .map((item) => ({
        enrolment: item,
        year: this.academicYears.find((academicYear) =>
          academicYear.id === item.academicYearId && academicYear.campusId === actor.activeCampusId)
      }))
      .filter((item) => item.year?.status === 'closed' && item.enrolment.status === 'completed')
      .sort((a, b) => b.year.endDate.localeCompare(a.year.endDate))[0];
    if (!previous) throw setupConflict('A completed enrolment from a closed academic year is required.');

    const sourceSection = this.sections.find((item) => item.id === previous.enrolment.sectionId);
    const sourceGrade = this.gradeLevels.find((item) => item.id === sourceSection?.gradeLevelId);
    if (!sourceSection || !sourceGrade) throw setupConflict('The prior enrolment is missing its grade assignment.');
    if (outcome === 'graduated' && sourceGrade.sortOrder !== 12) {
      throw setupConflict('Only Grade 12 students can be recorded as graduates.');
    }

    let section = null;
    if (outcome !== 'graduated') {
      section = this.sections.find((item) =>
        item.id === sectionId && item.campusId === actor.activeCampusId &&
        item.academicYearId === year.id && item.isActive);
      if (!section) throw campusScopeError('Select a section in the active academic year at this campus.');
      const destinationGrade = this.gradeLevels.find((item) =>
        item.id === section.gradeLevelId && item.campusId === actor.activeCampusId);
      const expectedOrder = sourceGrade.sortOrder + (outcome === 'promoted' ? 1 : 0);
      if (!destinationGrade || destinationGrade.sortOrder !== expectedOrder) {
        throw setupConflict(outcome === 'promoted'
          ? 'Promotion must advance exactly one grade.'
          : 'Repetition must keep the student in the same grade.');
      }
      if (outcome === 'promoted') {
        const eligibility = await this.evaluateStudentProgression(studentId, actor);
        const overrideAllowed = ['owner_director', 'principal', 'system_admin'].includes(actor.role) &&
          Boolean(overrideReason?.trim());
        if (eligibility.status !== 'eligible' && !overrideAllowed) {
          throw setupConflict(`${eligibility.reason} A principal must configure the rule/results or provide an audited override reason.`);
        }
      }
      const count = this.enrolments.filter((item) =>
        item.sectionId === section.id && item.academicYearId === year.id && item.status === 'active').length;
      if (section.capacity != null && count >= section.capacity) {
        throw setupConflict('The selected section has reached capacity.');
      }
    }

    const before = { status: student.status, sectionName: student.sectionName };
    previous.enrolment.outcome = outcome;
    if (outcome === 'graduated') {
      student.status = 'graduated';
      student.sectionName = null;
    } else {
      this.enrolments.push({
        id: randomUUID(), studentId, academicYearId: year.id, sectionId: section.id,
        status: 'active', enrolledOn: addisDate(), leftOn: null, outcome: null
      });
      student.sectionName = section.name;
    }
    this.studentStatusHistory.unshift({
      id: randomUUID(), studentId, campusId: actor.activeCampusId,
      status: outcome, reason, recordedBy: actor.sub, createdAt: now()
    });
    const linkedAdmission = this.admissions.find((item) => item.studentId === studentId);
    if (linkedAdmission && outcome === 'graduated') linkedAdmission.status = 'graduated';
    await this.appendAudit(actor, `student.${outcome}`, 'student', studentId, before, {
      status: student.status, outcome, fromAcademicYearId: previous.year.id,
      toAcademicYearId: outcome === 'graduated' ? null : year.id,
      sectionId: section?.id ?? null, reason,
      overrideReason: overrideReason ?? null
    });
    return student;
  }
  async transferStudentOut(studentId, reason, actor) {
    return this.changeStudentStatus(studentId, 'transferred_out', reason, actor);
  }
  async getStudentTransferRecord(campusId, studentId) {
    const student = this.students.find((item) => item.id === studentId && item.campusId === campusId);
    const history = this.studentStatusHistory.find((item) =>
      item.studentId === studentId && item.campusId === campusId && item.status === 'transferred_out');
    return student && history ? { student, history, campus: await this.getCampus(campusId) } : null;
  }
  async close() {}
}

export class MysqlRepository {
  constructor(knex, privateDocumentsDir, sensitiveDataKey = '') {
    this.db = knex;
    this.mode = 'mysql';
    this.loginFailures = new Map();
    this.privateDocumentsDir = path.resolve(privateDocumentsDir);
    this.sensitiveDataKey = sensitiveDataKey;
  }
  async findUserByLogin(login) {
    const normalizedLogin = login.toLowerCase();
    const user = await this.db('users as u')
      .join('organizations as o', 'o.id', 'u.organization_id')
      .select('u.*', 'o.status as organization_status')
      .where(function () {
        this.whereRaw('LOWER(u.email) = ?', [normalizedLogin])
          .orWhereRaw('LOWER(u.username) = ?', [normalizedLogin])
          .orWhere({ 'u.phone': login });
    }).first();
    if (!user) return null;
    const memberships = await this.db('user_campuses as uc')
      .join('campuses as c', 'c.id', 'uc.campus_id')
      .where({
        'uc.user_id': user.id, 'uc.is_active': true,
        'c.organization_id': user.organization_id, 'c.is_active': true
      })
      .select('uc.campus_id');
    return {
      id: user.id, orgId: user.organization_id, name: user.name, email: user.email,
      phone: user.phone, passwordHash: user.password_hash, role: user.role,
      campusIds: memberships.map((m) => m.campus_id), activeCampusId: memberships[0]?.campus_id,
      authVersion: Number(user.auth_version ?? 0),
      isActive: Boolean(user.is_active),
      mustChangePassword: Boolean(user.must_change_password)
    };
  }
  async findUserById(id) {
    const user = await this.db('users as u')
      .join('organizations as o', 'o.id', 'u.organization_id')
      .select('u.*', 'o.status as organization_status').where('u.id', id).first();
    if (!user) return null;
    const memberships = await this.db('user_campuses as uc')
      .join('campuses as c', 'c.id', 'uc.campus_id')
      .where({
        'uc.user_id': id, 'uc.is_active': true,
        'c.organization_id': user.organization_id, 'c.is_active': true
      })
      .select('uc.campus_id');
    return {
      id: user.id, orgId: user.organization_id, name: user.name, email: user.email,
      role: user.role, campusIds: memberships.map((m) => m.campus_id),
      activeCampusId: memberships[0]?.campus_id,
      authVersion: Number(user.auth_version ?? 0),
      accountActive: Boolean(user.is_active),
      isActive: Boolean(user.is_active) &&
        (user.role === 'super_admin' || user.organization_status === 'active'),
      mustChangePassword: Boolean(user.must_change_password)
    };
  }
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
  }
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
  }
  async registerSchool(data, passwordHash) {
    const organizationId = randomUUID();
    const campusId = randomUUID();
    const userId = randomUUID();
    const subscriptionId = randomUUID();
    const plan = await this.db('subscription_plans').where({ code: 'starter', is_active: true }).first('id');
    if (!plan) throw new Error('The active starter subscription plan is not configured.');
    const trialEndsAt = new Date(Date.now() + Number(plan.trial_days) * 86400000);
    try {
      await this.db.transaction(async (trx) => {
        await trx('organizations').insert({
          id: organizationId, name: data.schoolName, status: 'active',
          preferred_locale: data.locale, currency_code: data.currencyCode,
          branding_json: JSON.stringify({ logoUrl: '', primaryColor: '#0f766e' }),
          requested_at: trx.fn.now(), activated_at: trx.fn.now()
        });
        await trx('campuses').insert({
          id: campusId, organization_id: organizationId, name: data.schoolName,
          address: data.address, phone: data.schoolPhone, timezone: data.timezone,
          is_active: true
        });
        await trx('users').insert({
          id: userId, organization_id: organizationId, name: data.ownerName,
          email: data.ownerEmail, phone: data.ownerPhone, password_hash: passwordHash,
          role: 'owner_director', is_active: true
        });
        await trx('user_campuses').insert({
          user_id: userId, campus_id: campusId, is_active: true
        });
        await trx('organization_subscriptions').insert({
          id: subscriptionId, organization_id: organizationId,
          plan_id: plan.id, status: 'trialing',
          trial_started_at: trx.fn.now(), trial_ends_at: trialEndsAt
        });
        await trx('audit_log').insert(auditRow({
          sub: userId, orgId: organizationId, activeCampusId: campusId
        }, 'school.registration_activated', 'organization', organizationId, null, {
          schoolName: data.schoolName, ownerEmail: data.ownerEmail,
          status: 'active', subscriptionStatus: 'trialing', trialEndsAt: trialEndsAt.toISOString()
        }));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('An account already uses this email or phone.');
      throw error;
    }
    return { organizationId, status: 'active', trialEndsAt: trialEndsAt.toISOString() };
  }
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
        campuses, studentCount: Number(studentCount.total),
        subscription: subscription ? {
          status: subscription.status, trialEndsAt: subscription.trial_ends_at,
          planCode: subscription.code, planName: subscription.name
        } : null
      });
    }
    return results;
  }
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
  }
  async listSubscriptionPlans() {
    const rows = await this.db('subscription_plans').orderBy('monthly_price').orderBy('name');
    return rows.map(mapSubscriptionPlan);
  }
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
  }
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
  }
  async getOrganizationSettings(organizationId) {
    const row = await this.db('organizations').where({ id: organizationId }).first();
    return row ? mapOrganization(row) : null;
  }
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
  }
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
  }
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
  }
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
  }
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
  }
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
  }
  async assertStudentCapacity(organizationId, additional = 1, query = this.db) {
    const subscription = await query('organization_subscriptions as os')
      .join('subscription_plans as sp', 'sp.id', 'os.plan_id')
      .where('os.organization_id', organizationId).orderBy('os.created_at', 'desc')
      .forUpdate().select('sp.student_limit').first();
    if (!subscription || subscription.student_limit == null) return;
    const result = await query('students as s')
      .join('campuses as c', 'c.id', 's.campus_id')
      .where('c.organization_id', organizationId).whereNull('s.archived_at')
      .count({ total: 's.id' }).first();
    if (Number(result.total) + additional > Number(subscription.student_limit)) {
      throw planLimitError('student', Number(subscription.student_limit));
    }
  }
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
  }
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
  }
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
  }
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
  async changePassword(userId, currentPassword, newPassword, actor) {
    const changed = await this.db.transaction(async (trx) => {
      const user = await trx('users').where({ id: userId }).forUpdate().first();
      if (!user || !user.is_active || !await bcrypt.compare(currentPassword, user.password_hash)) return false;
      if (await bcrypt.compare(newPassword, user.password_hash)) {
        throw setupConflict('Choose a password different from your temporary password.');
      }
      await trx('users').where({ id: userId }).update({
        password_hash: await bcrypt.hash(newPassword, 12), must_change_password: false,
        auth_version: trx.raw('auth_version + 1')
      });
      await trx('refresh_tokens').where({ user_id: userId }).whereNull('revoked_at')
        .update({ revoked_at: trx.fn.now() });
      await trx('audit_log').insert(auditRow(actor, 'user.password_changed', 'user', userId, null, null));
      return true;
    });
    return changed ? this.findUserById(userId) : null;
  }
  async createPasswordReset(email, tokenHash, expiresAt) {
    return this.db.transaction(async (trx) => {
      const user = await trx('users').whereRaw('LOWER(email) = ?', [email.toLowerCase()])
        .where({ is_active: true }).first('id', 'organization_id', 'name', 'email');
      if (!user) return null;
      await trx('password_reset_tokens').where({ user_id: user.id })
        .whereNull('consumed_at').update({ consumed_at: trx.fn.now() });
      await trx('password_reset_tokens').insert({
        id: randomUUID(), user_id: user.id, token_hash: tokenHash, expires_at: expiresAt
      });
      await trx('audit_log').insert(auditRow({
        sub: user.id, orgId: user.organization_id, activeCampusId: null
      }, 'auth.password_reset_requested', 'user', user.id, null, null));
      return { userId: user.id, name: user.name, email: user.email };
    });
  }
  async revokePasswordResetToken(tokenHash) {
    await this.db('password_reset_tokens').where({ token_hash: tokenHash })
      .whereNull('consumed_at').update({ consumed_at: this.db.fn.now() });
  }
  async completePasswordReset(tokenHash, passwordHash) {
    return this.db.transaction(async (trx) => {
      const reset = await trx('password_reset_tokens').where({
        token_hash: tokenHash
      }).whereNull('consumed_at').where('expires_at', '>', trx.fn.now())
        .forUpdate().first();
      if (!reset) return null;
      const user = await trx('users').where({
        id: reset.user_id, is_active: true
      }).forUpdate().first();
      await trx('password_reset_tokens').where({ id: reset.id })
        .update({ consumed_at: trx.fn.now() });
      if (!user) return null;
      await trx('users').where({ id: user.id }).update({
        password_hash: passwordHash, must_change_password: false,
        auth_version: trx.raw('auth_version + 1')
      });
      await trx('password_reset_tokens').where({ user_id: user.id })
        .whereNull('consumed_at').update({ consumed_at: trx.fn.now() });
      await trx('refresh_tokens').where({ user_id: user.id }).whereNull('revoked_at')
        .update({ revoked_at: trx.fn.now() });
      await trx('audit_log').insert(auditRow({
        sub: user.id, orgId: user.organization_id, activeCampusId: null
      }, 'auth.password_reset_completed', 'user', user.id, null, null));
      return { id: user.id };
    });
  }
  async getInvitationTarget(invitation, query = this.db) {
    if (invitation.target_type === 'staff') {
      const target = await query('staff').where({
        id: invitation.target_id, campus_id: invitation.campus_id
      }).whereNot('employment_status', 'terminated')
        .whereNull('archived_at').whereNull('user_id').first();
      return target ? { name: `${target.given_name_en} ${target.father_name_en} ${target.grandfather_name_en}` } : null;
    }
    if (invitation.target_type === 'student') {
      const target = await query('students').where({
        id: invitation.target_id, campus_id: invitation.campus_id, status: 'enrolled'
      }).whereNull('archived_at').whereNull('user_id').first();
      return target ? { name: `${target.given_name_en} ${target.father_name_en} ${target.grandfather_name_en}` } : null;
    }
    const guardian = await query('guardians').where({
      id: invitation.target_id, organization_id: invitation.organization_id
    }).whereNull('user_id').first();
    if (!guardian || !guardian.email || guardian.email.toLowerCase() !== invitation.email.toLowerCase()) return null;
    const verifiedLink = await query('student_guardians as sg')
      .join('students as s', 's.id', 'sg.student_id')
      .where({
        'sg.guardian_id': invitation.target_id, 'sg.is_verified': true,
        's.campus_id': invitation.campus_id
      }).whereNull('s.archived_at').first('sg.guardian_id');
    return verifiedLink
      ? { name: `${guardian.given_name_en} ${guardian.father_name_en} ${guardian.grandfather_name_en}` }
      : null;
  }
  async createAccountInvitation(invitation, actor) {
    const existingUser = await this.db('users')
      .whereRaw('LOWER(email) = ?', [invitation.email.toLowerCase()]).first('id');
    if (existingUser) throw setupConflict('An account already uses this email address.');
    const target = await this.getInvitationTarget({
      ...invitation, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      target_type: invitation.targetType, target_id: invitation.targetId
    });
    if (!target) throw setupConflict('The selected person is not eligible for an account invitation.');
    const record = {
      id: invitation.id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      email: invitation.email, role: invitation.role, target_type: invitation.targetType,
      target_id: invitation.targetId, token_hash: invitation.tokenHash,
      expires_at: invitation.expiresAt, accepted_at: null, created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await trx('account_invitations').where({
        organization_id: actor.orgId, target_type: invitation.targetType, target_id: invitation.targetId
      }).whereNull('accepted_at').update({ expires_at: trx.fn.now() });
      await trx('account_invitations').insert(record);
      await trx('audit_log').insert(auditRow(actor, 'account_invitation.created',
        'account_invitation', invitation.id, null, {
          email: invitation.email, role: invitation.role, targetType: invitation.targetType,
          targetId: invitation.targetId, expiresAt: invitation.expiresAt
        }));
    });
    return { id: invitation.id, email: invitation.email, role: invitation.role, name: target.name, expiresAt: invitation.expiresAt };
  }
  async getAccountInvitation(tokenHash) {
    const invitation = await this.db('account_invitations').where({
      token_hash: tokenHash
    }).whereNull('accepted_at').where('expires_at', '>', this.db.fn.now()).first();
    if (!invitation) return null;
    const target = await this.getInvitationTarget(invitation);
    return target ? {
      email: invitation.email, role: invitation.role, name: target.name,
      expiresAt: invitation.expires_at
    } : null;
  }
  async acceptAccountInvitation(tokenHash, passwordHash) {
    return this.db.transaction(async (trx) => {
      const invitation = await trx('account_invitations').where({
        token_hash: tokenHash
      }).whereNull('accepted_at').where('expires_at', '>', trx.fn.now()).forUpdate().first();
      if (!invitation) return null;
      const target = await this.getInvitationTarget(invitation, trx);
      if (!target) return null;
      const existing = await trx('users').whereRaw('LOWER(email) = ?', [invitation.email.toLowerCase()]).first('id');
      if (existing) throw setupConflict('An account already uses this email address.');
      const id = randomUUID();
      const campusIds = invitation.target_type === 'guardian'
        ? (await trx('student_guardians as sg')
          .join('students as s', 's.id', 'sg.student_id')
          .join('campuses as c', 'c.id', 's.campus_id')
          .where({
            'sg.guardian_id': invitation.target_id, 'sg.is_verified': true,
            'c.organization_id': invitation.organization_id, 'c.is_active': true
          }).whereNull('s.archived_at').distinct('s.campus_id').select('s.campus_id'))
          .map((item) => item.campus_id)
        : [invitation.campus_id];
      if (!campusIds.includes(invitation.campus_id)) return null;
      await trx('users').insert({
        id, organization_id: invitation.organization_id, name: target.name, email: invitation.email,
        password_hash: passwordHash, role: invitation.role, is_active: true
      });
      await trx('user_campuses').insert(campusIds.map((campusId) => ({
        user_id: id, campus_id: campusId, is_active: true
      })));
      const targetTable = invitation.target_type === 'staff' ? 'staff'
        : invitation.target_type === 'student' ? 'students' : 'guardians';
      const updated = await trx(targetTable).where({
        id: invitation.target_id, user_id: null
      }).update({ user_id: id });
      if (!updated) throw setupConflict('This person already has an account.');
      await trx('account_invitations').where({ id: invitation.id, accepted_at: null })
        .update({ accepted_at: trx.fn.now() });
      await trx('audit_log').insert(auditRow({
        sub: id, orgId: invitation.organization_id, activeCampusId: invitation.campus_id
      }, 'account_invitation.accepted', 'user', id, null, {
        email: invitation.email, role: invitation.role,
        targetType: invitation.target_type, targetId: invitation.target_id
      }));
      return {
        id, orgId: invitation.organization_id, name: target.name, email: invitation.email,
        phone: null, passwordHash, role: invitation.role, campusIds,
        activeCampusId: invitation.campus_id, isActive: true
      };
    });
  }
  async verifyStudentGuardian(studentId, guardianId, access, actor) {
    return this.db.transaction(async (trx) => {
      const link = await trx('student_guardians as sg')
        .join('students as s', 's.id', 'sg.student_id')
        .where({
          'sg.student_id': studentId, 'sg.guardian_id': guardianId,
          's.campus_id': actor.activeCampusId
        }).whereNull('s.archived_at')
        .select('sg.is_verified', 'sg.can_view_results', 'sg.can_view_fees').first();
      if (!link) return null;
      await trx('student_guardians').where({ student_id: studentId, guardian_id: guardianId }).update({
        is_verified: access.isVerified, can_view_results: access.canViewResults, can_view_fees: access.canViewFees
      });
      await trx('audit_log').insert(auditRow(actor, 'student.guardian_access_updated', 'student_guardian',
        studentId, {
          isVerified: Boolean(link.is_verified), canViewResults: Boolean(link.can_view_results),
          canViewFees: Boolean(link.can_view_fees)
        }, { guardianId, ...access }));
      return { studentId, guardianId, ...access };
    });
  }
  async getPortalHome(actor) {
    if (actor.role === 'student') {
      const rows = await this.db('students').where({
        user_id: actor.sub, campus_id: actor.activeCampusId, status: 'enrolled'
      }).whereNull('archived_at').select('id', 'campus_id', 'student_no', 'given_name_en',
        'father_name_en', 'grandfather_name_en', 'given_name_am', 'father_name_am',
        'grandfather_name_am', 'section_name', 'status');
      const students = await Promise.all(rows.map(async (row) => ({
        student: portalStudentView(mapStudent(row)), canViewResults: true, canViewFees: false,
        results: await this.portalResults(row.id),
        reports: await this.portalPublishedReports(row.id, row.campus_id),
        attendance: await this.portalAttendance(row.id, row.campus_id), fees: []
      })));
      return { role: actor.role, students };
    }
    if (actor.role === 'parent_guardian') {
      const rows = await this.db('student_guardians as sg')
        .join('guardians as g', 'g.id', 'sg.guardian_id')
        .join('students as s', 's.id', 'sg.student_id')
        .whereIn('s.campus_id', actor.campusIds)
        .where({
          'g.user_id': actor.sub, 'g.organization_id': actor.orgId, 'sg.is_verified': true
        }).whereNull('s.archived_at')
        .select('s.id', 's.campus_id', 's.student_no', 's.given_name_en', 's.father_name_en',
          's.grandfather_name_en', 's.given_name_am', 's.father_name_am',
          's.grandfather_name_am', 's.section_name', 's.status', 'sg.can_view_results', 'sg.can_view_fees');
      const students = await Promise.all(rows.map(async (row) => {
        const canViewResults = Boolean(row.can_view_results);
        const canViewFees = Boolean(row.can_view_fees);
        return {
          student: portalStudentView(mapStudent(row)), canViewResults, canViewFees,
          results: canViewResults ? await this.portalResults(row.id) : [],
          reports: canViewResults ? await this.portalPublishedReports(row.id, row.campus_id) : [],
          attendance: await this.portalAttendance(row.id, row.campus_id),
          fees: canViewFees ? await this.portalFees(row.id) : []
        };
      }));
      return { role: actor.role, students };
    }
    return { role: actor.role, students: [] };
  }
  async portalResults(studentId) {
    const rows = await this.db('marks').where({ student_id: studentId, state: 'locked' })
      .orderBy('created_at', 'desc').limit(20);
    return rows.map((row) => ({
      assessmentName: row.assessment_name, value: Number(row.value), maxValue: Number(row.max_value)
    }));
  }
  async portalPublishedReports(studentId, campusId) {
    const rows = await this.db('term_report_revisions').where({
      student_id: studentId, campus_id: campusId, status: 'published'
    }).orderBy('published_at', 'desc').orderBy('revision', 'desc').limit(20);
    return rows.map((row) => portalPublishedReportView(mapTermReportRevision(row)));
  }
  async portalAttendance(studentId, campusId) {
    const rows = await this.db('attendance_sessions as s')
      .join('attendance_records as r', 'r.session_id', 's.id')
      .where({ 's.campus_id': campusId, 'r.student_id': studentId })
      .orderBy('s.attendance_date', 'desc').limit(20)
      .select('s.attendance_date', 'r.status');
    return rows.map((row) => ({
      date: String(row.attendance_date).slice(0, 10), status: row.status
    }));
  }
  async portalFees(studentId) {
    const rows = await this.db('invoices').where({ student_id: studentId })
      .whereNot({ status: 'void' }).orderBy('issued_at', 'desc').limit(20);
    return rows.map((row) => ({
      invoiceNumber: row.invoice_number, totalAmount: Number(row.total_amount),
      dueDate: row.due_date, status: row.status, currencyCode: row.currency_code
    }));
  }
  async recordLoginFailure(login) {
    const item = this.loginFailures.get(login) ?? { count: 0, since: Date.now() };
    if (Date.now() - item.since > 15 * 60_000) { item.count = 0; item.since = Date.now(); }
    item.count += 1; this.loginFailures.set(login, item);
    return item.count;
  }
  async clearLoginFailures(login) { this.loginFailures.delete(login); }
  async storeRefreshToken(tokenHash, userId, expiresAt) {
    await this.db('refresh_tokens').insert({
      id: randomUUID(), user_id: userId, token_hash: tokenHash, expires_at: expiresAt
    });
  }
  async consumeRefreshToken(tokenHash) {
    return this.db.transaction(async (trx) => {
      const row = await trx('refresh_tokens').where({ token_hash: tokenHash }).forUpdate().first();
      if (!row || row.revoked_at || new Date(row.expires_at) <= new Date()) return null;
      await trx('refresh_tokens').where({ id: row.id }).update({ revoked_at: trx.fn.now() });
      const user = await trx('users').where({ id: row.user_id }).first();
      if (!user || !user.is_active) return null;
      const memberships = await trx('user_campuses as uc')
        .join('campuses as c', 'c.id', 'uc.campus_id')
        .where({
          'uc.user_id': user.id, 'uc.is_active': true,
          'c.organization_id': user.organization_id, 'c.is_active': true
        })
        .select('uc.campus_id');
      return {
        id: user.id, orgId: user.organization_id, name: user.name, email: user.email,
        role: user.role, campusIds: memberships.map((m) => m.campus_id),
        activeCampusId: memberships[0]?.campus_id, isActive: Boolean(user.is_active),
        authVersion: Number(user.auth_version ?? 0),
        mustChangePassword: Boolean(user.must_change_password)
      };
    });
  }
  async revokeRefreshToken(tokenHash) {
    const token = await this.db('refresh_tokens').where({ token_hash: tokenHash })
      .whereNull('revoked_at').first('user_id');
    if (!token) return null;
    await this.db('refresh_tokens').where({ token_hash: tokenHash })
      .whereNull('revoked_at').update({ revoked_at: this.db.fn.now() });
    return this.findUserById(token.user_id);
  }
  async listOrganizationAccounts(organizationId) {
    const users = await this.db('users')
      .where({ organization_id: organizationId })
      .whereNot('role', 'super_admin')
      .orderBy('name')
      .select('id', 'name', 'email', 'role', 'is_active');
    if (!users.length) return [];
    const memberships = await this.db('user_campuses as uc')
      .join('campuses as c', 'c.id', 'uc.campus_id')
      .whereIn('uc.user_id', users.map((user) => user.id))
      .where({ 'uc.is_active': true, 'c.organization_id': organizationId })
      .select('uc.user_id', 'uc.campus_id');
    const campusesByUser = new Map();
    for (const membership of memberships) {
      const campuses = campusesByUser.get(membership.user_id) ?? [];
      campuses.push(membership.campus_id);
      campusesByUser.set(membership.user_id, campuses);
    }
    return users.map((user) => ({
      id: user.id, name: user.name, email: user.email, role: user.role,
      isActive: Boolean(user.is_active), campusIds: campusesByUser.get(user.id) ?? []
    }));
  }
  async setOrganizationAccountStatus(organizationId, userId, isActive, actor) {
    return this.db.transaction(async (trx) => {
      const user = await trx('users').where({
        id: userId, organization_id: organizationId
      }).whereNot('role', 'super_admin').forUpdate().first('id', 'is_active');
      if (!user) return null;
      if (userId === actor.sub && !isActive) {
        throw setupConflict('You cannot deactivate your own account.');
      }
      if (Boolean(user.is_active) === isActive) {
        const account = await trx('users').where({ id: userId })
          .first('id', 'name', 'email', 'role', 'is_active');
        const campuses = await trx('user_campuses as uc').join('campuses as c', 'c.id', 'uc.campus_id')
          .where({ 'uc.user_id': userId, 'uc.is_active': true, 'c.organization_id': organizationId })
          .select('uc.campus_id');
        return {
          id: account.id, name: account.name, email: account.email, role: account.role,
          isActive: Boolean(account.is_active), campusIds: campuses.map((campus) => campus.campus_id)
        };
      }
      await trx('users').where({ id: userId, organization_id: organizationId })
        .update({ is_active: isActive, auth_version: trx.raw('auth_version + 1') });
      if (!isActive) {
        await trx('refresh_tokens').where({ user_id: userId }).whereNull('revoked_at')
          .update({ revoked_at: trx.fn.now() });
      }
      await trx('audit_log').insert(auditRow(actor,
        isActive ? 'user.activated' : 'user.deactivated', 'user', userId,
        { isActive: Boolean(user.is_active) }, { isActive }));
      const updated = await trx('users').where({ id: userId })
        .first('id', 'name', 'email', 'role', 'is_active');
      const campuses = await trx('user_campuses as uc').join('campuses as c', 'c.id', 'uc.campus_id')
        .where({ 'uc.user_id': userId, 'uc.is_active': true, 'c.organization_id': organizationId })
        .select('uc.campus_id');
      return {
        id: updated.id, name: updated.name, email: updated.email, role: updated.role,
        isActive: Boolean(updated.is_active), campusIds: campuses.map((campus) => campus.campus_id)
      };
    });
  }
  async listStudents(campusId) {
    const rows = await this.db('students').where({ campus_id: campusId }).whereNull('archived_at')
      .orderBy('created_at', 'desc').limit(250);
    const placements = rows.length ? await this.db('enrolments as e')
      .join('sections as s', 's.id', 'e.section_id')
      .join('academic_years as y', 'y.id', 'e.academic_year_id')
      .whereIn('e.student_id', rows.map((row) => row.id))
      .where({ 'e.status': 'active', 'y.status': 'active', 's.campus_id': campusId })
      .select('e.student_id', 's.id as section_id', 's.grade_level_id', 's.stream') : [];
    const placementByStudent = new Map(placements.map((row) => [row.student_id, row]));
    return rows.map((row) => mapStudent({ ...row, ...(placementByStudent.get(row.id) ?? {}) }));
  }
  async listSections(campusId, actor = null) {
    const rows = await this.db('sections as s')
      .leftJoin('grade_levels as g', 'g.id', 's.grade_level_id')
      .join('academic_years as y', 'y.id', 's.academic_year_id')
      .where({ 's.campus_id': campusId })
      .where({ 'y.status': 'active' })
      .select('s.id', 's.campus_id', 's.name', 's.shift', 's.stream',
        's.grade_level_id', 'g.name_en as grade_name')
      .orderBy('g.sort_order').orderBy('s.name');
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    const mapped = rows.map((row) => ({
      id: row.id, campusId: row.campus_id, name: row.name, gradeName: row.grade_name ?? '',
      gradeLevelId: row.grade_level_id, shift: row.shift ?? 'morning', stream: row.stream
    })).filter((section) => accessible === null || accessible.has(section.id));
    return mapped;
  }
  async accessibleSectionIds(actor) {
    if (!['homeroom_teacher', 'subject_teacher'].includes(actor.role)) return null;
    const staff = await this.db('staff').where({
      campus_id: actor.activeCampusId, user_id: actor.sub
    }).whereNull('archived_at').first();
    if (!staff) return new Set();
    const [teaching, homeroom] = await Promise.all([
      this.db('teaching_assignments').where({
        campus_id: actor.activeCampusId, staff_id: staff.id, is_active: true
      }).select('section_id'),
      this.db('homeroom_assignments').where({
        campus_id: actor.activeCampusId, staff_id: staff.id
      }).select('section_id')
    ]);
    return new Set([...teaching, ...homeroom].map((item) => item.section_id));
  }
  async hasSection(campusId, sectionId) {
    return Boolean(await this.db('sections as s').join('academic_years as y', 'y.id', 's.academic_year_id')
      .where({ 's.campus_id': campusId, 's.id': sectionId, 'y.status': 'active' }).first());
  }
  async hasStudentsInSection(campusId, sectionId, ids) {
    const rows = await this.db('enrolments as e')
      .join('students as st', 'st.id', 'e.student_id')
      .join('academic_years as y', 'y.id', 'e.academic_year_id')
      .where({
        'st.campus_id': campusId, 'e.section_id': sectionId,
        'e.status': 'active', 'y.status': 'active'
      })
      .whereIn('st.id', ids)
      .countDistinct({ total: 'st.id' }).first();
    return Number(rows.total) === ids.length;
  }
  async getAcademicYear(campusId) {
    const row = await this.db('academic_years').where({ campus_id: campusId, status: 'active' })
      .orderBy('start_date', 'desc').first();
    return row ? {
      id: row.id, campusId: row.campus_id, labelEc: row.label_ec,
      startDate: String(row.start_date).slice(0, 10),
      endDate: String(row.end_date).slice(0, 10), status: row.status
    } : null;
  }
  async listAcademicYears(campusId) {
    const rows = await this.db('academic_years').where({ campus_id: campusId }).orderBy('start_date', 'desc');
    return rows.map(mapAcademicYear);
  }
  async createAcademicYear(data, actor) {
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('academic_years').insert({
          id, campus_id: actor.activeCampusId, label_ec: data.labelEc,
          start_date: data.startDate, end_date: data.endDate, status: 'planned'
        });
        await trx('audit_log').insert(auditRow(actor, 'academic_year.created', 'academic_year', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Academic-year label already exists at this campus.');
      throw error;
    }
    return { id, campusId: actor.activeCampusId, ...data, status: 'planned' };
  }
  async activateAcademicYear(yearId, actor) {
    return this.db.transaction(async (trx) => {
      const campus = await trx('campuses').where({
        id: actor.activeCampusId, organization_id: actor.orgId
      }).forUpdate().first();
      if (!campus) return null;
      const year = await trx('academic_years').where({
        id: yearId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!year) return null;
      const previous = await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).select('id', 'label_ec');
      const previousIds = previous.map((item) => item.id).filter((id) => id !== yearId);
      if (previousIds.length) {
        await trx('terms').whereIn('academic_year_id', previousIds).update({ is_current: false });
        await trx('enrolments').whereIn('academic_year_id', previousIds)
          .where({ status: 'active' }).update({ status: 'completed', left_on: addisDate() });
      }
      await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).update({ status: 'closed' });
      await trx('academic_years').where({ id: yearId, campus_id: actor.activeCampusId })
        .update({ status: 'active' });
      const updated = mapAcademicYear({ ...year, status: 'active' });
      await trx('audit_log').insert(auditRow(
        actor, 'academic_year.activated', 'academic_year', yearId,
        previous.map((item) => ({ id: item.id, labelEc: item.label_ec })), updated
      ));
      return updated;
    });
  }
  async listSchoolCalendarEntries(campusId, { from, to } = {}) {
    const query = this.db('school_calendar_entries').where({ campus_id: campusId })
      .orderBy('start_date').orderBy('title_en');
    if (from) query.where('end_date', '>=', from);
    if (to) query.where('start_date', '<=', to);
    return (await query).map(mapSchoolCalendarEntry);
  }
  async createSchoolCalendarEntry(data, actor) {
    const year = data.academicYearId
      ? await this.db('academic_years').where({
        id: data.academicYearId, campus_id: actor.activeCampusId
      }).first('id', 'start_date', 'end_date')
      : null;
    if (data.academicYearId && !year) throw campusScopeError('Academic year is outside the active campus.');
    if (year && (data.startDate < String(year.start_date).slice(0, 10) ||
        data.endDate > String(year.end_date).slice(0, 10))) {
      throw setupConflict('Calendar dates must fall within the selected academic year.');
    }
    if (['holiday', 'closure'].includes(data.entryType) && !data.isNonInstructionalDay) {
      throw setupConflict('Holidays and closures must be marked as non-instructional days.');
    }
    const id = randomUUID();
    const row = {
      id, campus_id: actor.activeCampusId, academic_year_id: data.academicYearId ?? null,
      entry_type: data.entryType, title_en: data.titleEn, title_am: data.titleAm,
      start_date: data.startDate, end_date: data.endDate,
      is_non_instructional_day: data.isNonInstructionalDay,
      notes_en: data.notesEn ?? '', notes_am: data.notesAm ?? '', created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await trx('school_calendar_entries').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'school_calendar_entry.created',
        'school_calendar_entry', id, null, mapSchoolCalendarEntry(row)));
    });
    return mapSchoolCalendarEntry(row);
  }
  async updateSchoolCalendarEntry(id, data, actor) {
    const current = await this.db('school_calendar_entries').where({
      id, campus_id: actor.activeCampusId
    }).first();
    if (!current) return null;
    const next = { ...mapSchoolCalendarEntry(current), ...data };
    const year = next.academicYearId
      ? await this.db('academic_years').where({
        id: next.academicYearId, campus_id: actor.activeCampusId
      }).first('id', 'start_date', 'end_date')
      : null;
    if (next.academicYearId && !year) throw campusScopeError('Academic year is outside the active campus.');
    if (year && (next.startDate < String(year.start_date).slice(0, 10) ||
        next.endDate > String(year.end_date).slice(0, 10))) {
      throw setupConflict('Calendar dates must fall within the selected academic year.');
    }
    if (['holiday', 'closure'].includes(next.entryType) && !next.isNonInstructionalDay) {
      throw setupConflict('Holidays and closures must be marked as non-instructional days.');
    }
    const row = {
      academic_year_id: next.academicYearId ?? null, entry_type: next.entryType,
      title_en: next.titleEn, title_am: next.titleAm, start_date: next.startDate,
      end_date: next.endDate, is_non_instructional_day: next.isNonInstructionalDay,
      notes_en: next.notesEn ?? '', notes_am: next.notesAm ?? ''
    };
    await this.db.transaction(async (trx) => {
      await trx('school_calendar_entries').where({
        id, campus_id: actor.activeCampusId
      }).update(row);
      await trx('audit_log').insert(auditRow(actor, 'school_calendar_entry.updated',
        'school_calendar_entry', id, mapSchoolCalendarEntry(current), { ...next, id }));
    });
    return { ...next, id };
  }
  async deleteSchoolCalendarEntry(id, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('school_calendar_entries').where({
        id, campus_id: actor.activeCampusId
      }).first();
      if (!row) return false;
      await trx('school_calendar_entries').where({ id, campus_id: actor.activeCampusId }).del();
      await trx('audit_log').insert(auditRow(actor, 'school_calendar_entry.deleted',
        'school_calendar_entry', id, mapSchoolCalendarEntry(row), null));
      return true;
    });
  }
  async listCurriculumUnits(campusId, filters = {}) {
    const query = this.db('curriculum_units as u')
      .join('grade_levels as g', 'g.id', 'u.grade_level_id')
      .join('subjects as s', 's.id', 'u.subject_id')
      .where({ 'u.campus_id': campusId })
      .orderBy('u.academic_year_id').orderBy('u.grade_level_id')
      .orderBy('u.subject_id').orderBy('u.unit_number');
    if (filters.academicYearId) query.where('u.academic_year_id', filters.academicYearId);
    if (filters.gradeLevelId) query.where('u.grade_level_id', filters.gradeLevelId);
    if (filters.subjectId) query.where('u.subject_id', filters.subjectId);
    const rows = await query.select('u.*', 'g.name_en as grade_name', 's.name_en as subject_name');
    return rows.map((row) => ({ ...mapCurriculumUnit(row), gradeName: row.grade_name, subjectName: row.subject_name }));
  }
  async saveCurriculumUnit(data, actor, unitId = null) {
    const [year, grade, subject] = await Promise.all([
      this.db('academic_years').where({ id: data.academicYearId, campus_id: actor.activeCampusId })
        .first('id', 'start_date', 'end_date'),
      this.db('grade_levels').where({ id: data.gradeLevelId, campus_id: actor.activeCampusId })
        .first('id', 'code', 'name_en'),
      this.db('subjects').where({ id: data.subjectId, campus_id: actor.activeCampusId })
        .first('id', 'name_en')
    ]);
    if (!year || !grade || !subject) throw campusScopeError('Curriculum grade, subject or year is outside the active campus.');
    if (data.stream !== 'all' && !isUpperSecondaryGrade(grade.code)) {
      throw setupConflict('Only Grades 11 and 12 can use subject streams.');
    }
    const mapping = await this.db('grade_subjects').where({
      grade_level_id: grade.id, subject_id: subject.id
    }).whereIn('stream', ['all', data.stream]).first('id');
    if (!mapping) throw setupConflict('The subject is not mapped to this grade and stream.');
    if ((data.plannedStart && data.plannedStart < String(year.start_date).slice(0, 10)) ||
        (data.plannedEnd && data.plannedEnd > String(year.end_date).slice(0, 10))) {
      throw setupConflict('Curriculum dates must fall within the selected academic year.');
    }
    const duplicate = await this.db('curriculum_units').where({
      academic_year_id: year.id, grade_level_id: grade.id,
      subject_id: subject.id, stream: data.stream, unit_number: data.unitNumber
    }).modify((query) => { if (unitId) query.whereNot('id', unitId); }).first('id');
    if (duplicate) throw setupConflict('Unit number already exists for this grade, subject and stream.');
    const id = unitId ?? randomUUID();
    const row = {
      campus_id: actor.activeCampusId, academic_year_id: year.id,
      grade_level_id: grade.id, subject_id: subject.id, stream: data.stream,
      unit_number: data.unitNumber, title_en: data.titleEn, title_am: data.titleAm,
      learning_outcomes_en: data.learningOutcomesEn, learning_outcomes_am: data.learningOutcomesAm,
      planned_start: data.plannedStart ?? null, planned_end: data.plannedEnd ?? null,
      created_by: actor.sub
    };
    return this.db.transaction(async (trx) => {
      const previous = unitId ? await trx('curriculum_units').where({
        id: unitId, campus_id: actor.activeCampusId
      }).first() : null;
      if (unitId && !previous) return null;
      try {
        if (unitId) {
          await trx('curriculum_units').where({ id: unitId, campus_id: actor.activeCampusId }).update(row);
        } else {
          await trx('curriculum_units').insert({ id, ...row });
        }
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Unit number already exists for this grade, subject and stream.');
        throw error;
      }
      const result = { id, ...mapCurriculumUnit(row), gradeName: grade.name_en, subjectName: subject.name_en };
      await trx('audit_log').insert(auditRow(actor, unitId ? 'curriculum_unit.updated' : 'curriculum_unit.created',
        'curriculum_unit', id, previous ? mapCurriculumUnit(previous) : null, result));
      return result;
    });
  }
  async evaluateStudentProgression(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const targetYear = await this.getAcademicYear(actor.activeCampusId);
    const previous = await this.db('enrolments as e')
      .join('academic_years as y', 'y.id', 'e.academic_year_id')
      .join('sections as sc', 'sc.id', 'e.section_id')
      .join('grade_levels as g', 'g.id', 'sc.grade_level_id')
      .where({
        'e.student_id': studentId, 'e.status': 'completed',
        'y.campus_id': actor.activeCampusId, 'y.status': 'closed',
        'sc.campus_id': actor.activeCampusId
      })
      .orderBy('y.end_date', 'desc')
      .select('e.academic_year_id', 'y.label_ec', 'y.end_date',
        'sc.id as section_id', 'sc.stream', 'sc.grade_level_id',
        'g.name_en as grade_name', 'g.sort_order')
      .first();
    if (!targetYear || !previous) throw setupConflict('A completed prior year and active destination year are required.');
    const ruleRow = await this.db('promotion_rules').where({
      campus_id: actor.activeCampusId, academic_year_id: targetYear.id,
      grade_level_id: previous.grade_level_id
    }).first();
    const sourceGrade = {
      id: previous.grade_level_id, nameEn: previous.grade_name,
      sortOrder: Number(previous.sort_order)
    };
    if (!ruleRow) return {
      studentId, sourceYearId: previous.academic_year_id, targetYearId: targetYear.id,
      sourceGradeId: sourceGrade.id, sourceGrade: sourceGrade.nameEn,
      status: 'needs_configuration', rule: null, annualAveragePercent: null,
      failedRequiredSubjects: [], reason: 'Configure a promotion rule for this grade and academic year.'
    };
    const rule = mapPromotionRule(ruleRow);
    const terms = await this.db('terms').where({
      academic_year_id: previous.academic_year_id
    }).orderBy('start_date').select('id', 'name');
    if (!terms.length) return {
      studentId, sourceYearId: previous.academic_year_id, targetYearId: targetYear.id,
      sourceGradeId: sourceGrade.id, sourceGrade: sourceGrade.nameEn,
      status: 'missing_results', rule, annualAveragePercent: null,
      failedRequiredSubjects: [], reason: 'The prior academic year has no terms.'
    };
    const reportRows = await this.db('term_report_revisions').where({
      campus_id: actor.activeCampusId, student_id: studentId
    }).whereIn('term_id', terms.map((term) => term.id)).orderBy('revision', 'desc');
    const latestByTerm = new Map();
    for (const row of reportRows) {
      if (!latestByTerm.has(row.term_id)) latestByTerm.set(row.term_id, mapTermReportRevision(row));
    }
    const reports = [];
    for (const term of terms) {
      const report = latestByTerm.get(term.id);
      if (!report || report.status !== 'published') return {
        studentId, sourceYearId: previous.academic_year_id, targetYearId: targetYear.id,
        sourceGradeId: sourceGrade.id, sourceGrade: sourceGrade.nameEn,
        status: 'missing_results', rule, annualAveragePercent: null,
        failedRequiredSubjects: [], reason: `A published report is missing for ${term.name}.`
      };
      reports.push(report.snapshot);
    }
    const requiredRows = await this.db('grade_subjects as gs')
      .join('subjects as s', 's.id', 'gs.subject_id')
      .where({ 'gs.grade_level_id': sourceGrade.id, 'gs.is_required': true })
      .whereIn('gs.stream', ['all', previous.stream ?? 'all'])
      .select('gs.subject_id', 's.name_en');
    if (!requiredRows.length) return {
      studentId, sourceYearId: previous.academic_year_id, targetYearId: targetYear.id,
      sourceGradeId: sourceGrade.id, sourceGrade: sourceGrade.nameEn,
      status: 'missing_results', rule, annualAveragePercent: null,
      failedRequiredSubjects: [], reason: 'Required subject mappings are missing.'
    };
    const subjects = requiredRows.map((mapping) => {
      const rows = reports.flatMap((report) =>
        (report.subjects ?? []).filter((item) => item.subjectId === mapping.subject_id));
      const value = rows.reduce((total, item) => total + Number(item.value), 0);
      const maxValue = rows.reduce((total, item) => total + Number(item.maxValue), 0);
      return {
        subjectId: mapping.subject_id, subjectName: mapping.name_en,
        percent: maxValue ? Math.round((value / maxValue) * 10000) / 100 : null,
        value, maxValue
      };
    });
    const missingSubject = subjects.find((item) => item.percent === null);
    if (missingSubject) return {
      studentId, sourceYearId: previous.academic_year_id, targetYearId: targetYear.id,
      sourceGradeId: sourceGrade.id, sourceGrade: sourceGrade.nameEn,
      status: 'missing_results', rule, annualAveragePercent: null,
      failedRequiredSubjects: [], reason: `Published results are missing for ${missingSubject.subjectName}.`
    };
    const gradingPolicy = await this.getGradingPolicy(actor.activeCampusId);
    const earned = subjects.reduce((total, item) => total + item.value, 0);
    const possible = subjects.reduce((total, item) => total + item.maxValue, 0);
    const annualAveragePercent = gradingPolicy.scoringMethod === 'equal_subject_weighted'
      ? Math.round(subjects.reduce((sum, item) => sum + item.percent, 0) /
        subjects.length * 100) / 100
      : Math.round((earned / possible) * 10000) / 100;
    const failedRequiredSubjects = subjects.filter((item) =>
      item.percent < rule.minimumAnnualPercent);
    const eligible = annualAveragePercent >= rule.minimumAnnualPercent &&
      failedRequiredSubjects.length <= rule.maximumFailedRequiredSubjects;
    return {
      studentId, sourceYearId: previous.academic_year_id, targetYearId: targetYear.id,
      sourceGradeId: sourceGrade.id, sourceGrade: sourceGrade.nameEn,
      status: eligible ? 'eligible' : 'ineligible', rule,
      annualAveragePercent, failedRequiredSubjects,
      reason: eligible ? '' : 'The student does not meet the configured annual promotion criteria.'
    };
  }
  async deleteCurriculumUnit(id, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('curriculum_units').where({
        id, campus_id: actor.activeCampusId
      }).first();
      if (!row) return false;
      if (await trx('lesson_plans').where({ curriculum_unit_id: id }).first('id')) {
        throw setupConflict('A curriculum unit referenced by a lesson plan cannot be deleted.');
      }
      await trx('curriculum_units').where({ id, campus_id: actor.activeCampusId }).del();
      await trx('audit_log').insert(auditRow(actor, 'curriculum_unit.deleted',
        'curriculum_unit', id, mapCurriculumUnit(row), null));
      return true;
    });
  }
  async listLessonPlans(actor, { from, to, sectionId } = {}) {
    const assignments = await this.listTeachingAssignments(actor);
    if (!assignments.length) return [];
    const query = this.db('lesson_plans as lp')
      .join('teaching_assignments as ta', 'ta.id', 'lp.teaching_assignment_id')
      .join('sections as sc', 'sc.id', 'ta.section_id')
      .join('subjects as su', 'su.id', 'ta.subject_id')
      .join('staff as st', 'st.id', 'ta.staff_id')
      .leftJoin('curriculum_units as cu', 'cu.id', 'lp.curriculum_unit_id')
      .where({ 'lp.campus_id': actor.activeCampusId })
      .whereIn('lp.teaching_assignment_id', assignments.map((item) => item.id))
      .orderBy('lp.planned_on');
    if (from) query.where('lp.planned_on', '>=', from);
    if (to) query.where('lp.planned_on', '<=', to);
    if (sectionId) query.where('ta.section_id', sectionId);
    const rows = await query.select('lp.*', 'sc.name as section_name',
      'su.name_en as subject_name', 'st.given_name_en as teacher_name',
      'cu.title_en as unit_name');
    return rows.map((row) => mapLessonPlan(row));
  }
  async createLessonPlan(data, actor) {
    const assignment = await this.db('teaching_assignments as ta')
      .join('sections as sc', 'sc.id', 'ta.section_id')
      .join('academic_years as y', 'y.id', 'sc.academic_year_id')
      .join('staff as st', 'st.id', 'ta.staff_id')
      .where({
        'ta.id': data.teachingAssignmentId, 'ta.campus_id': actor.activeCampusId,
        'ta.is_active': true, 'sc.is_active': true, 'y.status': 'active'
      })
      .select('ta.id', 'ta.staff_id', 'ta.section_id', 'ta.subject_id', 'sc.name as section_name',
        'sc.grade_level_id', 'sc.stream', 'sc.academic_year_id', 'y.start_date', 'y.end_date',
        'st.user_id')
      .first();
    if (!assignment) throw campusScopeError('Teaching assignment is outside the active campus or inactive.');
    if (['homeroom_teacher', 'subject_teacher'].includes(actor.role) && assignment.user_id !== actor.sub) {
      throw campusScopeError('Lesson plans can only be created for your assignments.');
    }
    if (data.plannedOn < String(assignment.start_date).slice(0, 10) ||
        data.plannedOn > String(assignment.end_date).slice(0, 10)) {
      throw setupConflict('Lesson date must fall within the section active academic year.');
    }
    if (data.curriculumUnitId) {
      const unit = await this.db('curriculum_units').where({
        id: data.curriculumUnitId, campus_id: actor.activeCampusId,
        academic_year_id: assignment.academic_year_id,
        grade_level_id: assignment.grade_level_id, subject_id: assignment.subject_id
      }).whereIn('stream', ['all', assignment.stream ?? 'all']).first('id');
      if (!unit) throw campusScopeError('Curriculum unit does not match this section and subject.');
    }
    const id = randomUUID();
    const row = {
      id, campus_id: actor.activeCampusId, academic_year_id: assignment.academic_year_id,
      teaching_assignment_id: assignment.id, curriculum_unit_id: data.curriculumUnitId ?? null,
      planned_on: data.plannedOn, title_en: data.titleEn, title_am: data.titleAm,
      objectives_en: data.objectivesEn, objectives_am: data.objectivesAm,
      activities_en: data.activitiesEn, activities_am: data.activitiesAm,
      resources: data.resources ?? '', status: 'planned', created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await trx('lesson_plans').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'lesson_plan.created', 'lesson_plan', id, null, data));
    });
    return mapLessonPlan({
      ...row, section_name: assignment.section_name,
      subject_name: (await this.db('subjects').where({ id: assignment.subject_id }).first('name_en')).name_en,
      teacher_name: (await this.db('staff').where({ id: assignment.staff_id }).first('given_name_en')).given_name_en
    });
  }
  async updateLessonPlan(id, data, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('lesson_plans as lp')
        .join('teaching_assignments as ta', 'ta.id', 'lp.teaching_assignment_id')
        .join('staff as st', 'st.id', 'ta.staff_id')
        .where({ 'lp.id': id, 'lp.campus_id': actor.activeCampusId })
        .select('lp.*', 'ta.staff_id', 'st.user_id')
        .first();
      if (!row) return null;
      if (['homeroom_teacher', 'subject_teacher'].includes(actor.role) && row.user_id !== actor.sub) {
        throw campusScopeError('Lesson plan is outside your assignments.');
      }
      if (row.status !== 'planned') throw setupConflict('Only planned lessons can be edited.');
      const columns = {
        titleEn: 'title_en', titleAm: 'title_am',
        objectivesEn: 'objectives_en', objectivesAm: 'objectives_am',
        activitiesEn: 'activities_en', activitiesAm: 'activities_am', resources: 'resources',
        status: 'status'
      };
      const update = Object.fromEntries(Object.entries(data)
        .filter(([key]) => columns[key]).map(([key, value]) => [columns[key], value]));
      if (data.status === 'completed') update.completed_at = new Date();
      if (Object.keys(update).length) {
        await trx('lesson_plans').where({ id, campus_id: actor.activeCampusId }).update(update);
      }
      const after = { ...row, ...update };
      await trx('audit_log').insert(auditRow(actor, 'lesson_plan.updated', 'lesson_plan',
        id, mapLessonPlan(row), mapLessonPlan(after)));
      const context = await trx('sections as sc')
        .join('teaching_assignments as ta', 'ta.section_id', 'sc.id')
        .join('subjects as su', 'su.id', 'ta.subject_id')
        .join('staff as st', 'st.id', 'ta.staff_id')
        .where({ 'ta.id': row.teaching_assignment_id })
        .first('sc.name as section_name', 'su.name_en as subject_name',
          'st.given_name_en as teacher_name', 'ta.subject_id');
      return mapLessonPlan({
        ...after, section_name: context?.section_name ?? '',
        subject_name: context?.subject_name ?? '', teacher_name: context?.teacher_name ?? '',
        subject_id: context?.subject_id ?? null
      });
    });
  }
  async listPromotionRules(campusId) {
    const year = await this.getAcademicYear(campusId);
    if (!year) return [];
    const rows = await this.db('promotion_rules as pr')
      .join('grade_levels as g', 'g.id', 'pr.grade_level_id')
      .where({ 'pr.campus_id': campusId, 'pr.academic_year_id': year.id })
      .select('pr.*', 'g.name_en as grade_name');
    return rows.map((row) => ({ ...mapPromotionRule(row), gradeName: row.grade_name }));
  }
  async savePromotionRule(data, actor) {
    const year = await this.getAcademicYear(actor.activeCampusId);
    const grade = await this.db('grade_levels').where({
      id: data.gradeLevelId, campus_id: actor.activeCampusId
    }).first('id', 'name_en');
    if (!year || !grade) throw campusScopeError('Select a campus grade and active academic year.');
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const existing = await trx('promotion_rules').where({
        campus_id: actor.activeCampusId, academic_year_id: year.id,
        grade_level_id: grade.id
      }).forUpdate().first();
      const row = {
        campus_id: actor.activeCampusId, academic_year_id: year.id,
        grade_level_id: grade.id, minimum_annual_percent: data.minimumAnnualPercent,
        maximum_failed_required_subjects: data.maximumFailedRequiredSubjects,
        updated_by: actor.sub, updated_at: new Date()
      };
      if (existing) {
        await trx('promotion_rules').where({ id: existing.id }).update(row);
      } else {
        row.id = id;
        await trx('promotion_rules').insert(row);
      }
      const result = {
        id: existing?.id ?? id, campusId: actor.activeCampusId,
        academicYearId: year.id, gradeLevelId: grade.id,
        minimumAnnualPercent: Number(data.minimumAnnualPercent),
        maximumFailedRequiredSubjects: data.maximumFailedRequiredSubjects,
        updatedBy: actor.sub
      };
      await trx('audit_log').insert(auditRow(actor, 'promotion_rule.saved',
        'promotion_rule', result.id, existing ? mapPromotionRule(existing) : null, result));
      return result;
    });
  }
  async listTerms(campusId) {
    const rows = await this.db('terms as t')
      .join('academic_years as y', 'y.id', 't.academic_year_id')
      .where({ 'y.campus_id': campusId })
      .select('t.id', 't.academic_year_id', 't.name', 't.start_date', 't.end_date',
        't.is_current', 't.period_type');
    return rows.map((row) => ({
      id: row.id, academicYearId: row.academic_year_id, name: row.name,
      startDate: String(row.start_date).slice(0, 10), endDate: String(row.end_date).slice(0, 10),
      periodType: row.period_type ?? 'term', isCurrent: Boolean(row.is_current)
    }));
  }
  async createTerm(data, actor) {
    const year = await this.getAcademicYear(actor.activeCampusId);
    if (!year) throw setupConflict('Create or activate an academic year before adding terms.');
    if (data.startDate < year.startDate || data.endDate > year.endDate) {
      const error = new Error('Term dates must be within the active academic year.');
      error.status = 400;
      error.code = 'TERM_OUTSIDE_ACADEMIC_YEAR';
      throw error;
    }
    const id = randomUUID();
    let isCurrent = false;
    try {
      await this.db.transaction(async (trx) => {
        const activeYear = await trx('academic_years').where({
          id: year.id, campus_id: actor.activeCampusId, status: 'active'
        }).forUpdate().first();
        if (!activeYear) throw setupConflict('The active academic year changed. Reload and try again.');
        const count = await trx('terms').where({ academic_year_id: year.id }).count({ total: '*' }).first();
        isCurrent = Number(count.total) === 0;
        await trx('terms').insert({
          id, academic_year_id: year.id, name: data.name, start_date: data.startDate,
          end_date: data.endDate, period_type: data.periodType ?? 'term', is_current: isCurrent
        });
        await trx('audit_log').insert(auditRow(actor, 'term.created', 'term', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Term name already exists in the active academic year.');
      throw error;
    }
    return { id, academicYearId: year.id, ...data, isCurrent };
  }
  async setCurrentTerm(termId, actor) {
    return this.db.transaction(async (trx) => {
      const activeYear = await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).forUpdate().first();
      if (!activeYear) return null;
      const selected = await trx('terms').where({
        id: termId, academic_year_id: activeYear.id
      }).forUpdate().first();
      if (!selected) return null;
      const previous = await trx('terms').where({
        academic_year_id: activeYear.id, is_current: true
      }).first();
      await trx('terms').where({ academic_year_id: activeYear.id })
        .update({ is_current: false });
      await trx('terms').where({ id: termId }).update({ is_current: true });
      const updated = {
        id: selected.id, academicYearId: selected.academic_year_id,
        name: selected.name, startDate: String(selected.start_date).slice(0, 10),
        endDate: String(selected.end_date).slice(0, 10),
        periodType: selected.period_type ?? 'term', isCurrent: true
      };
      await trx('audit_log').insert(auditRow(
        actor, 'term.current_changed', 'term', termId,
        previous ? { id: previous.id, isCurrent: true } : null,
        { id: termId, isCurrent: true }
      ));
      return updated;
    });
  }
  async listGrades(campusId) {
    const rows = await this.db('grade_levels').where({ campus_id: campusId }).orderBy('sort_order');
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, code: row.code, nameEn: row.name_en,
      nameAm: row.name_am, band: row.band, sortOrder: row.sort_order
    }));
  }
  async createGrade(data, actor) {
    const template = getGradeTemplate(data.code);
    if (!template) throw setupConflict('Choose a grade from the Grade 1–12 school curriculum.');
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      try {
        await trx('grade_levels').insert({
          id, campus_id: actor.activeCampusId, code: template.grade.code,
          name_en: template.grade.nameEn, name_am: template.grade.nameAm,
          band: template.grade.band, sort_order: template.grade.sortOrder
        });
        const subjectIds = new Map();
        for (const item of template.subjects) {
          let subject = await trx('subjects').where({
            campus_id: actor.activeCampusId, code: item.code
          }).first('id');
          if (!subject) {
            const subjectId = randomUUID();
            await trx('subjects').insert({
              id: subjectId, campus_id: actor.activeCampusId, code: item.code,
              name_en: item.nameEn, name_am: item.nameAm
            });
            subject = { id: subjectId };
          }
          subjectIds.set(item.code, subject.id);
        }
        await trx('grade_subjects').insert(template.subjects.map((item) => ({
          id: randomUUID(), grade_level_id: id, subject_id: subjectIds.get(item.code),
          stream: item.stream, weekly_periods: item.weeklyPeriods, is_required: true
        })));
        const gradingBandCount = await trx('grading_bands')
          .where({ campus_id: actor.activeCampusId }).count({ total: '*' }).first();
        if (Number(gradingBandCount.total) === 0) {
          await trx('grading_bands').insert(DEFAULT_GRADING_BANDS.map((band) => ({
            id: randomUUID(), campus_id: actor.activeCampusId, code: band.code,
            name_en: band.nameEn, name_am: band.nameAm, min_percent: band.minPercent
          })));
        }
        await trx('audit_log').insert(auditRow(actor, 'grade_level.created', 'grade_level', id, null, data));
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Grade code already exists at this campus.');
        throw error;
      }
      return { id, campusId: actor.activeCampusId, ...template.grade };
    });
  }
  async listSubjects(campusId) {
    const rows = await this.db('subjects').where({ campus_id: campusId }).orderBy('name_en');
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, code: row.code,
      nameEn: row.name_en, nameAm: row.name_am, category: row.category ?? 'core'
    }));
  }
  async listGradeSubjects(campusId, gradeLevelId, stream) {
    const grade = await this.db('grade_levels').where({
      id: gradeLevelId, campus_id: campusId
    }).first('id');
    if (!grade) throw campusScopeError('Grade is outside the active campus.');
    const rows = await this.db('grade_subjects as gs')
      .join('subjects as s', 's.id', 'gs.subject_id')
      .where('gs.grade_level_id', gradeLevelId)
      .modify((query) => {
        if (stream) query.whereIn('gs.stream', ['all', stream]);
      })
      .orderBy('gs.stream').orderBy('s.name_en')
      .select('gs.id', 'gs.grade_level_id as gradeLevelId', 'gs.subject_id as subjectId',
        'gs.stream', 'gs.weekly_periods as weeklyPeriods', 'gs.is_required as isRequired',
        's.campus_id as campusId', 's.code', 's.name_en as nameEn', 's.name_am as nameAm',
        's.category');
    return rows;
  }
  async sectionHasSubject(section, subjectId) {
    const query = this.db('grade_subjects').where({
      grade_level_id: section.grade_level_id
    });
    const count = await query.clone().count({ total: '*' }).first();
    if (Number(count.total) === 0) return true;
    const mapping = await query.where({
      subject_id: subjectId
    }).whereIn('stream', ['all', section.stream ?? 'all']).first('id');
    return Boolean(mapping);
  }
  async replaceGradeSubjects(gradeLevelId, data, actor) {
    const grade = await this.db('grade_levels').where({
      id: gradeLevelId, campus_id: actor.activeCampusId
    }).first('id', 'code');
    if (!grade) throw campusScopeError('Grade is outside the active campus.');
    const seen = new Set();
    for (const item of data.subjects) {
      const subject = await this.db('subjects').where({
        id: item.subjectId, campus_id: actor.activeCampusId
      }).first('id');
      const key = `${item.subjectId}:${item.stream}`;
      if (!subject) throw campusScopeError('Subject is outside the active campus.');
      if (seen.has(key)) throw setupConflict('A subject cannot be added twice to the same grade stream.');
      if (item.stream !== 'all' && !isUpperSecondaryGrade(grade.code)) {
        throw setupConflict('Only Grades 11 and 12 can use subject streams.');
      }
      seen.add(key);
    }
    const before = await this.listGradeSubjects(actor.activeCampusId, gradeLevelId);
    await this.db.transaction(async (trx) => {
      await trx('grade_subjects').where({ grade_level_id: gradeLevelId }).delete();
      if (data.subjects.length) {
        await trx('grade_subjects').insert(data.subjects.map((item) => ({
          id: randomUUID(), grade_level_id: gradeLevelId, subject_id: item.subjectId,
          stream: item.stream, weekly_periods: item.weeklyPeriods, is_required: item.isRequired ?? true
        })));
      }
      const after = await trx('grade_subjects as gs')
        .join('subjects as s', 's.id', 'gs.subject_id')
        .where('gs.grade_level_id', gradeLevelId)
        .orderBy('gs.stream').orderBy('s.name_en')
        .select('gs.id', 'gs.grade_level_id as gradeLevelId', 'gs.subject_id as subjectId',
          'gs.stream', 'gs.weekly_periods as weeklyPeriods', 'gs.is_required as isRequired',
          's.campus_id as campusId', 's.code', 's.name_en as nameEn', 's.name_am as nameAm');
      await trx('audit_log').insert(auditRow(actor, 'grade_subjects.replaced', 'grade_level', gradeLevelId, before, after));
    });
    return this.listGradeSubjects(actor.activeCampusId, gradeLevelId);
  }
  async createSubject(data, actor) {
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('subjects').insert({
          id, campus_id: actor.activeCampusId, code: data.code,
          name_en: data.nameEn, name_am: data.nameAm, category: data.category ?? 'core'
        });
        await trx('audit_log').insert(auditRow(actor, 'subject.created', 'subject', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Subject code already exists at this campus.');
      throw error;
    }
    const subject = { id, campusId: actor.activeCampusId, ...data };
    return subject;
  }
  async createSection(data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const year = await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).forUpdate().first();
      const grade = await trx('grade_levels').where({
        id: data.gradeLevelId, campus_id: actor.activeCampusId
      }).first();
      if (!year || !grade) throw campusScopeError('Grade or active academic year is not available at this campus.');
      if (isUpperSecondaryGrade(grade.code) !== Boolean(data.stream)) {
        throw setupConflict(isUpperSecondaryGrade(grade.code)
          ? 'Choose a Natural Science or Social Science stream for this grade.'
          : 'Streams are only available for Grades 11 and 12.');
      }
      try {
        await trx('sections').insert({
          id, campus_id: actor.activeCampusId, academic_year_id: year.id,
          grade_level_id: grade.id, name: data.name, capacity: data.capacity ?? null,
          shift: data.shift ?? 'morning', stream: data.stream ?? null
        });
        await trx('audit_log').insert(auditRow(actor, 'section.created', 'section', id, null, data));
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Section name already exists in the active academic year.');
        throw error;
      }
      return {
        id, campusId: actor.activeCampusId, academicYearId: year.id, gradeLevelId: grade.id,
        gradeName: grade.name_en, name: data.name, capacity: data.capacity ?? null,
        shift: data.shift ?? 'morning', stream: data.stream ?? null
      };
    });
  }
  async updateSectionCapacity(sectionId, { capacity }, actor) {
    return this.db.transaction(async (trx) => {
      const section = await trx('sections').where({
        id: sectionId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!section) return null;
      const count = await trx('enrolments').where({
        section_id: sectionId, academic_year_id: section.academic_year_id, status: 'active'
      }).count({ total: '*' }).first();
      if (capacity != null && capacity < Number(count.total)) {
        throw setupConflict('Capacity cannot be lower than the number of active enrolments.');
      }
      const before = { capacity: section.capacity == null ? null : Number(section.capacity) };
      await trx('sections').where({ id: sectionId, campus_id: actor.activeCampusId }).update({ capacity });
      await trx('audit_log').insert(auditRow(actor, 'section.capacity_updated', 'section', sectionId, before, { capacity }));
      return {
        id: section.id, campusId: section.campus_id, academicYearId: section.academic_year_id,
        gradeLevelId: section.grade_level_id, name: section.name, capacity
      };
    });
  }
  async createStudent(data, actor) {
    const id = randomUUID();
    const placement = await this.db('sections as s')
      .join('academic_years as y', 'y.id', 's.academic_year_id')
      .where({
        's.campus_id': actor.activeCampusId, 's.name': data.sectionName,
        'y.status': 'active'
      })
      .select('s.id as section_id', 's.academic_year_id')
      .first();
    if (!placement) {
      const error = new Error('Section is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    try {
      const credentials = await this.db.transaction(async (trx) => {
        await this.assertStudentCapacity(actor.orgId, 1, trx);
        const generated = await generateStudentCredentials(data, async (username) =>
          Boolean(await trx('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first('id')));
        const userId = randomUUID();
        await trx('users').insert({
          id: userId, organization_id: actor.orgId, name: studentName(data),
          username: generated.username, password_hash: generated.passwordHash,
          role: 'student', must_change_password: true, is_active: true
        });
        await trx('user_campuses').insert({
          user_id: userId, campus_id: actor.activeCampusId, is_active: true
        });
        await trx('students').insert({
          id, campus_id: actor.activeCampusId, student_no: data.studentNo,
          user_id: userId, status: 'enrolled',
          given_name_am: data.givenNameAm, father_name_am: data.fatherNameAm,
          grandfather_name_am: data.grandfatherNameAm, given_name_en: data.givenNameEn,
          father_name_en: data.fatherNameEn, grandfather_name_en: data.grandfatherNameEn,
          gender: data.gender, date_of_birth: data.dateOfBirth ?? null,
          guardian_phone: data.guardianPhone ?? null, previous_school: data.previousSchool ?? null,
          section_name: data.sectionName ?? null
        });
        await trx('enrolments').insert({
          id: randomUUID(), student_id: id, academic_year_id: placement.academic_year_id,
          section_id: placement.section_id, status: 'active', enrolled_on: new Date()
        });
        await trx('audit_log').insert(auditRow(actor, 'student.created', 'student', id, null,
          { studentNo: data.studentNo, sectionName: data.sectionName, fields: Object.keys(data) }));
        await trx('audit_log').insert(auditRow(actor, 'student.account_created', 'user', userId, null, {
          studentId: id, username: generated.username
        }));
        return {
          username: generated.username, temporaryPassword: generated.temporaryPassword,
          studentName: generated.studentName
        };
      });
      return {
        student: { id, ...data, campusId: actor.activeCampusId, status: 'enrolled', hasPortalAccount: true },
        credentials
      };
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' && /student_no/i.test(error.message ?? '')) {
        error.code = 'STUDENT_NO_CONFLICT';
        error.message = 'Student number is already in use at this campus.';
      }
      throw error;
    }
    return { id, ...data, campusId: actor.activeCampusId, status: 'enrolled' };
  }
  async previewStudentImport(rows, actor) {
    const [sections, studentRows] = await Promise.all([
      this.db('sections as s')
        .join('academic_years as y', 'y.id', 's.academic_year_id')
        .where({ 's.campus_id': actor.activeCampusId, 'y.status': 'active' })
        .select('s.id', 's.name'),
      this.db('students').where({ campus_id: actor.activeCampusId })
        .whereNull('archived_at').select('*')
    ]);
    return studentImportReports(rows, sections, studentRows.map(mapStudent));
  }
  async importStudents(rows, actor) {
    try {
      return await this.db.transaction(async (trx) => {
        const [sections, studentRows] = await Promise.all([
          trx('sections as s')
            .join('academic_years as y', 'y.id', 's.academic_year_id')
            .where({ 's.campus_id': actor.activeCampusId, 'y.status': 'active' })
            .select('s.id', 's.name', 's.academic_year_id'),
          trx('students').where({ campus_id: actor.activeCampusId })
            .whereNull('archived_at').forUpdate().select('*')
        ]);
        const reports = studentImportReports(rows, sections, studentRows.map(mapStudent));
        const eligibleRows = rows.filter((row) =>
          reports.find((report) => report.rowNumber === row.rowNumber)?.eligible);
        await this.assertStudentCapacity(actor.orgId, eligibleRows.length, trx);
        const sectionByName = new Map(sections.map((section) => [
          normalizeImportValue(section.name), section
        ]));
        const generatedRows = await Promise.all(eligibleRows.map(async ({ rowNumber, data }) => ({
          rowNumber, data, generated: await generateStudentCredentials(data, async (username) =>
            Boolean(await trx('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first('id')))
        })));
        const credentials = [];
        for (const { rowNumber, data, generated } of generatedRows) {
          const section = sectionByName.get(normalizeImportValue(data.sectionName));
          const id = randomUUID();
          const userId = randomUUID();
          await trx('users').insert({
            id: userId, organization_id: actor.orgId, name: studentName(data),
            username: generated.username, password_hash: generated.passwordHash,
            role: 'student', must_change_password: true, is_active: true
          });
          await trx('user_campuses').insert({
            user_id: userId, campus_id: actor.activeCampusId, is_active: true
          });
          await trx('students').insert({
            id, campus_id: actor.activeCampusId, student_no: data.studentNo,
            user_id: userId, status: 'enrolled',
            given_name_am: data.givenNameAm, father_name_am: data.fatherNameAm,
            grandfather_name_am: data.grandfatherNameAm, given_name_en: data.givenNameEn,
            father_name_en: data.fatherNameEn, grandfather_name_en: data.grandfatherNameEn,
            gender: data.gender, date_of_birth: data.dateOfBirth ?? null,
            guardian_phone: data.guardianPhone ?? null, previous_school: data.previousSchool ?? null,
            section_name: data.sectionName
          });
          await trx('enrolments').insert({
            id: randomUUID(), student_id: id, academic_year_id: section.academic_year_id,
            section_id: section.id, status: 'active', enrolled_on: addisDate()
          });
          await trx('audit_log').insert(auditRow(actor, 'student.created', 'student', id, null, {
            studentNo: data.studentNo, sectionName: data.sectionName, fields: Object.keys(data)
          }));
          await trx('audit_log').insert(auditRow(actor, 'student.account_created', 'user', userId, null, {
            studentId: id, username: generated.username
          }));
          credentials.push({
            rowNumber, studentNo: data.studentNo, studentName: generated.studentName,
            username: generated.username, temporaryPassword: generated.temporaryPassword
          });
        }
        return { reports, createdCount: credentials.length, credentials };
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' && /student_no/i.test(error.message ?? '')) {
        error.code = 'STUDENT_NO_CONFLICT';
        error.message = 'Student number is already in use at this campus; no import rows were saved.';
      }
      throw error;
    }
  }
  async hasStudents(campusId, ids) {
    const rows = await this.db('students').where({ campus_id: campusId }).whereIn('id', ids).count({ total: '*' }).first();
    return Number(rows.total) === ids.length;
  }
  async hasStudentsInSections(campusId, sectionIds, ids) {
    const rows = await this.db('enrolments as e')
      .join('students as st', 'st.id', 'e.student_id')
      .where({ 'st.campus_id': campusId, 'e.status': 'active' })
      .whereIn('e.section_id', sectionIds)
      .whereIn('st.id', ids)
      .countDistinct({ total: 'st.id' }).first();
    return Number(rows.total) === ids.length;
  }
  async listStudentsFor(actor) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible === null) return (await this.listStudents(actor.activeCampusId)).map((student) => studentForActor(student, actor));
    if (accessible.size === 0) return [];
    const rows = await this.db('students as st')
      .join('enrolments as e', 'e.student_id', 'st.id')
      .join('sections as s', 's.id', 'e.section_id')
      .join('academic_years as y', 'y.id', 'e.academic_year_id')
      .where({ 'st.campus_id': actor.activeCampusId, 'e.status': 'active' })
      .where({ 'y.status': 'active' })
      .whereNull('st.archived_at')
      .whereIn('e.section_id', [...accessible])
      .select('st.*', 's.id as section_id', 's.grade_level_id', 's.stream')
      .distinct().orderBy('st.created_at', 'desc').limit(250);
    return rows.map(mapStudent).map((student) => studentForActor(student, actor));
  }
  async updateStudentProfile(studentId, data, actor) {
    const fields = {
      givenNameAm: 'given_name_am', fatherNameAm: 'father_name_am', grandfatherNameAm: 'grandfather_name_am',
      givenNameEn: 'given_name_en', fatherNameEn: 'father_name_en', grandfatherNameEn: 'grandfather_name_en',
      gender: 'gender', dateOfBirth: 'date_of_birth', guardianPhone: 'guardian_phone',
      previousSchool: 'previous_school'
    };
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first();
      if (!student) return null;
      const updates = Object.fromEntries(Object.entries(data).map(([key, value]) => [fields[key], value]));
      await trx('students').where({ id: studentId, campus_id: actor.activeCampusId }).update(updates);
      await trx('audit_log').insert(auditRow(actor, 'student.profile_updated', 'student', studentId,
        null, { fields: Object.keys(data) }));
      return mapStudent({ ...student, ...updates });
    });
  }
  async getStudentSensitiveData(studentId, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at')
        .select('id_number_enc', 'health_notes_enc', 'special_needs_enc', 'allergies_enc').first();
      if (!student) return null;
      const data = {
        idNumber: decryptSensitiveValue(student.id_number_enc, this.sensitiveDataKey),
        healthNotes: decryptSensitiveValue(student.health_notes_enc, this.sensitiveDataKey),
        specialNeeds: decryptSensitiveValue(student.special_needs_enc, this.sensitiveDataKey),
        allergies: decryptSensitiveValue(student.allergies_enc, this.sensitiveDataKey)
      };
      await trx('audit_log').insert(auditRow(actor, 'student.sensitive_data_viewed', 'student', studentId, null, {
        fields: Object.keys(data)
      }));
      return data;
    });
  }
  async updateStudentSensitiveData(studentId, data, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').select('id').first();
      if (!student) return null;
      const updates = {};
      if (Object.hasOwn(data, 'idNumber')) {
        updates.id_number_enc = encryptSensitiveValue(data.idNumber, this.sensitiveDataKey);
        updates.id_number_hash = hashSensitiveIdentifier(data.idNumber, this.sensitiveDataKey);
      }
      if (Object.hasOwn(data, 'healthNotes')) {
        updates.health_notes_enc = encryptSensitiveValue(data.healthNotes, this.sensitiveDataKey);
      }
      if (Object.hasOwn(data, 'specialNeeds')) {
        updates.special_needs_enc = encryptSensitiveValue(data.specialNeeds, this.sensitiveDataKey);
      }
      if (Object.hasOwn(data, 'allergies')) {
        updates.allergies_enc = encryptSensitiveValue(data.allergies, this.sensitiveDataKey);
      }
      await trx('students').where({ id: studentId, campus_id: actor.activeCampusId }).update(updates);
      await trx('audit_log').insert(auditRow(actor, 'student.sensitive_data_updated', 'student', studentId, null, {
        fields: Object.keys(data)
      }));
      const row = await trx('students').where({ id: studentId, campus_id: actor.activeCampusId })
        .select('id_number_enc', 'health_notes_enc', 'special_needs_enc', 'allergies_enc').first();
      return {
        idNumber: decryptSensitiveValue(row.id_number_enc, this.sensitiveDataKey),
        healthNotes: decryptSensitiveValue(row.health_notes_enc, this.sensitiveDataKey),
        specialNeeds: decryptSensitiveValue(row.special_needs_enc, this.sensitiveDataKey),
        allergies: decryptSensitiveValue(row.allergies_enc, this.sensitiveDataKey)
      };
    });
  }
  async listStudentEmergencyContacts(studentId, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return null;
      const rows = await trx('student_emergency_contacts').where({
        student_id: studentId, campus_id: actor.activeCampusId
      }).orderBy('priority').orderBy('created_at');
      await trx('audit_log').insert(auditRow(actor, 'student.emergency_contacts_viewed',
        'student', studentId, null, { count: rows.length }));
      return rows.map((row) => ({
        id: row.id, studentId, name: decryptSensitiveValue(row.contact_name_enc, this.sensitiveDataKey),
        phone: decryptSensitiveValue(row.phone_enc, this.sensitiveDataKey),
        relationship: row.relationship, priority: row.priority, createdAt: row.created_at
      }));
    });
  }
  async addStudentEmergencyContact(studentId, data, actor) {
    const id = randomUUID();
    const contactNameEnc = encryptSensitiveValue(data.name, this.sensitiveDataKey);
    const phoneEnc = encryptSensitiveValue(data.phone, this.sensitiveDataKey);
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return null;
      await trx('student_emergency_contacts').insert({
        id, campus_id: actor.activeCampusId, student_id: studentId,
        contact_name_enc: contactNameEnc, phone_enc: phoneEnc,
        relationship: data.relationship, priority: data.priority, created_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'student.emergency_contact_added',
        'student_emergency_contact', id, null, {
          studentId, fields: ['name', 'phone', 'relationship', 'priority'], priority: data.priority
        }));
      const row = await trx('student_emergency_contacts').where({ id }).first();
      return {
        id, studentId, name: decryptSensitiveValue(row.contact_name_enc, this.sensitiveDataKey),
        phone: decryptSensitiveValue(row.phone_enc, this.sensitiveDataKey),
        relationship: row.relationship, priority: row.priority, createdAt: row.created_at
      };
    });
  }
  async removeStudentEmergencyContact(studentId, contactId, actor) {
    return this.db.transaction(async (trx) => {
      const contact = await trx('student_emergency_contacts').where({
        id: contactId, student_id: studentId, campus_id: actor.activeCampusId
      }).first('id');
      if (!contact) return false;
      await trx('student_emergency_contacts').where({ id: contactId }).delete();
      await trx('audit_log').insert(auditRow(actor, 'student.emergency_contact_removed',
        'student_emergency_contact', contactId, null, { studentId }));
      return true;
    });
  }
  async listStudentGuardians(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const rows = await this.db('student_guardians as sg')
      .join('guardians as g', 'g.id', 'sg.guardian_id')
      .where({ 'sg.student_id': studentId, 'g.organization_id': actor.orgId })
      .select(
        'g.id', 'g.given_name_am', 'g.father_name_am', 'g.grandfather_name_am',
        'g.given_name_en', 'g.father_name_en', 'g.grandfather_name_en',
        'g.phone', 'g.email', 'g.user_id', 'sg.relationship', 'sg.is_primary', 'sg.is_verified',
        'sg.can_view_results', 'sg.can_view_fees'
      );
    return rows.map(mapStudentGuardian);
  }
  async listStudentCommendations(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const rows = await this.db('student_commendations').where({
      student_id: studentId, campus_id: actor.activeCampusId
    }).orderBy('recorded_on', 'desc').orderBy('created_at', 'desc');
    return rows.map(mapStudentCommendation);
  }
  async createStudentCommendation(studentId, data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return null;
      await trx('student_commendations').insert({
        id, campus_id: actor.activeCampusId, student_id: studentId,
        recorded_on: data.recordedOn, title_en: data.titleEn, title_am: data.titleAm,
        description_en: data.descriptionEn, description_am: data.descriptionAm,
        created_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'student.commendation.created',
        'student_commendation', id, null, {
          studentId, recordedOn: data.recordedOn, titleEn: data.titleEn, titleAm: data.titleAm
        }));
      return mapStudentCommendation(await trx('student_commendations').where({ id }).first());
    });
  }
  async addStudentGuardian(studentId, data, actor) {
    const guardianId = randomUUID();
    await this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').forUpdate().first('id');
      if (!student) {
        const error = new Error('Student is outside the active campus.');
        error.code = 'CAMPUS_SCOPE_VIOLATION';
        throw error;
      }
      if (data.isPrimary) {
        await trx('student_guardians').where({ student_id: studentId }).update({ is_primary: false });
      }
      await trx('guardians').insert({
        id: guardianId, organization_id: actor.orgId,
        given_name_am: data.givenNameAm, father_name_am: data.fatherNameAm,
        grandfather_name_am: data.grandfatherNameAm, given_name_en: data.givenNameEn,
        father_name_en: data.fatherNameEn, grandfather_name_en: data.grandfatherNameEn,
        phone: data.phone, email: data.email ?? null
      });
      await trx('student_guardians').insert({
        student_id: studentId, guardian_id: guardianId, relationship: data.relationship,
        is_primary: data.isPrimary, is_verified: false, can_view_results: false, can_view_fees: false
      });
      await trx('audit_log').insert(auditRow(actor, 'student.guardian_linked', 'student', studentId,
        null, { guardianId, relationship: data.relationship, isPrimary: data.isPrimary }));
    });
    return {
      id: guardianId, ...data, email: data.email ?? null, isVerified: false,
      canViewResults: false, canViewFees: false
    };
  }
  async removeStudentGuardian(studentId, guardianId, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return false;
      const link = await trx('student_guardians as sg')
        .join('guardians as g', 'g.id', 'sg.guardian_id')
        .where({
          'sg.student_id': studentId, 'sg.guardian_id': guardianId,
          'g.organization_id': actor.orgId
        }).first('sg.relationship');
      if (!link) return false;
      await trx('student_guardians').where({ student_id: studentId, guardian_id: guardianId }).delete();
      await trx('audit_log').insert(auditRow(actor, 'student.guardian_unlinked', 'student', studentId,
        null, { guardianId, relationship: link.relationship }));
      return true;
    });
  }
  async listRoster(actor, sectionId) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !accessible.has(sectionId)) throw campusScopeError('Section is not accessible.');
    const section = await this.db('sections as s')
      .join('academic_years as y', 'y.id', 's.academic_year_id')
      .where({ 's.id': sectionId, 's.campus_id': actor.activeCampusId, 'y.status': 'active' })
      .first('s.id');
    if (!section) throw campusScopeError('Section is not accessible.');
    const rows = await this.db('enrolments as e')
      .join('students as st', 'st.id', 'e.student_id')
      .where({
        'st.campus_id': actor.activeCampusId, 'e.section_id': sectionId, 'e.status': 'active'
      }).whereNull('st.archived_at').select('st.*').orderBy('st.given_name_en').limit(500);
    return rows.map(mapStudent);
  }
  async listStudentsFor(actor) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible === null) return (await this.listStudents(actor.activeCampusId)).map((student) => studentForActor(student, actor));
    if (accessible.size === 0) return [];
    const query = this.db('students as st')
      .join('enrolments as e', 'e.student_id', 'st.id')
      .where({ 'st.campus_id': actor.activeCampusId, 'e.status': 'active' })
      .whereNull('st.archived_at')
      .whereIn('e.section_id', [...accessible])
      .select('st.*').distinct().orderBy('st.created_at', 'desc').limit(250);
    return (await query).map(mapStudent).map((student) => studentForActor(student, actor));
  }
  async saveAttendance(data, actor) {
    const prior = await this.db('attendance_sessions').where({
      campus_id: actor.activeCampusId, client_uuid: data.clientUuid
    }).first();
    if (prior) return { id: prior.id, duplicate: true };
    if (!await this.hasSection(actor.activeCampusId, data.sectionId)) {
      const error = new Error('Section is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const accessibleSections = await this.accessibleSectionIds(actor);
    if (accessibleSections && !accessibleSections.has(data.sectionId)) {
      throw campusScopeError('Teacher is not assigned to this section.');
    }
    if (!await this.hasStudentsInSection(actor.activeCampusId, data.sectionId, data.records.map((r) => r.studentId))) {
      const error = new Error('Attendance includes a student outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('attendance_sessions').insert({
          id, campus_id: actor.activeCampusId, section_id: data.sectionId,
          attendance_date: data.date, taken_by: actor.sub, client_uuid: data.clientUuid
        });
        for (const record of data.records) {
          await trx('attendance_records').insert({
            session_id: id, student_id: record.studentId, status: record.status
          });
        }
        await trx('audit_log').insert(auditRow(actor, 'attendance.recorded', 'attendance_session', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        const concurrent = await this.db('attendance_sessions').where({
          campus_id: actor.activeCampusId, client_uuid: data.clientUuid
        }).first();
        if (concurrent) return { id: concurrent.id, duplicate: true };
      }
      throw error;
    }
    return { id, ...data };
  }
  async listAttendance(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    if (accessible && accessible.size === 0) return [];
    const query = this.db('attendance_sessions').where({ campus_id: campusId });
    if (accessible) query.whereIn('section_id', [...accessible]);
    const rows = await query
      .orderBy('attendance_date', 'desc').limit(100);
    return rows.map((r) => ({ id: r.id, date: String(r.attendance_date).slice(0, 10), sectionId: r.section_id, clientUuid: r.client_uuid }));
  }
  async getAttendanceSession(sessionId, actor) {
    const session = await this.db('attendance_sessions').where({
      id: sessionId, campus_id: actor.activeCampusId
    }).first('id', 'attendance_date', 'section_id');
    if (!session) return null;
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !accessible.has(session.section_id)) {
      throw campusScopeError('Attendance session is outside the assigned sections.');
    }
    const records = await this.db('attendance_records as r')
      .join('students as st', 'st.id', 'r.student_id')
      .where({ 'r.session_id': sessionId, 'st.campus_id': actor.activeCampusId })
      .select('r.student_id', 'r.status', 'r.reason', 'st.given_name_en',
        'st.father_name_en', 'st.grandfather_name_en')
      .orderBy('st.given_name_en').orderBy('st.father_name_en');
    return {
      id: session.id, date: String(session.attendance_date).slice(0, 10),
      sectionId: session.section_id,
      records: records.map((record) => ({
        studentId: record.student_id,
        studentName: studentName({
          givenNameEn: record.given_name_en,
          fatherNameEn: record.father_name_en,
          grandfatherNameEn: record.grandfather_name_en
        }),
        status: record.status, reason: record.reason ?? ''
      }))
    };
  }
  async correctAttendance(sessionId, studentId, correction, actor) {
    const accessible = await this.accessibleSectionIds(actor);
    let updated = false;
    let correctionRequest = null;
    await this.db.transaction(async (trx) => {
      const session = await trx('attendance_sessions').where({
        id: sessionId, campus_id: actor.activeCampusId
      }).forUpdate().first('id', 'attendance_date', 'section_id');
      if (!session) return;
      if (accessible && !accessible.has(session.section_id)) {
        throw campusScopeError('Attendance session is outside the assigned sections.');
      }
      const record = await trx('attendance_records as r')
        .join('students as st', 'st.id', 'r.student_id')
        .where({
          'r.session_id': sessionId, 'r.student_id': studentId,
          'st.campus_id': actor.activeCampusId
        }).forUpdate().first('r.status', 'r.reason');
      if (!record) return;
      if (record.status === correction.status) {
        const error = new Error('Choose a different attendance status to make a correction.');
        error.status = 409;
        error.code = 'ATTENDANCE_CORRECTION_NO_CHANGE';
        throw error;
      }
      const attendanceDate = String(session.attendance_date).slice(0, 10);
      if (!attendanceCorrectionWindowOpen(attendanceDate)) {
        const existing = await trx('attendance_correction_requests').where({
          campus_id: actor.activeCampusId, session_id: sessionId,
          student_id: studentId, status: 'pending'
        }).forUpdate().first('id');
        if (existing) {
          throw attendanceCorrectionConflict('A correction request is already pending for this attendance record.');
        }
        const request = {
          id: randomUUID(), campus_id: actor.activeCampusId, session_id: sessionId,
          student_id: studentId, original_status: record.status,
          requested_status: correction.status, reason: correction.reason,
          requested_by: actor.sub, status: 'pending'
        };
        await trx('attendance_correction_requests').insert(request);
        await trx('audit_log').insert(auditRow(
          actor, 'attendance.correction_requested', 'attendance_correction_request',
          request.id, null, {
            sessionId, studentId, attendanceDate, originalStatus: record.status,
            requestedStatus: correction.status, reason: correction.reason
          }
        ));
        correctionRequest = {
          id: request.id, campusId: request.campus_id, sessionId: request.session_id,
          studentId: request.student_id, attendanceDate, originalStatus: request.original_status,
          requestedStatus: request.requested_status, reason: request.reason,
          requestedBy: request.requested_by, status: request.status,
          requestedAt: null, reviewedBy: null, reviewNote: null, reviewedAt: null
        };
        return;
      }
      await trx('attendance_records').where({
        session_id: sessionId, student_id: studentId
      }).update({ status: correction.status, reason: correction.reason });
      await trx('audit_log').insert(auditRow(
        actor, 'attendance.corrected', 'attendance_record', sessionId,
        { status: record.status, reason: record.reason ?? '' },
        { status: correction.status, reason: correction.reason }
      ));
      updated = true;
    });
    if (correctionRequest) {
      return { approvalRequired: true, request: correctionRequest };
    }
    return updated ? this.getAttendanceSession(sessionId, actor) : null;
  }
  async listAttendanceCorrectionRequests(actor) {
    const rows = await this.db('attendance_correction_requests as cr')
      .join('students as st', 'st.id', 'cr.student_id')
      .join('attendance_sessions as ats', 'ats.id', 'cr.session_id')
      .where({
        'cr.campus_id': actor.activeCampusId, 'cr.status': 'pending',
        'st.campus_id': actor.activeCampusId
      }).whereNull('st.archived_at')
      .select(
        'cr.id', 'cr.campus_id', 'cr.session_id', 'cr.student_id',
        'cr.original_status', 'cr.requested_status', 'cr.reason',
        'cr.requested_by', 'cr.status', 'cr.created_at', 'ats.attendance_date',
        'st.given_name_en', 'st.father_name_en', 'st.grandfather_name_en'
      ).orderBy('cr.created_at').limit(200);
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, sessionId: row.session_id,
      studentId: row.student_id, originalStatus: row.original_status,
      requestedStatus: row.requested_status, reason: row.reason,
      requestedBy: row.requested_by, status: row.status,
      attendanceDate: String(row.attendance_date).slice(0, 10),
      requestedAt: row.created_at, studentName: studentName({
        givenNameEn: row.given_name_en, fatherNameEn: row.father_name_en,
        grandfatherNameEn: row.grandfather_name_en
      })
    }));
  }
  async reviewAttendanceCorrection(requestId, review, actor) {
    let reviewed = null;
    await this.db.transaction(async (trx) => {
      const requestRef = await trx('attendance_correction_requests').where({
        id: requestId, campus_id: actor.activeCampusId
      }).first('id', 'session_id');
      if (!requestRef) return;
      const session = await trx('attendance_sessions').where({
        id: requestRef.session_id, campus_id: actor.activeCampusId
      }).forUpdate().first('id');
      if (!session) return;
      const request = await trx('attendance_correction_requests').where({
        id: requestId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!request) return;
      if (request.status !== 'pending') {
        throw attendanceCorrectionConflict('Only pending attendance correction requests can be reviewed.');
      }
      if (request.requested_by === actor.sub) {
        throw attendanceCorrectionConflict('A correction requester cannot approve or reject their own request.');
      }
      const record = await trx('attendance_records').where({
        session_id: request.session_id, student_id: request.student_id
      }).forUpdate().first('status', 'reason');
      if (!record) return;
      if (review.decision === 'approved' && record.status !== request.original_status) {
        throw attendanceCorrectionConflict('Attendance changed after this correction was requested; review the current record.');
      }
      if (review.decision === 'approved') {
        await trx('attendance_records').where({
          session_id: request.session_id, student_id: request.student_id
        }).update({ status: request.requested_status, reason: request.reason });
        await trx('audit_log').insert(auditRow(
          actor, 'attendance.corrected', 'attendance_record',
          request.session_id,
          { status: record.status, reason: record.reason ?? '' },
          { status: request.requested_status, reason: request.reason,
            correctionRequestId: request.id }
        ));
      }
      await trx('attendance_correction_requests').where({ id: request.id }).update({
        status: review.decision, reviewed_by: actor.sub,
        review_note: review.note, reviewed_at: trx.fn.now(), updated_at: trx.fn.now()
      });
      await trx('audit_log').insert(auditRow(
        actor, `attendance.correction_${review.decision}`, 'attendance_correction_request',
        request.id, { status: request.status }, {
          status: review.decision, reviewedBy: actor.sub, reviewNote: review.note
        }
      ));
      reviewed = {
        id: request.id, campusId: request.campus_id, sessionId: request.session_id,
        studentId: request.student_id, originalStatus: request.original_status,
        requestedStatus: request.requested_status, reason: request.reason,
        requestedBy: request.requested_by, status: review.decision,
        reviewedBy: actor.sub, reviewNote: review.note
      };
    });
    return reviewed;
  }
  async getAttendanceSummary(campusId, from, to, actor) {
    const accessible = await this.accessibleSectionIds(actor);
    const query = this.db('attendance_sessions as s')
      .join('attendance_records as r', 'r.session_id', 's.id')
      .join('sections as c', 'c.id', 's.section_id')
      .where({ 's.campus_id': campusId })
      .whereBetween('s.attendance_date', [from, to])
      .select(
        's.id as session_id', 's.attendance_date as date', 's.section_id',
        'c.name as section_name', 'r.status'
      );
    if (accessible) {
      if (!accessible.size) return buildAttendanceSummary([], from, to);
      query.whereIn('s.section_id', [...accessible]);
    }
    const rows = await query.orderBy('s.attendance_date').orderBy('c.name');
    return buildAttendanceSummary(rows.map((row) => ({
      sessionId: row.session_id, date: String(row.date).slice(0, 10),
      sectionId: row.section_id, sectionName: row.section_name, status: row.status
    })), from, to);
  }
  async saveMark(data, actor) {
    if (!await this.hasStudents(actor.activeCampusId, [data.studentId])) {
      const error = new Error('Student is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [data.studentId])) {
      throw campusScopeError('Teacher is not assigned to this student’s section.');
    }
    if ((data.termId && !await this.db('terms as t')
      .join('academic_years as y', 'y.id', 't.academic_year_id')
      .where({ 't.id': data.termId, 'y.campus_id': actor.activeCampusId }).first('t.id')) ||
      (data.subjectId && !await this.db('subjects')
        .where({ id: data.subjectId, campus_id: actor.activeCampusId }).first('id'))) {
      throw campusScopeError('Term or subject is not available at this campus.');
    }
    if (data.subjectId) {
      const placement = await this.db('enrolments as e')
        .join('sections as s', 's.id', 'e.section_id')
        .join('academic_years as y', 'y.id', 'e.academic_year_id')
        .where({
          'e.student_id': data.studentId, 'e.status': 'active',
          'y.status': 'active', 's.campus_id': actor.activeCampusId
        }).first('s.grade_level_id', 's.stream');
      if (placement) {
        const gradeSubject = await this.db('grade_subjects').where({
          grade_level_id: placement.grade_level_id, subject_id: data.subjectId
        }).whereIn('stream', ['all', placement.stream ?? 'all']).first('id');
        if (!gradeSubject) throw setupConflict('This subject is not included in the student’s grade and stream.');
      }
    }
    if (Boolean(data.termId) !== Boolean(data.subjectId)) {
      const error = new Error('Select both a term and subject for report-card marks.');
      error.status = 400;
      error.code = 'MARK_CONTEXT_REQUIRED';
      throw error;
    }
    const prior = await this.db('marks').where({
      campus_id: actor.activeCampusId, client_uuid: data.clientUuid
    }).first();
    if (prior) return { id: prior.id, duplicate: true };
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('marks').insert({
          id, campus_id: actor.activeCampusId, student_id: data.studentId,
          assessment_name: data.assessmentName, max_value: data.maxValue,
          value: data.value, term_id: data.termId ?? null, subject_id: data.subjectId ?? null,
          entered_by: actor.sub, client_uuid: data.clientUuid
        });
        await trx('audit_log').insert(auditRow(actor, 'mark.created', 'mark', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        const concurrent = await this.db('marks').where({
          campus_id: actor.activeCampusId, client_uuid: data.clientUuid
        }).first();
        if (concurrent) return { id: concurrent.id, duplicate: true };
      }
      throw error;
    }
    return { id, ...data, state: 'draft' };
  }
  async transitionMark(markId, targetState, actor) {
    const accessible = await this.accessibleSectionIds(actor);
    let updated;
    await this.db.transaction(async (trx) => {
      const query = trx('marks').where({
        id: markId, campus_id: actor.activeCampusId
      }).forUpdate();
      const row = await query.first();
      if (!row) return;
      if (accessible && (accessible.size === 0 ||
        !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [row.student_id]))) {
        throw campusScopeError('Mark is outside the assigned sections.');
      }
      assertMarkTransition(row.state, targetState, row.entered_by, actor, row.approved_by);
      const update = { state: targetState, updated_at: trx.fn.now() };
      if (targetState === 'approved') update.approved_by = actor.sub;
      if (targetState === 'locked') update.published_by = actor.sub;
      await trx('marks').where({ id: markId, campus_id: actor.activeCampusId }).update(update);
      await trx('audit_log').insert(auditRow(
        actor, `mark.${targetState}`, 'mark', markId,
        { state: row.state }, { state: targetState }
      ));
      updated = {
        id: row.id, studentId: row.student_id, assessmentName: row.assessment_name,
        maxValue: Number(row.max_value), value: Number(row.value), state: targetState,
        termId: row.term_id, subjectId: row.subject_id, enteredBy: row.entered_by,
        approvedBy: targetState === 'approved' ? actor.sub : row.approved_by,
        publishedBy: targetState === 'locked' ? actor.sub : row.published_by
      };
    });
    return updated ?? null;
  }
  async amendPublishedMark(markId, amendment, actor) {
    const accessible = await this.accessibleSectionIds(actor);
    let updated = null;
    await this.db.transaction(async (trx) => {
      const row = await trx('marks').where({
        id: markId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return;
      if (accessible && (accessible.size === 0 ||
        !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [row.student_id]))) {
        throw campusScopeError('Mark is outside the assigned sections.');
      }
      if (row.state !== 'locked') throw markAmendmentConflict('Only a published mark can be corrected.');
      if (Number(row.value) === amendment.value && Number(row.max_value) === amendment.maxValue) {
        throw markAmendmentConflict('Enter a changed score to create a correction.');
      }
      const before = {
        value: Number(row.value), maxValue: Number(row.max_value), state: row.state,
        approvedBy: row.approved_by ?? null, publishedBy: row.published_by ?? null
      };
      await trx('marks').where({ id: markId, campus_id: actor.activeCampusId }).update({
        value: amendment.value, max_value: amendment.maxValue, state: 'draft',
        approved_by: null, published_by: null, updated_at: trx.fn.now()
      });
      await trx('audit_log').insert(auditRow(
        actor, 'mark.amended', 'mark', markId, before, {
          value: amendment.value, maxValue: amendment.maxValue,
          state: 'draft', reason: amendment.reason
        }
      ));
      updated = {
        id: row.id, campusId: row.campus_id, studentId: row.student_id,
        assessmentName: row.assessment_name, value: amendment.value, maxValue: amendment.maxValue,
        state: 'draft', termId: row.term_id, subjectId: row.subject_id, enteredBy: row.entered_by,
        approvedBy: null, publishedBy: null
      };
    });
    return updated;
  }
  async listMarks(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    if (accessible && accessible.size === 0) return [];
    const query = this.db('marks').where({ campus_id: campusId });
    if (accessible) {
      query.whereIn('student_id', this.db('enrolments as e')
        .join('students as st', 'st.id', 'e.student_id')
        .whereIn('e.section_id', [...accessible])
        .where({ 'st.campus_id': campusId, 'e.status': 'active' })
        .select('e.student_id'));
    }
    const rows = await query.orderBy('created_at', 'desc').limit(250);
    return rows.map((r) => ({
      id: r.id, studentId: r.student_id, assessmentName: r.assessment_name,
      maxValue: Number(r.max_value), value: Number(r.value), state: r.state,
      termId: r.term_id, subjectId: r.subject_id, enteredBy: r.entered_by,
      approvedBy: r.approved_by ?? null, publishedBy: r.published_by ?? null
    }));
  }
  async getTermMarksSummary(termId, actor) {
    const term = await this.db('terms as t')
      .join('academic_years as y', 'y.id', 't.academic_year_id')
      .where({ 't.id': termId, 'y.campus_id': actor.activeCampusId })
      .first('t.id', 't.name');
    if (!term) throw campusScopeError('Term is not available at this campus.');
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && accessible.size === 0) {
      return buildTermMarksSummary({ id: term.id, name: term.name }, [], new Map());
    }
    const query = this.db('marks as m')
      .join('subjects as s', 's.id', 'm.subject_id')
      .where({
        'm.campus_id': actor.activeCampusId, 'm.term_id': termId,
        's.campus_id': actor.activeCampusId
      });
    if (accessible) {
      query.whereIn('m.student_id', this.db('enrolments as e')
        .join('students as st', 'st.id', 'e.student_id')
        .whereIn('e.section_id', [...accessible])
        .where({ 'st.campus_id': actor.activeCampusId, 'e.status': 'active' })
        .select('e.student_id'));
    }
    const aggregate = (source) => source
      .sum({ earned: 'm.value' }).sum({ possible: 'm.max_value' })
      .count({ assessmentCount: 'm.id' })
      .countDistinct({ students: 'm.student_id' });
    const totals = await aggregate(query.clone()).first();
    const rows = await aggregate(query.clone())
      .select('m.subject_id as subjectId', 's.name_en as subjectNameEn', 's.name_am as subjectNameAm')
      .groupBy('m.subject_id', 's.name_en', 's.name_am').orderBy('s.name_en');
    return {
      termId: term.id, termName: term.name, status: 'provisional',
      totals: termMarksMetric(totals),
      bySubject: rows.map((row) => ({
        subjectId: row.subjectId, subjectNameEn: row.subjectNameEn,
        subjectNameAm: row.subjectNameAm, ...termMarksMetric(row)
      }))
    };
  }
  async listGradingBands(campusId) {
    const rows = await this.db('grading_bands').where({ campus_id: campusId }).orderBy('min_percent');
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, code: row.code, nameEn: row.name_en,
      nameAm: row.name_am, minPercent: Number(row.min_percent)
    }));
  }
  async getGradingPolicy(campusId) {
    const row = await this.db('campus_academic_policies').where({ campus_id: campusId }).first();
    return row ? {
      campusId: row.campus_id, scoringMethod: row.scoring_method,
      confirmedBy: row.confirmed_by,
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null
    } : { campusId, scoringMethod: 'points_weighted', confirmedBy: null, confirmedAt: null };
  }
  async confirmGradingPolicy(data, actor) {
    const policy = {
      campus_id: actor.activeCampusId, scoring_method: data.scoringMethod,
      confirmed_by: actor.sub, confirmed_at: now(), updated_at: now()
    };
    await this.db.transaction(async (trx) => {
      await trx('campuses').where({ id: actor.activeCampusId }).forUpdate().first('id');
      const bands = await trx('grading_bands').where({ campus_id: actor.activeCampusId })
        .where({ min_percent: 0 }).first('id');
      if (!bands) {
        throw setupConflict('Configure a complete grading scale, including a 0% band, before confirming policy.');
      }
      const beforeRow = await trx('campus_academic_policies')
        .where({ campus_id: actor.activeCampusId }).first();
      const before = beforeRow ? {
        campusId: beforeRow.campus_id, scoringMethod: beforeRow.scoring_method,
        confirmedBy: beforeRow.confirmed_by,
        confirmedAt: beforeRow.confirmed_at ? new Date(beforeRow.confirmed_at).toISOString() : null
      } : { campusId: actor.activeCampusId, scoringMethod: 'points_weighted', confirmedBy: null, confirmedAt: null };
      await trx('campus_academic_policies').insert(policy)
        .onConflict('campus_id').merge({
          scoring_method: policy.scoring_method, confirmed_by: policy.confirmed_by,
          confirmed_at: policy.confirmed_at, updated_at: policy.updated_at
        });
      await trx('audit_log').insert(auditRow(
        actor, 'grading_policy.confirmed', 'grading_policy', actor.activeCampusId,
        before, {
          campusId: actor.activeCampusId, scoringMethod: data.scoringMethod,
          confirmedBy: actor.sub, confirmedAt: policy.confirmed_at
        }
      ));
    });
    return this.getGradingPolicy(actor.activeCampusId);
  }
  async replaceGradingBands(data, actor) {
    const before = await this.listGradingBands(actor.activeCampusId);
    const bands = data.bands.map((band) => ({
      id: randomUUID(), campus_id: actor.activeCampusId, code: band.code,
      name_en: band.nameEn, name_am: band.nameAm, min_percent: band.minPercent
    }));
    try {
      await this.db.transaction(async (trx) => {
        await trx('campuses').where({ id: actor.activeCampusId }).forUpdate().first('id');
        const policyRow = await trx('campus_academic_policies')
          .where({ campus_id: actor.activeCampusId }).first();
        const policyBefore = policyRow ? {
          campusId: policyRow.campus_id, scoringMethod: policyRow.scoring_method,
          confirmedBy: policyRow.confirmed_by,
          confirmedAt: policyRow.confirmed_at ? new Date(policyRow.confirmed_at).toISOString() : null
        } : { campusId: actor.activeCampusId, scoringMethod: 'points_weighted', confirmedBy: null, confirmedAt: null };
        await trx('grading_bands').where({ campus_id: actor.activeCampusId }).delete();
        if (bands.length) await trx('grading_bands').insert(bands);
        await trx('audit_log').insert(auditRow(
          actor, 'grading_bands.replaced', 'grading_scale', actor.activeCampusId, before, data.bands
        ));
        if (policyBefore.confirmedAt) {
          await trx('campus_academic_policies').where({ campus_id: actor.activeCampusId }).update({
            confirmed_by: null, confirmed_at: null, updated_at: trx.fn.now()
          });
          await trx('audit_log').insert(auditRow(
            actor, 'grading_policy.invalidated', 'grading_policy', actor.activeCampusId,
            policyBefore, { ...policyBefore, confirmedBy: null, confirmedAt: null }
          ));
        }
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw setupConflict('Grading band codes and minimum percentages must be unique.');
      }
      throw error;
    }
    return this.listGradingBands(actor.activeCampusId);
  }
  async getStudentReportCard(studentId, termId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) throw campusScopeError('Student is outside the active campus.');
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible) {
      const inScope = await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [studentId]);
      if (!inScope) throw campusScopeError('Teacher is not assigned to this student’s section.');
    }
    const term = await this.db('terms as t')
      .join('academic_years as y', 'y.id', 't.academic_year_id')
      .where({ 't.id': termId, 'y.campus_id': actor.activeCampusId })
      .first('t.id', 't.name');
    if (!term) throw campusScopeError('Term is not available at this campus.');
    const rows = await this.db('marks as m')
      .join('subjects as s', 's.id', 'm.subject_id')
      .where({
        'm.campus_id': actor.activeCampusId, 'm.student_id': studentId,
        'm.term_id': termId, 's.campus_id': actor.activeCampusId
      })
      .select(
        'm.id', 'm.subject_id', 's.name_en', 's.name_am',
        'm.assessment_name', 'm.value', 'm.max_value', 'm.state'
      );
    const grouped = new Map();
    const fingerprintRows = [];
    for (const row of rows) {
      fingerprintRows.push({
        id: row.id, assessmentName: row.assessment_name,
        value: Number(row.value), maxValue: Number(row.max_value), state: row.state
      });
      const current = grouped.get(row.subject_id) ?? {
        subjectId: row.subject_id, subjectNameEn: row.name_en, subjectNameAm: row.name_am,
        assessmentCount: 0, value: 0, maxValue: 0
      };
      current.assessmentCount += 1;
      current.value += Number(row.value);
      current.maxValue += Number(row.max_value);
      grouped.set(row.subject_id, current);
    }
    const bands = await this.listGradingBands(actor.activeCampusId);
    const policy = await this.getGradingPolicy(actor.activeCampusId);
    const subjects = [...grouped.values()].map((result) => {
      const value = roundScore(result.value);
      const maxValue = roundScore(result.maxValue);
      const percent = maxValue ? Math.round((value / maxValue) * 10000) / 100 : 0;
      return { ...result, value, maxValue, percent, band: bandForPercent(bands, percent) };
    });
    const totalValue = roundScore(subjects.reduce((total, result) => total + result.value, 0));
    const totalMaxValue = roundScore(subjects.reduce((total, result) => total + result.maxValue, 0));
    const overallPercent = !subjects.length ? 0
      : policy.scoringMethod === 'equal_subject_weighted'
        ? Math.round(subjects.reduce((total, result) => total + result.percent, 0) /
          subjects.length * 100) / 100
        : totalMaxValue ? Math.round((totalValue / totalMaxValue) * 10000) / 100 : 0;
    return {
      studentId, termId, termName: term.name, subjects, totalValue, totalMaxValue,
      overallPercent, overallBand: bandForPercent(bands, overallPercent), status: 'provisional',
      scoringMethod: policy.scoringMethod, gradingPolicyConfirmed: Boolean(policy.confirmedAt),
      gradingPolicyConfirmedAt: policy.confirmedAt,
      sourceMarkFingerprint: markFingerprint(fingerprintRows),
      workflow: await this.latestTermReport(studentId, termId, actor.activeCampusId)
    };
  }
  async latestTermReport(studentId, termId, campusId) {
    const row = await this.db('term_report_revisions').where({
      campus_id: campusId, student_id: studentId, term_id: termId
    }).orderBy('revision', 'desc').first();
    return row ? termReportWorkflowView(mapTermReportRevision(row)) : null;
  }
  async createTermReportDraft(studentId, termId, actor, amendmentReason = null) {
    const report = await this.getStudentReportCard(studentId, termId, actor);
    let result = null;
    await this.db.transaction(async (trx) => {
      await trx('campuses').where({ id: actor.activeCampusId }).forUpdate().first('id');
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').forUpdate().first('id');
      if (!student) throw campusScopeError('Student is outside the active campus.');
      const marks = await trx('marks').where({
        campus_id: actor.activeCampusId, student_id: studentId, term_id: termId
      }).whereNotNull('subject_id').forUpdate()
        .select('id', 'assessment_name', 'value', 'max_value', 'state');
      if (!marks.length || marks.some((mark) => mark.state !== 'locked')) {
        throw reportWorkflowConflict('All report-card marks must be published before creating an official report.');
      }
      if (markFingerprint(marks.map((mark) => ({
        id: mark.id, assessmentName: mark.assessment_name,
        value: Number(mark.value), maxValue: Number(mark.max_value), state: mark.state
      }))) !== report.sourceMarkFingerprint) {
        throw reportWorkflowConflict('Published marks changed while this report was being prepared; reload the preview.');
      }
      const policyRow = await trx('campus_academic_policies')
        .where({ campus_id: actor.activeCampusId }).first();
      const confirmedAt = policyRow?.confirmed_at
        ? new Date(policyRow.confirmed_at).toISOString() : null;
      if (!report.gradingPolicyConfirmed || !confirmedAt ||
        report.gradingPolicyConfirmedAt !== confirmedAt) {
        throw reportWorkflowConflict('Confirm the campus grading policy before creating an official report.');
      }
      const previousRow = await trx('term_report_revisions').where({
        campus_id: actor.activeCampusId, student_id: studentId, term_id: termId
      }).orderBy('revision', 'desc').forUpdate().first();
      const previous = previousRow ? mapTermReportRevision(previousRow) : null;
      const snapshot = { ...report };
      delete snapshot.workflow;
      if (previous?.status !== 'published' &&
        previous?.snapshot.gradingPolicyConfirmedAt === report.gradingPolicyConfirmedAt &&
        previous?.snapshot.sourceMarkFingerprint === report.sourceMarkFingerprint) {
        throw reportWorkflowConflict('The current report revision must be published before another draft is created.');
      }
      if (previous?.status === 'published' && stableJson(previous.snapshot) === stableJson(snapshot)) {
        throw reportWorkflowConflict('There are no report-card changes to publish as a new revision.');
      }
      if (previous?.status === 'published' && !amendmentReason) {
        throw reportAmendmentReasonRequired();
      }
      const revision = {
        id: randomUUID(), campusId: actor.activeCampusId, studentId, termId,
        revision: (previous?.revision ?? 0) + 1, status: 'draft', snapshot,
        amendmentReason,
        createdBy: actor.sub, submittedBy: null, approvedBy: null, publishedBy: null,
        createdAt: now(), submittedAt: null, approvedAt: null, publishedAt: null
      };
      await trx('term_report_revisions').insert({
        id: revision.id, campus_id: revision.campusId, student_id: studentId,
        term_id: termId, revision: revision.revision, status: revision.status,
        report_json: JSON.stringify(snapshot), created_by: actor.sub,
        amendment_reason: amendmentReason
      });
      await trx('audit_log').insert(auditRow(
        actor, 'term_report.draft_created', 'term_report_revision', revision.id, null,
        {
          studentId, termId, revision: revision.revision, status: revision.status,
          amendmentReason
        }
      ));
      result = termReportWorkflowView(revision);
    });
    return result;
  }
  async transitionTermReport(reportId, targetState, actor) {
    let result = null;
    await this.db.transaction(async (trx) => {
      await trx('campuses').where({ id: actor.activeCampusId }).forUpdate().first('id');
      const row = await trx('term_report_revisions').where({
        id: reportId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return;
      const revision = mapTermReportRevision(row);
      const currentMarks = await trx('marks').where({
        campus_id: actor.activeCampusId, student_id: revision.studentId, term_id: revision.termId
      }).whereNotNull('subject_id').forUpdate()
        .select('id', 'assessment_name', 'value', 'max_value', 'state');
      assertReportSnapshotCurrent(revision, currentMarks.map((mark) => ({
        id: mark.id, assessmentName: mark.assessment_name,
        value: Number(mark.value), maxValue: Number(mark.max_value), state: mark.state
      })));
      const policyRow = await trx('campus_academic_policies')
        .where({ campus_id: actor.activeCampusId }).first();
      const confirmedAt = policyRow?.confirmed_at
        ? new Date(policyRow.confirmed_at).toISOString() : null;
      assertTermReportTransition(revision, targetState, actor, confirmedAt);
      const timestampColumn = {
        submitted: 'submitted_at', approved: 'approved_at', published: 'published_at'
      }[targetState];
      const actorColumn = {
        submitted: 'submitted_by', approved: 'approved_by', published: 'published_by'
      }[targetState];
      await trx('term_report_revisions').where({ id: reportId }).update({
        status: targetState, [timestampColumn]: trx.fn.now(), [actorColumn]: actor.sub,
        updated_at: trx.fn.now()
      });
      await trx('audit_log').insert(auditRow(
        actor, `term_report.${targetState}`, 'term_report_revision', reportId,
        { status: revision.status }, { status: targetState, revision: revision.revision }
      ));
      const transitioned = { ...revision, status: targetState };
      if (targetState === 'submitted') {
        transitioned.submittedBy = actor.sub;
        transitioned.submittedAt = new Date().toISOString();
      } else if (targetState === 'approved') {
        transitioned.approvedBy = actor.sub;
        transitioned.approvedAt = new Date().toISOString();
      } else {
        transitioned.publishedBy = actor.sub;
        transitioned.publishedAt = new Date().toISOString();
      }
      result = termReportWorkflowView(transitioned);
    });
    return result;
  }
















  async getDashboard(campusId) {
    const today = addisDate();
    const [students, attendance, marks, attendanceToday, recentStudents, sections, genderRows] = await Promise.all([
      this.db('students').where({ campus_id: campusId }).whereNull('archived_at').count({ total: '*' }).first(),
      this.db('attendance_sessions').where({ campus_id: campusId }).count({ total: '*' }).first(),
      this.db('marks').where({ campus_id: campusId }).count({ total: '*' }).first(),
      this.db('attendance_sessions').where({ campus_id: campusId, attendance_date: today }).count({ total: '*' }).first(),
      this.listStudents(campusId),
      this.db('students').where({ campus_id: campusId }).whereNull('archived_at')
        .select('section_name').count({ total: '*' }).groupBy('section_name'),
      this.db('students').where({ campus_id: campusId }).whereNull('archived_at')
        .select('gender').count({ total: '*' }).groupBy('gender')
    ]);
    const genderTotals = { female: 0, male: 0, other: 0 };
    for (const row of genderRows) genderTotals[row.gender] = Number(row.total);
    return {
      studentCount: Number(students.total), attendanceSessions: Number(attendance.total),
      marksRecorded: Number(marks.total), attendanceToday: Number(attendanceToday.total),
      recentStudents: recentStudents.slice(0, 5).map((student) => ({ ...student, guardianPhone: null })),
      sectionDistribution: sections.map((row) => ({ sectionName: row.section_name ?? 'Unassigned', count: Number(row.total) })),
      genderTotals, mode: this.mode
    };
  }
  async appendAudit(actor, action, entityType, entityId, before, after) {
    await this.db('audit_log').insert(auditRow(actor, action, entityType, entityId, before, after));
  }
  async getCampus(campusId) {
    const row = await this.db('campuses').where({ id: campusId }).first();
    return row ? {
      id: row.id, organizationId: row.organization_id, name: row.name,
      address: row.address ?? '', phone: row.phone ?? '', timezone: row.timezone
    } : null;
  }
  async updateCampus(data, actor) {
    const before = await this.getCampus(actor.activeCampusId);
    if (!before) return null;
    await this.db.transaction(async (trx) => {
      await trx('campuses').where({ id: actor.activeCampusId, organization_id: actor.orgId }).update(data);
      await trx('audit_log').insert(auditRow(
        actor, 'school.profile_updated', 'campus', actor.activeCampusId, before, data
      ));
    });
    return this.getCampus(actor.activeCampusId);
  }
  async listTimetablePeriods(campusId) {
    return (await this.db('timetable_periods').where({ campus_id: campusId })
      .orderBy('shift').orderBy('period_number')).map((row) => ({
      id: row.id, campusId: row.campus_id, shift: row.shift,
      periodNumber: row.period_number, startsAt: String(row.starts_at).slice(0, 5),
      endsAt: String(row.ends_at).slice(0, 5)
    }));
  }
  async createTimetablePeriod(data, actor) {
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        const overlap = await trx('timetable_periods').where({
          campus_id: actor.activeCampusId, shift: data.shift
        }).where('starts_at', '<', `${data.endsAt}:00`)
          .where('ends_at', '>', `${data.startsAt}:00`).first('id');
        if (overlap) throw scheduleConflict('Timetable periods in the same shift cannot overlap.');
        await trx('timetable_periods').insert({
          id, campus_id: actor.activeCampusId, shift: data.shift,
          period_number: data.periodNumber, starts_at: `${data.startsAt}:00`,
          ends_at: `${data.endsAt}:00`
        });
        await trx('audit_log').insert(auditRow(actor, 'timetable.period_created', 'timetable_period', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('This period number already exists for the selected shift.');
      throw error;
    }
    return { id, campusId: actor.activeCampusId, ...data };
  }
  async listRooms(campusId) {
    return (await this.db('rooms').where({ campus_id: campusId, is_active: true }).orderBy('name'))
      .map((row) => ({
        id: row.id, campusId: row.campus_id, name: row.name,
        capacity: row.capacity == null ? null : Number(row.capacity), isActive: Boolean(row.is_active)
      }));
  }
  async createRoom(data, actor) {
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('rooms').insert({
          id, campus_id: actor.activeCampusId, name: data.name, capacity: data.capacity ?? null
        });
        await trx('audit_log').insert(auditRow(actor, 'timetable.room_created', 'room', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('A room with this name already exists at this campus.');
      throw error;
    }
    return { id, campusId: actor.activeCampusId, ...data, capacity: data.capacity ?? null, isActive: true };
  }
  async listTimetable(actor, { sectionId, date } = {}) {
    let rows = await this.listTeachingAssignments(actor);
    if (date) {
      const weekday = weekdayNumber(date);
      rows = rows.filter((item) => item.dayOfWeek === weekday);
      const substitutions = await this.db('timetable_substitutions as ts')
        .join('teaching_assignments as ta', 'ta.id', 'ts.teaching_assignment_id')
        .join('staff as substitute', 'substitute.id', 'ts.substitute_staff_id')
        .where({ 'ts.campus_id': actor.activeCampusId, 'ts.substitution_date': date })
        .select(
          'ts.teaching_assignment_id', 'ts.substitute_staff_id', 'ts.substitution_date',
          'ta.section_id', 'ta.subject_id', 'ta.room_id', 'ta.day_of_week', 'ta.period_number',
          'substitute.given_name_en', 'substitute.father_name_en', 'substitute.grandfather_name_en',
          'substitute.given_name_am', 'substitute.father_name_am', 'substitute.grandfather_name_am'
        );
      const actorStaff = await this.db('staff').where({
        campus_id: actor.activeCampusId, user_id: actor.sub
      }).whereNull('archived_at').first('id');
      const canSeeCampus = ['owner_director', 'group_executive', 'principal', 'academic_head', 'hr_admin', 'system_admin'].includes(actor.role);
      for (const substitution of substitutions) {
        const originalVisible = rows.some((item) => item.id === substitution.teaching_assignment_id);
        const isSubstitute = actorStaff?.id === substitution.substitute_staff_id;
        if (!canSeeCampus && !originalVisible && !isSubstitute) continue;
        rows = rows.filter((item) => item.id !== substitution.teaching_assignment_id);
        if (canSeeCampus || isSubstitute) {
          rows.push({
            id: substitution.teaching_assignment_id, campusId: actor.activeCampusId,
            staffId: substitution.substitute_staff_id, effectiveStaffId: substitution.substitute_staff_id,
            effectiveStaffName: formatStaffName(mapStaff(substitution)),
            sectionId: substitution.section_id, subjectId: substitution.subject_id,
            roomId: substitution.room_id, dayOfWeek: substitution.day_of_week,
            periodNumber: substitution.period_number, isActive: true,
            isSubstitute: true, substitutionDate: date
          });
        }
      }
    }
    return rows.filter((item) => !sectionId || item.sectionId === sectionId)
      .sort((a, b) => (a.dayOfWeek ?? 0) - (b.dayOfWeek ?? 0) || (a.periodNumber ?? 0) - (b.periodNumber ?? 0));
  }
  async createTimetableSubstitution(assignmentId, data, actor) {
    return this.db.transaction(async (trx) => {
      const assignment = await trx('teaching_assignments as ta')
        .join('staff as original', 'original.id', 'ta.staff_id')
        .where({
          'ta.id': assignmentId, 'ta.campus_id': actor.activeCampusId, 'ta.is_active': true
        }).whereNotNull('ta.day_of_week').forUpdate().first('ta.*', 'original.employment_status');
      if (!assignment) return null;
      if (assignment.day_of_week !== weekdayNumber(data.date)) {
        throw setupConflict('The substitution date does not match this timetable day.');
      }
      const leave = await trx('leave_requests').where({
        id: data.leaveRequestId, campus_id: actor.activeCampusId, staff_id: assignment.staff_id,
        status: 'approved'
      }).where('start_date', '<=', data.date).where('end_date', '>=', data.date).first('id');
      if (!leave) throw setupConflict('An approved leave request for the assigned teacher is required.');
      const substitute = await trx('staff').where({
        id: data.substituteStaffId, campus_id: actor.activeCampusId,
        employment_status: 'active'
      }).whereNull('archived_at').first();
      if (!substitute || substitute.id === assignment.staff_id) {
        throw campusScopeError('Choose a different active staff member at this campus.');
      }
      const regularConflict = await trx('teaching_assignments').where({
        campus_id: actor.activeCampusId, staff_id: substitute.id,
        day_of_week: assignment.day_of_week, period_number: assignment.period_number, is_active: true
      }).first('id');
      const substituteConflict = await trx('timetable_substitutions as ts')
        .join('teaching_assignments as other', 'other.id', 'ts.teaching_assignment_id')
        .where({
          'ts.campus_id': actor.activeCampusId, 'ts.substitute_staff_id': substitute.id,
          'ts.substitution_date': data.date, 'other.period_number': assignment.period_number
        }).first('ts.id');
      if (regularConflict || substituteConflict) {
        throw scheduleConflict('The substitute already has a class at this time.');
      }
      const id = randomUUID();
      try {
        await trx('timetable_substitutions').insert({
          id, campus_id: actor.activeCampusId, teaching_assignment_id: assignmentId,
          substitute_staff_id: substitute.id, substitution_date: data.date,
          leave_request_id: leave.id, reason: data.reason, created_by: actor.sub
        });
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw setupConflict('A substitute has already been assigned for this timetable slot and date.');
        throw error;
      }
      await trx('audit_log').insert(auditRow(actor, 'timetable.substitute_assigned',
        'timetable_assignment', assignmentId, null,
        { substituteStaffId: substitute.id, date: data.date, leaveRequestId: leave.id }));
      return {
        id, campusId: actor.activeCampusId, assignmentId,
        substituteStaffId: substitute.id, substituteName: formatStaffName(mapStaff(substitute)),
        date: data.date, leaveRequestId: leave.id, reason: data.reason
      };
    });
  }
  async getAdmissionsDashboard(campusId) {
    const statusRows = await this.db('admissions').where({ campus_id: campusId })
      .groupBy('status').select('status').count({ total: '*' });
    const byStatus = Object.fromEntries(statusRows.map((row) => [row.status, Number(row.total)]));
    const gradeRows = await this.db('admissions as a')
      .join('grade_levels as g', 'g.id', 'a.grade_level_id')
      .where({ 'a.campus_id': campusId })
      .groupBy('g.id', 'g.name_en').select('g.name_en as grade')
      .count({ total: '*' })
      .count({ enrolled: this.db.raw('CASE WHEN a.status = ? THEN 1 END', ['enrolled']) });
    return {
      total: statusRows.reduce((sum, row) => sum + Number(row.total), 0),
      byStatus, byGrade: gradeRows.map((row) => ({ grade: row.grade, total: Number(row.total), enrolled: Number(row.enrolled) }))
    };
  }
  async getPublicAdmissionInfo(token) {
    const campus = await this.db('campuses').where({
      admissions_public_token: token, is_active: true
    }).first();
    if (!campus) return null;
    const year = await this.db('academic_years').where({
      campus_id: campus.id, status: 'active'
    }).first('id');
    if (!year) return null;
    const grades = await this.db('grade_levels').where({ campus_id: campus.id })
      .orderBy('sort_order').select('id', 'name_en', 'name_am');
    const organization = await this.db('organizations').where({ id: campus.organization_id }).first('name');
    return {
      schoolName: organization?.name ?? campus.name, campusName: campus.name,
      address: campus.address ?? '', phone: campus.phone ?? '',
      grades: grades.map((grade) => ({ id: grade.id, nameEn: grade.name_en, nameAm: grade.name_am }))
    };
  }
  async getAdmissionsPublicToken(campusId) {
    const campus = await this.db('campuses').where({ id: campusId, is_active: true })
      .first('admissions_public_token');
    return campus?.admissions_public_token ?? null;
  }
  async createPublicAdmission(token, data) {
    const campus = await this.db('campuses').where({
      admissions_public_token: token, is_active: true
    }).first('id', 'organization_id');
    if (!campus || !await this.getPublicAdmissionInfo(token)) return null;
    return this.createAdmission(data, {
      sub: 'public-intake', orgId: campus.organization_id, activeCampusId: campus.id
    });
  }
  async listAdmissions(campusId, { status = null, query = '' } = {}) {
    const builder = this.db('admissions as a').join('grade_levels as g', 'g.id', 'a.grade_level_id')
      .leftJoin('students as s', 's.id', 'a.student_id')
      .where({ 'a.campus_id': campusId })
      .select('a.*', 'g.name_en as grade_name', 's.student_no');
    if (status) builder.where('a.status', status);
    if (query) builder.where((where) => where
      .where('a.given_name_en', 'like', `%${query}%`)
      .orWhere('a.father_name_en', 'like', `%${query}%`)
      .orWhere('a.grandfather_name_en', 'like', `%${query}%`)
      .orWhere('a.given_name_am', 'like', `%${query}%`)
      .orWhere('a.father_name_am', 'like', `%${query}%`)
      .orWhere('a.grandfather_name_am', 'like', `%${query}%`)
      .orWhere('a.guardian_name', 'like', `%${query}%`)
      .orWhere('a.guardian_phone', 'like', `%${query}%`));
    const rows = await builder.orderBy('a.created_at', 'desc').limit(500);
    return Promise.all(rows.map((row) => this.enrichAdmission(row)));
  }
  async getAdmission(campusId, admissionId) {
    const row = await this.db('admissions as a')
      .join('grade_levels as g', 'g.id', 'a.grade_level_id')
      .leftJoin('students as s', 's.id', 'a.student_id')
      .where({ 'a.id': admissionId, 'a.campus_id': campusId })
      .select('a.*', 'g.name_en as grade_name', 's.student_no').first();
    return row ? this.enrichAdmission(row) : null;
  }
  async enrichAdmission(row) {
    const admission = mapAdmission(row);
    const documents = await this.listAdmissionDocuments(row.campus_id, row.id);
    return {
      ...admission, documents,
      documentChecklist: admission.requiredDocuments.map((type) => ({
        type, complete: documents.some((document) => document.documentType === type)
      }))
    };
  }
  async findAdmissionDuplicates(campusId, { name = '', dateOfBirth = '', guardianPhone = '' }) {
    const needle = name.trim();
    const duplicateWhere = (builder) => {
      let hasWhere = false;
      if (guardianPhone) {
        builder.where('guardian_phone', guardianPhone);
        hasWhere = true;
      }
      if (needle && dateOfBirth) {
        const nameMatch = (condition) => condition
          .whereRaw('LOWER(CONCAT(given_name_en, " ", father_name_en, " ", grandfather_name_en)) = LOWER(?)', [needle])
          .orWhereRaw('LOWER(CONCAT(given_name_am, " ", father_name_am, " ", grandfather_name_am)) = LOWER(?)', [needle]);
        builder[hasWhere ? 'orWhere' : 'where']((condition) =>
          condition.where('date_of_birth', dateOfBirth).andWhere(nameMatch));
      }
    };
    const [admissions, students] = await Promise.all([
      this.db('admissions').where({ campus_id: campusId }).andWhere(duplicateWhere)
        .select('id', 'status', 'given_name_en', 'father_name_en', 'grandfather_name_en', 'guardian_phone'),
      this.db('students').where({ campus_id: campusId }).andWhere(duplicateWhere)
        .select('id', 'status', 'given_name_en', 'father_name_en', 'grandfather_name_en', 'guardian_phone')
    ]);
    return [
      ...admissions.map((row) => ({ id: row.id, type: 'admission', status: row.status, name: `${row.given_name_en} ${row.father_name_en} ${row.grandfather_name_en}`, guardianPhone: row.guardian_phone })),
      ...students.map((row) => ({ id: row.id, type: 'student', status: row.status, name: `${row.given_name_en} ${row.father_name_en} ${row.grandfather_name_en}`, guardianPhone: row.guardian_phone ?? '' }))
    ];
  }
  async createAdmission(data, actor) {
    const year = await this.getAcademicYear(actor.activeCampusId);
    const grade = await this.db('grade_levels').where({
      id: data.gradeLevelId, campus_id: actor.activeCampusId
    }).first();
    if (!year || !grade) throw campusScopeError('An active academic year and campus grade are required.');
    const id = randomUUID();
    const admission = {
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      academic_year_id: year.id, given_name_am: data.givenNameAm, father_name_am: data.fatherNameAm,
      grandfather_name_am: data.grandfatherNameAm, given_name_en: data.givenNameEn,
      father_name_en: data.fatherNameEn, grandfather_name_en: data.grandfatherNameEn,
      gender: data.gender, date_of_birth: data.dateOfBirth ?? null,
      guardian_name: data.guardianName, guardian_phone: data.guardianPhone,
      guardian_email: data.guardianEmail ?? null, grade_level_id: data.gradeLevelId,
      previous_school: data.previousSchool ?? null,
      status: actor.sub === 'public-intake' ? 'application' : 'enquiry',
      public_submission: actor.sub === 'public-intake',
      privacy_consent_at: actor.sub === 'public-intake' ? new Date() : null,
      required_documents: JSON.stringify(['birth_certificate', 'previous_school_report', 'guardian_id']),
      created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await trx('admissions').insert(admission);
      await trx('audit_log').insert(auditRow(actor, 'admission.created', 'admission', id, null, data));
    });
    return this.getAdmission(actor.activeCampusId, id);
  }
  async setStudentIdPattern(pattern, actor) {
    const campus = await this.db('campuses').where({ id: actor.activeCampusId }).first();
    if (!campus) throw campusScopeError('Campus is not available.');
    await this.db.transaction(async (trx) => {
      await trx('campuses').where({ id: actor.activeCampusId }).update({ student_id_pattern: pattern });
      await trx('audit_log').insert(auditRow(actor, 'admission.student_id_pattern_updated', 'campus', actor.activeCampusId, { pattern: campus.student_id_pattern }, { pattern }));
    });
    return { pattern };
  }
  async scheduleAdmissionInterview(admissionId, data, actor) {
    const found = await this.db.transaction(async (trx) => {
      const row = await trx('admissions').where({
        id: admissionId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      if (!['application', 'interview'].includes(row.status)) throw setupConflict('Only applicants may be scheduled for an interview.');
      const before = { status: row.status, interviewAt: row.interview_at, interviewResult: row.interview_result };
      await trx('admissions').where({ id: admissionId }).update({
        status: 'interview', interview_at: toMysqlDateTime(data.interviewAt), interview_result: data.interviewResult
      });
      await trx('audit_log').insert(auditRow(actor, 'admission.interview_scheduled', 'admission', admissionId, before, data));
      return true;
    });
    return found ? this.getAdmission(actor.activeCampusId, admissionId) : null;
  }
  async updateAdmissionStatus(admissionId, data, actor) {
    const found = await this.db.transaction(async (trx) => {
      const row = await trx('admissions').where({
        id: admissionId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      const allowed = {
        enquiry: ['application', 'rejected'], application: ['accepted', 'waitlisted', 'rejected', 'interview'],
        interview: ['accepted', 'waitlisted', 'rejected'], waitlisted: ['accepted', 'rejected']
      };
      if (!allowed[row.status]?.includes(data.status)) throw setupConflict(`Cannot move an admission from ${row.status} to ${data.status}.`);
      await trx('admissions').where({ id: admissionId }).update({
        status: data.status, decision_note: data.decisionNote
      });
      await trx('audit_log').insert(auditRow(actor, `admission.${data.status}`, 'admission', admissionId, { status: row.status }, data));
      return true;
    });
    return found ? this.getAdmission(actor.activeCampusId, admissionId) : null;
  }
  async storeAdmissionDocument(admissionId, documentType, originalName, mimeType, content, actor) {
    const admission = await this.db('admissions').where({
      id: admissionId, campus_id: actor.activeCampusId
    }).first();
    if (!admission) throw campusScopeError('Admission is outside the active campus.');
    if (!isValidDocumentContent(mimeType, content)) throw invalidDocument('The document content does not match its declared file type.');
    const id = randomUUID();
    const storageKey = randomUUID();
    const document = {
      id, admission_id: admissionId, document_type: documentType,
      original_name: safeFilename(originalName),
      mime_type: mimeType, size_bytes: content.length, storage_key: storageKey,
      sha256: createHash('sha256').update(content).digest('hex'), uploaded_by: actor.sub
    };
    const filePath = path.join(this.privateDocumentsDir, storageKey);
    await mkdir(this.privateDocumentsDir, { recursive: true });
    await writeFile(filePath, content, { flag: 'wx' });
    try {
      await this.db.transaction(async (trx) => {
        await trx('admission_documents').insert(document);
        await trx('audit_log').insert(auditRow(actor, 'admission.document_uploaded', 'admission_document', id, null, {
          admissionId, documentType, sizeBytes: content.length, sha256: document.sha256
        }));
      });
    } catch (error) {
      try {
        await unlink(filePath);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Document metadata write and private-file cleanup both failed.');
      }
      throw error;
    }
    return mapAdmissionDocument(document);
  }
  async listAdmissionDocuments(campusId, admissionId) {
    const admission = await this.db('admissions').where({ id: admissionId, campus_id: campusId }).first();
    if (!admission) return [];
    const rows = await this.db('admission_documents').where({ admission_id: admissionId }).orderBy('created_at', 'desc');
    return rows.map(mapAdmissionDocument);
  }
  async getAdmissionDocument(campusId, admissionId, documentId) {
    const rows = await this.db('admission_documents as d')
      .join('admissions as a', 'a.id', 'd.admission_id')
      .where({ 'a.campus_id': campusId, 'a.id': admissionId, 'd.id': documentId })
      .select('d.*').first();
    if (!rows) return null;
    const filePath = path.join(this.privateDocumentsDir, path.basename(rows.storage_key));
    return { document: mapAdmissionDocument(rows), content: await readFile(filePath) };
  }
  async storeStudentDocument(studentId, documentType, originalName, mimeType, content, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) throw campusScopeError('Student is outside the active campus.');
    if (!isValidDocumentContent(mimeType, content) ||
      (documentType === 'photo' && !['image/jpeg', 'image/png'].includes(mimeType))) {
      throw invalidDocument('The student document content does not match its declared file type.');
    }
    const id = randomUUID();
    const row = {
      id, campus_id: actor.activeCampusId, student_id: studentId, document_type: documentType,
      original_name: safeFilename(originalName), mime_type: mimeType, size_bytes: content.length,
      storage_key: randomUUID(), sha256: createHash('sha256').update(content).digest('hex'),
      uploaded_by: actor.sub
    };
    const filePath = path.join(this.privateDocumentsDir, row.storage_key);
    await mkdir(this.privateDocumentsDir, { recursive: true });
    await writeFile(filePath, content, { flag: 'wx' });
    try {
      await this.db.transaction(async (trx) => {
        await trx('student_documents').insert(row);
        await trx('audit_log').insert(auditRow(actor, 'student.document_uploaded',
          'student_document', id, null, {
            studentId, documentType, sizeBytes: content.length, sha256: row.sha256
          }));
      });
    } catch (error) {
      try {
        await unlink(filePath);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Student document metadata write and private-file cleanup both failed.');
      }
      throw error;
    }
    return mapStudentDocument(row);
  }
  async listStudentDocuments(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const rows = await this.db('student_documents').where({
      student_id: studentId, campus_id: actor.activeCampusId
    }).orderBy('created_at', 'desc');
    await this.appendAudit(actor, 'student.documents_viewed', 'student', studentId, null, { count: rows.length });
    return rows.map(mapStudentDocument);
  }
  async getStudentDocument(studentId, documentId, actor) {
    const row = await this.db('student_documents as d')
      .join('students as s', 's.id', 'd.student_id')
      .where({
        'd.id': documentId, 'd.student_id': studentId,
        'd.campus_id': actor.activeCampusId, 's.campus_id': actor.activeCampusId
      }).whereNull('s.archived_at').select('d.*').first();
    if (!row) return null;
    await this.appendAudit(actor, 'student.document_downloaded', 'student_document', documentId, null, { studentId });
    const filePath = path.join(this.privateDocumentsDir, path.basename(row.storage_key));
    return { document: mapStudentDocument(row), content: await readFile(filePath) };
  }
  async createStudentTransferPackage(studentId, data, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const consent = await this.db('student_documents').where({
      id: data.consentDocumentId, student_id: studentId,
      campus_id: actor.activeCampusId, document_type: 'transfer_consent'
    }).first('id');
    if (!consent) throw setupConflict('Upload the guardian-signed transfer consent document before requesting approval.');
    const id = randomUUID();
    const row = {
      id, campus_id: actor.activeCampusId, student_id: studentId,
      recipient_school: data.recipientSchool, guardian_name: data.guardianName,
      guardian_relationship: data.guardianRelationship, consent_recorded_on: data.consentRecordedOn,
      consent_document_id: consent.id, status: 'pending', created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await trx('student_transfer_packages').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'student.transfer_package_requested',
        'student_transfer_package', id, null, {
          studentId, recipientSchool: row.recipient_school, consentRecordedOn: row.consent_recorded_on
        }));
    });
    return mapStudentTransferPackage(row);
  }
  async listStudentTransferPackages(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const rows = await this.db('student_transfer_packages').where({
      student_id: studentId, campus_id: actor.activeCampusId
    }).orderBy('created_at', 'desc');
    return rows.map(mapStudentTransferPackage);
  }
  async approveStudentTransferPackage(packageId, tokenHash, actor) {
    return this.db.transaction(async (trx) => {
      const item = await trx('student_transfer_packages').where({
        id: packageId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!item) return null;
      if (!['pending', 'approved'].includes(item.status)) throw setupConflict('Only pending or approved transfer packages can receive a transfer link.');
      const expiresAt = new Date(Date.now() + 72 * 60 * 60_000);
      await trx('student_transfer_packages').where({ id: packageId }).update({
        status: 'approved', share_token_hash: tokenHash, expires_at: expiresAt,
        approved_by: actor.sub, approved_at: new Date()
      });
      await trx('audit_log').insert(auditRow(actor,
        item.status === 'pending' ? 'student.transfer_package_approved' : 'student.transfer_link_reissued',
        'student_transfer_package', packageId, { status: item.status }, {
          status: 'approved', expiresAt: expiresAt.toISOString()
        }));
      return mapStudentTransferPackage({
        ...item, status: 'approved', share_token_hash: tokenHash,
        expires_at: expiresAt, approved_by: actor.sub, approved_at: new Date()
      });
    });
  }
  async getStudentTransferPackageByTokenHash(tokenHash) {
    return this.db.transaction(async (trx) => {
      const item = await trx('student_transfer_packages as p')
        .join('students as s', 's.id', 'p.student_id')
        .join('campuses as c', 'c.id', 'p.campus_id')
        .join('organizations as o', 'o.id', 'c.organization_id')
        .where({ 'p.share_token_hash': tokenHash, 'p.status': 'approved' })
        .where('p.expires_at', '>', new Date())
        .whereNull('s.archived_at')
        .select('p.*', 'c.name as source_campus_name', 'o.name as source_school_name',
          's.student_no', 's.given_name_am', 's.father_name_am', 's.grandfather_name_am',
          's.given_name_en', 's.father_name_en', 's.grandfather_name_en',
          's.gender', 's.date_of_birth', 's.previous_school').first();
      if (!item) return null;
      const historyRows = await trx('enrolments as e')
        .join('academic_years as y', 'y.id', 'e.academic_year_id')
        .join('sections as section', 'section.id', 'e.section_id')
        .join('grade_levels as grade', 'grade.id', 'section.grade_level_id')
        .where({ 'e.student_id': item.student_id, 'y.campus_id': item.campus_id })
        .orderBy('y.start_date')
        .select('y.label_ec as academicYear', 'grade.name_en as grade',
          'section.name as section', 'e.status', 'e.outcome');
      return {
        recipientSchool: item.recipient_school,
        sourceSchool: item.source_school_name || item.source_campus_name,
        student: {
          studentNo: item.student_no, givenNameAm: item.given_name_am,
          fatherNameAm: item.father_name_am, grandfatherNameAm: item.grandfather_name_am,
          givenNameEn: item.given_name_en, fatherNameEn: item.father_name_en,
          grandfatherNameEn: item.grandfather_name_en, gender: item.gender,
          dateOfBirth: item.date_of_birth ? String(item.date_of_birth).slice(0, 10) : null,
          previousSchool: item.previous_school
        },
        guardianConsent: {
          guardianName: item.guardian_name, relationship: item.guardian_relationship,
          recordedOn: String(item.consent_recorded_on).slice(0, 10)
        },
        academicHistory: historyRows
      };
    });
  }
  async enrolAdmission(admissionId, { sectionId, siblingStudentId = null }, actor) {
    const result = await this.db.transaction(async (trx) => {
      const admission = await trx('admissions').where({
        id: admissionId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!admission) throw campusScopeError('Admission is outside the active campus.');
      if (admission.status !== 'accepted') throw setupConflict('Only accepted applicants can be enrolled.');
      const required = Array.isArray(admission.required_documents)
        ? admission.required_documents : JSON.parse(admission.required_documents);
      const uploaded = await trx('admission_documents').where({ admission_id: admissionId }).pluck('document_type');
      if (required.some((type) => !uploaded.includes(type))) throw setupConflict('All required documents must be uploaded before enrolment.');
      const section = await trx('sections as s').join('academic_years as y', 'y.id', 's.academic_year_id')
        .where({
          's.id': sectionId, 's.campus_id': actor.activeCampusId,
          's.grade_level_id': admission.grade_level_id,
          's.academic_year_id': admission.academic_year_id, 'y.status': 'active'
        }).forUpdate().select('s.*').first();
      if (!section) throw campusScopeError('Select an active section for the applicant’s grade and academic year at this campus.');
      if (section.capacity != null) {
        const count = await trx('enrolments').where({
          section_id: sectionId, academic_year_id: admission.academic_year_id, status: 'active'
        }).count({ total: '*' }).first();
        if (Number(count.total) >= Number(section.capacity)) throw setupConflict('The selected section has reached capacity.');
      }
      if (siblingStudentId) {
        const sibling = await trx('students').where({
          id: siblingStudentId, campus_id: actor.activeCampusId, status: 'enrolled'
        }).first();
        if (!sibling) throw campusScopeError('Sibling student is not enrolled at this campus.');
      }
      const campus = await trx('campuses').where({ id: actor.activeCampusId }).first();
      await trx('admission_counters').insert({
        campus_id: actor.activeCampusId, academic_year_id: admission.academic_year_id, last_value: 0
      }).onConflict(['campus_id', 'academic_year_id']).ignore();
      const counter = await trx('admission_counters').where({
        campus_id: actor.activeCampusId, academic_year_id: admission.academic_year_id
      }).forUpdate().first();
      const sequence = Number(counter.last_value) + 1;
      const year = await trx('academic_years').where({ id: admission.academic_year_id }).first();
      const studentNo = formatStudentNo(campus.student_id_pattern, campus.name, year.label_ec, sequence);
      await trx('admission_counters').where({
        campus_id: actor.activeCampusId, academic_year_id: admission.academic_year_id
      }).update({ last_value: sequence });
      const studentId = randomUUID();
      const studentData = {
        givenNameEn: admission.given_name_en, fatherNameEn: admission.father_name_en,
        grandfatherNameEn: admission.grandfather_name_en,
        studentNo, givenNameAm: admission.given_name_am, fatherNameAm: admission.father_name_am,
        grandfatherNameAm: admission.grandfather_name_am
      };
      const generated = await generateStudentCredentials(studentData, async (username) =>
        Boolean(await trx('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first('id')));
      const userId = randomUUID();
      await trx('users').insert({
        id: userId, organization_id: actor.orgId, name: studentName(studentData),
        username: generated.username, password_hash: generated.passwordHash,
        role: 'student', must_change_password: true, is_active: true
      });
      await trx('user_campuses').insert({
        user_id: userId, campus_id: actor.activeCampusId, is_active: true
      });
      await trx('students').insert({
        id: studentId, campus_id: actor.activeCampusId, student_no: studentNo,
        user_id: userId, status: 'enrolled',
        given_name_am: admission.given_name_am, father_name_am: admission.father_name_am,
        grandfather_name_am: admission.grandfather_name_am, given_name_en: admission.given_name_en,
        father_name_en: admission.father_name_en, grandfather_name_en: admission.grandfather_name_en,
        gender: admission.gender, date_of_birth: admission.date_of_birth,
        section_name: section.name, previous_school: admission.previous_school,
        guardian_phone: admission.guardian_phone, status: 'enrolled'
      });
      await trx('enrolments').insert({
        id: randomUUID(), student_id: studentId, academic_year_id: admission.academic_year_id,
        section_id: sectionId, status: 'active', enrolled_on: addisDate()
      });
      await trx('student_status_history').insert({
        id: randomUUID(), student_id: studentId, campus_id: actor.activeCampusId,
        status: 'enrolled', reason: `Admission ${admissionId}`, recorded_by: actor.sub
      });
      await trx('admissions').where({ id: admissionId }).update({
        status: 'enrolled', section_id: sectionId, student_id: studentId,
        sibling_student_id: siblingStudentId
      });
      if (siblingStudentId) {
        await trx('student_siblings').insert([
          { student_id: studentId, sibling_student_id: siblingStudentId, campus_id: actor.activeCampusId },
          { student_id: siblingStudentId, sibling_student_id: studentId, campus_id: actor.activeCampusId }
        ]).onConflict().ignore();
      }
      await trx('audit_log').insert(auditRow(actor, 'admission.enrolled', 'student', studentId, {
        admissionId, status: 'accepted'
      }, { studentNo, sectionId, siblingStudentId }));
      await trx('audit_log').insert(auditRow(actor, 'student.account_created', 'user', userId, null, {
        studentId, username: generated.username
      }));
      return {
        studentId, studentNo,
        credentials: {
          username: generated.username, temporaryPassword: generated.temporaryPassword,
          studentName: generated.studentName
        }
      };
    });
    const studentRow = await this.db('students').where({ id: result.studentId }).first();
    return {
      student: mapStudent(studentRow), admission: await this.getAdmission(actor.activeCampusId, admissionId),
      credentials: result.credentials
    };
  }
  async changeStudentStatus(studentId, status, reason, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!student) return null;
      if (student.status !== 'enrolled') throw setupConflict('Only an enrolled student can be withdrawn or transferred.');
      const before = { status: student.status, sectionName: student.section_name };
      await trx('students').where({ id: studentId }).update({ status });
      await trx('admissions').where({ student_id: studentId }).update({ status });
      await trx('enrolments').where({
        student_id: studentId, status: 'active'
      }).update({ status: 'withdrawn', left_on: addisDate(), outcome: status });
      await trx('student_status_history').insert({
        id: randomUUID(), student_id: studentId, campus_id: actor.activeCampusId,
        status, reason, recorded_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, `student.${status}`, 'student', studentId, before, { status, reason }));
      return mapStudent({ ...student, status });
    });
  }
  async readmitStudent(studentId, { sectionId, reason }, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!student) return null;
      if (student.status !== 'withdrawn') throw setupConflict('Only a withdrawn student can be readmitted.');
      const year = await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).forUpdate().first();
      const section = year && await trx('sections').where({
        id: sectionId, campus_id: actor.activeCampusId, academic_year_id: year.id
      }).forUpdate().first();
      if (!section) throw campusScopeError('Select a section in the active academic year at this campus.');
      if (section.capacity != null) {
        const count = await trx('enrolments').where({
          section_id: sectionId, academic_year_id: year.id, status: 'active'
        }).count({ total: '*' }).first();
        if (Number(count.total) >= Number(section.capacity)) throw setupConflict('The selected section has reached capacity.');
      }
      const current = await trx('enrolments').where({
        student_id: studentId, academic_year_id: year.id
      }).first();
      if (current) {
        await trx('enrolments').where({ id: current.id }).update({
          section_id: sectionId, status: 'active', enrolled_on: addisDate(), left_on: null, outcome: null
        });
      } else {
        await trx('enrolments').insert({
          id: randomUUID(), student_id: studentId, academic_year_id: year.id,
          section_id: sectionId, status: 'active', enrolled_on: addisDate()
        });
      }
      const before = { status: student.status, sectionName: student.section_name };
      await trx('students').where({ id: studentId }).update({ status: 'enrolled', section_name: section.name });
      await trx('admissions').where({ student_id: studentId }).update({ status: 'enrolled' });
      await trx('student_status_history').insert({
        id: randomUUID(), student_id: studentId, campus_id: actor.activeCampusId,
        status: 'enrolled', reason, recorded_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'student.readmitted', 'student', studentId, before, {
        status: 'enrolled', sectionId, reason
      }));
      return mapStudent({ ...student, status: 'enrolled', section_name: section.name });
    });
  }
  async listStudentEnrollmentHistory(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [studentId])) {
      throw campusScopeError('Teacher is not assigned to this student’s active section.');
    }
    const rows = await this.db('enrolments as e')
      .join('academic_years as y', 'y.id', 'e.academic_year_id')
      .join('sections as s', 's.id', 'e.section_id')
      .join('grade_levels as g', 'g.id', 's.grade_level_id')
      .where({ 'e.student_id': studentId, 's.campus_id': actor.activeCampusId, 'y.campus_id': actor.activeCampusId })
      .orderBy('y.start_date', 'desc')
      .select('e.id', 'e.academic_year_id as academicYearId', 'y.label_ec as academicYear',
        'g.id as gradeLevelId', 'g.name_en as gradeNameEn', 'g.name_am as gradeNameAm',
        's.id as sectionId', 's.name as sectionName', 'e.status', 'e.enrolled_on as enrolledOn',
        'e.left_on as leftOn', 'e.outcome');
    return rows.map((row) => ({
      ...row,
      enrolledOn: row.enrolledOn ? String(row.enrolledOn).slice(0, 10) : null,
      leftOn: row.leftOn ? String(row.leftOn).slice(0, 10) : null
    }));
  }
  async transferStudentSection(studentId, { sectionId, reason }, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId, status: 'enrolled'
      }).whereNull('archived_at').forUpdate().first();
      if (!student) {
        const exists = await trx('students').where({
          id: studentId, campus_id: actor.activeCampusId
        }).whereNull('archived_at').first('id');
        if (exists) throw setupConflict('Only enrolled students can transfer sections.');
        return null;
      }
      const year = await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).first('id');
      const current = year && await trx('enrolments').where({
        student_id: studentId, academic_year_id: year.id, status: 'active'
      }).forUpdate().first();
      const destination = year && await trx('sections').where({
        id: sectionId, campus_id: actor.activeCampusId, academic_year_id: year.id, is_active: true
      }).forUpdate().first();
      if (!year || !current || !destination) {
        throw campusScopeError('Select a section in the active academic year at this campus.');
      }
      if (current.section_id === destination.id) throw setupConflict('Student is already assigned to this section.');
      if (destination.capacity != null) {
        const total = await trx('enrolments').where({
          section_id: destination.id, academic_year_id: year.id, status: 'active'
        }).count({ total: '*' }).first();
        if (Number(total.total) >= Number(destination.capacity)) throw setupConflict('The selected section has reached capacity.');
      }
      await trx('enrolments').where({ id: current.id }).update({ section_id: destination.id });
      await trx('students').where({ id: studentId }).update({ section_name: destination.name });
      const transferId = randomUUID();
      await trx('student_section_transfers').insert({
        id: transferId, campus_id: actor.activeCampusId, student_id: studentId,
        academic_year_id: year.id, from_section_id: current.section_id,
        to_section_id: destination.id, reason, recorded_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'student.section_transferred', 'student',
        studentId, { sectionId: current.section_id }, { sectionId: destination.id, reason }));
      return mapStudent({ ...student, section_name: destination.name });
    });
  }
  async listStudentSectionTransfers(studentId, actor) {
    const exists = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!exists) return null;
    const rows = await this.db('student_section_transfers as tr')
      .join('sections as source', 'source.id', 'tr.from_section_id')
      .join('sections as destination', 'destination.id', 'tr.to_section_id')
      .where({ 'tr.campus_id': actor.activeCampusId, 'tr.student_id': studentId })
      .orderBy('tr.created_at', 'desc')
      .select('tr.id', 'tr.student_id as studentId', 'tr.reason', 'tr.created_at as createdAt',
        'source.name as fromSection', 'destination.name as toSection');
    return rows;
  }
  async listStudentDisciplineRecords(studentId, actor) {
    const exists = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!exists) return null;
    const rows = await this.db('student_discipline_records').where({
      student_id: studentId, campus_id: actor.activeCampusId
    }).orderBy('recorded_on', 'desc').orderBy('created_at', 'desc');
    await this.appendAudit(actor, 'student.discipline_viewed', 'student', studentId, null, { count: rows.length });
    return rows.map((row) => mapStudentDisciplineRecord(row, this.sensitiveDataKey));
  }
  async createStudentDisciplineRecord(studentId, data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return null;
      const row = {
        id, campus_id: actor.activeCampusId, student_id: studentId,
        recorded_on: data.recordedOn, category: data.category,
        details_enc: encryptSensitiveValue(data.details, this.sensitiveDataKey),
        action_taken_enc: encryptSensitiveValue(data.actionTaken ?? null, this.sensitiveDataKey),
        recorded_by: actor.sub
      };
      await trx('student_discipline_records').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'student.discipline_recorded',
        'student_discipline_record', id, null, {
          studentId, recordedOn: data.recordedOn, category: data.category
        }));
      return mapStudentDisciplineRecord(row, this.sensitiveDataKey);
    });
  }
  async advanceStudent(studentId, { outcome, sectionId, reason, overrideReason }, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').forUpdate().first();
      if (!student) return null;
      if (student.status !== 'enrolled') {
        throw setupConflict('Only an enrolled student can progress to a new academic year.');
      }
      const year = await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).forUpdate().first();
      if (!year) throw setupConflict('Activate the destination academic year before recording progression.');
      const currentEnrollment = await trx('enrolments').where({
        student_id: studentId, academic_year_id: year.id
      }).first('id');
      if (currentEnrollment) throw setupConflict('The student already has an enrolment in the active academic year.');
      const previous = await trx('enrolments as e')
        .join('academic_years as y', 'y.id', 'e.academic_year_id')
        .join('sections as s', 's.id', 'e.section_id')
        .join('grade_levels as g', 'g.id', 's.grade_level_id')
        .where({
          'e.student_id': studentId, 'e.status': 'completed',
          'y.campus_id': actor.activeCampusId, 'y.status': 'closed', 's.campus_id': actor.activeCampusId
        })
        .orderBy('y.end_date', 'desc')
        .forUpdate()
        .first('e.id', 'e.academic_year_id', 's.grade_level_id as source_grade_level_id',
          's.stream as source_stream', 'g.sort_order as source_sort_order');
      if (!previous) throw setupConflict('A completed enrolment from a closed academic year is required.');

      if (outcome === 'graduated' && Number(previous.source_sort_order) !== 12) {
        throw setupConflict('Only Grade 12 students can be recorded as graduates.');
      }

      let section = null;
      if (outcome !== 'graduated') {
        section = await trx('sections').where({
          id: sectionId, campus_id: actor.activeCampusId, academic_year_id: year.id
        }).forUpdate().first();
        if (!section) throw campusScopeError('Select a section in the active academic year at this campus.');
        const destinationGrade = await trx('grade_levels').where({
          id: section.grade_level_id, campus_id: actor.activeCampusId
        }).first('sort_order');
        const expectedOrder = Number(previous.source_sort_order) + (outcome === 'promoted' ? 1 : 0);
        if (!destinationGrade || Number(destinationGrade.sort_order) !== expectedOrder) {
          throw setupConflict(outcome === 'promoted'
            ? 'Promotion must advance exactly one grade.'
            : 'Repetition must keep the student in the same grade.');
        }
        if (outcome === 'promoted') {
          const eligibility = await this.evaluateStudentProgression(studentId, actor);
          const overrideAllowed = ['owner_director', 'principal', 'system_admin'].includes(actor.role) &&
            Boolean(overrideReason?.trim());
          if (eligibility.status !== 'eligible' && !overrideAllowed) {
            throw setupConflict(`${eligibility.reason} A principal must configure the rule/results or provide an audited override reason.`);
          }
        }
        if (section.capacity != null) {
          const count = await trx('enrolments').where({
            section_id: section.id, academic_year_id: year.id, status: 'active'
          }).count({ total: '*' }).first();
          if (Number(count.total) >= Number(section.capacity)) {
            throw setupConflict('The selected section has reached capacity.');
          }
        }
      }

      const before = { status: student.status, sectionName: student.section_name };
      await trx('enrolments').where({ id: previous.id }).update({ outcome });
      if (outcome === 'graduated') {
        await trx('students').where({ id: studentId, campus_id: actor.activeCampusId })
          .update({ status: 'graduated', section_name: null });
      } else {
        await trx('enrolments').insert({
          id: randomUUID(), student_id: studentId, academic_year_id: year.id,
          section_id: section.id, status: 'active', enrolled_on: addisDate()
        });
        await trx('students').where({ id: studentId, campus_id: actor.activeCampusId })
          .update({ section_name: section.name });
      }
      await trx('student_status_history').insert({
        id: randomUUID(), student_id: studentId, campus_id: actor.activeCampusId,
        status: outcome, reason, recorded_by: actor.sub
      });
      const after = {
        status: outcome === 'graduated' ? 'graduated' : 'enrolled',
        outcome, fromAcademicYearId: previous.academic_year_id,
        toAcademicYearId: outcome === 'graduated' ? null : year.id,
        sectionId: section?.id ?? null, reason,
        overrideReason: overrideReason ?? null
      };
      await trx('audit_log').insert(auditRow(actor, `student.${outcome}`, 'student', studentId, before, after));
      return mapStudent({
        ...student, status: after.status,
        section_name: outcome === 'graduated' ? null : section.name
      });
    });
  }
  async transferStudentOut(studentId, reason, actor) {
    return this.changeStudentStatus(studentId, 'transferred_out', reason, actor);
  }
  async getStudentTransferRecord(campusId, studentId) {
    const [student, history, campus] = await Promise.all([
      this.db('students').where({ id: studentId, campus_id: campusId }).first(),
      this.db('student_status_history').where({
        student_id: studentId, campus_id: campusId, status: 'transferred_out'
      }).orderBy('created_at', 'desc').first(),
      this.db('campuses').where({ id: campusId }).first()
    ]);
    return student && history && campus ? {
      student: mapStudent(student),
      history: { status: history.status, reason: history.reason, createdAt: history.created_at },
      campus: { id: campus.id, name: campus.name, address: campus.address }
    } : null;
  }
  async close() { await this.db.destroy(); }
}

Object.assign(MemoryRepository.prototype, composeRepositoryBundles({
  communications: memoryCommunicationsBundle,
  staff: memoryStaffBundle,
  fees: memoryFeesBundle
}));
Object.assign(MysqlRepository.prototype, composeRepositoryBundles({
  communications: mysqlCommunicationsBundle,
  staff: mysqlStaffBundle,
  fees: mysqlFeesBundle
}));

function mapStudent(row) {
  return {
    id: row.id, campusId: row.campus_id, studentNo: row.student_no,
    givenNameAm: row.given_name_am, fatherNameAm: row.father_name_am,
    grandfatherNameAm: row.grandfather_name_am, givenNameEn: row.given_name_en,
    fatherNameEn: row.father_name_en, grandfatherNameEn: row.grandfather_name_en,
    gender: row.gender, sectionName: row.section_name ?? row.sectionName ?? '',
    sectionId: row.section_id ?? row.sectionId ?? null,
    gradeLevelId: row.grade_level_id ?? row.gradeLevelId ?? null, stream: row.stream ?? null,
    status: row.status,
    dateOfBirth: row.date_of_birth ?? row.dateOfBirth ?? null,
    previousSchool: row.previous_school ?? row.previousSchool ?? null,
    guardianPhone: row.guardian_phone ?? row.guardianPhone ?? null,
    hasPortalAccount: Boolean(row.user_id ?? row.userId)
  };
}

function portalStudentView(student) {
  return {
    id: student.id, campusId: student.campusId, studentNo: student.studentNo,
    name: `${student.givenNameEn} ${student.fatherNameEn} ${student.grandfatherNameEn}`,
    nameAm: `${student.givenNameAm} ${student.fatherNameAm} ${student.grandfatherNameAm}`,
    sectionName: student.sectionName, status: student.status
  };
}





















function buildAttendanceSummary(rows, from, to) {
  const createTotals = () => ({
    sessions: 0, records: 0, present: 0, absent: 0, late: 0, excused: 0, attendanceRate: null
  });
  const sectionTotals = new Map();
  const dailyTotals = new Map();
  const all = createTotals();
  const allSessions = new Set();
  const sectionSessions = new Map();
  const dailySessions = new Map();
  for (const row of rows) {
    const date = String(row.date).slice(0, 10);
    let section = sectionTotals.get(row.sectionId);
    if (!section) {
      section = { sectionId: row.sectionId, sectionName: row.sectionName, ...createTotals() };
      sectionTotals.set(row.sectionId, section);
    }
    let daily = dailyTotals.get(date);
    if (!daily) {
      daily = { date, ...createTotals() };
      dailyTotals.set(date, daily);
    }
    all.records += 1;
    section.records += 1;
    daily.records += 1;
    if (Object.hasOwn(all, row.status) && typeof all[row.status] === 'number') {
      all[row.status] += 1;
      section[row.status] += 1;
      daily[row.status] += 1;
    }
    allSessions.add(row.sessionId);
    if (!sectionSessions.has(row.sectionId)) sectionSessions.set(row.sectionId, new Set());
    sectionSessions.get(row.sectionId).add(row.sessionId);
    if (!dailySessions.has(date)) dailySessions.set(date, new Set());
    dailySessions.get(date).add(row.sessionId);
  }
  const complete = (totals, sessions) => {
    totals.sessions = sessions.size;
    const eligible = totals.present + totals.absent + totals.late;
    totals.attendanceRate = eligible ? Math.round(((totals.present + totals.late) / eligible) * 1000) / 10 : null;
    return totals;
  };
  complete(all, allSessions);
  const bySection = [...sectionTotals.values()].map((totals) =>
    complete(totals, sectionSessions.get(totals.sectionId)));
  const byDate = [...dailyTotals.values()].sort((a, b) => a.date.localeCompare(b.date))
    .map((totals) => complete(totals, dailySessions.get(totals.date)));
  return { from, to, totals: all, bySection, byDate };
}

function buildTermMarksSummary(term, marks, subjects) {
  const grouped = new Map();
  const allStudents = new Set();
  let earned = 0;
  let possible = 0;
  for (const mark of marks) {
    const subject = subjects.get(mark.subjectId);
    if (!subject) continue;
    const result = grouped.get(mark.subjectId) ?? {
      subjectId: mark.subjectId, subjectNameEn: subject.nameEn,
      subjectNameAm: subject.nameAm, assessmentCount: 0,
      students: new Set(), earned: 0, possible: 0
    };
    result.assessmentCount += 1;
    result.students.add(mark.studentId);
    result.earned += Number(mark.value);
    result.possible += Number(mark.maxValue);
    allStudents.add(mark.studentId);
    earned += Number(mark.value);
    possible += Number(mark.maxValue);
    grouped.set(mark.subjectId, result);
  }
  return {
    termId: term.id, termName: term.name, status: 'provisional',
    totals: termMarksMetric({
      assessmentCount: marks.length, students: allStudents.size,
      earned, possible
    }),
    bySubject: [...grouped.values()].map((result) => ({
      subjectId: result.subjectId, subjectNameEn: result.subjectNameEn,
      subjectNameAm: result.subjectNameAm, ...termMarksMetric({
        assessmentCount: result.assessmentCount, students: result.students.size,
        earned: result.earned, possible: result.possible
      })
    }))
      .sort((a, b) => a.subjectNameEn.localeCompare(b.subjectNameEn))
  };
}

function termMarksMetric(result) {
  const earnedPoints = roundScore(Number(result.earned) || 0);
  const possiblePoints = roundScore(Number(result.possible) || 0);
  return {
    assessmentCount: Number(result.assessmentCount) || 0,
    students: Number(result.students) || 0,
    earnedPoints, possiblePoints,
    percent: possiblePoints ? Math.round((earnedPoints / possiblePoints) * 10000) / 100 : null
  };
}

function studentForActor(student, actor) {
  const { userId, ...publicStudent } = student;
  const result = { ...publicStudent, hasPortalAccount: Boolean(userId) };
  if (['owner_director', 'principal', 'registrar', 'system_admin'].includes(actor.role)) return result;
  return { ...result, guardianPhone: null };
}

function mapStudentGuardian(row) {
  return {
    id: row.id,
    givenNameAm: row.given_name_am ?? row.givenNameAm,
    fatherNameAm: row.father_name_am ?? row.fatherNameAm,
    grandfatherNameAm: row.grandfather_name_am ?? row.grandfatherNameAm,
    givenNameEn: row.given_name_en ?? row.givenNameEn,
    fatherNameEn: row.father_name_en ?? row.fatherNameEn,
    grandfatherNameEn: row.grandfather_name_en ?? row.grandfatherNameEn,
    phone: row.phone,
    email: row.email ?? null,
    hasPortalAccount: Boolean(row.user_id ?? row.userId),
    relationship: row.relationship,
    isPrimary: Boolean(row.is_primary ?? row.isPrimary),
    isVerified: Boolean(row.is_verified ?? row.isVerified),
    canViewResults: Boolean(row.can_view_results ?? row.canViewResults),
    canViewFees: Boolean(row.can_view_fees ?? row.canViewFees)
  };
}

function mapStudentCommendation(row) {
  const recordedOn = row.recorded_on ?? row.recordedOn;
  const createdAt = row.created_at ?? row.createdAt;
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    studentId: row.student_id ?? row.studentId,
    recordedOn: String(recordedOn).slice(0, 10),
    titleEn: row.title_en ?? row.titleEn, titleAm: row.title_am ?? row.titleAm,
    descriptionEn: row.description_en ?? row.descriptionEn,
    descriptionAm: row.description_am ?? row.descriptionAm,
    createdBy: row.created_by ?? row.createdBy,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt
  };
}

function mapAcademicYear(row) {
  return {
    id: row.id, campusId: row.campus_id, labelEc: row.label_ec,
    startDate: String(row.start_date).slice(0, 10),
    endDate: String(row.end_date).slice(0, 10), status: row.status
  };
}

function mapSchoolCalendarEntry(row) {
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    academicYearId: row.academic_year_id ?? row.academicYearId ?? null,
    entryType: row.entry_type ?? row.entryType,
    titleEn: row.title_en ?? row.titleEn, titleAm: row.title_am ?? row.titleAm,
    startDate: String(row.start_date ?? row.startDate).slice(0, 10),
    endDate: String(row.end_date ?? row.endDate).slice(0, 10),
    isNonInstructionalDay: Boolean(row.is_non_instructional_day ?? row.isNonInstructionalDay),
    notesEn: row.notes_en ?? row.notesEn ?? '', notesAm: row.notes_am ?? row.notesAm ?? '',
    createdBy: row.created_by ?? row.createdBy ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

function mapCurriculumUnit(row) {
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    academicYearId: row.academic_year_id ?? row.academicYearId,
    gradeLevelId: row.grade_level_id ?? row.gradeLevelId,
    subjectId: row.subject_id ?? row.subjectId, stream: row.stream,
    unitNumber: Number(row.unit_number ?? row.unitNumber),
    titleEn: row.title_en ?? row.titleEn, titleAm: row.title_am ?? row.titleAm,
    learningOutcomesEn: row.learning_outcomes_en ?? row.learningOutcomesEn,
    learningOutcomesAm: row.learning_outcomes_am ?? row.learningOutcomesAm,
    plannedStart: row.planned_start ?? row.plannedStart ?? null,
    plannedEnd: row.planned_end ?? row.plannedEnd ?? null,
    createdBy: row.created_by ?? row.createdBy ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

function mapLessonPlan(row) {
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    academicYearId: row.academic_year_id ?? row.academicYearId,
    teachingAssignmentId: row.teaching_assignment_id ?? row.teachingAssignmentId,
    curriculumUnitId: row.curriculum_unit_id ?? row.curriculumUnitId ?? null,
    plannedOn: String(row.planned_on ?? row.plannedOn).slice(0, 10),
    titleEn: row.title_en ?? row.titleEn, titleAm: row.title_am ?? row.titleAm,
    objectivesEn: row.objectives_en ?? row.objectivesEn,
    objectivesAm: row.objectives_am ?? row.objectivesAm,
    activitiesEn: row.activities_en ?? row.activitiesEn,
    activitiesAm: row.activities_am ?? row.activitiesAm,
    resources: row.resources ?? '',
    status: row.status, sectionId: row.section_id ?? row.sectionId ?? null,
    sectionName: row.section_name ?? row.sectionName ?? '',
    subjectId: row.subject_id ?? row.subjectId ?? null,
    subjectName: row.subject_name ?? row.subjectName ?? '',
    teacherName: row.teacher_name ?? row.teacherName ?? '',
    unitName: row.unit_name ?? row.unitName ?? '',
    createdBy: row.created_by ?? row.createdBy ?? null,
    completedAt: row.completed_at ?? row.completedAt ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

function mapPromotionRule(row) {
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    academicYearId: row.academic_year_id ?? row.academicYearId,
    gradeLevelId: row.grade_level_id ?? row.gradeLevelId,
    minimumAnnualPercent: Number(row.minimum_annual_percent ?? row.minimumAnnualPercent),
    maximumFailedRequiredSubjects: Number(row.maximum_failed_required_subjects ?? row.maximumFailedRequiredSubjects),
    updatedBy: row.updated_by ?? row.updatedBy ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

function mapOrganization(row) {
  let branding = row.branding_json ?? row.branding;
  if (typeof branding === 'string') {
    try { branding = JSON.parse(branding); } catch { branding = {}; }
  }
  return {
    id: row.id, name: row.name, status: row.status,
    preferredLocale: row.preferred_locale ?? row.preferredLocale ?? 'en',
    currencyCode: row.currency_code ?? row.currencyCode ?? 'ETB',
    branding: branding ?? {}, requestedAt: row.requested_at ?? row.requestedAt ?? null,
    activatedAt: row.activated_at ?? row.activatedAt ?? null,
    suspendedAt: row.suspended_at ?? row.suspendedAt ?? null,
    closedAt: row.closed_at ?? row.closedAt ?? null,
    closureRetentionUntil: row.closure_retention_until ?? row.closureRetentionUntil ?? null,
    trialEndsAt: row.trial_ends_at ?? row.trialEndsAt ?? null
  };
}

function mapSubscriptionPlan(row) {
  let modules = row.modules_json ?? row.modules ?? [];
  if (typeof modules === 'string') {
    try { modules = JSON.parse(modules); } catch { modules = []; }
  }
  return {
    id: row.id, code: row.code, name: row.name, description: row.description ?? '',
    monthlyPrice: Number(row.monthly_price ?? row.monthlyPrice ?? 0),
    currencyCode: row.currency_code ?? row.currencyCode ?? 'ETB',
    trialDays: Number(row.trial_days ?? row.trialDays ?? 30),
    studentLimit: row.student_limit == null ? null : Number(row.student_limit),
    staffLimit: row.staff_limit == null ? null : Number(row.staff_limit),
    siteLimit: row.site_limit == null ? null : Number(row.site_limit),
    modules, isActive: Boolean(row.is_active ?? row.isActive)
  };
}

function formatStudentNo(pattern, campusName, yearLabel, sequence) {
  const campusCode = String(campusName ?? 'CAMPUS').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'CAMPUS';
  const yearCode = String(yearLabel ?? '').replace(/\D/g, '').slice(0, 4) || 'YEAR';
  return String(pattern ?? '{CAMPUS}-{YEAR}-{SEQ}')
    .replaceAll('{CAMPUS}', campusCode)
    .replaceAll('{YEAR}', yearCode)
    .replaceAll('{SEQ}', String(sequence).padStart(5, '0'));
}

function toMysqlDateTime(value) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

function fromMysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const iso = String(value).replace(' ', 'T');
  return iso.endsWith('Z') ? iso : `${iso}Z`;
}

function mapAdmission(row) {
  const requiredDocuments = Array.isArray(row.required_documents ?? row.requiredDocuments)
    ? (row.required_documents ?? row.requiredDocuments)
    : JSON.parse(row.required_documents ?? row.requiredDocuments ?? '[]');
  return {
    id: row.id, organizationId: row.organization_id ?? row.organizationId,
    campusId: row.campus_id ?? row.campusId,
    academicYearId: row.academic_year_id ?? row.academicYearId,
    givenNameAm: row.given_name_am ?? row.givenNameAm,
    fatherNameAm: row.father_name_am ?? row.fatherNameAm,
    grandfatherNameAm: row.grandfather_name_am ?? row.grandfatherNameAm,
    givenNameEn: row.given_name_en ?? row.givenNameEn,
    fatherNameEn: row.father_name_en ?? row.fatherNameEn,
    grandfatherNameEn: row.grandfather_name_en ?? row.grandfatherNameEn,
    gender: row.gender,
    dateOfBirth: row.date_of_birth ?? row.dateOfBirth ?? null,
    guardianName: row.guardian_name ?? row.guardianName,
    guardianPhone: row.guardian_phone ?? row.guardianPhone,
    guardianEmail: row.guardian_email ?? row.guardianEmail ?? null,
    gradeLevelId: row.grade_level_id ?? row.gradeLevelId,
    gradeName: row.grade_name ?? row.gradeName ?? '',
    previousSchool: row.previous_school ?? row.previousSchool ?? null,
    status: row.status, publicSubmission: Boolean(row.public_submission ?? row.publicSubmission),
    requiredDocuments,
    interviewAt: fromMysqlDateTime(row.interview_at ?? row.interviewAt),
    interviewResult: row.interview_result ?? row.interviewResult ?? null,
    decisionNote: row.decision_note ?? row.decisionNote ?? '',
    sectionId: row.section_id ?? row.sectionId ?? null,
    studentId: row.student_id ?? row.studentId ?? null,
    siblingStudentId: row.sibling_student_id ?? row.siblingStudentId ?? null,
    studentNo: row.student_no ?? row.studentNo ?? null,
    createdAt: row.created_at ?? row.createdAt
  };
}

function mapStudentDocument(row) {
  const createdAt = row.created_at ?? row.createdAt;
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    studentId: row.student_id ?? row.studentId,
    documentType: row.document_type ?? row.documentType,
    originalName: row.original_name ?? row.originalName,
    mimeType: row.mime_type ?? row.mimeType,
    sizeBytes: Number(row.size_bytes ?? row.sizeBytes),
    sha256: row.sha256,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt
  };
}

function mapStudentDisciplineRecord(row, key) {
  const recordedOn = row.recorded_on ?? row.recordedOn;
  const createdAt = row.created_at ?? row.createdAt;
  return {
    id: row.id, studentId: row.student_id ?? row.studentId,
    recordedOn: String(recordedOn).slice(0, 10), category: row.category,
    details: decryptSensitiveValue(row.details_enc ?? row.detailsEnc, key),
    actionTaken: decryptSensitiveValue(row.action_taken_enc ?? row.actionTakenEnc, key),
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt
  };
}

function mapStudentTransferPackage(row) {
  const expiresAt = row.expires_at ?? row.expiresAt;
  const createdAt = row.created_at ?? row.createdAt;
  return {
    id: row.id, studentId: row.student_id ?? row.studentId,
    recipientSchool: row.recipient_school ?? row.recipientSchool,
    guardianName: row.guardian_name ?? row.guardianName,
    guardianRelationship: row.guardian_relationship ?? row.guardianRelationship,
    consentRecordedOn: String(row.consent_recorded_on ?? row.consentRecordedOn).slice(0, 10),
    status: row.status,
    expiresAt: expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt ?? null,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt ?? null
  };
}

function mapAdmissionDocument(row) {
  return {
    id: row.id, admissionId: row.admission_id ?? row.admissionId,
    documentType: row.document_type ?? row.documentType,
    originalName: row.original_name ?? row.originalName,
    mimeType: row.mime_type ?? row.mimeType,
    sizeBytes: Number(row.size_bytes ?? row.sizeBytes),
    sha256: row.sha256, createdAt: row.created_at ?? row.createdAt
  };
}

function bandForPercent(bands, percent) {
  const band = [...bands].sort((a, b) => b.minPercent - a.minPercent)
    .find((item) => percent >= item.minPercent);
  return band ? { code: band.code, nameEn: band.nameEn, nameAm: band.nameAm } : null;
}

function roundScore(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function markFingerprint(marks) {
  const rows = marks.map((mark) => ({
    id: mark.id, assessmentName: mark.assessmentName ?? mark.assessment_name,
    value: Number(mark.value), maxValue: Number(mark.maxValue ?? mark.max_value),
    state: mark.state
  })).sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(stableJson(rows)).digest('hex');
}

function mapTermReportRevision(row) {
  const snapshot = typeof row.report_json === 'string' ? JSON.parse(row.report_json) : row.report_json;
  return {
    id: row.id, campusId: row.campus_id, studentId: row.student_id, termId: row.term_id,
    revision: Number(row.revision), status: row.status, snapshot,
    amendmentReason: row.amendment_reason ?? null,
    createdBy: row.created_by, submittedBy: row.submitted_by ?? null,
    approvedBy: row.approved_by ?? null, publishedBy: row.published_by ?? null,
    createdAt: row.created_at, submittedAt: row.submitted_at ?? null,
    approvedAt: row.approved_at ?? null, publishedAt: row.published_at ?? null
  };
}
function termReportWorkflowView(revision) {
  const iso = (value) => value ? new Date(value).toISOString() : null;
  return {
    id: revision.id, campusId: revision.campusId, studentId: revision.studentId,
    termId: revision.termId, revision: revision.revision, status: revision.status,
    amendmentReason: revision.amendmentReason ?? null,
    createdBy: revision.createdBy, submittedBy: revision.submittedBy,
    approvedBy: revision.approvedBy, publishedBy: revision.publishedBy,
    createdAt: iso(revision.createdAt), submittedAt: iso(revision.submittedAt),
    approvedAt: iso(revision.approvedAt), publishedAt: iso(revision.publishedAt),
    gradingPolicyConfirmedAt: revision.snapshot.gradingPolicyConfirmedAt,
    snapshot: revision.snapshot
  };
}
function portalPublishedReportView(revision) {
  const { snapshot } = revision;
  return {
    revision: revision.revision, publishedAt: revision.publishedAt,
    snapshot: {
      termId: snapshot.termId, termName: snapshot.termName,
      subjects: snapshot.subjects.map((subject) => ({
        subjectId: subject.subjectId, subjectNameEn: subject.subjectNameEn,
        subjectNameAm: subject.subjectNameAm, value: subject.value,
        maxValue: subject.maxValue, percent: subject.percent, band: subject.band
      })),
      totalValue: snapshot.totalValue, totalMaxValue: snapshot.totalMaxValue,
      overallPercent: snapshot.overallPercent, overallBand: snapshot.overallBand
    }
  };
}
function assertTermReportTransition(revision, targetState, actor, currentPolicyConfirmedAt) {
  const prior = { submitted: 'draft', approved: 'submitted', published: 'approved' }[targetState];
  if (!prior || revision.status !== prior) {
    throw reportWorkflowConflict(`A report revision must be ${prior ?? 'in the required prior state'} before it can be ${targetState}.`);
  }
  if (!currentPolicyConfirmedAt ||
    revision.snapshot.gradingPolicyConfirmedAt !== currentPolicyConfirmedAt) {
    throw reportWorkflowConflict('The grading policy changed after this report draft was created; create a fresh draft.');
  }
  if (targetState === 'approved' &&
    [revision.createdBy, revision.submittedBy].includes(actor.sub)) {
    throw reportWorkflowConflict('A report approver must differ from its creator and submitter.');
  }
  if (targetState === 'published' &&
    [revision.createdBy, revision.submittedBy, revision.approvedBy].includes(actor.sub)) {
    throw reportWorkflowConflict('A report publisher must differ from its creator, submitter and approver.');
  }
}
function assertReportSnapshotCurrent(revision, marks) {
  if (!marks.length || marks.some((mark) => mark.state !== 'locked') ||
    markFingerprint(marks) !== revision.snapshot.sourceMarkFingerprint) {
    throw reportWorkflowConflict('Published marks changed after this report draft was created; create a fresh draft.');
  }
}
function reportWorkflowConflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = 'REPORT_WORKFLOW_CONFLICT';
  return error;
}
function reportAmendmentReasonRequired() {
  const error = new Error('A reason is required to amend a published report.');
  error.status = 400;
  error.code = 'REPORT_AMENDMENT_REASON_REQUIRED';
  return error;
}
function markAmendmentConflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = 'MARK_AMENDMENT_CONFLICT';
  return error;
}
function attendanceCorrectionConflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = 'ATTENDANCE_CORRECTION_CONFLICT';
  return error;
}
function assertMarkTransition(currentState, targetState, enteredBy, actor, approvedBy = null) {
  const expectedPreviousState = {
    submitted: 'draft',
    approved: 'submitted',
    locked: 'approved'
  }[targetState];
  if (!expectedPreviousState || currentState !== expectedPreviousState) {
    const error = new Error(`A mark must be ${expectedPreviousState ?? 'in the required prior state'} before it can be ${targetState}.`);
    error.status = 409;
    error.code = 'MARK_TRANSITION_INVALID';
    throw error;
  }
  if (targetState === 'approved' && enteredBy === actor.sub) {
    const error = new Error('A mark cannot be approved by the person who entered it.');
    error.status = 409;
    error.code = 'MARK_APPROVER_MUST_DIFFER';
    throw error;
  }
  if (targetState === 'locked' && approvedBy === actor.sub) {
    const error = new Error('A mark cannot be published by the person who approved it.');
    error.status = 409;
    error.code = 'MARK_PUBLISHER_MUST_DIFFER';
    throw error;
  }
  if (targetState === 'locked' && !approvedBy) {
    const error = new Error('The mark has no recorded approver; it cannot be published until reviewed.');
    error.status = 409;
    error.code = 'MARK_APPROVER_NOT_RECORDED';
    throw error;
  }
}



function invalidDocument(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'INVALID_DOCUMENT';
  return error;
}

function isValidDocumentContent(mimeType, content) {
  if (mimeType === 'application/pdf') return content.subarray(0, 5).toString() === '%PDF-';
  if (mimeType === 'image/png') return content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  return false;
}

function safeFilename(filename) {
  return String(filename).split(/[\\/]/).pop().replace(/[\r\n"]/g, '_').slice(0, 180) || 'admission-document';
}

export async function createRepository(config) {
  if (config.STORAGE_MODE === 'mysql') {
    const db = knexFactory({
      client: 'mysql2',
      connection: {
        ...(config.DB_SOCKET_PATH
          ? { socketPath: config.DB_SOCKET_PATH }
          : { host: config.DB_HOST, port: config.DB_PORT }),
        user: config.DB_USER,
        password: config.DB_PASSWORD, database: config.DB_NAME, charset: 'utf8mb4',
        dateStrings: true
      },
      pool: { min: 0, max: 10 }
    });
    await db.raw('SELECT 1');
    return new MysqlRepository(
      db, config.PRIVATE_DOCUMENTS_DIR ?? '.private/admissions', config.SENSITIVE_DATA_KEY ?? ''
    );
  }
  const userId = '10000000-0000-4000-8000-000000000001';
  const orgId = '20000000-0000-4000-8000-000000000001';
  const campusId = '30000000-0000-4000-8000-000000000001';
  const passwordHash = await bcrypt.hash(config.DEMO_LOGIN_PASSWORD, 12);
  const repo = new MemoryRepository({
    sensitiveDataKey: config.SENSITIVE_DATA_KEY ?? '',
    users: [{
      id: userId, orgId, name: 'SIMS Demo Administrator',
      email: config.DEMO_LOGIN_EMAIL, phone: null, passwordHash,
      role: 'owner_director', campusIds: [campusId], activeCampusId: campusId, isActive: true
    }],
    campuses: [{
      id: campusId, organizationId: orgId, name: 'Addis Learning Campus',
      address: 'Addis Ababa, Ethiopia', phone: '', timezone: 'Africa/Addis_Ababa'
    }],
    sections: [{
      id: '70000000-0000-4000-8000-000000000001', campusId,
      academicYearId: '50000000-0000-4000-8000-000000000001',
      name: 'Grade 7A', gradeName: 'Grade 7',
      gradeLevelId: '60000000-0000-4000-8000-000000000001', isActive: true
    }],
    gradeLevels: [{
      id: '60000000-0000-4000-8000-000000000001', campusId, code: 'G7',
      nameEn: 'Grade 7', nameAm: '7ኛ ክፍል', band: 'primary', sortOrder: 7
    }],
    subjects: [{
      id: '61000000-0000-4000-8000-000000000001', campusId,
      code: 'MATH', nameEn: 'Mathematics', nameAm: 'ሂሳብ'
    }],
    academicYears: [{
      id: '50000000-0000-4000-8000-000000000001', campusId,
      labelEc: '2019 E.C.', startDate: '2026-09-11', endDate: '2027-09-10', status: 'active'
    }]
  });
  repo.students = [
    { id: '40000000-0000-4000-8000-000000000001', campusId, studentNo: 'SIMS-001', givenNameAm: 'ሳራ', fatherNameAm: 'አበበ', grandfatherNameAm: 'ተስፋዬ', givenNameEn: 'Sara', fatherNameEn: 'Abebe', grandfatherNameEn: 'Tesfaye', gender: 'female', sectionName: 'Grade 7A', status: 'enrolled', createdAt: now() },
    { id: '40000000-0000-4000-8000-000000000002', campusId, studentNo: 'SIMS-002', givenNameAm: 'ዳዊት', fatherNameAm: 'ከበደ', grandfatherNameAm: 'ገብረ', givenNameEn: 'Dawit', fatherNameEn: 'Kebede', grandfatherNameEn: 'Ghere', gender: 'male', sectionName: 'Grade 7A', status: 'enrolled', createdAt: now() },
    { id: '40000000-0000-4000-8000-000000000003', campusId, studentNo: 'SIMS-003', givenNameAm: 'ሚካኤል', fatherNameAm: 'ሀይሉ', grandfatherNameAm: 'ደሳለኝ', givenNameEn: 'Mikael', fatherNameEn: 'Hailu', grandfatherNameEn: 'Desalegn', gender: 'male', sectionName: 'Grade 7A', status: 'enrolled', createdAt: now() }
  ];
  repo.enrolments = repo.students.map((student) => ({
    id: randomUUID(), studentId: student.id, academicYearId: '50000000-0000-4000-8000-000000000001',
    sectionId: '70000000-0000-4000-8000-000000000001', status: 'active',
    enrolledOn: addisDate(), leftOn: null, outcome: null
  }));
  return repo;
}
