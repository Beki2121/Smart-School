export function createAssignmentsController({ assignmentAttachmentSchema, assignmentCreateSchema,
  assignmentGradeSchema, assignmentSubmissionSchema, assignmentTransitionSchema,
  assignmentUpdateSchema, parse, repo, z }) {
  const idSchema = z.string().uuid();
  const upload = (request) => {
    let originalName;
    try { originalName = decodeURIComponent(request.headers['x-file-name'] ?? ''); }
    catch {
      const error = new Error('Attachment filename is invalid.');
      error.status = 400;
      error.code = 'ASSIGNMENT_ATTACHMENT_INVALID';
      throw error;
    }
    const metadata = parse(assignmentAttachmentSchema, {
      originalName,
      mimeType: request.headers['content-type']
    });
    if (!Buffer.isBuffer(request.body) || request.body.length === 0 || request.body.length > 5 * 1024 * 1024) {
      const error = new Error('Attachment must be between 1 byte and 5 MB.');
      error.status = 413;
      error.code = 'ASSIGNMENT_ATTACHMENT_SIZE_INVALID';
      throw error;
    }
    return { ...metadata, content: request.body };
  };
  return {
    listAssignments: async (request, response, next) => {
      try {
        response.json({ data: await repo.listAssignments(request.user) });
      } catch (error) { next(error); }
    },
    getAssignmentSubmissions: async (request, response, next) => {
      try {
        const data = await repo.listAssignmentSubmissions(
          parse(idSchema, request.params.assignmentId), request.user
        );
        if (!data) return response.status(404).json({
          error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found.' }
        });
        response.json({ data });
      } catch (error) { next(error); }
    },
    postAssignment: async (request, response, next) => {
      try {
        response.status(201).json({
          data: await repo.createAssignment(parse(assignmentCreateSchema, request.body), request.user)
        });
      } catch (error) { next(error); }
    },
    patchAssignment: async (request, response, next) => {
      try {
        const item = await repo.updateAssignment(
          parse(idSchema, request.params.assignmentId),
          parse(assignmentUpdateSchema, request.body), request.user
        );
        if (!item) return response.status(404).json({
          error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found.' }
        });
        response.json({ data: item });
      } catch (error) { next(error); }
    },
    transitionAssignment: async (request, response, next) => {
      try {
        const item = await repo.transitionAssignment(
          parse(idSchema, request.params.assignmentId),
          parse(assignmentTransitionSchema, request.body).status, request.user
        );
        if (!item) return response.status(404).json({
          error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found.' }
        });
        response.json({ data: item });
      } catch (error) { next(error); }
    },
    uploadAssignmentAttachment: async (request, response, next) => {
      try {
        const item = await repo.storeAssignmentAttachment(
          parse(idSchema, request.params.assignmentId), upload(request), request.user
        );
        if (!item) return response.status(404).json({
          error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found.' }
        });
        response.status(201).json({ data: item });
      } catch (error) { next(error); }
    },
    portalAssignments: async (request, response, next) => {
      try { response.json({ data: await repo.listPortalAssignments(request.user) }); }
      catch (error) { next(error); }
    },
    submitAssignment: async (request, response, next) => {
      try {
        const item = await repo.submitAssignment(
          parse(idSchema, request.params.assignmentId),
          parse(assignmentSubmissionSchema, request.body), request.user
        );
        if (!item) return response.status(404).json({
          error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found.' }
        });
        response.status(201).json({ data: item });
      } catch (error) { next(error); }
    },
    uploadSubmissionAttachment: async (request, response, next) => {
      try {
        const item = await repo.storeSubmissionAttachment(
          parse(idSchema, request.params.assignmentId), upload(request), request.user
        );
        if (!item) return response.status(404).json({
          error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found.' }
        });
        response.status(201).json({ data: item });
      } catch (error) { next(error); }
    },
    gradeSubmission: async (request, response, next) => {
      try {
        const item = await repo.gradeAssignmentSubmission(
          parse(idSchema, request.params.assignmentId),
          parse(idSchema, request.params.submissionId),
          parse(assignmentGradeSchema, request.body), request.user
        );
        if (!item) return response.status(404).json({
          error: { code: 'ASSIGNMENT_SUBMISSION_NOT_FOUND', message: 'Submission not found.' }
        });
        response.json({ data: item });
      } catch (error) { next(error); }
    },
    downloadAssignmentAttachment: async (request, response, next) => {
      try {
        const result = await repo.getAssignmentAttachment(
          parse(idSchema, request.params.attachmentId), request.user
        );
        if (!result) return response.status(404).json({
          error: { code: 'ASSIGNMENT_ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' }
        });
        response.type(result.mimeType).attachment(result.originalName).send(result.content);
      } catch (error) { next(error); }
    },
    downloadPortalAssignmentAttachment: async (request, response, next) => {
      try {
        const result = await repo.getPortalAssignmentAttachment(
          parse(idSchema, request.params.attachmentId), request.user
        );
        if (!result) return response.status(404).json({
          error: { code: 'ASSIGNMENT_ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' }
        });
        response.type(result.mimeType).attachment(result.originalName).send(result.content);
      } catch (error) { next(error); }
    }
  };
}
