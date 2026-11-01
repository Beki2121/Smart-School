export function createAcademicController(context) {
  const { academicYearIdSchema, academicYearSchema, gradeSchema, parse, repo, schoolCalendarEntrySchema, sectionCapacitySchema, sectionSchema, termSchema, z } = context;
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
    postGrades: async (request, response, next) => {
    try {
      const grade = await repo.createGrade(parse(gradeSchema, request.body), request.user);
      response.status(201).json({ data: grade });
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
