export function createStaffController(context) {
  const { assignmentSchema, departmentSchema, leaveReviewSchema, leaveSchema, parse, repo, staffDateSchema, staffMessageSchema, staffSchema, toCsv, z } = context;
  return {
    getDepartments: async (request, response, next) => {
    try {
      response.json({ data: await repo.listDepartments(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    postDepartments: async (request, response, next) => {
    try {
      const department = await repo.createDepartment(parse(departmentSchema, request.body), request.user);
      response.status(201).json({ data: department });
    } catch (error) { next(error); }
  },
    getStaff: async (request, response, next) => {
    try {
      response.json({ data: await repo.listStaff(request.user) });
    } catch (error) { next(error); }
  },
    postStaff: async (request, response, next) => {
    try {
      const staff = await repo.createStaff(parse(staffSchema, request.body), request.user);
      response.status(201).json({ data: staff });
    } catch (error) { next(error); }
  },
    getTeachingAssignments: async (request, response, next) => {
    try {
      response.json({ data: await repo.listTeachingAssignments(request.user) });
    } catch (error) { next(error); }
  },
    postTeachingAssignments: async (request, response, next) => {
    try {
      const assignment = await repo.createTeachingAssignment(parse(assignmentSchema, request.body), request.user);
      response.status(201).json({ data: assignment });
    } catch (error) { next(error); }
  },
    getStaffAttendance: async (request, response, next) => {
    try {
      response.json({ data: await repo.listStaffAttendance(request.user) });
    } catch (error) { next(error); }
  },
    postStaffAttendance: async (request, response, next) => {
    try {
      const record = await repo.recordStaffAttendance(parse(staffDateSchema, request.body), request.user);
      response.status(record.duplicate ? 200 : 201).json({ data: record });
    } catch (error) { next(error); }
  },
    getStaffAttendanceCsv: async (request, response, next) => {
    try {
      const rows = await repo.listStaffAttendance(request.user);
      response.set('Content-Type', 'text/csv; charset=utf-8');
      response.attachment('staff-attendance.csv');
      response.send(toCsv([
        ['Staff ID', 'Name', 'Department', 'Date', 'Status', 'Clock in', 'Clock out'],
        ...rows.map((row) => [
          row.staffId, row.name, row.department ?? '', row.date, row.status,
          row.clockIn ?? '', row.clockOut ?? ''
        ])
      ]));
    } catch (error) { next(error); }
  },
    getLeaveRequests: async (request, response, next) => {
    try {
      response.json({ data: await repo.listLeaveRequests(request.user) });
    } catch (error) { next(error); }
  },
    postLeaveRequests: async (request, response, next) => {
    try {
      const leave = await repo.createLeaveRequest(parse(leaveSchema, request.body), request.user);
      response.status(201).json({ data: leave });
    } catch (error) { next(error); }
  },
    patchLeaveRequestsByLeaveId: async (request, response, next) => {
    try {
      const leaveId = parse(z.string().uuid(), request.params.leaveId);
      const input = parse(leaveReviewSchema, request.body);
      const leave = await repo.reviewLeaveRequest(leaveId, input, request.user);
      if (!leave) return response.status(404).json({ error: { code: 'LEAVE_NOT_FOUND', message: 'Leave request not found.' } });
      response.json({ data: leave });
    } catch (error) { next(error); }
  },
    getStaffMessages: async (request, response, next) => {
    try {
      response.json({ data: await repo.listStaffMessages(request.user) });
    } catch (error) { next(error); }
  },
    postStaffMessages: async (request, response, next) => {
    try {
      const message = await repo.createStaffMessage(parse(staffMessageSchema, request.body), request.user);
      response.status(201).json({ data: message });
    } catch (error) { next(error); }
  }
  };
}
