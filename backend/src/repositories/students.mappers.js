import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { decryptSensitiveValue } from '../secure-fields.js';

export function studentName(student) {
  return `${student.givenNameEn} ${student.fatherNameEn} ${student.grandfatherNameEn}`.trim();
}

export function mapStudent(row) {
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

export function normalizeImportValue(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function studentImportReports(rows, sections, existingStudents) {
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

export async function generateStudentCredentials(student, usernameExists) {
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

export function studentForActor(student, actor) {
  const { userId, ...publicStudent } = student;
  const result = { ...publicStudent, hasPortalAccount: Boolean(userId) };
  if (['owner_director', 'principal', 'registrar', 'system_admin'].includes(actor.role)) return result;
  return { ...result, guardianPhone: null };
}

export function mapStudentGuardian(row) {
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

export function mapStudentCommendation(row) {
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

export function mapStudentDocument(row) {
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

export function mapStudentDisciplineRecord(row, key) {
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

export function mapStudentTransferPackage(row) {
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
