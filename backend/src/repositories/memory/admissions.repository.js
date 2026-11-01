import { createHash, randomUUID } from 'node:crypto';
import { addisDate, campusScopeError, now, setupConflict } from '../shared.js';
import { generateStudentCredentials, studentName } from '../students.mappers.js';
import { formatStudentNo } from '../admissions.mappers.js';
import { invalidDocument, isValidDocumentContent, safeFilename } from '../documents.mappers.js';

export const memoryAdmissionsBundle = {
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
  },
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
  },
  async getAdmissionsPublicToken(campusId) {
    return this.campuses.find((item) => item.id === campusId)?.admissionsPublicToken ?? null;
  },
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
  },
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
  },
  async getAdmission(campusId, admissionId) {
    const item = this.admissions.find((row) => row.id === admissionId && row.campusId === campusId);
    return item ? this.mapAdmission(item) : null;
  },
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
  },
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
  },
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
  },
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
  },
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
  },
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
  },
  async listAdmissionDocuments(campusId, admissionId) {
    if (!this.admissions.some((item) => item.id === admissionId && item.campusId === campusId)) return [];
    return this.admissionDocuments.filter((item) => item.admissionId === admissionId)
      .map((item) => this.mapAdmissionDocument(item));
  },
  async getAdmissionDocument(campusId, admissionId, documentId) {
    if (!this.admissions.some((item) => item.id === admissionId && item.campusId === campusId)) return null;
    const document = this.admissionDocuments.find((item) =>
      item.id === documentId && item.admissionId === admissionId);
    return document ? { document: this.mapAdmissionDocument(document), content: document.content } : null;
  },
  mapAdmissionDocument(document) {
    const { content, ...metadata } = document;
    return metadata;
  },
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
};
