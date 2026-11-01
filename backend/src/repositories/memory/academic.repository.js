import { randomUUID } from 'node:crypto';
import { DEFAULT_GRADING_BANDS, getGradeTemplate, isUpperSecondaryGrade } from '../../school-curriculum.js';
import { addisDate, auditRow, campusScopeError, now, setupConflict } from '../shared.js';
import { mapAcademicYear, mapSchoolCalendarEntry, mapCurriculumUnit, mapLessonPlan, mapPromotionRule } from '../academic.mappers.js';

export const memoryAcademicBundle = {
  async listSections(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    return this.sections.filter((section) => section.campusId === campusId && section.isActive &&
      (accessible === null || accessible.has(section.id)));
  },
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
  },
  async hasStudentsInSections(campusId, sectionIds, ids) {
    const allowed = new Set(sectionIds);
    const sectionNames = new Set(this.sections.filter((section) => allowed.has(section.id)).map((section) => section.name));
    const rows = this.students.filter((student) =>
      student.campusId === campusId && sectionNames.has(student.sectionName) && ids.includes(student.id));
    return rows.length === ids.length;
  },
  async getAcademicYear(campusId) {
    return this.academicYears.find((year) => year.campusId === campusId && year.status === 'active') ?? null;
  },
  async listAcademicYears(campusId) {
    return this.academicYears.filter((year) => year.campusId === campusId);
  },
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
  },
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
  },
  async listTerms(campusId) {
    return this.academicYears.filter((year) => year.campusId === campusId)
      .flatMap((year) => (year.terms ?? []).map((term) => ({
        ...term, academicYearId: year.id, periodType: term.periodType ?? 'term'
      })));
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
    year.terms ??= [];
    if (year.terms.some((term) => term.name.toLowerCase() === data.name.toLowerCase())) {
      throw setupConflict('Term name already exists in the active academic year.');
    }
    const term = { id: randomUUID(), ...data, periodType: data.periodType ?? 'term', isCurrent: year.terms.length === 0 };
    year.terms.push(term);
    await this.appendAudit(actor, 'term.created', 'term', term.id, null, term);
    return { ...term, academicYearId: year.id };
  },
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
  },
  async listSchoolCalendarEntries(campusId, { from, to } = {}) {
    return this.schoolCalendarEntries.filter((entry) => entry.campusId === campusId &&
      (!from || entry.endDate >= from) && (!to || entry.startDate <= to))
      .sort((left, right) => left.startDate.localeCompare(right.startDate));
  },
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
  },
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
  },
  async deleteSchoolCalendarEntry(id, actor) {
    const index = this.schoolCalendarEntries.findIndex((item) =>
      item.id === id && item.campusId === actor.activeCampusId);
    if (index < 0) return false;
    const [entry] = this.schoolCalendarEntries.splice(index, 1);
    await this.appendAudit(actor, 'school_calendar_entry.deleted', 'school_calendar_entry', id, entry, null);
    return true;
  },
  async listCurriculumUnits(campusId, { academicYearId, gradeLevelId, subjectId } = {}) {
    return this.curriculumUnits.filter((unit) => unit.campusId === campusId &&
      (!academicYearId || unit.academicYearId === academicYearId) &&
      (!gradeLevelId || unit.gradeLevelId === gradeLevelId) &&
      (!subjectId || unit.subjectId === subjectId))
      .sort((left, right) => left.unitNumber - right.unitNumber);
  },
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
  },
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
  },
  async listLessonPlans(actor, { from, to, sectionId } = {}) {
    const assignments = await this.listTeachingAssignments(actor);
    const assignmentIds = new Set(assignments.map((item) => item.id));
    return this.lessonPlans.filter((plan) => plan.campusId === actor.activeCampusId &&
      assignmentIds.has(plan.teachingAssignmentId) &&
      (!from || plan.plannedOn >= from) && (!to || plan.plannedOn <= to) &&
      (!sectionId || plan.sectionId === sectionId))
      .sort((left, right) => left.plannedOn.localeCompare(right.plannedOn));
  },
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
  },
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
  },
  async listPromotionRules(campusId) {
    const year = await this.getAcademicYear(campusId);
    if (!year) return [];
    return this.promotionRules.filter((rule) =>
      rule.campusId === campusId && rule.academicYearId === year.id);
  },
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
  },
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
  },
  async listGrades(campusId) {
    return this.gradeLevels.filter((grade) => grade.campusId === campusId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },
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
  },
  async listSubjects(campusId) {
    return this.subjects.filter((subject) => subject.campusId === campusId)
      .map((subject) => ({ ...subject, category: subject.category ?? 'core' }));
  },
  async createSubject(data, actor) {
    if (this.subjects.some((subject) => subject.campusId === actor.activeCampusId && subject.code === data.code)) {
      throw setupConflict('Subject code already exists at this campus.');
    }
    const subject = { id: randomUUID(), campusId: actor.activeCampusId, ...data, category: data.category ?? 'core' };
    this.subjects.push(subject);
    await this.appendAudit(actor, 'subject.created', 'subject', subject.id, null, subject);
    return subject;
  },
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
  },
  async sectionHasSubject(section, subjectId) {
    const mappings = this.gradeSubjects.filter((item) => item.gradeLevelId === section.gradeLevelId);
    return mappings.length === 0 || mappings.some((item) =>
      item.gradeLevelId === section.gradeLevelId && item.subjectId === subjectId &&
      (item.stream === 'all' || item.stream === section.stream));
  },
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
  },
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
  },
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
};
