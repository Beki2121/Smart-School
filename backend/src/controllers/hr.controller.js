export function createHrController(context) {
  const { hrDocumentCategorySchema, hrDocumentNameSchema, hrStaffIdSchema,
    hrStaffUpdateSchema, hrContractSchema, hrContractRenewalSchema, hrLeaveTypeSchema,
    hrLeaveBalanceSchema, hrContractListSchema, hrLeaveBalanceListSchema,
    hrRenewalIdSchema, hrVacancySchema, hrApplicantSchema, hrInterviewSchema,
    hrApplicantDecisionSchema, hrPerformanceCycleSchema, hrPerformanceGoalSchema,
    hrPerformanceEvaluationSchema, hrTrainingCourseSchema, hrTrainingEnrollmentSchema,
    hrTrainingAttendanceSchema, hrApplicantDocumentCategorySchema,
    parse, previewHrStaffCsv, repo, z } = context;
  const notFound = (response, code, message) =>
    response.status(404).json({ error: { code, message } });
  return {
    getDashboard: async (request, response, next) => {
      try { response.json({ data: await repo.getHrDashboard(request.user) }); }
      catch (error) { next(error); }
    },
    patchStaff: async (request, response, next) => {
      try {
        const staffId = parse(hrStaffIdSchema, request.params.staffId);
        const staff = await repo.updateHrStaff(
          staffId, parse(hrStaffUpdateSchema, request.body), request.user
        );
        if (!staff) return notFound(response, 'STAFF_NOT_FOUND', 'Staff profile not found.');
        response.set('Cache-Control', 'no-store').json({ data: staff });
      } catch (error) { next(error); }
    },
    archiveStaff: async (request, response, next) => {
      try {
        const result = await repo.archiveHrStaff(
          parse(hrStaffIdSchema, request.params.staffId), request.user
        );
        if (!result) return notFound(response, 'STAFF_NOT_FOUND', 'Staff profile not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    previewStaffImport: async (request, response, next) => {
      try {
        const preview = await previewHrStaffCsv(repo, request.body, request.user);
        response.set('Cache-Control', 'no-store').json({ data: {
          totalRows: preview.totalRows, eligibleCount: preview.eligibleCount,
          invalidCount: preview.invalidCount, rows: preview.rows
        } });
      } catch (error) { next(error); }
    },
    commitStaffImport: async (request, response, next) => {
      try {
        const preview = await previewHrStaffCsv(repo, request.body, request.user);
        const imported = await repo.importHrStaff(preview.dataRows, request.user);
        response.set('Cache-Control', 'no-store').json({ data: {
          totalRows: preview.totalRows, createdCount: imported.createdCount,
          skippedCount: preview.totalRows - imported.createdCount,
          rows: [...preview.rows.filter((row) => !row.eligible), ...imported.reports]
            .sort((left, right) => left.rowNumber - right.rowNumber)
        } });
      } catch (error) { next(error); }
    },
    listStaffDocuments: async (request, response, next) => {
      try {
        const result = await repo.listStaffDocuments(
          parse(hrStaffIdSchema, request.params.staffId), request.user
        );
        if (result === null) return notFound(response, 'STAFF_NOT_FOUND', 'Staff profile not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    uploadStaffDocument: async (request, response, next) => {
      try {
        if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
          return response.status(400).json({ error: {
            code: 'INVALID_DOCUMENT',
            message: 'Upload a non-empty PDF, JPEG, or PNG file no larger than 5 MB.'
          } });
        }
        const document = await repo.storeStaffDocument(
          parse(hrStaffIdSchema, request.params.staffId),
          parse(hrDocumentCategorySchema, request.query.category),
          parse(hrDocumentNameSchema, request.query.name),
          request.headers['content-type'], request.body, request.user
        );
        response.set('Cache-Control', 'no-store').status(201).json({ data: document });
      } catch (error) { next(error); }
    },
    downloadStaffDocument: async (request, response, next) => {
      try {
        const result = await repo.getStaffDocument(
          parse(hrStaffIdSchema, request.params.staffId),
          parse(z.string().uuid(), request.params.documentId), request.user
        );
        if (!result) return notFound(response, 'DOCUMENT_NOT_FOUND', 'Staff document not found.');
        response.set('Cache-Control', 'no-store').type(result.document.mimeType)
          .attachment(result.document.originalName).send(result.content);
      } catch (error) { next(error); }
    },
    listContracts: async (request, response, next) => {
      try {
        const { staffId } = parse(hrContractListSchema, request.query);
        const result = await repo.listHrContracts(request.user, staffId);
        if (result === null) return notFound(response, 'STAFF_NOT_FOUND', 'Staff profile not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    createContract: async (request, response, next) => {
      try {
        const result = await repo.createHrContract(
          parse(hrStaffIdSchema, request.params.staffId),
          parse(hrContractSchema, request.body), request.user
        );
        if (!result) return notFound(response, 'STAFF_NOT_FOUND', 'Staff profile not found.');
        response.status(201).set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    renewContract: async (request, response, next) => {
      try {
        const result = await repo.renewHrContract(
          parse(hrRenewalIdSchema, request.params.contractId),
          parse(hrContractRenewalSchema, request.body), request.user
        );
        if (!result) return notFound(response, 'CONTRACT_NOT_FOUND', 'Contract not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    listContractRenewals: async (request, response, next) => {
      try {
        const result = await repo.listHrContractRenewals(
          parse(hrRenewalIdSchema, request.params.contractId), request.user
        );
        if (result === null) return notFound(response, 'CONTRACT_NOT_FOUND', 'Contract not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    listLeaveTypes: async (request, response, next) => {
      try {
        response.set('Cache-Control', 'no-store')
          .json({ data: await repo.listHrLeaveTypes(request.user) });
      } catch (error) { next(error); }
    },
    createLeaveType: async (request, response, next) => {
      try {
        const result = await repo.createHrLeaveType(
          parse(hrLeaveTypeSchema, request.body), request.user
        );
        response.status(201).set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    listLeaveBalances: async (request, response, next) => {
      try {
        const { staffId, year } = parse(hrLeaveBalanceListSchema, request.query);
        const result = await repo.listHrLeaveBalances(request.user, staffId);
        if (result === null) return notFound(response, 'STAFF_NOT_FOUND', 'Staff profile not found.');
        response.set('Cache-Control', 'no-store').json({
          data: year ? result.filter((item) => item.year === year) : result
        });
      } catch (error) { next(error); }
    },
    setLeaveBalance: async (request, response, next) => {
      try {
        const result = await repo.setHrLeaveBalance(
          parse(hrLeaveBalanceSchema, request.body), request.user
        );
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    listVacancies: async (request, response, next) => {
      try { response.json({ data: await repo.listHrVacancies(request.user) }); }
      catch (error) { next(error); }
    },
    createVacancy: async (request, response, next) => {
      try {
        response.status(201).json({ data: await repo.createHrVacancy(
          parse(hrVacancySchema, request.body), request.user
        ) });
      } catch (error) { next(error); }
    },
    listApplicants: async (request, response, next) => {
      try {
        const vacancyId = request.query.vacancyId
          ? parse(z.string().uuid(), request.query.vacancyId) : undefined;
        response.set('Cache-Control', 'no-store')
          .json({ data: await repo.listHrApplicants(request.user, vacancyId) });
      } catch (error) { next(error); }
    },
    createApplicant: async (request, response, next) => {
      try {
        const applicant = await repo.createHrApplicant(
          parse(z.string().uuid(), request.params.vacancyId),
          parse(hrApplicantSchema, request.body), request.user
        );
        if (!applicant) return notFound(response, 'VACANCY_NOT_FOUND', 'Open vacancy not found.');
        response.status(201).json({ data: applicant });
      } catch (error) { next(error); }
    },
    scheduleInterview: async (request, response, next) => {
      try {
        const interview = await repo.scheduleHrInterview(
          parse(z.string().uuid(), request.params.applicantId),
          parse(hrInterviewSchema, request.body), request.user
        );
        if (!interview) return notFound(response, 'APPLICANT_NOT_FOUND', 'Applicant not found or closed.');
        response.status(201).json({ data: interview });
      } catch (error) { next(error); }
    },
    listInterviews: async (request, response, next) => {
      try {
        const interviews = await repo.listHrInterviews(
          parse(z.string().uuid(), request.params.applicantId), request.user
        );
        if (interviews === null) return notFound(response, 'APPLICANT_NOT_FOUND', 'Applicant not found.');
        response.json({ data: interviews });
      } catch (error) { next(error); }
    },
    decideApplicant: async (request, response, next) => {
      try {
        const applicant = await repo.decideHrApplicant(
          parse(z.string().uuid(), request.params.applicantId),
          parse(hrApplicantDecisionSchema, request.body), request.user
        );
        if (!applicant) return notFound(response, 'APPLICANT_NOT_FOUND', 'Applicant not found.');
        response.json({ data: applicant });
      } catch (error) { next(error); }
    },
    uploadApplicantDocument: async (request, response, next) => {
      try {
        if (!Buffer.isBuffer(request.body) || !request.body.length) return response.status(400).json({
          error: { code: 'INVALID_DOCUMENT', message: 'A non-empty PDF, JPEG, or PNG file is required.' }
        });
        const document = await repo.storeHrApplicantDocument(
          parse(z.string().uuid(), request.params.applicantId),
          parse(hrApplicantDocumentCategorySchema, request.query.category),
          parse(hrDocumentNameSchema, request.query.name),
          request.headers['content-type'], request.body, request.user
        );
        if (!document) return notFound(response, 'APPLICANT_NOT_FOUND', 'Applicant not found.');
        response.status(201).json({ data: document });
      } catch (error) { next(error); }
    },
    listApplicantDocuments: async (request, response, next) => {
      try {
        const documents = await repo.listHrApplicantDocuments(
          parse(z.string().uuid(), request.params.applicantId), request.user
        );
        if (documents === null) return notFound(response, 'APPLICANT_NOT_FOUND', 'Applicant not found.');
        response.set('Cache-Control', 'no-store').json({ data: documents });
      } catch (error) { next(error); }
    },
    downloadApplicantDocument: async (request, response, next) => {
      try {
        const result = await repo.getHrApplicantDocument(
          parse(z.string().uuid(), request.params.applicantId),
          parse(z.string().uuid(), request.params.documentId), request.user
        );
        if (!result) return notFound(response, 'DOCUMENT_NOT_FOUND', 'Applicant document not found.');
        response.set('Cache-Control', 'no-store').type(result.document.mimeType)
          .attachment(result.document.originalName).send(result.content);
      } catch (error) { next(error); }
    },
    createPerformanceCycle: async (request, response, next) => {
      try {
        response.status(201).json({ data: await repo.createHrPerformanceCycle(
          parse(hrPerformanceCycleSchema, request.body), request.user
        ) });
      } catch (error) { next(error); }
    },
    listPerformanceCycles: async (request, response, next) => {
      try { response.json({ data: await repo.listHrPerformanceCycles(request.user) }); }
      catch (error) { next(error); }
    },
    createPerformanceGoal: async (request, response, next) => {
      try {
        response.status(201).json({ data: await repo.createHrPerformanceGoal(
          parse(hrPerformanceGoalSchema, request.body), request.user
        ) });
      } catch (error) { next(error); }
    },
    listPerformanceGoals: async (request, response, next) => {
      try {
        const staffId = request.query.staffId
          ? parse(z.string().uuid(), request.query.staffId) : undefined;
        const goals = await repo.listHrPerformanceGoals(request.user, staffId);
        if (goals === null) return notFound(response, 'STAFF_NOT_FOUND', 'Staff profile not found.');
        response.json({ data: goals });
      } catch (error) { next(error); }
    },
    createPerformanceEvaluation: async (request, response, next) => {
      try {
        response.status(201).json({ data: await repo.createHrPerformanceEvaluation(
          parse(hrPerformanceEvaluationSchema, request.body), request.user
        ) });
      } catch (error) { next(error); }
    },
    listPerformanceEvaluations: async (request, response, next) => {
      try {
        const staffId = request.query.staffId
          ? parse(z.string().uuid(), request.query.staffId) : undefined;
        const evaluations = await repo.listHrPerformanceEvaluations(request.user, staffId);
        if (evaluations === null) return notFound(response, 'STAFF_NOT_FOUND', 'Staff profile not found.');
        response.set('Cache-Control', 'no-store').json({ data: evaluations });
      } catch (error) { next(error); }
    },
    createTrainingCourse: async (request, response, next) => {
      try {
        response.status(201).json({ data: await repo.createHrTrainingCourse(
          parse(hrTrainingCourseSchema, request.body), request.user
        ) });
      } catch (error) { next(error); }
    },
    listTrainingCourses: async (request, response, next) => {
      try { response.json({ data: await repo.listHrTrainingCourses(request.user) }); }
      catch (error) { next(error); }
    },
    enrollTraining: async (request, response, next) => {
      try {
        const { staffId } = parse(hrTrainingEnrollmentSchema, request.body);
        const enrollment = await repo.enrollHrTraining(
          parse(z.string().uuid(), request.params.courseId), staffId, request.user
        );
        if (!enrollment) return notFound(response, 'TRAINING_SCOPE_NOT_FOUND', 'Course or staff profile not found.');
        response.status(201).json({ data: enrollment });
      } catch (error) { next(error); }
    },
    listTrainingEnrollments: async (request, response, next) => {
      try {
        const rows = await repo.listHrTrainingEnrollments(
          parse(z.string().uuid(), request.params.courseId), request.user
        );
        if (rows === null) return notFound(response, 'TRAINING_COURSE_NOT_FOUND', 'Training course not found.');
        response.json({ data: rows });
      } catch (error) { next(error); }
    },
    updateTrainingAttendance: async (request, response, next) => {
      try {
        const enrollment = await repo.updateHrTrainingAttendance(
          parse(z.string().uuid(), request.params.enrollmentId),
          parse(hrTrainingAttendanceSchema, request.body).status, request.user
        );
        if (!enrollment) return notFound(response, 'ENROLLMENT_NOT_FOUND', 'Training enrollment not found.');
        response.json({ data: enrollment });
      } catch (error) { next(error); }
    },
    uploadTrainingCertificate: async (request, response, next) => {
      try {
        if (!Buffer.isBuffer(request.body) || !request.body.length) return response.status(400).json({
          error: { code: 'INVALID_DOCUMENT', message: 'A non-empty PDF, JPEG, or PNG certificate is required.' }
        });
        const result = await repo.storeHrTrainingCertificate(
          parse(z.string().uuid(), request.params.enrollmentId),
          parse(hrDocumentNameSchema, request.query.name),
          request.headers['content-type'], request.body, request.user
        );
        if (!result) return notFound(response, 'ENROLLMENT_NOT_FOUND', 'Training enrollment not found.');
        response.status(201).json({ data: result });
      } catch (error) { next(error); }
    },
    downloadTrainingCertificate: async (request, response, next) => {
      try {
        const result = await repo.getHrTrainingCertificate(
          parse(z.string().uuid(), request.params.enrollmentId), request.user
        );
        if (!result) return notFound(response, 'CERTIFICATE_NOT_FOUND', 'Training certificate not found.');
        response.set('Cache-Control', 'no-store').type(result.mimeType)
          .attachment(result.name).send(result.content);
      } catch (error) { next(error); }
    }
  };
}
