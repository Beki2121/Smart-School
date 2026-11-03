export function createExamsController({ examCreateSchema, examScheduleEntrySchema,
  examScheduleEntryUpdateSchema, examTypeSchema, examTypeUpdateSchema, examUpdateSchema,
  parse, repo, z }) {
  return {
    getExamTypes: async (request, response, next) => {
      try {
        response.json({ data: await repo.listExamTypes(request.user) });
      } catch (error) { next(error); }
    },
    postExamTypes: async (request, response, next) => {
      try {
        response.status(201).json({
          data: await repo.createExamType(parse(examTypeSchema, request.body), request.user)
        });
      } catch (error) { next(error); }
    },
    patchExamTypesByExamTypeId: async (request, response, next) => {
      try {
        const id = parse(z.string().uuid(), request.params.examTypeId);
        const item = await repo.updateExamType(
          id, parse(examTypeUpdateSchema, request.body), request.user
        );
        if (!item) return response.status(404).json({
          error: { code: 'EXAM_TYPE_NOT_FOUND', message: 'Exam type not found.' }
        });
        response.json({ data: item });
      } catch (error) { next(error); }
    },
    getExams: async (request, response, next) => {
      try {
        const query = parse(z.object({ termId: z.string().uuid().optional() }), request.query);
        response.json({ data: await repo.listExams(request.user, query) });
      } catch (error) { next(error); }
    },
    getExamsMonitoring: async (request, response, next) => {
      try {
        response.json({ data: await repo.getExamMonitoring(request.user) });
      } catch (error) { next(error); }
    },
    postExams: async (request, response, next) => {
      try {
        response.status(201).json({
          data: await repo.createExam(parse(examCreateSchema, request.body), request.user)
        });
      } catch (error) { next(error); }
    },
    patchExamsByExamId: async (request, response, next) => {
      try {
        const id = parse(z.string().uuid(), request.params.examId);
        const item = await repo.updateExam(id, parse(examUpdateSchema, request.body), request.user);
        if (!item) return response.status(404).json({
          error: { code: 'EXAM_NOT_FOUND', message: 'Exam not found.' }
        });
        response.json({ data: item });
      } catch (error) { next(error); }
    },
    postExamsByExamIdSchedule: async (request, response, next) => {
      try {
        const examId = parse(z.string().uuid(), request.params.examId);
        const item = await repo.addExamScheduleEntry(
          examId, parse(examScheduleEntrySchema, request.body), request.user
        );
        if (!item) return response.status(404).json({
          error: { code: 'EXAM_NOT_FOUND', message: 'Exam not found.' }
        });
        response.status(201).json({ data: item });
      } catch (error) { next(error); }
    },
    putExamsByExamIdScheduleEntry: async (request, response, next) => {
      try {
        const examId = parse(z.string().uuid(), request.params.examId);
        const entryId = parse(z.string().uuid(), request.params.entryId);
        const item = await repo.updateExamScheduleEntry(
          examId, entryId, parse(examScheduleEntryUpdateSchema, request.body), request.user
        );
        if (!item) return response.status(404).json({
          error: { code: 'EXAM_SCHEDULE_ENTRY_NOT_FOUND', message: 'Exam schedule entry not found.' }
        });
        response.json({ data: item });
      } catch (error) { next(error); }
    },
    postExamsByExamIdSchedulePublish: async (request, response, next) => {
      try {
        const item = await repo.publishExamSchedule(
          parse(z.string().uuid(), request.params.examId), request.user
        );
        if (!item) return response.status(404).json({
          error: { code: 'EXAM_NOT_FOUND', message: 'Exam not found.' }
        });
        response.json({ data: item });
      } catch (error) { next(error); }
    },
    postExamsByExamIdMarksOpen: async (request, response, next) => {
      try {
        const item = await repo.openExamMarks(
          parse(z.string().uuid(), request.params.examId), request.user
        );
        if (!item) return response.status(404).json({
          error: { code: 'EXAM_NOT_FOUND', message: 'Exam not found.' }
        });
        response.json({ data: item });
      } catch (error) { next(error); }
    }
  };
}
