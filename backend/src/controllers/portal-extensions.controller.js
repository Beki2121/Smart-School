export function createPortalExtensionsController(context) {
  const { parse, repo, z, addDays, addisDate } = context;
  return {
    getCalendar: async (request, response, next) => {
      try {
        const range = parse(context.portalCalendarQuerySchema, {
          from: request.query.from ?? addisDate(),
          to: request.query.to ?? addDays(addisDate(), 30)
        });
        response.json({ data: await repo.getPortalCalendar(request.user, range) });
      } catch (error) { next(error); }
    },
    getRequests: async (request, response, next) => {
      try { response.json({ data: await repo.listPortalRequests(request.user) }); }
      catch (error) { next(error); }
    },
    postRequests: async (request, response, next) => {
      try {
        const result = await repo.createPortalRequest(
          parse(context.portalRequestSchema, request.body), request.user
        );
        response.status(201).json({ data: result });
      } catch (error) { next(error); }
    },
    patchRequestStatus: async (request, response, next) => {
      try {
        const id = parse(z.string().uuid(), request.params.requestId);
        const result = await repo.updatePortalRequest(
          id, parse(context.portalRequestDecisionSchema, request.body), request.user
        );
        if (!result) return response.status(404).json({
          error: { code: 'PORTAL_REQUEST_NOT_FOUND', message: 'Request not found.' }
        });
        response.json({ data: result });
      } catch (error) { next(error); }
    },
    getSupportRequests: async (request, response, next) => {
      try { response.json({ data: await repo.listPortalSupportRequests(request.user) }); }
      catch (error) { next(error); }
    },
    postSupportRequest: async (request, response, next) => {
      try {
        const result = await repo.createPortalSupportRequest(
          parse(context.portalSupportRequestSchema, request.body), request.user
        );
        response.status(201).json({ data: result });
      } catch (error) { next(error); }
    },
    patchSupportRequest: async (request, response, next) => {
      try {
        const id = parse(z.string().uuid(), request.params.requestId);
        const result = await repo.updatePortalSupportRequest(
          id, parse(context.portalSupportDecisionSchema, request.body), request.user
        );
        if (!result) return response.status(404).json({
          error: { code: 'PORTAL_SUPPORT_NOT_FOUND', message: 'Support request not found.' }
        });
        response.json({ data: result });
      } catch (error) { next(error); }
    },
    getMessageThreads: async (request, response, next) => {
      try {
        const enabled = await repo.isPortalMessagingEnabled(request.user.orgId);
        if (!enabled) return response.status(403).json({
          error: { code: 'PORTAL_MESSAGING_DISABLED', message: 'Parent-teacher messaging is disabled by the school.' }
        });
        response.json({ data: await repo.listPortalMessageThreads(request.user) });
      } catch (error) { next(error); }
    },
    postMessageThread: async (request, response, next) => {
      try {
        const result = await repo.createPortalMessageThread(
          parse(context.portalMessageSchema, request.body), request.user
        );
        response.status(201).json({ data: result });
      } catch (error) { next(error); }
    },
    postThreadMessage: async (request, response, next) => {
      try {
        const id = parse(z.string().uuid(), request.params.threadId);
        const body = parse(context.portalThreadMessageSchema, request.body).body;
        response.status(201).json({ data: await repo.sendPortalMessage(id, body, request.user) });
      } catch (error) { next(error); }
    },
    patchThreadRead: async (request, response, next) => {
      try {
        const id = parse(z.string().uuid(), request.params.threadId);
        const result = await repo.markPortalThreadRead(id, request.user);
        if (!result) return response.status(404).json({
          error: { code: 'PORTAL_THREAD_NOT_FOUND', message: 'Message thread not found.' }
        });
        response.json({ data: result });
      } catch (error) { next(error); }
    },
    patchMessageModeration: async (request, response, next) => {
      try {
        const id = parse(z.string().uuid(), request.params.messageId);
        const result = await repo.moderatePortalMessage(
          id, parse(context.portalModerationSchema, request.body), request.user
        );
        if (!result) return response.status(404).json({
          error: { code: 'PORTAL_MESSAGE_NOT_FOUND', message: 'Message not found.' }
        });
        response.json({ data: result });
      } catch (error) { next(error); }
    },
    getMessagingSettings: async (request, response, next) => {
      try {
        response.json({ data: { messagingEnabled: await repo.isPortalMessagingEnabled(request.user.orgId) } });
      } catch (error) { next(error); }
    },
    putMessagingSettings: async (request, response, next) => {
      try {
        const data = parse(context.portalMessagingSettingSchema, request.body);
        const result = await repo.setPortalMessagingEnabled(data.messagingEnabled, request.user);
        if (!result) return response.status(404).json({
          error: { code: 'SCHOOL_NOT_FOUND', message: 'School tenant not found.' }
        });
        response.json({ data: result });
      } catch (error) { next(error); }
    },
    patchEventStatus: async (request, response, next) => {
      try {
        const id = parse(z.string().uuid(), request.params.eventId);
        const { status } = parse(context.campusEventStatusSchema, request.body);
        const result = await repo.updateCampusEventStatus(id, status, request.user);
        if (!result) return response.status(404).json({
          error: { code: 'CAMPUS_EVENT_NOT_FOUND', message: 'Event not found.' }
        });
        response.json({ data: result });
      } catch (error) { next(error); }
    }
  };
}
