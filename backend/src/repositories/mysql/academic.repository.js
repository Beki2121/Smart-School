import { randomUUID } from 'node:crypto';
import { DEFAULT_GRADING_BANDS, getGradeTemplate, isUpperSecondaryGrade } from '../../school-curriculum.js';
import { addisDate, auditRow, campusScopeError, now, setupConflict } from '../shared.js';
import { mapAcademicYear, mapSchoolCalendarEntry, mapCurriculumUnit, mapLessonPlan, mapPromotionRule } from '../academic.mappers.js';

export const mysqlAcademicBundle = {
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
  },
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
  },
  async hasStudentsInSections(campusId, sectionIds, ids) {
    const rows = await this.db('enrolments as e')
      .join('students as st', 'st.id', 'e.student_id')
      .where({ 'st.campus_id': campusId, 'e.status': 'active' })
      .whereIn('e.section_id', sectionIds)
      .whereIn('st.id', ids)
      .countDistinct({ total: 'st.id' }).first();
    return Number(rows.total) === ids.length;
  },
  async getAcademicYear(campusId) {
    const row = await this.db('academic_years').where({ campus_id: campusId, status: 'active' })
      .orderBy('start_date', 'desc').first();
    return row ? {
      id: row.id, campusId: row.campus_id, labelEc: row.label_ec,
      startDate: String(row.start_date).slice(0, 10),
      endDate: String(row.end_date).slice(0, 10), status: row.status
    } : null;
  },
  async listAcademicYears(campusId) {
    const rows = await this.db('academic_years').where({ campus_id: campusId }).orderBy('start_date', 'desc');
    return rows.map(mapAcademicYear);
  },
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
  },
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
  },
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
  },
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
  },
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
  },
  async listSchoolCalendarEntries(campusId, { from, to } = {}) {
    const query = this.db('school_calendar_entries').where({ campus_id: campusId })
      .orderBy('start_date').orderBy('title_en');
    if (from) query.where('end_date', '>=', from);
    if (to) query.where('start_date', '<=', to);
    return (await query).map(mapSchoolCalendarEntry);
  },
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
  },
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
  },
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
  },
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
  },
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
  },
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
  },
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
  },
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
  },
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
  },
  async listPromotionRules(campusId) {
    const year = await this.getAcademicYear(campusId);
    if (!year) return [];
    const rows = await this.db('promotion_rules as pr')
      .join('grade_levels as g', 'g.id', 'pr.grade_level_id')
      .where({ 'pr.campus_id': campusId, 'pr.academic_year_id': year.id })
      .select('pr.*', 'g.name_en as grade_name');
    return rows.map((row) => ({ ...mapPromotionRule(row), gradeName: row.grade_name }));
  },
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
  },
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
  },
  async listGrades(campusId) {
    const rows = await this.db('grade_levels').where({ campus_id: campusId }).orderBy('sort_order');
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, code: row.code, nameEn: row.name_en,
      nameAm: row.name_am, band: row.band, sortOrder: row.sort_order
    }));
  },
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
  },
  async listSubjects(campusId) {
    const rows = await this.db('subjects').where({ campus_id: campusId }).orderBy('name_en');
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, code: row.code,
      nameEn: row.name_en, nameAm: row.name_am, category: row.category ?? 'core'
    }));
  },
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
  },
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
  },
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
  },
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
  },
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
  },
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
};
