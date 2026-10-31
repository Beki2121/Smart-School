export function createAssessmentsController(context) {
  const { gradingPolicySchema, gradingScaleSchema, markAmendmentSchema, markSchema, parse, repo, z } = context;
  return {
    getMarks: async (request, response, next) => {
    try {
      response.json({ data: await repo.listMarks(request.user.activeCampusId, request.user) });
    } catch (error) { next(error); }
  },
    getMarksContext: async (request, response, next) => {
    try {
      const campusId = request.user.activeCampusId;
      response.json({ data: {
        terms: await repo.listTerms(campusId),
        subjects: await repo.listSubjects(campusId)
      } });
    } catch (error) { next(error); }
  },
    getMarksSummary: async (request, response, next) => {
    try {
      const termId = parse(z.string().uuid(), request.query.termId);
      response.json({ data: await repo.getTermMarksSummary(termId, request.user) });
    } catch (error) { next(error); }
  },
    postMarks: async (request, response, next) => {
    try {
      const input = parse(markSchema, request.body);
      const item = await repo.saveMark(input, request.user);
      response.status(item.duplicate ? 200 : 201).json({ data: item });
    } catch (error) { next(error); }
  },
    postMarksByMarkIdSubmit: async (request, response, next) => {
    try {
      const item = await repo.transitionMark(
        parse(z.string().uuid(), request.params.markId), 'submitted', request.user
      );
      if (!item) return response.status(404).json({ error: { code: 'MARK_NOT_FOUND', message: 'Mark not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  },
    postMarksByMarkIdApprove: async (request, response, next) => {
    try {
      const item = await repo.transitionMark(
        parse(z.string().uuid(), request.params.markId), 'approved', request.user
      );
      if (!item) return response.status(404).json({ error: { code: 'MARK_NOT_FOUND', message: 'Mark not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  },
    postMarksByMarkIdPublish: async (request, response, next) => {
    try {
      const item = await repo.transitionMark(
        parse(z.string().uuid(), request.params.markId), 'locked', request.user
      );
      if (!item) return response.status(404).json({ error: { code: 'MARK_NOT_FOUND', message: 'Mark not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  },
    postMarksByMarkIdAmend: async (request, response, next) => {
    try {
      const item = await repo.amendPublishedMark(
        parse(z.string().uuid(), request.params.markId),
        parse(markAmendmentSchema, request.body),
        request.user
      );
      if (!item) return response.status(404).json({ error: { code: 'MARK_NOT_FOUND', message: 'Mark not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  },
    getMarksStudentsByStudentId: async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const marks = await repo.listMarks(request.user.activeCampusId, request.user);
      response.json({ data: marks.filter((item) => item.studentId === studentId) });
    } catch (error) { next(error); }
  },
    getGradingBands: async (request, response, next) => {
    try {
      response.json({ data: await repo.listGradingBands(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    putGradingBands: async (request, response, next) => {
    try {
      const bands = await repo.replaceGradingBands(parse(gradingScaleSchema, request.body), request.user);
      response.json({ data: bands });
    } catch (error) { next(error); }
  },
    getGradingPolicy: async (request, response, next) => {
    try {
      response.json({ data: await repo.getGradingPolicy(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    putGradingPolicy: async (request, response, next) => {
    try {
      const policy = await repo.confirmGradingPolicy(
        parse(gradingPolicySchema, request.body), request.user
      );
      response.json({ data: policy });
    } catch (error) { next(error); }
  },
    getReportCardsStudentsByStudentId: async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const termId = parse(z.string().uuid(), request.query.termId);
      response.json({ data: await repo.getStudentReportCard(studentId, termId, request.user) });
    } catch (error) { next(error); }
  },
    postReportCardsStudentsByStudentIdDrafts: async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const input = parse(z.object({
        termId: z.string().uuid(),
        amendmentReason: z.string().trim().min(5).max(500).optional()
      }), request.body);
      response.status(201).json({
        data: await repo.createTermReportDraft(
          studentId, input.termId, request.user, input.amendmentReason ?? null
        )
      });
    } catch (error) { next(error); }
  },
    postReportCardsByReportIdSubmit: async (request, response, next) => {
    try {
      const item = await repo.transitionTermReport(
        parse(z.string().uuid(), request.params.reportId), 'submitted', request.user
      );
      if (!item) return response.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: 'Report revision not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  },
    postReportCardsByReportIdApprove: async (request, response, next) => {
    try {
      const item = await repo.transitionTermReport(
        parse(z.string().uuid(), request.params.reportId), 'approved', request.user
      );
      if (!item) return response.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: 'Report revision not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  },
    postReportCardsByReportIdPublish: async (request, response, next) => {
    try {
      const item = await repo.transitionTermReport(
        parse(z.string().uuid(), request.params.reportId), 'published', request.user
      );
      if (!item) return response.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: 'Report revision not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  }
  };
}
