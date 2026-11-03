import { basename } from 'node:path';

export const ASSIGNMENT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ASSIGNMENT_MIME_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

export function assignmentConflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = 'ASSIGNMENT_CONFLICT';
  return error;
}

export function validateAssignmentFile(file) {
  const content = Buffer.from(file.content);
  const signatures = {
    'application/pdf': content.subarray(0, 5).toString() === '%PDF-',
    'image/jpeg': content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff,
    'image/png': content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/webp': content.length >= 12 && content.subarray(0, 4).toString() === 'RIFF' &&
      content.subarray(8, 12).toString() === 'WEBP',
    'text/plain': !content.includes(0),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      content.length >= 4 && content[0] === 0x50 && content[1] === 0x4b
  };
  if (!content.length || content.length > ASSIGNMENT_MAX_FILE_BYTES ||
      !ASSIGNMENT_MIME_TYPES.has(file.mimeType) || !signatures[file.mimeType]) {
    const error = new Error('Unsupported or invalid assignment attachment.');
    error.status = content.length > ASSIGNMENT_MAX_FILE_BYTES ? 413 : 400;
    error.code = 'ASSIGNMENT_ATTACHMENT_INVALID';
    throw error;
  }
  const originalName = basename(file.originalName).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);
  if (!originalName) {
    const error = new Error('Attachment filename is required.');
    error.status = 400;
    error.code = 'ASSIGNMENT_ATTACHMENT_INVALID';
    throw error;
  }
  return { ...file, originalName, content };
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value == null ? null : String(value);
}

export function mapAssignment(row, attachments = []) {
  return {
    id: row.id, organizationId: row.organization_id ?? row.organizationId,
    campusId: row.campus_id ?? row.campusId,
    academicYearId: row.academic_year_id ?? row.academicYearId,
    termId: row.term_id ?? row.termId,
    gradeLevelId: row.grade_level_id ?? row.gradeLevelId,
    sectionId: row.section_id ?? row.sectionId, sectionName: row.section_name ?? row.sectionName ?? '',
    subjectId: row.subject_id ?? row.subjectId, subjectName: row.subject_name ?? row.subjectName ?? '',
    title: row.title, instructions: row.instructions, dueAt: iso(row.due_at ?? row.dueAt),
    status: row.status, createdBy: row.created_by ?? row.createdBy,
    publishedAt: iso(row.published_at ?? row.publishedAt),
    createdAt: iso(row.created_at ?? row.createdAt), updatedAt: iso(row.updated_at ?? row.updatedAt),
    attachments
  };
}

export function mapAssignmentAttachment(row) {
  return {
    id: row.id, assignmentId: row.assignment_id ?? row.assignmentId,
    submissionId: row.submission_id ?? row.submissionId ?? null,
    type: row.attachment_type ?? row.type, originalName: row.original_name ?? row.originalName,
    mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes),
    sha256: row.sha256, uploadedBy: row.uploaded_by ?? row.uploadedBy,
    createdAt: iso(row.created_at ?? row.createdAt)
  };
}

export function mapAssignmentSubmission(row, attachments = []) {
  return {
    id: row.id, assignmentId: row.assignment_id ?? row.assignmentId,
    studentId: row.student_id ?? row.studentId, studentName: row.student_name ?? row.studentName ?? '',
    text: row.text, submittedAt: iso(row.submitted_at ?? row.submittedAt),
    isLate: Boolean(row.is_late ?? row.isLate), grade: row.grade == null ? null : Number(row.grade),
    feedback: row.feedback, gradedBy: row.graded_by ?? row.gradedBy ?? null,
    gradedAt: iso(row.graded_at ?? row.gradedAt), status: row.status, attachments
  };
}
