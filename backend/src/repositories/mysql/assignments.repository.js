import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditRow, campusScopeError, setupConflict } from '../shared.js';
import {
  assignmentConflict, mapAssignment, mapAssignmentAttachment, mapAssignmentSubmission,
  validateAssignmentFile
} from '../assignments.mappers.js';

function mapDate(value) {
  return value instanceof Date ? value.toISOString() : value == null ? null : String(value);
}

function assignmentRow(row, attachments = []) {
  return mapAssignment({
    ...row, due_at: mapDate(row.due_at), published_at: mapDate(row.published_at),
    created_at: mapDate(row.created_at), updated_at: mapDate(row.updated_at)
  }, attachments);
}

function submissionRow(row, attachments = []) {
  return mapAssignmentSubmission({
    ...row, submitted_at: mapDate(row.submitted_at), graded_at: mapDate(row.graded_at),
    created_at: mapDate(row.created_at), updated_at: mapDate(row.updated_at)
  }, attachments);
}

function isManager(actor) {
  return ['owner_director', 'principal', 'academic_head', 'system_admin'].includes(actor.role);
}

function mayManageAcrossClasses(actor) {
  return ['owner_director', 'academic_head', 'principal', 'system_admin'].includes(actor.role);
}

function validateGrade(grade) {
  if (!Number.isFinite(grade) || grade < 0 || grade > 1000 || !Number.isInteger(grade * 100)) {
    throw assignmentConflict('Assignment grades must be from 0 to 1000 with at most two decimal places.');
  }
}

async function teacherScope(trx, actor, sectionId, subjectId) {
  const row = await trx('teaching_assignments as ta')
    .join('staff as st', 'st.id', 'ta.staff_id')
    .where({
      'ta.campus_id': actor.activeCampusId, 'ta.section_id': sectionId,
      'ta.subject_id': subjectId, 'ta.is_active': true, 'st.user_id': actor.sub
    }).whereNull('st.archived_at').first('ta.id');
  if (!row) {
    throw campusScopeError('Teachers may manage assignments only for their assigned class and subject.');
  }
}

async function checkAssignmentContext(trx, actor, data) {
  const [campus, section, year, term, subject] = await Promise.all([
    trx('campuses').where({ id: actor.activeCampusId, organization_id: actor.orgId }).first('id'),
    trx('sections').where({
      id: data.sectionId, campus_id: actor.activeCampusId,
      grade_level_id: data.gradeLevelId, academic_year_id: data.academicYearId
    }).first('id'),
    trx('academic_years').where({
      id: data.academicYearId, campus_id: actor.activeCampusId
    }).first('id'),
    trx('terms').where({ id: data.termId, academic_year_id: data.academicYearId }).first('id'),
    trx('subjects').where({ id: data.subjectId, campus_id: actor.activeCampusId }).first('id')
  ]);
  if (!campus || !section || !year || !term || !subject) {
    throw campusScopeError('Assignment class, subject, and academic period must belong to the active campus.');
  }
  if (!mayManageAcrossClasses(actor)) {
    await teacherScope(trx, actor, data.sectionId, data.subjectId);
  }
}

async function assignmentAttachments(query, assignmentIds, type = 'assignment') {
  if (!assignmentIds.length) return new Map();
  const rows = await query('assignment_attachments').whereIn('assignment_id', assignmentIds)
    .where({ attachment_type: type });
  const result = new Map();
  for (const row of rows) {
    const items = result.get(row.assignment_id) ?? [];
    items.push(mapAssignmentAttachment(row));
    result.set(row.assignment_id, items);
  }
  return result;
}

async function loadAssignment(query, id, actor) {
  return query('assignments as a')
    .join('sections as sec', 'sec.id', 'a.section_id')
    .join('subjects as sub', 'sub.id', 'a.subject_id')
    .where({
      'a.id': id, 'a.organization_id': actor.orgId, 'a.campus_id': actor.activeCampusId
    }).select('a.*', 'sec.name as section_name', 'sub.name_en as subject_name').first();
}

