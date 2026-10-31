export function createAcademicController(context) {
  const { SCHOOL_GRADE_CATALOG, academicYearIdSchema, academicYearSchema, curriculumUnitSchema, gradeSchema, gradeSubjectsSchema, lessonPlanSchema, lessonPlanUpdateSchema, parse, promotionRuleSchema, repo, roomSchema, schoolCalendarEntrySchema, sectionCapacitySchema, sectionSchema, subjectSchema, substituteSchema, termSchema, timetablePeriodSchema, timetableQuerySchema, z } = context;
  return {
    getSchoolCalendar: async (request, response, next) => {
    try {
      const filters = parse(z.object({
        from: z.string().date().optional(), to: z.string().date().optional()
      }).refine((value) => !value.from || !value.to || value.from <= value.to, {
        message: 'Calendar range start must not be after end.'
      }), request.query);
      response.json({ data: await repo.listSchoolCalendarEntries(request.user.activeCampusId, filters) });
    } catch (error) { next(error); }
  },
    postSchoolCalendar: async (request, response, next) => {
    try {
      const entry = await repo.createSchoolCalendarEntry(
        parse(schoolCalendarEntrySchema, request.body), request.user
      );
      response.status(201).json({ data: entry });
    } catch (error) { next(error); }
  },
    putSchoolCalendarByentryId: async (request, response, next) => {
    try {
      const entry = await repo.updateSchoolCalendarEntry(
        parse(z.string().uuid(), request.params.entryId),
        parse(schoolCalendarEntrySchema, request.body), request.user
      );
      if (!entry) return response.status(404).json({ error: { code: 'CALENDAR_ENTRY_NOT_FOUND', message: 'Calendar entry not found.' } });
      response.json({ data: entry });
    } catch (error) { next(error); }
  },
    deleteSchoolCalendarByentryId: async (request, response, next) => {
    try {
      const deleted = await repo.deleteSchoolCalendarEntry(
        parse(z.string().uuid(), request.params.entryId), request.user
      );
      if (!deleted) return response.status(404).json({ error: { code: 'CALENDAR_ENTRY_NOT_FOUND', message: 'Calendar entry not found.' } });
      response.status(204).end();
    } catch (error) { next(error); }
  },
    getAcademicYear: async (request, response, next) => {
    try {
      response.json({ data: await repo.getAcademicYear(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    getAcademicYears: async (request, response, next) => {
    try {
      response.json({ data: await repo.listAcademicYears(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    postAcademicYears: async (request, response, next) => {
    try {
      const year = await repo.createAcademicYear(parse(academicYearSchema, request.body), request.user);
      response.status(201).json({ data: year });
    } catch (error) { next(error); }
  },
    patchAcademicYearsByyearIdActivate: async (request, response, next) => {
    try {
      const yearId = parse(academicYearIdSchema, request.params.yearId);
      const year = await repo.activateAcademicYear(yearId, request.user);
      if (!year) return response.status(404).json({ error: { code: 'ACADEMIC_YEAR_NOT_FOUND', message: 'Academic year not found.' } });
      response.json({ data: year });
    } catch (error) { next(error); }
  },
    getTerms: async (request, response, next) => {
    try {
      response.json({ data: await repo.listTerms(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    postTerms: async (request, response, next) => {
    try {
      const term = await repo.createTerm(parse(termSchema, request.body), request.user);
      response.status(201).json({ data: term });
    } catch (error) { next(error); }
  },
    patchTermsBytermIdCurrent: async (request, response, next) => {
    try {
      const termId = parse(academicYearIdSchema, request.params.termId);
      const term = await repo.setCurrentTerm(termId, request.user);
      if (!term) return response.status(404).json({
        error: { code: 'TERM_NOT_FOUND', message: 'Term not found in the active academic year.' }
      });
      response.json({ data: term });
    } catch (error) { next(error); }
  },
    getGrades: async (request, response, next) => {
    try {
      response.json({ data: await repo.listGrades(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    getCurriculumGrades: (_request, response) => {
    response.json({ data: SCHOOL_GRADE_CATALOG });
  },
    getCurriculumUnits: async (request, response, next) => {
    try {
      const filters = parse(z.object({
        academicYearId: z.string().uuid().optional(),
        gradeLevelId: z.string().uuid().optional(),
        subjectId: z.string().uuid().optional()
      }), request.query);
      response.json({ data: await repo.listCurriculumUnits(request.user.activeCampusId, filters) });
    } catch (error) { next(error); }
  },
    postCurriculumUnits: async (request, response, next) => {
    try {
      const unit = await repo.saveCurriculumUnit(
        parse(curriculumUnitSchema, request.body), request.user
      );
      response.status(201).json({ data: unit });
    } catch (error) { next(error); }
  },
    putCurriculumUnitsByunitId: async (request, response, next) => {
    try {
      const unit = await repo.saveCurriculumUnit(
        parse(curriculumUnitSchema, request.body), request.user,
        parse(z.string().uuid(), request.params.unitId)
      );
      if (!unit) return response.status(404).json({ error: { code: 'CURRICULUM_UNIT_NOT_FOUND', message: 'Curriculum unit not found.' } });
      response.json({ data: unit });
    } catch (error) { next(error); }
  },
    deleteCurriculumUnitsByunitId: async (request, response, next) => {
    try {
      const deleted = await repo.deleteCurriculumUnit(
        parse(z.string().uuid(), request.params.unitId), request.user
      );
      if (!deleted) return response.status(404).json({ error: { code: 'CURRICULUM_UNIT_NOT_FOUND', message: 'Curriculum unit not found.' } });
      response.status(204).end();
    } catch (error) { next(error); }
  },
    postGrades: async (request, response, next) => {
    try {
      const grade = await repo.createGrade(parse(gradeSchema, request.body), request.user);
      response.status(201).json({ data: grade });
    } catch (error) { next(error); }
  },
    getGradesBygradeIdSubjects: async (request, response, next) => {
    try {
      const gradeId = parse(z.string().uuid(), request.params.gradeId);
      const stream = request.query.stream
        ? parse(z.enum(['natural_science', 'social_science']), request.query.stream)
        : undefined;
      response.json({ data: await repo.listGradeSubjects(request.user.activeCampusId, gradeId, stream) });
    } catch (error) { next(error); }
  },
    putGradesBygradeIdSubjects: async (request, response, next) => {
    try {
      const gradeId = parse(z.string().uuid(), request.params.gradeId);
      const subjects = await repo.replaceGradeSubjects(gradeId, parse(gradeSubjectsSchema, request.body), request.user);
      response.json({ data: subjects });
    } catch (error) { next(error); }
  },
    getSubjects: async (request, response, next) => {
    try {
      response.json({ data: await repo.listSubjects(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    postSubjects: async (request, response, next) => {
    try {
      const subject = await repo.createSubject(parse(subjectSchema, request.body), request.user);
      response.status(201).json({ data: subject });
    } catch (error) { next(error); }
  },
    getPromotionRules: async (request, response, next) => {
    try {
      response.json({ data: await repo.listPromotionRules(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    putGradesBygradeIdPromotionRule: async (request, response, next) => {
    try {
      const gradeLevelId = parse(z.string().uuid(), request.params.gradeId);
      const input = parse(promotionRuleSchema, { ...request.body, gradeLevelId });
      response.json({ data: await repo.savePromotionRule(input, request.user) });
    } catch (error) { next(error); }
  },
    getLessonPlans: async (request, response, next) => {
    try {
      const filters = parse(z.object({
        from: z.string().date().optional(), to: z.string().date().optional(),
        sectionId: z.string().uuid().optional()
      }).refine((value) => !value.from || !value.to || value.from <= value.to, {
        message: 'Lesson plan range start must not be after end.'
      }), request.query);
      response.json({ data: await repo.listLessonPlans(request.user, filters) });
    } catch (error) { next(error); }
  },
    postLessonPlans: async (request, response, next) => {
    try {
      const plan = await repo.createLessonPlan(parse(lessonPlanSchema, request.body), request.user);
      response.status(201).json({ data: plan });
    } catch (error) { next(error); }
  },
    putLessonPlansBylessonPlanId: async (request, response, next) => {
    try {
      const plan = await repo.updateLessonPlan(
        parse(z.string().uuid(), request.params.lessonPlanId),
        parse(lessonPlanUpdateSchema, request.body), request.user
      );
      if (!plan) return response.status(404).json({ error: { code: 'LESSON_PLAN_NOT_FOUND', message: 'Lesson plan not found.' } });
      response.json({ data: plan });
    } catch (error) { next(error); }
  },
    getTimetablePeriods: async (request, response, next) => {
    try {
      response.json({ data: await repo.listTimetablePeriods(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    postTimetablePeriods: async (request, response, next) => {
    try {
      const period = await repo.createTimetablePeriod(parse(timetablePeriodSchema, request.body), request.user);
      response.status(201).json({ data: period });
    } catch (error) { next(error); }
  },
    getTimetableRooms: async (request, response, next) => {
    try {
      response.json({ data: await repo.listRooms(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    postTimetableRooms: async (request, response, next) => {
    try {
      const room = await repo.createRoom(parse(roomSchema, request.body), request.user);
      response.status(201).json({ data: room });
    } catch (error) { next(error); }
  },
    getTimetable: async (request, response, next) => {
    try {
      const query = parse(timetableQuerySchema, request.query);
      response.json({ data: await repo.listTimetable(request.user, query) });
    } catch (error) { next(error); }
  },
    postTimetableAssignmentsByassignmentIdSubstitutions: async (request, response, next) => {
    try {
      const assignmentId = parse(z.string().uuid(), request.params.assignmentId);
      const substitution = await repo.createTimetableSubstitution(
        assignmentId, parse(substituteSchema, request.body), request.user
      );
      if (!substitution) return response.status(404).json({ error: { code: 'TIMETABLE_ASSIGNMENT_NOT_FOUND', message: 'Timetable assignment not found.' } });
      response.status(201).json({ data: substitution });
    } catch (error) { next(error); }
  },
    putSectionsBysectionIdHomeroom: async (request, response, next) => {
    try {
      const input = parse(z.object({ staffId: z.string().uuid() }), request.body);
      const sectionId = parse(z.string().uuid(), request.params.sectionId);
      const assignment = await repo.assignHomeroom(sectionId, input.staffId, request.user);
      if (!assignment) return response.status(404).json({ error: { code: 'SECTION_NOT_FOUND', message: 'Section not found.' } });
      response.json({ data: assignment });
    } catch (error) { next(error); }
  },
    postSections: async (request, response, next) => {
    try {
      const section = await repo.createSection(parse(sectionSchema, request.body), request.user);
      response.status(201).json({ data: section });
    } catch (error) { next(error); }
  },
    patchSectionsBysectionIdCapacity: async (request, response, next) => {
    try {
      const sectionId = parse(z.string().uuid(), request.params.sectionId);
      const section = await repo.updateSectionCapacity(sectionId, parse(sectionCapacitySchema, request.body), request.user);
      if (!section) return response.status(404).json({ error: { code: 'SECTION_NOT_FOUND', message: 'Section not found.' } });
      response.json({ data: section });
    } catch (error) { next(error); }
  },
    getSections: async (request, response, next) => {
    try {
      response.json({ data: await repo.listSections(request.user.activeCampusId, request.user) });
    } catch (error) { next(error); }
  }
  };
}
