import { createHash, randomUUID } from 'node:crypto';
import { addisDate, campusScopeError, now, setupConflict } from '../shared.js';
import { proratedLeaveEntitlementHalfDays } from '../hr-leave.js';

const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const maximumDocumentSize = 5 * 1024 * 1024;
const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase();
const staffNameKey = (staff) => [
  staff.givenNameEn, staff.fatherNameEn, staff.grandfatherNameEn, staff.jobTitle
].map(normalize).join('\u0000');

function hrError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function mapStaffDocument(document) {
  const { content, ...metadata } = document;
  return { ...metadata };
}

function safeFilename(value) {
  return String(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'document';
}

function localDateTime(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function dateSpanHalfDays(startDate, endDate, requestedHalfDays) {
  if (requestedHalfDays != null) return requestedHalfDays;
  return Math.floor((Date.parse(`${endDate}T00:00:00Z`) -
    Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1) * 2;
}

function hrLeaveError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export const memoryHrBundle = {
  addHrNotifications(actor, sourceType, sourceId, title, body, extraUserIds = []) {
    const roles = new Set(['hr_admin', 'owner_director', 'principal', 'system_admin']);
    const userIds = new Set(this.users.filter((user) => user.isActive !== false &&
      user.campusIds?.includes(actor.activeCampusId) && roles.has(user.role))
      .map((user) => user.id));
    for (const id of extraUserIds) if (id) userIds.add(id);
    const users = this.users.filter((user) => userIds.has(user.id));
    for (const user of users) {
      if (this.userNotifications.some((item) => item.userId === user.id &&
          item.sourceType === sourceType && item.sourceId === sourceId)) continue;
      this.userNotifications.unshift({
        id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
        userId: user.id, sourceType, sourceId, titleEn: title, titleAm: title,
        bodyEn: body, bodyAm: body, readAt: null, createdAt: now()
      });
    }
  },
  findHrStaff(staffId, actor, includeArchived = false) {
    return this.staff.find((item) => item.id === staffId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      (includeArchived || !item.archivedAt)) ?? null;
  },
  async updateHrStaff(staffId, data, actor) {
    const staff = this.findHrStaff(staffId, actor);
    if (!staff) return null;
    if (data.departmentId && !this.departments.some((item) =>
      item.id === data.departmentId && item.campusId === actor.activeCampusId)) {
      throw campusScopeError('Department is outside the active campus.');
    }
    const before = { ...staff };
    Object.assign(staff, data, { updatedAt: now() });
    await this.appendAudit(actor, 'hr.staff_updated', 'staff', staff.id, before, staff);
    return this.mapStaffWithWorkload(staff);
  },
  async archiveHrStaff(staffId, actor) {
    const staff = this.findHrStaff(staffId, actor);
    if (!staff) return null;
    const before = { archivedAt: staff.archivedAt ?? null, employmentStatus: staff.employmentStatus };
    staff.archivedAt = now();
    staff.updatedAt = staff.archivedAt;
    await this.appendAudit(actor, 'hr.staff_archived', 'staff', staff.id, before, {
      archivedAt: staff.archivedAt, retainedDocuments: this.staffDocuments.filter((item) =>
        item.staffId === staff.id).length
    });
    return { id: staff.id, archivedAt: staff.archivedAt };
  },
  async previewHrStaffImport(rows, actor) {
    const existing = new Set(this.staff.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      !item.archivedAt).map(staffNameKey));
    const seen = new Set();
    return rows.map(({ rowNumber, data }) => {
      const errors = [];
      if (data.departmentId && !this.departments.some((item) =>
        item.id === data.departmentId && item.campusId === actor.activeCampusId)) {
        errors.push({ field: 'departmentId', message: 'Department is outside the active campus.' });
      }
      const key = staffNameKey(data);
      if (existing.has(key) || seen.has(key)) {
        errors.push({ field: 'givenNameEn', message: 'A matching staff profile already exists.' });
      }
      seen.add(key);
      return { rowNumber, eligible: errors.length === 0, errors, warnings: [] };
    });
  },
  async importHrStaff(rows, actor) {
    const reports = await this.previewHrStaffImport(rows, actor);
    const eligible = rows.filter(({ rowNumber }) =>
      reports.find((report) => report.rowNumber === rowNumber)?.eligible);
    await this.assertStaffCapacity(actor.orgId, eligible.length);
    const originalLength = this.staff.length;
    try {
      const created = [];
      for (const { rowNumber, data } of eligible) {
        const staff = {
          id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
          userId: null, departmentId: data.departmentId ?? null,
          ...data, employmentStatus: data.employmentStatus ?? 'active',
          qualification: data.qualification ?? '', hiredOn: data.hiredOn ?? null,
          archivedAt: null, createdAt: now(), updatedAt: now()
        };
        this.staff.push(staff);
        await this.appendAudit(actor, 'hr.staff_imported', 'staff', staff.id, null, {
          rowNumber, fields: Object.keys(data)
        });
        created.push({ rowNumber, staff: this.mapStaffWithWorkload(staff) });
      }
      if (created.length) await this.appendAudit(actor, 'hr.staff_import_committed',
        'staff_import', null, null, { createdCount: created.length });
      return { reports, createdCount: created.length, created };
    } catch (error) {
      this.staff.splice(originalLength);
      throw error;
    }
  },
  async storeStaffDocument(staffId, category, originalName, mimeType, content, actor) {
    const staff = this.findHrStaff(staffId, actor);
    if (!staff) throw campusScopeError('Staff profile is outside the active campus.');
    if (!Buffer.isBuffer(content) || !content.length || content.length > maximumDocumentSize ||
        !allowedTypes.has(mimeType)) {
      throw hrError('INVALID_DOCUMENT', 'Upload a non-empty PDF, JPEG, or PNG file no larger than 5 MB.');
    }
    await this.assertStorageCapacity(actor.orgId, content.length);
    const document = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      staffId, category, originalName: safeFilename(originalName), mimeType,
      sizeBytes: content.length, storageKey: randomUUID(),
      sha256: createHash('sha256').update(content).digest('hex'),
      uploadedBy: actor.sub, createdAt: now(), content: Buffer.from(content)
    };
    this.staffDocuments.push(document);
    await this.appendAudit(actor, 'hr.staff_document_uploaded', 'staff_document', document.id,
      null, { staffId, category, sizeBytes: content.length, sha256: document.sha256 });
    return mapStaffDocument(document);
  },
  async listStaffDocuments(staffId, actor) {
    if (!this.findHrStaff(staffId, actor, true)) return null;
    const documents = this.staffDocuments.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.staffId === staffId).map(mapStaffDocument);
    await this.appendAudit(actor, 'hr.staff_documents_viewed', 'staff', staffId, null, {
      count: documents.length
    });
    return documents;
  },
  async getStaffDocument(staffId, documentId, actor) {
    const document = this.staffDocuments.find((item) =>
      item.id === documentId && item.staffId === staffId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    if (!document) return null;
    await this.appendAudit(actor, 'hr.staff_document_downloaded', 'staff_document', document.id,
      null, { staffId, category: document.category });
    return { document: mapStaffDocument(document), content: Buffer.from(document.content) };
  },
  async listHrContracts(actor, staffId) {
    if (staffId && !this.findHrStaff(staffId, actor, true)) return null;
    return this.hrContracts.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      (!staffId || item.staffId === staffId) && !item.archivedAt)
      .sort((left, right) => left.startsOn.localeCompare(right.startsOn));
  },
  async listHrContractsExpiring(actor, throughDate) {
    return this.hrContracts.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.status === 'active' && !item.archivedAt && item.endsOn &&
      item.endsOn <= throughDate).sort((left, right) => left.endsOn.localeCompare(right.endsOn));
  },
  async createHrContract(staffId, data, actor) {
    const staff = this.findHrStaff(staffId, actor);
    if (!staff) return null;
    const collision = this.hrContracts.some((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.staffId === staffId && item.status === 'active' && !item.archivedAt &&
      (!data.endsOn || item.startsOn <= data.endsOn) &&
      (!item.endsOn || data.startsOn <= item.endsOn));
    if (collision) throw setupConflict('This staff member already has an overlapping active contract.');
    const contract = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      staffId, ...data, status: 'active', createdBy: actor.sub,
      createdAt: now(), updatedAt: null, archivedAt: null
    };
    this.hrContracts.push(contract);
    await this.appendAudit(actor, 'hr.contract_created', 'hr_contract', contract.id, null, contract);
    return contract;
  },
  async renewHrContract(contractId, data, actor) {
    const contract = this.hrContracts.find((item) =>
      item.id === contractId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && item.status === 'active' && !item.archivedAt);
    if (!contract) return null;
    if (contract.endsOn && data.newEndDate <= contract.endsOn) {
      throw setupConflict('A renewal end date must be later than the current end date.');
    }
    const before = { endsOn: contract.endsOn };
    const renewal = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      contractId, previousEndDate: contract.endsOn ?? null,
      newEndDate: data.newEndDate, renewedBy: actor.sub, renewedAt: now()
    };
    contract.endsOn = data.newEndDate;
    contract.renewalDueOn = null;
    contract.updatedAt = now();
    this.hrContractRenewals.push(renewal);
    await this.appendAudit(actor, 'hr.contract_renewed', 'hr_contract', contractId,
      before, { endsOn: contract.endsOn, renewalId: renewal.id });
    return { contract, renewal };
  },
  async listHrContractRenewals(contractId, actor) {
    const contract = this.hrContracts.find((item) =>
      item.id === contractId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId);
    if (!contract) return null;
    return this.hrContractRenewals.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.contractId === contractId);
  },
  async listHrLeaveTypes(actor) {
    return this.hrLeaveTypes.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)
      .sort((left, right) => left.name.localeCompare(right.name));
  },
  async createHrLeaveType(data, actor) {
    if (this.hrLeaveTypes.some((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.name.toLocaleLowerCase() === data.name.toLocaleLowerCase())) {
      throw setupConflict('A leave type with this name already exists.');
    }
    const leaveType = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, createdAt: now(), updatedAt: null
    };
    this.hrLeaveTypes.push(leaveType);
    await this.appendAudit(actor, 'hr.leave_type_created', 'hr_leave_type',
      leaveType.id, null, leaveType);
    return leaveType;
  },
  async setHrLeaveBalance(data, actor) {
    const staff = this.findHrStaff(data.staffId, actor, true);
    const leaveType = this.hrLeaveTypes.find((item) =>
      item.id === data.leaveTypeId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId);
    if (!staff || !leaveType) throw campusScopeError('Staff or leave type is outside the active campus.');
    const prior = this.hrLeaveBalances.find((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.staffId === data.staffId && item.leaveTypeId === data.leaveTypeId &&
      item.year === data.year);
    const before = prior ? { ...prior } : null;
    const entitledHalfDays = data.entitledHalfDays ?? proratedLeaveEntitlementHalfDays(
      leaveType.annualEntitlementHalfDays, staff.hiredOn, data.year
    );
    const carryOverHalfDays = Math.min(data.carryOverHalfDays, leaveType.carryOverLimitHalfDays);
    if ((prior?.usedHalfDays ?? 0) > entitledHalfDays + carryOverHalfDays) {
      throw setupConflict('The updated entitlement cannot be lower than leave already used.');
    }
    const balance = prior ?? {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      staffId: data.staffId, leaveTypeId: data.leaveTypeId, year: data.year, usedHalfDays: 0
    };
    Object.assign(balance, {
      entitledHalfDays,
      carryOverHalfDays,
      updatedAt: now()
    });
    if (!prior) this.hrLeaveBalances.push(balance);
    await this.appendAudit(actor, 'hr.leave_balance_set', 'hr_leave_balance',
      balance.id, before, balance);
    return balance;
  },
  async listHrLeaveBalances(actor, staffId) {
    if (staffId && !this.findHrStaff(staffId, actor, true)) return null;
    return this.hrLeaveBalances.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      (!staffId || item.staffId === staffId)).map((item) => ({
      ...item,
      remainingHalfDays: Math.max(0,
        item.entitledHalfDays + item.carryOverHalfDays - item.usedHalfDays),
      leaveType: this.hrLeaveTypes.find((leaveType) => leaveType.id === item.leaveTypeId)?.name
    }));
  },
  async getApprovedHrLeaveForPeriod(staffId, from, to, actor) {
    if (!this.findHrStaff(staffId, actor, true)) return null;
    return this.leaveRequests.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.staffId === staffId && item.status === 'approved' &&
      item.startDate <= to && item.endDate >= from).map((item) => ({
      staffId, leaveTypeId: item.leaveTypeId ?? null,
      kind: this.hrLeaveTypes.find((type) => type.id === item.leaveTypeId)?.kind ?? 'unpaid',
      startDate: item.startDate, endDate: item.endDate,
      requestedHalfDays: item.requestedHalfDays
    })).sort((left, right) => left.startDate.localeCompare(right.startDate));
  },
  async getStaffAttendanceForPeriod(staffId, from, to, actor) {
    if (!this.findHrStaff(staffId, actor, true)) return null;
    return this.staffAttendance.filter((item) =>
      item.campusId === actor.activeCampusId && item.staffId === staffId &&
      item.date >= from && item.date <= to).map((item) => this.mapStaffAttendance(item));
  },
  async getHrDashboard(actor) {
    const staff = this.staff.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      !item.archivedAt);
    const today = addisDate();
    const throughDate = new Date(`${today}T00:00:00Z`);
    throughDate.setUTCDate(throughDate.getUTCDate() + 30);
    const through = throughDate.toISOString().slice(0, 10);
    const expiring = this.hrContracts.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.status === 'active' && !item.archivedAt && item.endsOn &&
      item.endsOn >= today && item.endsOn <= through);
    for (const contract of expiring) this.addHrNotifications(actor,
      'hr_contract_expiry', contract.id, 'Contract expiry reminder',
      `Contract ${contract.id} expires on ${contract.endsOn}.`);
    return {
      totalStaff: staff.length,
      activeStaff: staff.filter((item) => item.employmentStatus === 'active').length,
      pendingLeaveRequests: this.leaveRequests.filter((item) =>
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
        item.status === 'pending').length,
      contractsExpiringWithin30Days: expiring.length
    };
  },
  async listHrVacancies(actor) {
    return this.hrVacancies.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },
  async createHrVacancy(data, actor) {
    if (data.departmentId && !this.departments.some((item) =>
      item.id === data.departmentId && item.campusId === actor.activeCampusId)) {
      throw campusScopeError('Department is outside the active campus.');
    }
    const vacancy = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'open', createdBy: actor.sub, createdAt: now(), updatedAt: null
    };
    this.hrVacancies.push(vacancy);
    await this.appendAudit(actor, 'hr.vacancy_created', 'hr_vacancy', vacancy.id, null, vacancy);
    return vacancy;
  },
  async listHrApplicants(actor, vacancyId) {
    return this.hrApplicants.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      (!vacancyId || item.vacancyId === vacancyId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },
  async createHrApplicant(vacancyId, data, actor) {
    const vacancy = this.hrVacancies.find((item) =>
      item.id === vacancyId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && item.status === 'open');
    if (!vacancy) return null;
    const existing = this.hrApplicants.find((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.vacancyId === vacancyId && normalize(item.email) === normalize(data.email));
    if (existing) return existing;
    const applicant = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      vacancyId, ...data, status: 'received', staffId: null,
      createdAt: now(), updatedAt: null
    };
    this.hrApplicants.push(applicant);
    await this.appendAudit(actor, 'hr.applicant_created', 'hr_applicant', applicant.id, null, applicant);
    return applicant;
  },
  async scheduleHrInterview(applicantId, data, actor) {
    const applicant = this.hrApplicants.find((item) =>
      item.id === applicantId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && !['hired', 'rejected'].includes(item.status));
    if (!applicant) return null;
    const interview = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      applicantId, ...data, scheduledAt: localDateTime(data.scheduledAt),
      status: 'scheduled', createdBy: actor.sub, createdAt: now()
    };
    this.hrInterviews.push(interview);
    await this.appendAudit(actor, 'hr.interview_scheduled', 'hr_interview',
      interview.id, null, interview);
    this.addHrNotifications(actor, 'hr_interview_scheduled', interview.id,
      'Interview scheduled', `An interview was scheduled for applicant ${applicantId}.`);
    return interview;
  },
  async listHrInterviews(applicantId, actor) {
    if (!this.hrApplicants.some((item) => item.id === applicantId &&
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)) return null;
    return this.hrInterviews.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.applicantId === applicantId).sort((left, right) =>
      String(left.scheduledAt).localeCompare(String(right.scheduledAt)));
  },
  async decideHrApplicant(applicantId, decision, actor) {
    const applicant = this.hrApplicants.find((item) =>
      item.id === applicantId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId);
    if (!applicant) return null;
    if (applicant.staffId && applicant.status === 'hired') return applicant;
    if (!['received', 'shortlisted'].includes(applicant.status)) {
      throw setupConflict('This applicant cannot transition from the current status.');
    }
    const before = { status: applicant.status, staffId: applicant.staffId };
    if (decision.decision === 'hired') {
      const vacancy = this.hrVacancies.find((item) => item.id === applicant.vacancyId &&
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
      if (!vacancy) throw campusScopeError('Vacancy is outside the active campus.');
      await this.assertStaffCapacity(actor.orgId, 1);
      const staff = {
        id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
        userId: null, departmentId: vacancy.departmentId, givenNameEn: applicant.givenName,
        fatherNameEn: applicant.fatherName, grandfatherNameEn: applicant.grandfatherName,
        givenNameAm: '', fatherNameAm: '', grandfatherNameAm: '', jobTitle: vacancy.title,
        qualification: '', employmentStatus: 'active', hiredOn: now().slice(0, 10),
        archivedAt: null
      };
      this.staff.push(staff);
      applicant.staffId = staff.id;
    }
    applicant.status = decision.decision;
    applicant.updatedAt = now();
    await this.appendAudit(actor, `hr.applicant_${decision.decision}`, 'hr_applicant',
      applicant.id, before, { ...applicant, reason: decision.reason });
    return applicant;
  },
  async storeHrApplicantDocument(applicantId, category, originalName, mimeType, content, actor) {
    if (!this.hrApplicants.some((item) => item.id === applicantId &&
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)) return null;
    if (!Buffer.isBuffer(content) || !content.length || content.length > maximumDocumentSize ||
        !allowedTypes.has(mimeType)) throw hrError('INVALID_DOCUMENT',
      'Upload a non-empty PDF, JPEG, or PNG file no larger than 5 MB.');
    await this.assertStorageCapacity(actor.orgId, content.length);
    const document = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      applicantId, category, originalName: safeFilename(originalName), mimeType,
      sizeBytes: content.length, storageKey: randomUUID(),
      sha256: createHash('sha256').update(content).digest('hex'),
      uploadedBy: actor.sub, createdAt: now(), content: Buffer.from(content)
    };
    this.hrApplicantDocuments.push(document);
    await this.appendAudit(actor, 'hr.applicant_document_uploaded', 'hr_applicant_document',
      document.id, null, { applicantId, category, sizeBytes: content.length, sha256: document.sha256 });
    const { content: storedContent, ...metadata } = document;
    return metadata;
  },
  async listHrApplicantDocuments(applicantId, actor) {
    if (!this.hrApplicants.some((item) => item.id === applicantId &&
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)) return null;
    return this.hrApplicantDocuments.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.applicantId === applicantId).map(({ content, ...metadata }) => metadata);
  },
  async getHrApplicantDocument(applicantId, documentId, actor) {
    const document = this.hrApplicantDocuments.find((item) =>
      item.id === documentId && item.applicantId === applicantId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    if (!document) return null;
    await this.appendAudit(actor, 'hr.applicant_document_downloaded',
      'hr_applicant_document', document.id, null, { applicantId, category: document.category });
    const { content, ...metadata } = document;
    return { document: metadata, content: Buffer.from(content) };
  },
  async createHrPerformanceCycle(data, actor) {
    if (this.hrPerformanceCycles.some((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.name.toLocaleLowerCase() === data.name.toLocaleLowerCase())) {
      throw setupConflict('A performance cycle with this name already exists.');
    }
    const cycle = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'open', createdBy: actor.sub, createdAt: now(), updatedAt: null
    };
    this.hrPerformanceCycles.push(cycle);
    await this.appendAudit(actor, 'hr.performance_cycle_created', 'hr_performance_cycle',
      cycle.id, null, cycle);
    return cycle;
  },
  async listHrPerformanceCycles(actor) {
    return this.hrPerformanceCycles.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
  },
  async createHrPerformanceGoal(data, actor) {
    if (!this.findHrStaff(data.staffId, actor, true) ||
        !this.hrPerformanceCycles.some((item) => item.id === data.cycleId &&
          item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)) {
      throw campusScopeError('Staff or performance cycle is outside the active campus.');
    }
    const goal = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'open', createdBy: actor.sub, createdAt: now(), updatedAt: null
    };
    this.hrPerformanceGoals.push(goal);
    await this.appendAudit(actor, 'hr.performance_goal_created', 'hr_performance_goal',
      goal.id, null, goal);
    return goal;
  },
  async listHrPerformanceGoals(actor, staffId) {
    if (staffId && !this.findHrStaff(staffId, actor, true)) return null;
    return this.hrPerformanceGoals.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      (!staffId || item.staffId === staffId));
  },
  async createHrPerformanceEvaluation(data, actor) {
    if (!this.findHrStaff(data.staffId, actor, true) ||
        !this.hrPerformanceCycles.some((item) => item.id === data.cycleId &&
          item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)) {
      throw campusScopeError('Staff or performance cycle is outside the active campus.');
    }
    const existing = this.hrPerformanceEvaluations.find((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.staffId === data.staffId && item.cycleId === data.cycleId);
    if (existing) return existing;
    const evaluation = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, evaluatedBy: actor.sub, createdAt: now(), updatedAt: null
    };
    this.hrPerformanceEvaluations.push(evaluation);
    await this.appendAudit(actor, 'hr.performance_evaluated', 'hr_performance_evaluation',
      evaluation.id, null, evaluation);
    return evaluation;
  },
  async listHrPerformanceEvaluations(actor, staffId) {
    if (staffId && !this.findHrStaff(staffId, actor, true)) return null;
    return this.hrPerformanceEvaluations.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      (!staffId || item.staffId === staffId));
  },
  async createHrTrainingCourse(data, actor) {
    const course = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'open', createdBy: actor.sub, createdAt: now(), updatedAt: null
    };
    this.hrTrainingCourses.push(course);
    await this.appendAudit(actor, 'hr.training_course_created', 'hr_training_course',
      course.id, null, course);
    return course;
  },
  async listHrTrainingCourses(actor) {
    return this.hrTrainingCourses.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
  },
  async enrollHrTraining(courseId, staffId, actor) {
    const course = this.hrTrainingCourses.find((item) => item.id === courseId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.status === 'open');
    if (!course || !this.findHrStaff(staffId, actor, true)) return null;
    const existing = this.hrTrainingEnrollments.find((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.courseId === courseId && item.staffId === staffId);
    if (existing) return existing;
    const enrollment = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      courseId, staffId, status: 'enrolled', createdAt: now(), updatedAt: null
    };
    this.hrTrainingEnrollments.push(enrollment);
    await this.appendAudit(actor, 'hr.training_enrolled', 'hr_training_enrollment',
      enrollment.id, null, enrollment);
    this.addHrNotifications(actor, 'hr_training_enrolled', enrollment.id,
      'Training enrollment', `A staff member enrolled in ${course.title}.`);
    return enrollment;
  },
  async listHrTrainingEnrollments(courseId, actor) {
    if (!this.hrTrainingCourses.some((item) => item.id === courseId &&
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)) return null;
    return this.hrTrainingEnrollments.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.courseId === courseId).map((item) => ({
      id: item.id, organizationId: item.organizationId, campusId: item.campusId,
      courseId: item.courseId, staffId: item.staffId, status: item.status,
      certificateName: item.certificateName ?? null
    }));
  },
  async updateHrTrainingAttendance(enrollmentId, status, actor) {
    const enrollment = this.hrTrainingEnrollments.find((item) =>
      item.id === enrollmentId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId);
    if (!enrollment) return null;
    const before = { status: enrollment.status };
    enrollment.status = status;
    enrollment.updatedAt = now();
    await this.appendAudit(actor, 'hr.training_attendance_updated', 'hr_training_enrollment',
      enrollment.id, before, { status });
    return enrollment;
  },
  async storeHrTrainingCertificate(enrollmentId, originalName, mimeType, content, actor) {
    const enrollment = this.hrTrainingEnrollments.find((item) =>
      item.id === enrollmentId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId);
    if (!enrollment) return null;
    if (!Buffer.isBuffer(content) || !content.length || content.length > maximumDocumentSize ||
        !allowedTypes.has(mimeType)) throw hrError('INVALID_DOCUMENT',
      'Upload a non-empty PDF, JPEG, or PNG file no larger than 5 MB.');
    await this.assertStorageCapacity(actor.orgId, content.length);
    const before = { certificateName: enrollment.certificateName ?? null };
    Object.assign(enrollment, {
      certificateName: safeFilename(originalName), certificateMimeType: mimeType,
      certificateSizeBytes: content.length, certificateStorageKey: randomUUID(),
      certificateSha256: createHash('sha256').update(content).digest('hex'),
      certificateContent: Buffer.from(content), updatedAt: now()
    });
    await this.appendAudit(actor, 'hr.training_certificate_uploaded', 'hr_training_enrollment',
      enrollment.id, before, {
        certificateName: enrollment.certificateName,
        sizeBytes: enrollment.certificateSizeBytes,
        sha256: enrollment.certificateSha256
      });
    const { certificateContent, ...result } = enrollment;
    return result;
  },
  async getHrTrainingCertificate(enrollmentId, actor) {
    const enrollment = this.hrTrainingEnrollments.find((item) =>
      item.id === enrollmentId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && item.certificateContent);
    if (!enrollment) return null;
    await this.appendAudit(actor, 'hr.training_certificate_downloaded',
      'hr_training_enrollment', enrollment.id, null, {
        certificateName: enrollment.certificateName
      });
    return {
      name: enrollment.certificateName, mimeType: enrollment.certificateMimeType,
      content: Buffer.from(enrollment.certificateContent)
    };
  }
};
