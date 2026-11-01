export function createAdmissionsController(context) {
  const { admissionEnrolmentSchema, admissionSchema, admissionStatusSchema, interviewSchema, offerLetterHtml, parse, repo, studentIdPatternSchema, z } = context;
  return {
    getAdmissionsDashboard: async (request, response, next) => {
    try {
      response.json({ data: await repo.getAdmissionsDashboard(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    getAdmissionsPublicLink: async (request, response, next) => {
    try {
      const token = await repo.getAdmissionsPublicToken(request.user.activeCampusId);
      if (!token) return response.status(404).json({ error: { code: 'ADMISSIONS_LINK_UNAVAILABLE', message: 'A public admissions link is not configured for this campus.' } });
      response.json({ data: { token } });
    } catch (error) { next(error); }
  },
    getAdmissionsDuplicates: async (request, response, next) => {
    try {
      const search = parse(z.object({
        name: z.string().trim().min(2).max(180).optional(),
        dateOfBirth: z.string().date().optional(),
        guardianPhone: z.string().trim().min(7).max(32).optional()
      }).refine((value) => Boolean(value.name || value.guardianPhone), {
        message: 'Provide a name or guardian phone to search for duplicates.'
      }), request.query);
      response.json({ data: await repo.findAdmissionDuplicates(request.user.activeCampusId, search) });
    } catch (error) { next(error); }
  },
    getAdmissions: async (request, response, next) => {
    try {
      const status = request.query.status
        ? parse(z.enum(['enquiry', 'application', 'interview', 'accepted', 'waitlisted', 'rejected', 'enrolled', 'withdrawn', 'transferred_out']), request.query.status)
        : null;
      const query = request.query.q ? parse(z.string().trim().max(180), request.query.q) : '';
      response.json({ data: await repo.listAdmissions(request.user.activeCampusId, { status, query }) });
    } catch (error) { next(error); }
  },
    postAdmissions: async (request, response, next) => {
    try {
      const admission = await repo.createAdmission(parse(admissionSchema, request.body), request.user);
      response.status(201).json({ data: admission });
    } catch (error) { next(error); }
  },
    putAdmissionsStudentIdPattern: async (request, response, next) => {
    try {
      response.json({ data: await repo.setStudentIdPattern(parse(studentIdPatternSchema, request.body).pattern, request.user) });
    } catch (error) { next(error); }
  },
    postAdmissionsByadmissionIdInterview: async (request, response, next) => {
    try {
      const result = await repo.scheduleAdmissionInterview(
        parse(z.string().uuid(), request.params.admissionId), parse(interviewSchema, request.body), request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'ADMISSION_NOT_FOUND', message: 'Admission record not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  },
    patchAdmissionsByadmissionIdStatus: async (request, response, next) => {
    try {
      const result = await repo.updateAdmissionStatus(
        parse(z.string().uuid(), request.params.admissionId), parse(admissionStatusSchema, request.body), request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'ADMISSION_NOT_FOUND', message: 'Admission record not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  },
    postAdmissionsByadmissionIdEnrol: async (request, response, next) => {
    try {
      const result = await repo.enrolAdmission(
        parse(z.string().uuid(), request.params.admissionId), parse(admissionEnrolmentSchema, request.body), request.user
      );
      response.set('Cache-Control', 'no-store').status(201).json({ data: result });
    } catch (error) { next(error); }
  },
    getAdmissionsByadmissionIdDocuments: async (request, response, next) => {
    try {
      const admissionId = parse(z.string().uuid(), request.params.admissionId);
      const documents = await repo.listAdmissionDocuments(request.user.activeCampusId, admissionId);
      response.json({ data: documents });
    } catch (error) { next(error); }
  },
    postAdmissionsByadmissionIdDocuments: async (request, response, next) => {
      try {
        if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
          return response.status(400).json({ error: { code: 'INVALID_DOCUMENT', message: 'Upload a non-empty PDF, JPEG, or PNG document.' } });
        }
        const document = await repo.storeAdmissionDocument(
          parse(z.string().uuid(), request.params.admissionId),
          parse(z.enum(['birth_certificate', 'previous_school_report', 'guardian_id', 'other']), request.query.type),
          parse(z.string().trim().min(1).max(180), request.query.name),
          request.headers['content-type'],
          request.body,
          request.user
        );
        response.status(201).json({ data: document });
      } catch (error) { next(error); }
    },
    getAdmissionsByadmissionIdDocumentsBydocumentId: async (request, response, next) => {
    try {
      const result = await repo.getAdmissionDocument(
        request.user.activeCampusId, parse(z.string().uuid(), request.params.admissionId),
        parse(z.string().uuid(), request.params.documentId)
      );
      if (!result) return response.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found.' } });
      response.type(result.document.mimeType).attachment(result.document.originalName).send(result.content);
    } catch (error) { next(error); }
  },
    getAdmissionsByadmissionIdOfferLetter: async (request, response, next) => {
    try {
      const admission = await repo.getAdmission(request.user.activeCampusId, parse(z.string().uuid(), request.params.admissionId));
      if (!admission) return response.status(404).json({ error: { code: 'ADMISSION_NOT_FOUND', message: 'Admission record not found.' } });
      if (admission.status !== 'accepted') return response.status(409).json({ error: { code: 'OFFER_NOT_READY', message: 'An offer letter is available only for accepted applicants.' } });
      response.type('html').send(offerLetterHtml(admission));
    } catch (error) { next(error); }
  }
  };
}
