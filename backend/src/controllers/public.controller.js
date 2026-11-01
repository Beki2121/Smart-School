export function createPublicController(context) {
  const { createHash, parse, publicAdmissionSchema, repo, z } = context;
  return {
    getHealth: (request, response) => {
    response.json({ data: { status: 'ok', service: 'sims-api', storage: repo.mode, timestamp: new Date().toISOString() } });
  },
    getPublicAdmissionsBytoken: async (request, response, next) => {
    try {
      const token = parse(z.string().regex(/^[a-f0-9]{64}$/), request.params.token);
      const info = await repo.getPublicAdmissionInfo(token);
      if (!info) return response.status(404).json({ error: { code: 'ADMISSIONS_LINK_NOT_FOUND', message: 'This school application link is unavailable.' } });
      response.set('Cache-Control', 'no-store').json({ data: info });
    } catch (error) { next(error); }
  },
    postPublicAdmissionsBytoken: async (request, response, next) => {
    try {
      const token = parse(z.string().regex(/^[a-f0-9]{64}$/), request.params.token);
      const { privacyConsent: _privacyConsent, ...application } =
        parse(publicAdmissionSchema, request.body);
      const result = await repo.createPublicAdmission(token, application);
      if (!result) return response.status(404).json({ error: { code: 'ADMISSIONS_LINK_NOT_FOUND', message: 'This school application link is unavailable.' } });
      response.set('Cache-Control', 'no-store').status(201).json({
        data: { reference: result.id, message: 'Your application was submitted to the school.' }
      });
    } catch (error) { next(error); }
  },
    getPublicStudentTransfersBytoken: async (request, response, next) => {
    try {
      const token = parse(z.string().regex(/^[A-Za-z0-9_-]{43}$/), request.params.token);
      const packet = await repo.getStudentTransferPackageByTokenHash(
        createHash('sha256').update(token).digest('hex')
      );
      if (!packet) return response.status(404).json({ error: { code: 'TRANSFER_PACKAGE_NOT_FOUND', message: 'This transfer link is invalid or expired.' } });
      response.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer')
        .json({ data: packet });
    } catch (error) { next(error); }
  }
  };
}
