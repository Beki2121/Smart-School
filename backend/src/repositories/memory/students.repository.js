import { createHash, randomUUID } from 'node:crypto';
import { decryptSensitiveValue, encryptSensitiveValue, hashSensitiveIdentifier } from '../../secure-fields.js';
import { addisDate, campusScopeError, now, planLimitError, setupConflict } from '../shared.js';
import { invalidDocument, isValidDocumentContent, safeFilename } from '../documents.mappers.js';
import {
  generateStudentCredentials, mapStudent, mapStudentCommendation, mapStudentDisciplineRecord,
  mapStudentDocument, mapStudentGuardian, mapStudentTransferPackage, normalizeImportValue,
  studentForActor, studentImportReports, studentName
} from '../students.mappers.js';

export const memoryStudentsBundle = {
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
  },
  async listStudentsFor(actor) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible === null) return (await this.listStudents(actor.activeCampusId)).map((student) => studentForActor(student, actor));
    const names = new Set(this.sections.filter((section) => accessible.has(section.id)).map((section) => section.name));
    return (await this.listStudents(actor.activeCampusId))
      .filter((student) => names.has(student.sectionName))
      .map((student) => studentForActor(student, actor));
  },
  async updateStudentProfile(studentId, data, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const changedFields = Object.keys(data).filter((field) => student[field] !== data[field]);
    Object.assign(student, data);
    await this.appendAudit(actor, 'student.profile_updated', 'student', student.id, null, { fields: changedFields });
    return student;
  },
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
  },
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
  },
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
  },
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
  },
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
  },
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
  },
  async listStudentCommendations(studentId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    return this.studentCommendations.filter((item) =>
      item.studentId === studentId && item.campusId === actor.activeCampusId)
      .sort((a, b) => b.recordedOn.localeCompare(a.recordedOn) || b.createdAt.localeCompare(a.createdAt));
  },
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
  },
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
  },
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
  },
  async createStudent(data, actor) {
    await this.assertStudentCapacity(actor.orgId, 1);
    await this.assertUserCapacity(actor.orgId, 1);
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
  },
  async assertStudentCapacity(organizationId, additional = 1) {
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    const plan = subscription && this.subscriptionPlans.find((item) => item.id === subscription.planId);
    if (plan?.studentLimit == null) return;
    const campusIds = new Set(this.campuses.filter((campus) =>
      campus.organizationId === organizationId).map((campus) => campus.id));
    const count = this.students.filter((student) =>
      campusIds.has(student.campusId) && !student.archivedAt).length;
    if (count + additional > plan.studentLimit) throw planLimitError('student', plan.studentLimit);
  },
  async previewStudentImport(rows, actor) {
    const sections = this.sections.filter((section) =>
      section.campusId === actor.activeCampusId && section.isActive !== false);
    const existingStudents = this.students.filter((student) =>
      student.campusId === actor.activeCampusId && !student.archivedAt);
    return studentImportReports(rows, sections, existingStudents);
  },
  async importStudents(rows, actor) {
    const reports = await this.previewStudentImport(rows, actor);
    const eligibleRows = rows.filter((row) =>
      reports.find((report) => report.rowNumber === row.rowNumber)?.eligible);
    await this.assertStudentCapacity(actor.orgId, eligibleRows.length);
    await this.assertUserCapacity(actor.orgId, eligibleRows.length);
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
    if (stagedStudents.length) {
      await this.appendAudit(actor, 'student.imported', 'student_import', null, null, {
        createdCount: stagedStudents.length, rowNumbers: stagedStudents.map((entry) => entry.rowNumber)
      });
    }
    return { reports, createdCount: stagedStudents.length, credentials: stagedStudents.map((entry) => ({
      rowNumber: entry.rowNumber, studentNo: entry.student.studentNo, ...entry.credentials
    })) };
  },
  async hasStudents(campusId, ids) {
    const found = this.students.filter((s) => s.campusId === campusId && ids.includes(s.id));
    return found.length === ids.length;
  },
  async setStudentIdPattern(pattern, actor) {
    const campus = await this.getCampus(actor.activeCampusId);
    if (!campus) throw campusScopeError('Campus is not available.');
    const before = campus.studentIdPattern ?? '{CAMPUS}-{YEAR}-{SEQ}';
    campus.studentIdPattern = pattern;
    await this.appendAudit(actor, 'admission.student_id_pattern_updated', 'campus', campus.id, { pattern: before }, { pattern });
    return { pattern };
  },
  async storeStudentDocument(studentId, documentType, originalName, mimeType, content, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) throw campusScopeError('Student is outside the active campus.');
    if (!isValidDocumentContent(mimeType, content) ||
      (documentType === 'photo' && !['image/jpeg', 'image/png'].includes(mimeType))) {
      throw invalidDocument('The student document content does not match its declared file type.');
    }
    await this.assertStorageCapacity(actor.orgId, content.length);
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
  },
  async listStudentDocuments(studentId, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    await this.appendAudit(actor, 'student.documents_viewed', 'student', studentId, null, null);
    return this.studentDocuments.filter((item) =>
      item.studentId === studentId && item.campusId === actor.activeCampusId)
      .map(mapStudentDocument);
  },
  async getStudentDocument(studentId, documentId, actor) {
    const document = this.studentDocuments.find((item) =>
      item.id === documentId && item.studentId === studentId && item.campusId === actor.activeCampusId);
    if (!document || !this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    await this.appendAudit(actor, 'student.document_downloaded', 'student_document', documentId, null, { studentId });
    return { document: mapStudentDocument(document), content: document.content };
  },
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
  },
  async listStudentTransferPackages(studentId, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    return this.studentTransferPackages.filter((item) =>
      item.studentId === studentId && item.campusId === actor.activeCampusId)
      .map(mapStudentTransferPackage);
  },
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
  },
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
  },
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
  },
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
  },
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
  },
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
  },
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
  },
  async listStudentDisciplineRecords(studentId, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    const rows = this.studentDisciplineRecords.filter((item) =>
      item.studentId === studentId && item.campusId === actor.activeCampusId);
    await this.appendAudit(actor, 'student.discipline_viewed', 'student', studentId, null, { count: rows.length });
    return rows.map((item) => mapStudentDisciplineRecord(item, this.sensitiveDataKey));
  },
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
  },
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
  },
  async transferStudentOut(studentId, reason, actor) {
    return this.changeStudentStatus(studentId, 'transferred_out', reason, actor);
  },
  async getStudentTransferRecord(campusId, studentId) {
    const student = this.students.find((item) => item.id === studentId && item.campusId === campusId);
    const history = this.studentStatusHistory.find((item) =>
      item.studentId === studentId && item.campusId === campusId && item.status === 'transferred_out');
    return student && history ? { student, history, campus: await this.getCampus(campusId) } : null;
  }
};
