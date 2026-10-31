export function createSchoolController(context) {
  const { closureRequestSchema, logger, organizationSettingsSchema, parse, repo, schoolProfileSchema } = context;
  return {
    getDashboard: async (request, response, next) => {
    try {
      response.json({ data: await repo.getDashboard(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    getPortalHome: async (request, response, next) => {
    try {
      response.json({ data: await repo.getPortalHome(request.user) });
    } catch (error) { next(error); }
  },
    getSchool: async (request, response, next) => {
    try {
      const campus = await repo.getCampus(request.user.activeCampusId);
      if (!campus) return response.status(404).json({ error: { code: 'CAMPUS_NOT_FOUND', message: 'Campus not found.' } });
      response.json({ data: campus });
    } catch (error) { next(error); }
  },
    getSchoolSettings: async (request, response, next) => {
    try {
      const settings = await repo.getOrganizationSettings(request.user.orgId);
      if (!settings) return response.status(404).json({
        error: { code: 'SCHOOL_NOT_FOUND', message: 'School tenant not found.' }
      });
      response.json({ data: settings });
    } catch (error) { next(error); }
  },
    putSchoolSettings: async (request, response, next) => {
    try {
      const settings = await repo.updateOrganizationSettings(
        parse(organizationSettingsSchema, request.body), request.user
      );
      if (!settings) return response.status(404).json({
        error: { code: 'SCHOOL_NOT_FOUND', message: 'School tenant not found.' }
      });
      response.json({ data: settings });
    } catch (error) { next(error); }
  },
    getSchoolSubscription: async (request, response, next) => {
    try { response.json({ data: await repo.getOrganizationSubscription(request.user.orgId) }); }
    catch (error) { next(error); }
  },
    postSchoolClosure: async (request, response, next) => {
    try {
      const closure = await repo.requestOrganizationClosure(parse(closureRequestSchema, request.body), request.user);
      response.status(202).json({ data: closure });
    } catch (error) { next(error); }
  },
    getSchoolExport: async (request, response, next) => {
    try {
      const data = await repo.getOrganizationExport(request.user.orgId);
      if (!data) return response.status(404).json({
        error: { code: 'SCHOOL_NOT_FOUND', message: 'School tenant not found.' }
      });
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Disposition', 'attachment; filename="school-data-export.json"');
      response.once('finish', () => {
        repo.markOrganizationExported(request.user.orgId, request.user).catch((markError) => {
          logger.error({ err: markError, organizationId: request.user.orgId }, 'School export completed but closure export status could not be recorded');
        });
      });
      response.type('application/json').send(JSON.stringify(data));
    } catch (error) { next(error); }
  },
    putSchool: async (request, response, next) => {
    try {
      const campus = await repo.updateCampus(parse(schoolProfileSchema, request.body), request.user);
      if (!campus) return response.status(404).json({ error: { code: 'CAMPUS_NOT_FOUND', message: 'Campus not found.' } });
      response.json({ data: campus });
    } catch (error) { next(error); }
  }
  };
}
