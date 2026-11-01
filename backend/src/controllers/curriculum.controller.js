export function createCurriculumController(context) {
  const { SCHOOL_GRADE_CATALOG, curriculumUnitSchema, gradeSubjectsSchema, lessonPlanSchema, lessonPlanUpdateSchema, parse, promotionRuleSchema, repo, subjectSchema, z } = context;
  return {
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
  };
}
