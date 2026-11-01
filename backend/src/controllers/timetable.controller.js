export function createTimetableController(context) {
  const { parse, repo, roomSchema, substituteSchema, timetablePeriodSchema, timetableQuerySchema, z } = context;
  return {
    getTimetablePeriods: async (request, response, next) => {
    try {
      response.json({ data: await repo.listTimetablePeriods(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    postTimetablePeriods: async (request, response, next) => {
    try {
      const period = await repo.createTimetablePeriod(parse(timetablePeriodSchema, request.body), request.user);
      response.status(201).json({ data: period });
    } catch (error) { next(error); }
  },
    getTimetableRooms: async (request, response, next) => {
    try {
      response.json({ data: await repo.listRooms(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    postTimetableRooms: async (request, response, next) => {
    try {
      const room = await repo.createRoom(parse(roomSchema, request.body), request.user);
      response.status(201).json({ data: room });
    } catch (error) { next(error); }
  },
    getTimetable: async (request, response, next) => {
    try {
      const query = parse(timetableQuerySchema, request.query);
      response.json({ data: await repo.listTimetable(request.user, query) });
    } catch (error) { next(error); }
  },
    postTimetableAssignmentsByassignmentIdSubstitutions: async (request, response, next) => {
    try {
      const assignmentId = parse(z.string().uuid(), request.params.assignmentId);
      const substitution = await repo.createTimetableSubstitution(
        assignmentId, parse(substituteSchema, request.body), request.user
      );
      if (!substitution) return response.status(404).json({ error: { code: 'TIMETABLE_ASSIGNMENT_NOT_FOUND', message: 'Timetable assignment not found.' } });
      response.status(201).json({ data: substitution });
    } catch (error) { next(error); }
  },
    putSectionsBysectionIdHomeroom: async (request, response, next) => {
    try {
      const input = parse(z.object({ staffId: z.string().uuid() }), request.body);
      const sectionId = parse(z.string().uuid(), request.params.sectionId);
      const assignment = await repo.assignHomeroom(sectionId, input.staffId, request.user);
      if (!assignment) return response.status(404).json({ error: { code: 'SECTION_NOT_FOUND', message: 'Section not found.' } });
      response.json({ data: assignment });
    } catch (error) { next(error); }
  },
  };
}