async function notifyAssignmentRecipients(trx, assignment, sourceType, userIds) {
  const title = sourceType === 'assignment_due_soon' ? 'Assignment due soon' : 'New assignment';
  const titleAm = sourceType === 'assignment_due_soon' ? 'የቤት ሥራ ቀነ ገደብ ቀርቧል' : 'አዲስ የቤት ሥራ';
  const sourceId = assignment.id;
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    await trx('user_notifications').insert({
      id: randomUUID(), campus_id: assignment.campus_id, organization_id: assignment.organization_id,
      user_id: userId, source_type: sourceType, source_id: sourceId,
      title_en: title, title_am: titleAm, body_en: assignment.title, body_am: assignment.title
    }).onConflict(['user_id', 'source_type', 'source_id']).ignore();
  }
}

async function assignmentRecipients(trx, assignment) {
  const rows = await trx('students as s')
    .join('enrolments as e', 'e.student_id', 's.id')
    .leftJoin('student_guardians as sg', function joinGuardians() {
      this.on('sg.student_id', '=', 's.id').andOn('sg.is_verified', '=', trx.raw('?', [true]));
    })
    .leftJoin('guardians as g', 'g.id', 'sg.guardian_id')
    .where({
      's.campus_id': assignment.campus_id, 's.status': 'enrolled',
      'e.academic_year_id': assignment.academic_year_id,
      'e.section_id': assignment.section_id, 'e.status': 'active'
    }).whereNull('s.archived_at')
    .where((query) => query.whereNull('g.id').orWhere('g.organization_id', assignment.organization_id))
    .select('s.user_id', 'g.user_id as guardian_user_id');
  return rows.flatMap((row) => [row.user_id, row.guardian_user_id]).filter(Boolean);
}

async function portalStudentAssignmentQuery(trx, actor) {
  const query = trx('assignments as a')
    .join('enrolments as e', function joinEnrolment() {
      this.on('e.academic_year_id', '=', 'a.academic_year_id')
        .andOn('e.section_id', '=', 'a.section_id').andOn('e.status', '=', trx.raw('?', ['active']));
    })
    .join('students as s', 's.id', 'e.student_id')
    .join('sections as sec', 'sec.id', 'a.section_id')
    .join('subjects as sub', 'sub.id', 'a.subject_id')
    .where({
      'a.organization_id': actor.orgId,
      's.status': 'enrolled'
    }).whereIn('a.status', ['published', 'closed'])
    .whereIn('a.campus_id', actor.campusIds ?? [])
    .whereNull('s.archived_at');
  if (actor.role === 'student') {
    query.where('s.user_id', actor.sub);
  } else if (actor.role === 'parent_guardian') {
    query.join('student_guardians as sg', function joinGuardian() {
      this.on('sg.student_id', '=', 's.id').andOn('sg.is_verified', '=', trx.raw('?', [true]));
    }).join('guardians as g', 'g.id', 'sg.guardian_id')
      .where({ 'g.user_id': actor.sub, 'g.organization_id': actor.orgId });
    } else {
    query.whereRaw('1 = 0');
  }
  return query.select('a.*', 'sec.name as section_name', 'sub.name_en as subject_name',
    's.id as student_id', 's.given_name_en', 's.father_name_en');
}

async function studentForActor(trx, actor) {
  return trx('students').where({
    user_id: actor.sub, campus_id: actor.activeCampusId, status: 'enrolled'
  }).whereNull('archived_at').first('id');
}

async function studentBelongsToAssignment(trx, studentId, assignment) {
  return trx('enrolments').where({
    student_id: studentId, academic_year_id: assignment.academic_year_id,
    section_id: assignment.section_id, status: 'active'
  }).first('id');
}

function relativeStoragePath(root, storageKey) {
  const absolute = path.resolve(root, storageKey);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Assignment attachment storage key escaped the private storage directory.');
  }
  return absolute;
}

async function persistAttachment(repo, trx, assignment, submission, file, actor, type) {
  const validFile = validateAssignmentFile(file);
  await repo.assertStorageCapacity(actor.orgId, validFile.content.length, 0, trx);
  const id = randomUUID();
  const storageKey = path.join(actor.orgId, actor.activeCampusId, 'assignments', assignment.id, id);
  const filePath = relativeStoragePath(repo.privateDocumentsDir, storageKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, validFile.content, { flag: 'wx' });
  try {
    const row = {
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      assignment_id: assignment.id, submission_id: submission?.id ?? null,
      attachment_type: type, original_name: validFile.originalName,
      mime_type: validFile.mimeType, size_bytes: validFile.content.length,
      storage_key: storageKey, sha256: createHash('sha256').update(validFile.content).digest('hex'),
      uploaded_by: actor.sub
    };
    await trx('assignment_attachments').insert(row);
    await trx('audit_log').insert(auditRow(actor,
      type === 'assignment' ? 'assignment.attachment_uploaded' : 'assignment.submission_attachment_uploaded',
      'assignment_attachment', id, null, mapAssignmentAttachment(row)));
    return mapAssignmentAttachment(row);
  } catch (error) {
    await unlink(filePath).catch((cleanupError) => {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    });
    throw error;
  }
}

