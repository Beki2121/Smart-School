import { randomUUID } from 'node:crypto';
import { auditRow, campusScopeError, now, setupConflict } from '../shared.js';
import { calculateWeightedResult, examConflict, examWeightConflict, nextExamStatus } from '../exams.mappers.js';

function mapType(row) {
  return {
    id: row.id, organizationId: row.organization_id, code: row.code, name: row.name,
    weightBasisPoints: Number(row.weight_basis_points),
    weightPercent: Number(row.weight_basis_points) / 100, isActive: Boolean(row.is_active)
  };
}

function mapExam(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    academicYearId: row.academic_year_id, termId: row.term_id,
    gradeLevelId: row.grade_level_id, subjectId: row.subject_id,
    examTypeId: row.exam_type_id, title: row.title,
    weightBasisPoints: Number(row.weight_basis_points), maxValue: Number(row.max_value),
    status: row.status, isLegacy: Boolean(row.is_legacy), createdBy: row.created_by,
    schedulePublishedAt: row.schedule_published_at, marksOpenedAt: row.marks_opened_at,
    createdAt: row.created_at
  };
}

function dateOnly(value) {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function mapSchedule(row) {
  return {
    id: row.id, examId: row.exam_id, examTitle: row.exam_title, status: row.exam_status,
    sectionId: row.section_id, sectionName: row.section_name,
    examDate: dateOnly(row.exam_date),
    startsAt: String(row.starts_at).slice(0, 8), endsAt: String(row.ends_at).slice(0, 8),
    roomId: row.room_id, roomName: row.room_name ?? null
  };
}

function overlaps(left, right) {
  return left.examDate === right.examDate &&
    left.startsAt < right.endsAt && right.startsAt < left.endsAt;
}

async function normalizeScheduleInput(trx, actor, exam, input, excludedEntryId = null) {
  const section = await trx('sections').where({
    id: input.sectionId, campus_id: exam.campus_id,
    grade_level_id: exam.grade_level_id, academic_year_id: exam.academic_year_id
  }).first('id');
  const room = input.roomId ? await trx('rooms').where({
    id: input.roomId, campus_id: exam.campus_id, is_active: true
  }).first('id') : null;
  if (!section || (input.roomId && !room)) {
    throw campusScopeError('Schedule sections and rooms must belong to the active campus.');
  }
  const term = await trx('terms').where({ id: exam.term_id }).first('start_date', 'end_date');
  const examDate = dateOnly(input.examDate);
  if (!term || examDate < dateOnly(term.start_date) || examDate > dateOnly(term.end_date)) {
    throw setupConflict('Exam schedule dates must fall within the selected term.');
  }
  const invigilatorIds = [...new Set(input.invigilatorIds ?? [])];
  if (invigilatorIds.length) {
    const staffRows = await trx('staff').where({ campus_id: exam.campus_id })
      .whereNull('archived_at').whereIn('id', invigilatorIds).select('id');
    if (staffRows.length !== invigilatorIds.length) {
      throw campusScopeError('Invigilators must belong to the active campus.');
    }
  }
  const duplicate = trx('exam_schedule_entries').where({
    exam_id: exam.id, section_id: input.sectionId, exam_date: input.examDate
  });
  if (excludedEntryId) duplicate.whereNot({ id: excludedEntryId });
  if (await duplicate.first('id')) {
    throw setupConflict('A schedule entry already exists for this section and date.');
  }

  const conflictRows = await trx('exam_schedule_entries as ese')
    .leftJoin('exams as e', 'e.id', 'ese.exam_id')
    .leftJoin('sections as s', 's.id', 'ese.section_id')
    .leftJoin('rooms as r', 'r.id', 'ese.room_id')
    .where({
      'ese.campus_id': exam.campus_id, 'ese.exam_date': input.examDate
    })
    .where('ese.starts_at', '<', input.endsAt)
    .where('ese.ends_at', '>', input.startsAt)
    .modify((query) => {
      if (excludedEntryId) query.whereNot('ese.id', excludedEntryId);
    })
    .select('ese.*', 'e.title as exam_title', 'e.status as exam_status',
      's.name as section_name', 'r.name as room_name');
  const conflicts = [];
  for (const row of conflictRows) {
    const invigilatorMatch = invigilatorIds.length
      ? await trx('exam_schedule_invigilators').where({ schedule_entry_id: row.id })
        .whereIn('staff_id', invigilatorIds).first('staff_id')
      : null;
    if (row.section_id === input.sectionId ||
        (input.roomId && row.room_id === input.roomId) || invigilatorMatch) {
      conflicts.push({
        ...mapSchedule(row),
        conflictReason: row.section_id === input.sectionId ? 'section'
          : input.roomId && row.room_id === input.roomId ? 'room' : 'invigilator'
      });
    }
  }
  if (conflicts.length) throw examConflict(conflicts);

  return {
    entry: {
      id: randomUUID(), organization_id: actor.orgId, campus_id: exam.campus_id,
      exam_id: exam.id, section_id: input.sectionId, exam_date: input.examDate,
      starts_at: input.startsAt, ends_at: input.endsAt, room_id: input.roomId ?? null
    },
    invigilatorIds
  };
}

async function loadScheduleEntry(db, entryId) {
  const row = await db('exam_schedule_entries as ese')
    .join('exams as e', 'e.id', 'ese.exam_id')
    .join('sections as s', 's.id', 'ese.section_id')
    .leftJoin('rooms as r', 'r.id', 'ese.room_id')
    .where('ese.id', entryId)
    .select('ese.*', 'e.title as exam_title', 'e.status as exam_status',
      's.name as section_name', 'r.name as room_name')
    .first();
  if (!row) return null;
  const entry = mapSchedule(row);
  const invigilators = await db('exam_schedule_invigilators as esi')
    .join('staff as st', 'st.id', 'esi.staff_id')
    .where({ 'esi.schedule_entry_id': entryId })
    .select('st.given_name_en', 'st.father_name_en', 'st.grandfather_name_en');
  entry.invigilators = invigilators.map((staff) =>
    [staff.given_name_en, staff.father_name_en, staff.grandfather_name_en].filter(Boolean).join(' '));
  entry.invigilatorIds = (await db('exam_schedule_invigilators')
    .where({ schedule_entry_id: entryId }).select('staff_id')).map((item) => item.staff_id);
  return entry;
}

export const mysqlExamsBundle = {
  async listExamTypes(campusId) {
    const campus = await this.db('campuses').where({ id: campusId }).first('organization_id');
    if (!campus) return [];
    const rows = await this.db('exam_types').where({
      organization_id: campus.organization_id
    }).orderBy('name');
    return rows.map(mapType);
  },

  async createExamType(data, actor) {
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('exam_types').insert({
          id, organization_id: actor.orgId, code: data.code, name: data.name,
          weight_basis_points: Math.round(data.weightPercent * 100), is_active: true
        });
        await trx('audit_log').insert(auditRow(actor, 'exam_type.created', 'exam_type', id, null, {
          id, organizationId: actor.orgId, code: data.code, name: data.name,
          weightPercent: data.weightPercent, isActive: true
        }));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('An exam type with this code already exists.');
      throw error;
    }
    return mapType(await this.db('exam_types').where({ id }).first());
  },

  async updateExamType(id, data, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('exam_types').where({
        id, organization_id: actor.orgId
      }).forUpdate().first();
      if (!row) return null;
      const before = mapType(row);
      const update = {};
      if (data.name !== undefined) update.name = data.name;
      if (data.weightPercent !== undefined) {
        const weight = Math.round(data.weightPercent * 100);
        const exams = await trx('exams').where({ exam_type_id: id, is_legacy: false })
          .forUpdate().select('id', 'weight_basis_points');
        if (exams.length) {
          const submitted = await trx('marks').whereIn('exam_id', exams.map((exam) => exam.id))
            .whereNot('state', 'draft').first('id');
          if (submitted) {
            throw setupConflict('Exam type weight cannot change after marks have been submitted.');
          }
          for (const exam of exams) {
            await trx('exams').where({ id: exam.id }).update({ weight_basis_points: weight });
            await trx('audit_log').insert(auditRow(actor, 'exam.weight_updated', 'exam', exam.id,
              { weightBasisPoints: Number(exam.weight_basis_points) }, { weightBasisPoints: weight }));
          }
        }
        update.weight_basis_points = weight;
      }
      if (data.isActive !== undefined) update.is_active = data.isActive;
      if (Object.keys(update).length) await trx('exam_types').where({ id }).update(update);
      const after = mapType({ ...row, ...update });
      await trx('audit_log').insert(auditRow(actor, 'exam_type.updated', 'exam_type', id, before, after));
      return after;
    });
  },

  async listExams(actor, { termId } = {}) {
    let visibleSectionIds = null;
    let query = this.db('exams as e')
      .leftJoin('exam_types as et', 'et.id', 'e.exam_type_id')
      .where({ 'e.campus_id': actor.activeCampusId })
      .select('e.*', 'et.name as exam_type_name')
      .orderBy('e.created_at');
    if (termId) query = query.where('e.term_id', termId);
    if (actor.role === 'student') {
      visibleSectionIds = (await this.db('students as s')
        .join('sections as sec', function joinStudentSection() {
          this.on('sec.campus_id', '=', 's.campus_id')
            .andOn('sec.name', '=', 's.section_name');
        }).where({
          's.user_id': actor.sub, 's.campus_id': actor.activeCampusId,
          's.status': 'enrolled'
        }).whereNull('s.archived_at').select('sec.id')).map((row) => row.id);
      if (!visibleSectionIds.length) return [];
      query = query.whereNotNull('e.schedule_published_at')
        .whereExists(function studentSchedule() {
          this.select(this.client.raw('1')).from('exam_schedule_entries as ese')
            .whereRaw('ese.exam_id = e.id')
            .whereIn('ese.section_id', visibleSectionIds);
        });
    } else if (actor.role === 'parent_guardian') {
      visibleSectionIds = await this.db('student_guardians as sg')
        .join('guardians as g', 'g.id', 'sg.guardian_id')
        .join('students as s', 's.id', 'sg.student_id')
        .join('sections as sec', function joinStudentSection() {
          this.on('sec.campus_id', '=', 's.campus_id')
            .andOn('sec.name', '=', 's.section_name');
        }).where({
          'g.user_id': actor.sub, 'g.organization_id': actor.orgId,
          'sg.is_verified': true
        }).whereIn('s.campus_id', actor.campusIds ?? [])
        .whereNull('s.archived_at').select('sec.id').then((rows) =>
          [...new Set(rows.map((row) => row.id))]);
      if (!visibleSectionIds.length) return [];
      query = query.whereNotNull('e.schedule_published_at')
        .whereExists(function parentSchedule() {
          this.select(this.client.raw('1')).from('exam_schedule_entries as ese')
            .whereRaw('ese.exam_id = e.id')
            .whereIn('ese.section_id', visibleSectionIds);
        });
    } else {
      const accessible = await this.accessibleSectionIds(actor);
      if (accessible) {
        const ids = [...accessible];
        if (!ids.length) return [];
        query = query.whereNotNull('e.schedule_published_at');
        query = query.whereExists(function teacherSchedule() {
          this.select(this.client.raw('1')).from('exam_schedule_entries as ese')
            .whereRaw('ese.exam_id = e.id').whereIn('ese.section_id', ids);
        });
      }
    }
    const rows = await query;
    const exams = rows.map((row) => ({ ...mapExam(row), examType: row.exam_type_name }));
    for (const exam of exams) {
      const schedules = await this.db('exam_schedule_entries as ese')
        .join('sections as s', 's.id', 'ese.section_id')
        .leftJoin('rooms as r', 'r.id', 'ese.room_id')
        .where({ 'ese.exam_id': exam.id })
        .modify((scheduleQuery) => {
          if (visibleSectionIds) scheduleQuery.whereIn('ese.section_id', visibleSectionIds);
        })
        .select('ese.*', 's.name as section_name', 'r.name as room_name',
          'e.title as exam_title', 'e.status as exam_status')
        .join('exams as e', 'e.id', 'ese.exam_id');
      exam.scheduleEntries = schedules.map(mapSchedule);
      for (const entry of exam.scheduleEntries) {
        const invigilators = await this.db('exam_schedule_invigilators as esi')
          .join('staff as st', 'st.id', 'esi.staff_id')
          .where({ 'esi.schedule_entry_id': entry.id })
          .select('st.given_name_en', 'st.father_name_en', 'st.grandfather_name_en');
        entry.invigilators = invigilators.map((staff) =>
          [staff.given_name_en, staff.father_name_en, staff.grandfather_name_en].filter(Boolean).join(' '));
        entry.invigilatorIds = (await this.db('exam_schedule_invigilators')
          .where({ schedule_entry_id: entry.id }).select('staff_id'))
          .map((item) => item.staff_id);
      }
    }
    return exams;
  },

  async createExam(data, actor) {
    const campus = await this.db('campuses').where({
      id: actor.activeCampusId, organization_id: actor.orgId, is_active: true
    }).first('id');
    const typeRow = await this.db('exam_types').where({
      id: data.examTypeId, organization_id: actor.orgId, is_active: true
    }).first();
    const term = await this.db('terms as t')
      .join('academic_years as y', 'y.id', 't.academic_year_id')
      .where({ 't.id': data.termId, 'y.campus_id': actor.activeCampusId })
      .first('t.id', 't.academic_year_id', 't.start_date', 't.end_date');
    const grade = await this.db('grade_levels').where({
      id: data.gradeLevelId, campus_id: actor.activeCampusId
    }).first('id');
    const subject = await this.db('subjects').where({
      id: data.subjectId, campus_id: actor.activeCampusId
    }).first('id');
    if (!campus || !typeRow || !term || !grade || !subject) {
      throw campusScopeError('Exam context must belong to the active school and campus.');
    }
    const gradeSubjects = await this.db('grade_subjects').where({
      grade_level_id: data.gradeLevelId, subject_id: data.subjectId
    }).select('id');
    const configuredGradeSubjects = await this.db('grade_subjects')
      .where({ grade_level_id: data.gradeLevelId }).first('id');
    if (configuredGradeSubjects && !gradeSubjects.length) {
      throw setupConflict('This subject is not configured for the selected grade.');
    }
    const scheduleInputs = data.scheduleEntries ?? [];
    const examId = randomUUID();
    const conflictEntries = [];
    try {
      await this.db.transaction(async (trx) => {
        await trx('campuses').where({ id: actor.activeCampusId }).forUpdate().first('id');
        const duplicate = await trx('exams').where({
          campus_id: actor.activeCampusId, term_id: data.termId,
          grade_level_id: data.gradeLevelId, subject_id: data.subjectId,
          exam_type_id: data.examTypeId
        }).first('id');
        if (duplicate) throw setupConflict('An exam already exists for this term, grade, subject and type.');
        const normalizedEntries = [];
        for (const input of scheduleInputs) {
          const section = await trx('sections').where({
            id: input.sectionId, campus_id: actor.activeCampusId,
            grade_level_id: data.gradeLevelId, academic_year_id: term.academic_year_id
          }).first('id');
          const room = input.roomId ? await trx('rooms').where({
            id: input.roomId, campus_id: actor.activeCampusId, is_active: true
          }).first('id') : null;
          if (!section || (input.roomId && !room)) {
            throw campusScopeError('Schedule sections and rooms must belong to the active campus.');
          }
          const date = String(input.examDate).slice(0, 10);
          if (date < dateOnly(term.start_date) || date > dateOnly(term.end_date)) {
            throw setupConflict('Exam schedule dates must fall within the selected term.');
          }
          const invigilatorIds = [...new Set(input.invigilatorIds ?? [])];
          if (invigilatorIds.length) {
            const staff = await trx('staff').where({
              campus_id: actor.activeCampusId
            }).whereNull('archived_at').whereIn('id', invigilatorIds).select('id');
            if (staff.length !== invigilatorIds.length) {
              throw campusScopeError('Invigilators must belong to the active campus.');
            }
          }
          const entry = {
            id: randomUUID(), organization_id: actor.orgId,
            campus_id: actor.activeCampusId, exam_id: examId,
            section_id: input.sectionId, exam_date: input.examDate,
            starts_at: input.startsAt, ends_at: input.endsAt, room_id: input.roomId ?? null
          };
          normalizedEntries.push({ entry, invigilatorIds });
        }

        for (let index = 0; index < normalizedEntries.length; index += 1) {
          const { entry, invigilatorIds } = normalizedEntries[index];
          const incoming = {
            examDate: String(entry.exam_date).slice(0, 10),
            startsAt: String(entry.starts_at).slice(0, 8),
            endsAt: String(entry.ends_at).slice(0, 8)
          };
          const rows = await trx('exam_schedule_entries as ese')
            .leftJoin('exams as e', 'e.id', 'ese.exam_id')
            .leftJoin('sections as s', 's.id', 'ese.section_id')
            .leftJoin('rooms as r', 'r.id', 'ese.room_id')
            .where({ 'ese.campus_id': actor.activeCampusId, 'ese.exam_date': entry.exam_date })
            .where('ese.starts_at', '<', entry.ends_at)
            .where('ese.ends_at', '>', entry.starts_at)
            .select('ese.*', 'e.title as exam_title', 'e.status as exam_status',
              's.name as section_name', 'r.name as room_name');
          for (const row of rows) {
            const invigilatorMatch = invigilatorIds.length && await trx('exam_schedule_invigilators')
              .where({ schedule_entry_id: row.id }).whereIn('staff_id', invigilatorIds).first();
            if (row.section_id === entry.section_id ||
                (entry.room_id && row.room_id === entry.room_id) || invigilatorMatch) {
              const details = mapSchedule(row);
              details.conflictReason = row.section_id === entry.section_id ? 'section'
                : row.room_id === entry.room_id && entry.room_id ? 'room' : 'invigilator';
              conflictEntries.push(details);
            }
          }
          for (const earlier of normalizedEntries.slice(0, index)) {
            const prior = earlier.entry;
            const priorTimes = {
              examDate: String(prior.exam_date).slice(0, 10),
              startsAt: String(prior.starts_at).slice(0, 8),
              endsAt: String(prior.ends_at).slice(0, 8)
            };
            const invigilatorMatch = earlier.invigilatorIds.find((id) => invigilatorIds.includes(id));
            if (overlaps(incoming, priorTimes) && (prior.section_id === entry.section_id ||
                (entry.room_id && prior.room_id === entry.room_id) || invigilatorMatch)) {
              conflictEntries.push({
                id: prior.id, examId, examTitle: data.title, sectionId: prior.section_id,
                examDate: priorTimes.examDate, startsAt: priorTimes.startsAt, endsAt: priorTimes.endsAt,
                conflictReason: prior.section_id === entry.section_id ? 'section'
                  : prior.room_id === entry.room_id && entry.room_id ? 'room' : 'invigilator'
              });
            }
          }
        }
        if (conflictEntries.length) throw examConflict(conflictEntries);

        await trx('exams').insert({
          id: examId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          academic_year_id: term.academic_year_id, term_id: data.termId,
          grade_level_id: data.gradeLevelId, subject_id: data.subjectId,
          exam_type_id: data.examTypeId, title: data.title,
          weight_basis_points: Number(typeRow.weight_basis_points),
          max_value: data.maxValue ?? 100,
          status: normalizedEntries.length ? 'scheduled' : 'draft', is_legacy: false,
          created_by: actor.sub
        });
        for (const { entry, invigilatorIds } of normalizedEntries) {
          await trx('exam_schedule_entries').insert(entry);
          if (invigilatorIds.length) {
            await trx('exam_schedule_invigilators').insert(invigilatorIds.map((staffId) => ({
              organization_id: actor.orgId, campus_id: actor.activeCampusId,
              schedule_entry_id: entry.id, staff_id: staffId
            })));
          }
        }
        await trx('audit_log').insert(auditRow(actor, 'exam.created', 'exam', examId, null, {
          id: examId, organizationId: actor.orgId, campusId: actor.activeCampusId,
          termId: data.termId, gradeLevelId: data.gradeLevelId, subjectId: data.subjectId,
          examTypeId: data.examTypeId, title: data.title,
          scheduleEntries: normalizedEntries.map(({ entry }) => ({
            id: entry.id, sectionId: entry.section_id, examDate: entry.exam_date,
            startsAt: entry.starts_at, endsAt: entry.ends_at, roomId: entry.room_id
          }))
        }));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('An exam or schedule entry already exists.');
      throw error;
    }
    const row = await this.db('exams').where({ id: examId }).first();
    return mapExam(row);
  },

  async addExamScheduleEntry(examId, input, actor) {
    let entryId = null;
    await this.db.transaction(async (trx) => {
      await trx('campuses').where({
        id: actor.activeCampusId, organization_id: actor.orgId
      }).forUpdate().first('id');
      const exam = await trx('exams').where({
        id: examId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        is_legacy: false
      }).forUpdate().first();
      if (!exam) return;
      if (!['draft', 'scheduled'].includes(exam.status)) {
        throw setupConflict('Schedule entries can only be added to a draft or scheduled exam.');
      }
      const normalized = await normalizeScheduleInput(trx, actor, exam, input);
      entryId = normalized.entry.id;
      await trx('exam_schedule_entries').insert(normalized.entry);
      if (normalized.invigilatorIds.length) {
        await trx('exam_schedule_invigilators').insert(normalized.invigilatorIds.map((staffId) => ({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          schedule_entry_id: entryId, staff_id: staffId
        })));
      }
      const before = { status: exam.status };
      if (exam.status === 'draft') {
        await trx('exams').where({ id: examId }).update({ status: 'scheduled' });
      }
      await trx('audit_log').insert(auditRow(actor, 'exam.schedule_entry_created',
        'exam_schedule_entry', entryId, null, {
          sectionId: input.sectionId, examDate: dateOnly(input.examDate),
          startsAt: input.startsAt, endsAt: input.endsAt, roomId: input.roomId ?? null,
          invigilatorIds: normalized.invigilatorIds, examStatus: exam.status === 'draft' ? 'scheduled' : exam.status
        }));
      if (exam.status === 'draft') {
        await trx('audit_log').insert(auditRow(actor, 'exam.scheduled', 'exam', examId,
          before, { status: 'scheduled' }));
      }
    });
    return entryId ? loadScheduleEntry(this.db, entryId) : null;
  },

  async updateExamScheduleEntry(examId, entryId, input, actor) {
    let updated = false;
    await this.db.transaction(async (trx) => {
      await trx('campuses').where({
        id: actor.activeCampusId, organization_id: actor.orgId
      }).forUpdate().first('id');
      const exam = await trx('exams').where({
        id: examId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        is_legacy: false
      }).forUpdate().first();
      if (!exam) return;
      const entry = await trx('exam_schedule_entries').where({
        id: entryId, exam_id: examId, campus_id: actor.activeCampusId,
        organization_id: actor.orgId
      }).forUpdate().first();
      if (!entry) return;
      if (!['scheduled', 'schedule_published', 'marks_open'].includes(exam.status)) {
        throw setupConflict('This exam schedule can no longer be edited.');
      }
      const submitted = await trx('marks').where({ exam_id: examId })
        .whereNot('state', 'draft').first('id');
      if (submitted) {
        throw setupConflict('An exam schedule cannot be edited after marks have been submitted or approved.');
      }
      const normalized = await normalizeScheduleInput(trx, actor, exam, input, entryId);
      const before = {
        sectionId: entry.section_id, examDate: dateOnly(entry.exam_date),
        startsAt: String(entry.starts_at).slice(0, 8),
        endsAt: String(entry.ends_at).slice(0, 8), roomId: entry.room_id,
        invigilatorIds: (await trx('exam_schedule_invigilators')
          .where({ schedule_entry_id: entryId }).select('staff_id')).map((item) => item.staff_id)
      };
      await trx('exam_schedule_entries').where({ id: entryId }).update({
        section_id: normalized.entry.section_id, exam_date: normalized.entry.exam_date,
        starts_at: normalized.entry.starts_at, ends_at: normalized.entry.ends_at,
        room_id: normalized.entry.room_id
      });
      await trx('exam_schedule_invigilators').where({ schedule_entry_id: entryId }).del();
      if (normalized.invigilatorIds.length) {
        await trx('exam_schedule_invigilators').insert(normalized.invigilatorIds.map((staffId) => ({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          schedule_entry_id: entryId, staff_id: staffId
        })));
      }
      const previousStatus = exam.status;
      if (['schedule_published', 'marks_open'].includes(exam.status)) {
        await trx('exams').where({ id: examId }).update({
          status: 'scheduled', schedule_published_at: null, marks_opened_at: null
        });
      }
      await trx('audit_log').insert(auditRow(actor, 'exam.schedule_entry_updated',
        'exam_schedule_entry', entryId, before, {
          sectionId: input.sectionId, examDate: dateOnly(input.examDate),
          startsAt: input.startsAt, endsAt: input.endsAt, roomId: input.roomId ?? null,
          invigilatorIds: normalized.invigilatorIds,
          examStatus: ['schedule_published', 'marks_open'].includes(previousStatus)
            ? 'scheduled' : previousStatus
        }));
      if (previousStatus === 'schedule_published' || previousStatus === 'marks_open') {
        await trx('audit_log').insert(auditRow(actor, 'exam.schedule_rescheduled',
          'exam', examId, { status: previousStatus }, {
            status: 'scheduled', schedulePublishedAt: null, marksOpenedAt: null
          }));
      }
      updated = true;
    });
    return updated ? loadScheduleEntry(this.db, entryId) : null;
  },

  async updateExam(id, data, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('exams').where({
        id, campus_id: actor.activeCampusId, is_legacy: false
      }).forUpdate().first();
      if (!row) return null;
      const submitted = await trx('marks').where({ exam_id: id }).whereNot('state', 'draft').first('id');
      if (submitted) throw setupConflict(
        'An exam cannot be edited after marks have been submitted; use the existing mark correction workflow.'
      );
      if (!['draft', 'scheduled', 'schedule_published'].includes(row.status)) {
        throw setupConflict('This exam can no longer be edited.');
      }
      const before = { title: row.title, maxValue: Number(row.max_value) };
      const update = {};
      if (data.title !== undefined) update.title = data.title;
      if (data.maxValue !== undefined) update.max_value = data.maxValue;
      if (Object.keys(update).length) await trx('exams').where({ id }).update(update);
      const after = {
        title: update.title ?? row.title,
        maxValue: Number(update.max_value ?? row.max_value)
      };
      await trx('audit_log').insert(auditRow(actor, 'exam.updated', 'exam', id, before, after));
      return { ...mapExam(row), ...after };
    });
  },

  async publishExamSchedule(id, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('exams').where({
        id, campus_id: actor.activeCampusId, is_legacy: false
      }).forUpdate().first();
      if (!row) return null;
      const entries = await trx('exam_schedule_entries').where({ exam_id: id }).first('id');
      if (row.status !== 'scheduled' || !entries) {
        throw setupConflict('Only a scheduled exam with schedule entries can be published.');
      }
      const before = { status: row.status };
      const publishedAt = new Date();
      await trx('exams').where({ id }).update({
        status: 'schedule_published', schedule_published_at: publishedAt
      });
      await trx('audit_log').insert(auditRow(actor, 'exam.schedule_published', 'exam', id,
        before, { status: 'schedule_published', schedulePublishedAt: publishedAt }));
      return { ...mapExam(row), status: 'schedule_published', schedulePublishedAt: publishedAt };
    });
  },

  async openExamMarks(id, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('exams').where({
        id, campus_id: actor.activeCampusId, is_legacy: false
      }).forUpdate().first();
      if (!row) return null;
      if (row.status !== 'schedule_published') {
        throw setupConflict('Publish the exam schedule before opening marks.');
      }
      const activeTypes = (await trx('exam_types').where({
        organization_id: actor.orgId, is_active: true
      }).orderBy('code'));
      const types = [];
      let total = 0;
      for (const type of activeTypes) {
        const definedExam = await trx('exams').where({
          campus_id: actor.activeCampusId, term_id: row.term_id,
          grade_level_id: row.grade_level_id, subject_id: row.subject_id,
          exam_type_id: type.id, is_legacy: false
        }).first('id', 'weight_basis_points');
        const mapped = {
          ...mapType(type), configured: Boolean(definedExam), examId: definedExam?.id ?? null
        };
        types.push(mapped);
        if (definedExam) total += Number(definedExam.weight_basis_points);
      }
      if (total !== 10000 || types.some((item) => !item.configured)) {
        throw examWeightConflict(types, total);
      }
      const openedAt = new Date();
      await trx('exams').where({ id }).update({ status: 'marks_open', marks_opened_at: openedAt });
      await trx('audit_log').insert(auditRow(actor, 'exam.marks_opened', 'exam', id,
        { status: row.status }, { status: 'marks_open', marksOpenedAt: openedAt }));
      await this.insertExamNotifications(trx, mapExam({ ...row, status: 'marks_open' }), 'marks_due');
      return { ...mapExam(row), status: 'marks_open', marksOpenedAt: openedAt };
    });
  },

  async insertExamNotifications(trx, exam, type) {
    let recipients = [];
    if (type === 'marks_due') {
      const rows = await trx('exam_schedule_entries as ese')
        .leftJoin('exam_schedule_invigilators as esi', 'esi.schedule_entry_id', 'ese.id')
        .leftJoin('staff as inv', 'inv.id', 'esi.staff_id')
        .leftJoin('teaching_assignments as ta', function joinTeachers() {
          this.on('ta.section_id', '=', 'ese.section_id')
            .andOn('ta.campus_id', '=', 'ese.campus_id')
            .andOn('ta.subject_id', '=', trx.raw('?', [exam.subjectId]))
            .andOn('ta.is_active', '=', trx.raw('?', [true]));
        })
        .leftJoin('staff as teacher', 'teacher.id', 'ta.staff_id')
        .where('ese.exam_id', exam.id)
        .select('inv.user_id as invigilator_user_id', 'teacher.user_id as teacher_user_id');
      recipients = [...new Set(rows.flatMap((row) =>
        [row.invigilator_user_id, row.teacher_user_id].filter(Boolean)))];
    } else {
      const rows = await trx('exam_schedule_entries as ese')
        .join('students as s', 's.campus_id', 'ese.campus_id')
        .leftJoin('student_guardians as sg', function joinGuardians() {
          this.on('sg.student_id', '=', 's.id')
            .andOn('sg.is_verified', '=', trx.raw('?', [true]))
            .andOn('sg.can_view_results', '=', trx.raw('?', [true]));
        })
        .leftJoin('guardians as g', function joinGuardian() {
          this.on('g.id', '=', 'sg.guardian_id')
            .andOn('g.organization_id', '=', trx.raw('?', [exam.organizationId]));
        })
        .where({
          'ese.exam_id': exam.id, 's.status': 'enrolled'
        }).whereNull('s.archived_at')
        .whereRaw('s.section_name = (select sec.name from sections sec where sec.id = ese.section_id)')
        .select('s.user_id as student_user_id', 'g.user_id as guardian_user_id');
      recipients = [...new Set(rows.flatMap((row) =>
        [row.student_user_id, row.guardian_user_id].filter(Boolean)))];
    }
    for (const recipientId of recipients) {
      const notice = {
        id: randomUUID(), organization_id: exam.organizationId, campus_id: exam.campusId,
        exam_id: exam.id, recipient_id: recipientId, notification_type: type
      };
      const exists = await trx('exam_notifications').where({
        exam_id: exam.id, recipient_id: recipientId, notification_type: type
      }).first('id');
      if (exists) continue;
      await trx('exam_notifications').insert(notice);
      await trx('user_notifications').insert({
        id: randomUUID(), organization_id: exam.organizationId, campus_id: exam.campusId,
        user_id: recipientId, source_type: `exam_${type}`, source_id: exam.id,
        title_en: type === 'marks_due' ? 'Marks are due' : 'Exam results published',
        title_am: type === 'marks_due' ? 'ውጤት ማስገባት ጊዜ ደርሷል' : 'የፈተና ውጤት ታትሟል',
        body_en: exam.title, body_am: exam.title
      }).onConflict(['user_id', 'source_type', 'source_id']).ignore();
    }
  },

  async getExamMonitoring(actor) {
    const exams = (await this.listExams(actor)).filter((exam) => !exam.isLegacy);
    const results = [];
    for (const exam of exams) {
      const expected = await this.db('enrolments as e')
        .join('exam_schedule_entries as ese', 'ese.section_id', 'e.section_id')
        .where({
          'ese.exam_id': exam.id, 'e.status': 'active',
          'e.academic_year_id': exam.academicYearId
        }).countDistinct({ total: 'e.student_id' }).first();
      const recorded = await this.db('marks').where({
        exam_id: exam.id, campus_id: actor.activeCampusId
      }).countDistinct({ total: 'student_id' }).first();
      results.push({
        id: exam.id, title: exam.title, status: exam.status,
        expectedMarks: Number(expected.total), recordedMarks: Number(recorded.total),
        missingMarks: Math.max(0, Number(expected.total) - Number(recorded.total))
      });
    }
    return results;
  },

  async updateExamStatusFromMarks(examId, actor) {
    await this.db.transaction(async (trx) => {
      const row = await trx('exams').where({ id: examId }).forUpdate().first();
      if (!row || row.is_legacy) return;
      const exam = mapExam(row);
      const marks = (await trx('marks').where({ exam_id: examId }).select('state'))
        .map((item) => item);
      const expected = await trx('enrolments as e')
        .join('exam_schedule_entries as ese', 'ese.section_id', 'e.section_id')
        .where({
          'ese.exam_id': examId, 'e.status': 'active',
          'e.academic_year_id': exam.academicYearId
        }).countDistinct({ total: 'e.student_id' }).first();
      const status = nextExamStatus(exam, marks, Number(expected.total));
      if (status === exam.status) return;
      await trx('exams').where({ id: examId }).update({ status });
      await trx('audit_log').insert(auditRow(actor, `exam.${status}`, 'exam', examId,
        { status: exam.status }, { status }));
      if (status === 'published') {
        await this.insertExamNotifications(trx, { ...exam, status }, 'results_published');
      }
    });
  },

  async getWeightedExamResult(studentId, termId, actor) {
    const rows = await this.db('exams').where({
      campus_id: actor.activeCampusId, term_id: termId, is_legacy: false, status: 'published'
    });
    const exams = rows.map(mapExam);
    const marks = exams.length ? await this.db('marks').where({
      campus_id: actor.activeCampusId, student_id: studentId, state: 'locked'
    }).whereIn('exam_id', exams.map((exam) => exam.id)) : [];
    return calculateWeightedResult(exams, new Map(marks.map((mark) => [mark.exam_id, {
      value: Number(mark.value), maxValue: Number(mark.max_value)
    }])));
  },

  async examById(id, actor) {
    const row = await this.db('exams').where({
      id, campus_id: actor.activeCampusId, organization_id: actor.orgId
    }).first();
    return row ? mapExam(row) : null;
  },

  async resolveExamForMark(data, actor, trx = this.db) {
    if (data.examId) {
      const row = await trx('exams').where({
        id: data.examId, campus_id: actor.activeCampusId, organization_id: actor.orgId
      }).first();
      if (!row) throw campusScopeError('Exam is outside the active campus.');
      const exam = mapExam(row);
      if ((data.termId && data.termId !== exam.termId) ||
          (data.subjectId && data.subjectId !== exam.subjectId) ||
          Number(data.maxValue) !== exam.maxValue) {
        throw setupConflict('Mark context and maximum must match the selected exam.');
      }
      if (!exam.isLegacy && exam.status !== 'marks_open') {
        throw setupConflict('Marks can only be entered while the exam is open for marks.');
      }
      return exam;
    }
    let type = await trx('exam_types').where({
      organization_id: actor.orgId, code: 'legacy'
    }).first('id');
    if (!type) {
      const id = randomUUID();
      await trx('exam_types').insert({
        id, organization_id: actor.orgId, code: 'legacy', name: 'Legacy',
        weight_basis_points: 10000, is_active: false
      });
      type = { id };
    }
    const placement = await trx('enrolments as e')
      .join('sections as s', 's.id', 'e.section_id')
      .where({
        'e.student_id': data.studentId, 'e.status': 'active',
        's.campus_id': actor.activeCampusId
      }).first('s.grade_level_id');
    const year = data.termId ? await trx('terms').where({ id: data.termId })
      .first('academic_year_id') : null;
    const existing = await trx('exams').where({
      campus_id: actor.activeCampusId, term_id: data.termId ?? null,
      grade_level_id: placement?.grade_level_id ?? null,
      subject_id: data.subjectId ?? null, exam_type_id: type.id, is_legacy: true
    }).first();
    if (existing) return mapExam(existing);
    const id = randomUUID();
    await trx('exams').insert({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      academic_year_id: year?.academic_year_id ?? null, term_id: data.termId ?? null,
      grade_level_id: placement?.grade_level_id ?? null, subject_id: data.subjectId ?? null,
      exam_type_id: type.id, title: 'Legacy results', weight_basis_points: 10000,
      max_value: data.maxValue, status: 'draft', is_legacy: true, created_by: actor.sub
    });
    return mapExam(await trx('exams').where({ id }).first());
  }
};
