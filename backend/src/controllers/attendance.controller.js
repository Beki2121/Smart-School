export function createAttendanceController(context) {
  const { attendanceCorrectionReviewSchema, attendanceCorrectionSchema, attendanceSchema, feeReportRangeSchema, parse, repo, z } = context;
  return {
    getAttendance: async (request, response, next) => {
    try {
      response.json({ data: await repo.listAttendance(request.user.activeCampusId, request.user) });
    } catch (error) { next(error); }
  },
    getAttendanceSummary: async (request, response, next) => {
    try {
      const range = parse(feeReportRangeSchema, {
        from: request.query.from,
        to: request.query.to
      });
      response.json({ data: await repo.getAttendanceSummary(
        request.user.activeCampusId, range.from, range.to, request.user
      ) });
    } catch (error) { next(error); }
  },
    postAttendance: async (request, response, next) => {
    try {
      const item = await repo.saveAttendance(parse(attendanceSchema, request.body), request.user);
      response.status(item.duplicate ? 200 : 201).json({ data: item });
    } catch (error) { next(error); }
  },
    getAttendanceSessionsBySessionId: async (request, response, next) => {
    try {
      const sessionId = parse(z.string().uuid(), request.params.sessionId);
      const session = await repo.getAttendanceSession(sessionId, request.user);
      if (!session) return response.status(404).json({ error: { code: 'ATTENDANCE_SESSION_NOT_FOUND', message: 'Attendance session not found.' } });
      response.json({ data: session });
    } catch (error) { next(error); }
  },
    patchAttendanceSessionsBySessionIdRecordsByStudentId: async (request, response, next) => {
    try {
      const sessionId = parse(z.string().uuid(), request.params.sessionId);
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const correction = parse(attendanceCorrectionSchema, request.body);
      const result = await repo.correctAttendance(sessionId, studentId, correction, request.user);
      if (!result) return response.status(404).json({ error: { code: 'ATTENDANCE_RECORD_NOT_FOUND', message: 'Attendance record not found.' } });
      if (result.approvalRequired) return response.status(202).json({ data: result });
      response.json({ data: result });
    } catch (error) { next(error); }
  },
    getAttendanceCorrectionRequests: async (request, response, next) => {
    try {
      response.json({ data: await repo.listAttendanceCorrectionRequests(request.user) });
    } catch (error) { next(error); }
  },
    patchAttendanceCorrectionRequestsByRequestId: async (request, response, next) => {
    try {
      const result = await repo.reviewAttendanceCorrection(
        parse(z.string().uuid(), request.params.requestId),
        parse(attendanceCorrectionReviewSchema, request.body),
        request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'ATTENDANCE_CORRECTION_REQUEST_NOT_FOUND', message: 'Pending correction request not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  },
    getAttendanceSectionsBySectionIdRoster: async (request, response, next) => {
    try {
      const sectionId = parse(z.string().uuid(), request.params.sectionId);
      const students = await repo.listRoster(request.user, sectionId);
      response.json({ data: students });
    } catch (error) { next(error); }
  }
  };
}