async function loadSubmission(query, row) {
  const attachments = await query('assignment_attachments').where({
    assignment_id: row.assignment_id, submission_id: row.id, attachment_type: 'submission'
  });
  return submissionRow(row, attachments.map(mapAssignmentAttachment));
}

export const mysqlAssignmentsBundle = {
  async listAssignments(actor) {
    const campus = await this.db('campuses').where({
      id: actor.activeCampusId, organization_id: actor.orgId
    }).first('id');
    if (!campus) return [];
    let query = this.db('assignments as a')
      .join('sections as sec', 'sec.id', 'a.section_id')
      .join('subjects as sub', 'sub.id', 'a.subject_id')
      .where({
        'a.organization_id': actor.orgId, 'a.campus_id': actor.activeCampusId
      }).whereNot('a.status', 'archived')
      .select('a.*', 'sec.name as section_name', 'sub.name_en as subject_name');
    if (!isManager(actor)) {
      const staff = await this.db('staff').where({
        user_id: actor.sub, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!staff) return [];
      const teaching = await this.db('teaching_assignments').where({
        staff_id: staff.id, campus_id: actor.activeCampusId, is_active: true
      }).select('section_id', 'subject_id');
      if (!teaching.length) return [];
      query = query.where((builder) => {
        teaching.forEach(({ section_id, subject_id }) =>
          builder.orWhere({ 'a.section_id': section_id, 'a.subject_id': subject_id }));
      });
    }
    const rows = await query.orderBy('a.created_at', 'desc');
    const attachments = await assignmentAttachments(this.db, rows.map((row) => row.id));
    return rows.map((row) => assignmentRow(row, attachments.get(row.id) ?? []));
  },

  async createAssignment(data, actor) {
    const id = randomUUID();
    const row = {
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      academic_year_id: data.academicYearId, term_id: data.termId,
      grade_level_id: data.gradeLevelId, section_id: data.sectionId,
      subject_id: data.subjectId, title: data.title, instructions: data.instructions,
      due_at: new Date(data.dueAt), status: 'draft', created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await checkAssignmentContext(trx, actor, data);
      await trx('assignments').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'assignment.created', 'assignment', id, null, data));
    });
    return assignmentRow(await loadAssignment(this.db, id, actor));
  },

  async updateAssignment(id, data, actor) {
    return this.db.transaction(async (trx) => {
      const row = await loadAssignment(trx, id, actor);
      if (!row) return null;
      const locked = await trx('assignments').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!locked) return null;
      if (!mayManageAcrossClasses(actor)) {
        await teacherScope(trx, actor, locked.section_id, locked.subject_id);
      }
      if (locked.status !== 'draft') throw assignmentConflict('Only draft assignments can be edited.');
      const next = {
        academicYearId: data.academicYearId ?? locked.academic_year_id,
        termId: data.termId ?? locked.term_id, gradeLevelId: data.gradeLevelId ?? locked.grade_level_id,
        sectionId: data.sectionId ?? locked.section_id, subjectId: data.subjectId ?? locked.subject_id,
        title: data.title ?? locked.title, instructions: data.instructions ?? locked.instructions,
        dueAt: data.dueAt ?? mapDate(locked.due_at)
      };
      await checkAssignmentContext(trx, actor, next);
      const before = assignmentRow({ ...locked, section_name: row.section_name, subject_name: row.subject_name });
      await trx('assignments').where({ id, organization_id: actor.orgId, campus_id: actor.activeCampusId })
        .update({
          academic_year_id: next.academicYearId, term_id: next.termId,
          grade_level_id: next.gradeLevelId, section_id: next.sectionId,
          subject_id: next.subjectId, title: next.title, instructions: next.instructions,
          due_at: new Date(next.dueAt), updated_at: trx.fn.now()
        });
      const updated = await loadAssignment(trx, id, actor);
      await trx('audit_log').insert(auditRow(actor, 'assignment.updated', 'assignment',
        id, before, assignmentRow(updated)));
      return assignmentRow(updated);
    });
  },

  async transitionAssignment(id, status, actor) {
    return this.db.transaction(async (trx) => {
      const assignment = await trx('assignments').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!assignment) return null;
      if (!mayManageAcrossClasses(actor)) {
        await teacherScope(trx, actor, assignment.section_id, assignment.subject_id);
      }
      const valid = (assignment.status === 'draft' && status === 'published') ||
        (assignment.status === 'published' && status === 'closed') ||
        (assignment.status === 'closed' && status === 'archived');
      if (!valid) throw assignmentConflict(`Cannot transition an assignment from ${assignment.status} to ${status}.`);
      const before = assignmentRow(assignment);
      const timestamp = new Date();
      await trx('assignments').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).update({
        status, published_at: status === 'published' ? timestamp : assignment.published_at,
        closed_at: status === 'closed' ? timestamp : assignment.closed_at,
        archived_at: status === 'archived' ? timestamp : assignment.archived_at,
        updated_at: trx.fn.now()
      });
      const updated = await loadAssignment(trx, id, actor);
      await trx('audit_log').insert(auditRow(actor, `assignment.${status}`, 'assignment',
        id, before, assignmentRow(updated)));
      if (status === 'published') {
        await notifyAssignmentRecipients(trx, assignment,
          'assignment_published', await assignmentRecipients(trx, assignment));
      }
      return assignmentRow(updated);
    });
  },

  async listAssignmentSubmissions(assignmentId, actor) {
    const assignment = await loadAssignment(this.db, assignmentId, actor);
    if (!assignment) return null;
    if (!mayManageAcrossClasses(actor)) await teacherScope(this.db, actor, assignment.section_id, assignment.subject_id);
    const rows = await this.db('assignment_submissions as subm')
      .join('students as s', 's.id', 'subm.student_id')
      .where({
        'subm.assignment_id': assignmentId, 'subm.organization_id': actor.orgId,
        'subm.campus_id': actor.activeCampusId
      }).select('subm.*', 's.given_name_en', 's.father_name_en')
      .orderBy('subm.submitted_at');
    const output = [];
    for (const row of rows) {
      output.push(await loadSubmission(this.db, {
        ...row, student_name: `${row.given_name_en} ${row.father_name_en}`
      }));
    }
    return output;
  },

  async storeAssignmentAttachment(assignmentId, file, actor) {
    return this.db.transaction(async (trx) => {
      const assignment = await trx('assignments').where({
        id: assignmentId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!assignment) return null;
      if (!mayManageAcrossClasses(actor)) {
        await teacherScope(trx, actor, assignment.section_id, assignment.subject_id);
      }
      if (assignment.status !== 'draft') throw assignmentConflict('Attachments can be added only to draft assignments.');
      const attachment = await persistAttachment(this, trx, assignment, null, file, actor, 'assignment');
      return attachment;
    });
  },

  async listPortalAssignments(actor) {
    const rows = await portalStudentAssignmentQuery(this.db, actor);
    const assignmentIds = [...new Set(rows.map((row) => row.id))];
    const attachments = await assignmentAttachments(this.db, assignmentIds);
    const results = [];
    for (const row of rows) {
      const submission = await this.db('assignment_submissions').where({
        organization_id: actor.orgId, campus_id: row.campus_id,
        assignment_id: row.id, student_id: row.student_id
      }).first();
      results.push({
        ...assignmentRow(row, attachments.get(row.id) ?? []),
        studentId: row.student_id,
        studentName: `${row.given_name_en} ${row.father_name_en}`,
        submission: submission ? await loadSubmission(this.db, submission) : null
      });
    }
    return results;
  },

  async submitAssignment(assignmentId, data, actor) {
    return this.db.transaction(async (trx) => {
      const student = await studentForActor(trx, actor);
      if (!student) return null;
      const assignment = await trx('assignments').where({
        id: assignmentId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!assignment) return null;
      if (assignment.status !== 'published') {
        throw assignmentConflict('Closed or unpublished assignments cannot be submitted.');
      }
      if (!await studentBelongsToAssignment(trx, student.id, assignment)) return null;
      const existing = await trx('assignment_submissions').where({
        assignment_id: assignmentId, student_id: student.id,
        organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      const id = existing?.id ?? randomUUID();
      const submittedAt = new Date();
      const row = {
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        assignment_id: assignmentId, student_id: student.id, text: data.text ?? null,
        submitted_at: submittedAt, is_late: new Date(submittedAt) > new Date(assignment.due_at),
        grade: null, feedback: null, graded_by: null, graded_at: null, status: 'submitted'
      };
      const before = existing ? await loadSubmission(trx, existing) : null;
      if (existing) {
        await trx('assignment_submissions').where({ id }).update(row);
      } else {
        await trx('assignment_submissions').insert(row);
      }
      const updated = await loadSubmission(trx, { ...row, created_at: existing?.created_at });
      await trx('audit_log').insert(auditRow(actor,
        existing ? 'assignment.submission_resubmitted' : 'assignment.submitted',
        'assignment_submission', id, before, updated));
      if (!existing) {
        await trx('user_notifications').insert({
          id: randomUUID(), campus_id: actor.activeCampusId, organization_id: actor.orgId,
          user_id: assignment.created_by, source_type: 'assignment_submission', source_id: id,
          title_en: 'New assignment submission', title_am: 'አዲስ የቤት ሥራ ማስገባት',
          body_en: assignment.title, body_am: assignment.title
        }).onConflict(['user_id', 'source_type', 'source_id']).merge({
          read_at: null, created_at: trx.fn.now()
        });
      }
      return updated;
    });
  },

  async storeSubmissionAttachment(assignmentId, file, actor) {
    return this.db.transaction(async (trx) => {
      const student = await studentForActor(trx, actor);
      if (!student) return null;
      const assignment = await trx('assignments').where({
        id: assignmentId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!assignment) return null;
      if (assignment.status !== 'published') {
        throw assignmentConflict('Closed or unpublished assignments cannot be submitted.');
      }
      if (!await studentBelongsToAssignment(trx, student.id, assignment)) return null;
      let submission = await trx('assignment_submissions').where({
        assignment_id: assignmentId, student_id: student.id,
        organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!submission) {
        submission = {
          id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
          assignment_id: assignmentId, student_id: student.id, text: null,
          submitted_at: new Date(), is_late: new Date() > new Date(assignment.due_at),
          status: 'submitted'
        };
        await trx('assignment_submissions').insert(submission);
        await trx('audit_log').insert(auditRow(actor, 'assignment.submitted',
          'assignment_submission', submission.id, null, submission));
        await trx('user_notifications').insert({
          id: randomUUID(), campus_id: actor.activeCampusId, organization_id: actor.orgId,
          user_id: assignment.created_by, source_type: 'assignment_submission',
          source_id: submission.id, title_en: 'New assignment submission',
          title_am: 'አዲስ የቤት ሥራ ማስገባት',
          body_en: assignment.title, body_am: assignment.title
        }).onConflict(['user_id', 'source_type', 'source_id']).ignore();
      } else {
        const before = await loadSubmission(trx, submission);
        const submittedAt = new Date();
        await trx('assignment_submissions').where({ id: submission.id }).update({
          submitted_at: submittedAt, is_late: new Date(submittedAt) > new Date(assignment.due_at),
          status: 'submitted', grade: null, feedback: null, graded_by: null, graded_at: null,
          updated_at: trx.fn.now()
        });
        submission = {
          ...submission, submitted_at: submittedAt,
          is_late: new Date(submittedAt) > new Date(assignment.due_at),
          status: 'submitted', grade: null, feedback: null, graded_by: null, graded_at: null
        };
        await trx('audit_log').insert(auditRow(actor, 'assignment.submission_resubmitted',
          'assignment_submission', submission.id, before, await loadSubmission(trx, submission)));
      }
      return persistAttachment(this, trx, assignment, submission, file, actor, 'submission');
    });
  },

  async gradeAssignmentSubmission(assignmentId, submissionId, data, actor) {
    return this.db.transaction(async (trx) => {
      const assignment = await trx('assignments').where({
        id: assignmentId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!assignment) return null;
      if (!mayManageAcrossClasses(actor)) {
        await teacherScope(trx, actor, assignment.section_id, assignment.subject_id);
      }
      const submission = await trx('assignment_submissions').where({
        id: submissionId, assignment_id: assignmentId,
        organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!submission) return null;
      validateGrade(data.grade);
      if (!['submitted', 'graded'].includes(submission.status)) {
        throw assignmentConflict('This submission cannot be graded in its current state.');
      }
      const before = await loadSubmission(trx, submission);
      await trx('assignment_submissions').where({ id: submissionId }).update({
        grade: data.grade, feedback: data.feedback ?? null,
        graded_by: actor.sub, graded_at: trx.fn.now(), status: 'graded', updated_at: trx.fn.now()
      });
      const updated = await loadSubmission(trx, {
        ...submission, grade: data.grade, feedback: data.feedback ?? null,
        graded_by: actor.sub, graded_at: new Date(), status: 'graded'
      });
      await trx('audit_log').insert(auditRow(actor, 'assignment.submission_graded',
        'assignment_submission', submissionId, before, updated));
      return updated;
    });
  },

  async getAssignmentAttachment(id, actor) {
    const row = await this.db('assignment_attachments as aa')
      .join('assignments as a', 'a.id', 'aa.assignment_id')
      .where({
        'aa.id': id, 'aa.organization_id': actor.orgId, 'aa.campus_id': actor.activeCampusId,
        'a.organization_id': actor.orgId, 'a.campus_id': actor.activeCampusId
      }).first('aa.*', 'a.section_id', 'a.subject_id');
    if (!row) return null;
    if (!isManager(actor)) await teacherScope(this.db, actor, row.section_id, row.subject_id);
    return {
      ...mapAssignmentAttachment(row),
      content: await readFile(relativeStoragePath(this.privateDocumentsDir, row.storage_key))
    };
  },

  async getPortalAssignmentAttachment(id, actor) {
    const row = await this.db('assignment_attachments as aa')
      .join('assignments as a', 'a.id', 'aa.assignment_id')
      .where({
        'aa.id': id, 'aa.organization_id': actor.orgId, 'a.organization_id': actor.orgId,
      }).whereIn('a.status', ['published', 'closed'])
      .whereIn('aa.campus_id', actor.campusIds ?? [])
      .select('aa.*', 'a.academic_year_id', 'a.section_id').first();
    if (!row) return null;
    let studentIds;
    if (actor.role === 'student') {
      studentIds = (await this.db('students').where({
        user_id: actor.sub, campus_id: row.campus_id, status: 'enrolled'
      }).whereNull('archived_at').select('id')).map((student) => student.id);
    } else {
      studentIds = (await this.db('student_guardians as sg')
        .join('guardians as g', 'g.id', 'sg.guardian_id')
        .join('students as s', 's.id', 'sg.student_id')
        .where({
          'g.user_id': actor.sub, 'g.organization_id': actor.orgId,
          'sg.is_verified': true, 's.campus_id': row.campus_id, 's.status': 'enrolled'
        }).whereNull('s.archived_at').select('s.id')).map((student) => student.id);
    }
    if (row.attachment_type === 'submission') {
      const belongs = await this.db('assignment_submissions').where({
        id: row.submission_id, assignment_id: row.assignment_id,
        organization_id: actor.orgId, campus_id: row.campus_id
      }).whereIn('student_id', studentIds).first('id');
      if (!belongs) return null;
    } else {
      const enrolment = await this.db('enrolments').where({
        academic_year_id: row.academic_year_id, section_id: row.section_id, status: 'active'
      }).whereIn('student_id', studentIds).first('id');
      if (!enrolment) return null;
    }
    return {
      ...mapAssignmentAttachment(row),
      content: await readFile(relativeStoragePath(this.privateDocumentsDir, row.storage_key))
    };
  },

  async processAssignmentDueNotifications(at = new Date()) {
    const current = new Date(at);
    const future = new Date(current.valueOf() + 24 * 60 * 60 * 1000);
    await this.db.transaction(async (trx) => {
      const assignments = await trx('assignments').where({ status: 'published' })
        .where('due_at', '>', current).where('due_at', '<=', future)
        .select('id', 'organization_id', 'campus_id', 'academic_year_id', 'section_id', 'title');
      for (const assignment of assignments) {
        const recipients = await assignmentRecipients(trx, assignment);
        await notifyAssignmentRecipients(trx, assignment, 'assignment_due_soon', recipients);
      }
    });
  }
};
