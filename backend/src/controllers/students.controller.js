export function createStudentsController(context) {
  const { config, createHash, disciplineRecordSchema, guardianAccessSchema, parse, previewStudentCsv, randomBytes, repo, studentCommendationSchema, studentDocumentTypeSchema, studentEmergencyContactSchema, studentGuardianSchema, studentProfileSchema, studentProgressionSchema, studentSchema, studentSensitiveDataSchema, studentStatusSchema, studentTransferPackageSchema, transferCertificateHtml, z } = context;
  return {
    postStudentsByStudentIdWithdraw: async (request, response, next) => {
    try {
      const result = await repo.changeStudentStatus(
        parse(z.string().uuid(), request.params.studentId), 'withdrawn',
        parse(studentStatusSchema, request.body).reason, request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  },
    postStudentsByStudentIdReadmit: async (request, response, next) => {
    try {
      const result = await repo.readmitStudent(
        parse(z.string().uuid(), request.params.studentId),
        parse(z.object({ sectionId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }), request.body),
        request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  },
    postStudentsByStudentIdTransferOut: async (request, response, next) => {
    try {
      const result = await repo.transferStudentOut(
        parse(z.string().uuid(), request.params.studentId), parse(studentStatusSchema, request.body).reason, request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  },
    getStudentsByStudentIdEnrolments: async (request, response, next) => {
    try {
      const result = await repo.listStudentEnrollmentHistory(
        parse(z.string().uuid(), request.params.studentId), request.user
      );
      if (result === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  },
    postStudentsByStudentIdSectionTransfer: async (request, response, next) => {
    try {
      const result = await repo.transferStudentSection(
        parse(z.string().uuid(), request.params.studentId),
        parse(z.object({
          sectionId: z.string().uuid(), reason: z.string().trim().min(3).max(500)
        }), request.body),
        request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  },
    getStudentsByStudentIdSectionTransfers: async (request, response, next) => {
    try {
      const result = await repo.listStudentSectionTransfers(
        parse(z.string().uuid(), request.params.studentId), request.user
      );
      if (result === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  },
    postStudentsByStudentIdProgression: async (request, response, next) => {
    try {
      const result = await repo.advanceStudent(
        parse(z.string().uuid(), request.params.studentId),
        parse(studentProgressionSchema, request.body),
        request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  },
    getStudentsByStudentIdProgressionEligibility: async (request, response, next) => {
    try {
      const result = await repo.evaluateStudentProgression(
        parse(z.string().uuid(), request.params.studentId), request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  },
    getStudentsByStudentIdTransferCertificate: async (request, response, next) => {
    try {
      const result = await repo.getStudentTransferRecord(
        request.user.activeCampusId, parse(z.string().uuid(), request.params.studentId)
      );
      if (!result) return response.status(404).json({ error: { code: 'TRANSFER_NOT_FOUND', message: 'No transfer-out record was found.' } });
      response.type('html').send(transferCertificateHtml(result));
    } catch (error) { next(error); }
  },
    getStudents: async (request, response, next) => {
    try {
      response.json({ data: await repo.listStudentsFor(request.user) });
    } catch (error) { next(error); }
  },
    getAlumni: async (request, response, next) => {
    try {
      response.json({ data: (await repo.listStudentsFor(request.user))
        .filter((student) => student.status === 'graduated') });
    } catch (error) { next(error); }
  },
    postStudentsImportPreview: async (request, response, next) => {
      try {
        const preview = await previewStudentCsv(repo, request.body, request.user);
        response.set('Cache-Control', 'no-store').json({ data: {
          totalRows: preview.totalRows, eligibleCount: preview.eligibleCount,
          invalidCount: preview.invalidCount, warningCount: preview.warningCount,
          rows: preview.rows
        } });
      } catch (error) { next(error); }
    },
    postStudentsImportCommit: async (request, response, next) => {
      try {
        const preview = await previewStudentCsv(repo, request.body, request.user);
        const imported = await repo.importStudents(preview.dataRows, request.user);
        const reportsByRow = new Map([...preview.rowReports, ...imported.reports].map((report) =>
          [report.rowNumber, report]));
        const rows = [...reportsByRow.values()].sort((left, right) => left.rowNumber - right.rowNumber);
        response.set('Cache-Control', 'no-store').json({ data: {
          totalRows: preview.totalRows, createdCount: imported.createdCount,
          skippedCount: preview.totalRows - imported.createdCount, rows,
          credentials: imported.credentials
        } });
      } catch (error) { next(error); }
    },
    postStudents: async (request, response, next) => {
    try {
      const result = await repo.createStudent(parse(studentSchema, request.body), request.user);
      response.set('Cache-Control', 'no-store').status(201).json({ data: result });
    } catch (error) { next(error); }
  },
    getStudentsByStudentId: async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const student = (await repo.listStudentsFor(request.user)).find((item) => item.id === studentId);
      if (!student) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: student });
    } catch (error) { next(error); }
  },
    getStudentsByStudentIdSensitiveData: async (request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const data = await repo.getStudentSensitiveData(studentId, request.user);
      if (!data) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data });
    } catch (error) { next(error); }
  },
    putStudentsByStudentIdSensitiveData: async (request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const data = await repo.updateStudentSensitiveData(
        studentId, parse(studentSensitiveDataSchema, request.body), request.user
      );
      if (!data) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data });
    } catch (error) { next(error); }
  },
    patchStudentsByStudentIdProfile: async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const student = await repo.updateStudentProfile(studentId, parse(studentProfileSchema, request.body), request.user);
      if (!student) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: student });
    } catch (error) { next(error); }
  },
    getStudentsByStudentIdDocuments: async (request, response, next) => {
    try {
      const documents = await repo.listStudentDocuments(
        parse(z.string().uuid(), request.params.studentId), request.user
      );
      if (documents === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.set('Cache-Control', 'no-store').json({ data: documents });
    } catch (error) { next(error); }
  },
    getStudentsByStudentIdTransferPackages: async (request, response, next) => {
    try {
      const packages = await repo.listStudentTransferPackages(
        parse(z.string().uuid(), request.params.studentId), request.user
      );
      if (packages === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.set('Cache-Control', 'no-store').json({ data: packages });
    } catch (error) { next(error); }
  },
    postStudentsByStudentIdTransferPackages: async (request, response, next) => {
    try {
      const result = await repo.createStudentTransferPackage(
        parse(z.string().uuid(), request.params.studentId),
        parse(studentTransferPackageSchema, request.body), request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.set('Cache-Control', 'no-store').status(201).json({ data: result });
    } catch (error) { next(error); }
  },
    postStudentsByStudentIdTransferPackagesByPackageIdApprove: async (request, response, next) => {
      try {
        const token = randomBytes(32).toString('base64url');
        const approved = await repo.approveStudentTransferPackage(
          parse(z.string().uuid(), request.params.packageId),
          createHash('sha256').update(token).digest('hex'), request.user
        );
        if (!approved) return response.status(404).json({ error: { code: 'TRANSFER_PACKAGE_NOT_FOUND', message: 'Transfer package not found.' } });
        const webOrigin = config.WEB_ORIGIN.replace(/\/+$/, '');
        response.set('Cache-Control', 'no-store').json({
          data: { ...approved, shareUrl: `${webOrigin}/transfer/${token}` }
        });
      } catch (error) { next(error); }
    },
    postStudentsByStudentIdDocuments: async (request, response, next) => {
      try {
        if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
          return response.status(400).json({ error: { code: 'INVALID_DOCUMENT', message: 'Upload a non-empty PDF, JPEG, or PNG file no larger than 5 MB.' } });
        }
        const document = await repo.storeStudentDocument(
          parse(z.string().uuid(), request.params.studentId),
          parse(studentDocumentTypeSchema, request.query.type),
          parse(z.string().trim().min(1).max(180), request.query.name),
          request.headers['content-type'], request.body, request.user
        );
        response.set('Cache-Control', 'no-store').status(201).json({ data: document });
      } catch (error) { next(error); }
    },
    getStudentsByStudentIdDocumentsByDocumentId: async (request, response, next) => {
    try {
      const result = await repo.getStudentDocument(
        parse(z.string().uuid(), request.params.studentId),
        parse(z.string().uuid(), request.params.documentId), request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found.' } });
      response.set('Cache-Control', 'no-store').type(result.document.mimeType)
        .attachment(result.document.originalName).send(result.content);
    } catch (error) { next(error); }
  },
    getStudentsByStudentIdEmergencyContacts: async (request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const contacts = await repo.listStudentEmergencyContacts(studentId, request.user);
      if (contacts === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: contacts });
    } catch (error) { next(error); }
  },
    postStudentsByStudentIdEmergencyContacts: async (request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const contact = await repo.addStudentEmergencyContact(
        studentId, parse(studentEmergencyContactSchema, request.body), request.user
      );
      if (!contact) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.status(201).json({ data: contact });
    } catch (error) { next(error); }
  },
    deleteStudentsByStudentIdEmergencyContactsByContactId: async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const contactId = parse(z.string().uuid(), request.params.contactId);
      const removed = await repo.removeStudentEmergencyContact(studentId, contactId, request.user);
      if (!removed) return response.status(404).json({ error: { code: 'EMERGENCY_CONTACT_NOT_FOUND', message: 'Emergency contact not found.' } });
      response.status(204).end();
    } catch (error) { next(error); }
  },
    getStudentsByStudentIdGuardians: async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const guardians = await repo.listStudentGuardians(studentId, request.user);
      if (guardians === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: guardians });
    } catch (error) { next(error); }
  },
    postStudentsByStudentIdGuardians: async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const guardian = await repo.addStudentGuardian(studentId, parse(studentGuardianSchema, request.body), request.user);
      response.status(201).json({ data: guardian });
    } catch (error) { next(error); }
  },
    patchStudentsByStudentIdGuardiansByGuardianIdAccess: async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const guardianId = parse(z.string().uuid(), request.params.guardianId);
      const access = parse(guardianAccessSchema, request.body);
      const updated = await repo.verifyStudentGuardian(studentId, guardianId, access, request.user);
      if (!updated) return response.status(404).json({ error: { code: 'GUARDIAN_LINK_NOT_FOUND', message: 'Guardian link not found.' } });
      response.json({ data: updated });
    } catch (error) { next(error); }
  },
    deleteStudentsByStudentIdGuardiansByGuardianId: async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const guardianId = parse(z.string().uuid(), request.params.guardianId);
      const removed = await repo.removeStudentGuardian(studentId, guardianId, request.user);
      if (!removed) return response.status(404).json({ error: { code: 'GUARDIAN_LINK_NOT_FOUND', message: 'Guardian link not found.' } });
      response.status(204).end();
    } catch (error) { next(error); }
  },
    getStudentsByStudentIdDiscipline: async (request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      const records = await repo.listStudentDisciplineRecords(
        parse(z.string().uuid(), request.params.studentId), request.user
      );
      if (records === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: records });
    } catch (error) { next(error); }
  },
    postStudentsByStudentIdDiscipline: async (request, response, next) => {
    try {
      const record = await repo.createStudentDisciplineRecord(
        parse(z.string().uuid(), request.params.studentId),
        parse(disciplineRecordSchema, request.body), request.user
      );
      if (!record) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.set('Cache-Control', 'no-store').status(201).json({ data: record });
    } catch (error) { next(error); }
  },
    getStudentsByStudentIdCommendations: async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const commendations = await repo.listStudentCommendations(studentId, request.user);
      if (commendations === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: commendations });
    } catch (error) { next(error); }
  },
    postStudentsByStudentIdCommendations: async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const commendation = await repo.createStudentCommendation(
        studentId, parse(studentCommendationSchema, request.body), request.user
      );
      if (!commendation) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.status(201).json({ data: commendation });
    } catch (error) { next(error); }
  }
  };
}
