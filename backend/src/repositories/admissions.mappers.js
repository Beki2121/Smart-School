import { fromMysqlDateTime } from './platform.mappers.js';

export function formatStudentNo(pattern, campusName, yearLabel, sequence) {
  const campusCode = String(campusName ?? 'CAMPUS').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'CAMPUS';
  const yearCode = String(yearLabel ?? '').replace(/\D/g, '').slice(0, 4) || 'YEAR';
  return String(pattern ?? '{CAMPUS}-{YEAR}-{SEQ}')
    .replaceAll('{CAMPUS}', campusCode)
    .replaceAll('{YEAR}', yearCode)
    .replaceAll('{SEQ}', String(sequence).padStart(5, '0'));
}

export function toMysqlDateTime(value) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

export function mapAdmission(row) {
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

export function mapAdmissionDocument(row) {
  return {
    id: row.id, admissionId: row.admission_id ?? row.admissionId,
    documentType: row.document_type ?? row.documentType,
    originalName: row.original_name ?? row.originalName,
    mimeType: row.mime_type ?? row.mimeType,
    sizeBytes: Number(row.size_bytes ?? row.sizeBytes),
    sha256: row.sha256, createdAt: row.created_at ?? row.createdAt
  };
}
