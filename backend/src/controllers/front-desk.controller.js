export function createFrontDeskController(context) {
  const { parse, repo, frontDeskIdSchema, frontDeskListQuerySchema,
    frontDeskVisitorSchema, frontDeskAppointmentSchema, frontDeskAppointmentStatusSchema,
    frontDeskMessageSchema, frontDeskMessageStatusSchema, frontDeskAuthorizationSchema,
    frontDeskAuthorizationStatusSchema, frontDeskPickupReleaseSchema,
    frontDeskPickupCorrectionSchema, frontDeskDeliverySchema, frontDeskDeliveryStatusSchema,
    frontDeskLostFoundSchema, frontDeskLostFoundStatusSchema, frontDeskSettingsSchema } = context;
  const missing = (response, code, message) => response.status(404).json({ error: { code, message } });
  async function ownOnly(request, basePermission, selfPermission) {
    const permissions = await repo.getRolePermissions(request.user.orgId, request.user.role);
    return permissions.includes(selfPermission) && !permissions.includes(basePermission);
  }
  return {
    visitors: async (req, res, next) => {
      try { res.json({ data: await repo.listFrontDeskVisitors(
        parse(frontDeskListQuerySchema, req.query), req.user) }); } catch (error) { next(error); }
    },
    createVisitor: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createFrontDeskVisitor(
        parse(frontDeskVisitorSchema, req.body), req.user) }); } catch (error) { next(error); }
    },
    checkoutVisitor: async (req, res, next) => {
      try {
        const row = await repo.checkoutFrontDeskVisitor(
          parse(frontDeskIdSchema, req.params.visitorId), req.user);
        if (!row) return missing(res, 'FRONTDESK_VISITOR_NOT_FOUND', 'Visitor not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    appointments: async (req, res, next) => {
      try {
        const own = await ownOnly(req, 'frontdesk.appointments.view',
          'frontdesk.appointments.self.view');
        res.json({ data: await repo.listFrontDeskAppointments(
          parse(frontDeskListQuerySchema, req.query), req.user, own) });
      } catch (error) { next(error); }
    },
    createAppointment: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createFrontDeskAppointment(
        parse(frontDeskAppointmentSchema, req.body), req.user) }); } catch (error) { next(error); }
    },
    appointmentStatus: async (req, res, next) => {
      try {
        const row = await repo.updateFrontDeskAppointmentStatus(
          parse(frontDeskIdSchema, req.params.appointmentId),
          parse(frontDeskAppointmentStatusSchema, req.body).status, req.user);
        if (!row) return missing(res, 'FRONTDESK_APPOINTMENT_NOT_FOUND', 'Appointment not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    messages: async (req, res, next) => {
      try {
        const own = await ownOnly(req, 'frontdesk.messages.view', 'frontdesk.messages.self.view');
        res.json({ data: await repo.listFrontDeskMessages(
          parse(frontDeskListQuerySchema, req.query), req.user, own) });
      } catch (error) { next(error); }
    },
    createMessage: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createFrontDeskMessage(
        parse(frontDeskMessageSchema, req.body), req.user) }); } catch (error) { next(error); }
    },
    messageStatus: async (req, res, next) => {
      try {
        const row = await repo.updateFrontDeskMessageStatus(
          parse(frontDeskIdSchema, req.params.messageId),
          parse(frontDeskMessageStatusSchema, req.body).status, req.user);
        if (!row) return missing(res, 'FRONTDESK_MESSAGE_NOT_FOUND', 'Message not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    authorizations: async (req, res, next) => {
      try { res.json({ data: await repo.listFrontDeskAuthorizations(
        parse(frontDeskListQuerySchema, req.query), req.user) }); } catch (error) { next(error); }
    },
    createAuthorization: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createFrontDeskAuthorization(
        parse(frontDeskAuthorizationSchema, req.body), req.user) }); } catch (error) { next(error); }
    },
    authorizationStatus: async (req, res, next) => {
      try {
        const row = await repo.updateFrontDeskAuthorizationStatus(
          parse(frontDeskIdSchema, req.params.authorizationId),
          parse(frontDeskAuthorizationStatusSchema, req.body).status, req.user);
        if (!row) return missing(res, 'FRONTDESK_AUTHORIZATION_NOT_FOUND', 'Authorization not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    pickupReleases: async (req, res, next) => {
      try { res.json({ data: await repo.listFrontDeskPickupEvents(
        parse(frontDeskListQuerySchema, req.query), req.user) }); } catch (error) { next(error); }
    },
    pickupAttempts: async (req, res, next) => {
      try { res.json({ data: await repo.listFrontDeskPickupAttempts(
        parse(frontDeskListQuerySchema, req.query), req.user) }); } catch (error) { next(error); }
    },
    releasePickup: async (req, res, next) => {
      try {
        const result = await repo.recordFrontDeskPickup(
          parse(frontDeskPickupReleaseSchema, req.body), req.user);
        res.status(result.refused ? 403 : 201).json({
          data: result, ...(result.refused ? { error: {
            code: 'FRONTDESK_PICKUP_REFUSED', message: result.reason
          } } : {})
        });
      } catch (error) { next(error); }
    },
    correctPickup: async (req, res, next) => {
      try {
        const row = await repo.correctFrontDeskPickup(
          parse(frontDeskIdSchema, req.params.releaseId),
          parse(frontDeskPickupCorrectionSchema, req.body), req.user);
        if (!row) return missing(res, 'FRONTDESK_RELEASE_NOT_FOUND', 'Release record not found.');
        res.status(201).json({ data: row });
      } catch (error) { next(error); }
    },
    deliveries: async (req, res, next) => {
      try { res.json({ data: await repo.listFrontDeskDeliveries(
        parse(frontDeskListQuerySchema, req.query), req.user) }); } catch (error) { next(error); }
    },
    createDelivery: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createFrontDeskDelivery(
        parse(frontDeskDeliverySchema, req.body), req.user) }); } catch (error) { next(error); }
    },
    deliveryStatus: async (req, res, next) => {
      try {
        const row = await repo.updateFrontDeskDeliveryStatus(
          parse(frontDeskIdSchema, req.params.deliveryId),
          parse(frontDeskDeliveryStatusSchema, req.body).status, req.user);
        if (!row) return missing(res, 'FRONTDESK_DELIVERY_NOT_FOUND', 'Delivery not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    lostFound: async (req, res, next) => {
      try { res.json({ data: await repo.listFrontDeskLostFound(
        parse(frontDeskListQuerySchema, req.query), req.user) }); } catch (error) { next(error); }
    },
    createLostFound: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createFrontDeskLostFound(
        parse(frontDeskLostFoundSchema, req.body), req.user) }); } catch (error) { next(error); }
    },
    lostFoundStatus: async (req, res, next) => {
      try {
        const row = await repo.updateFrontDeskLostFoundStatus(
          parse(frontDeskIdSchema, req.params.itemId),
          parse(frontDeskLostFoundStatusSchema, req.body), req.user);
        if (!row) return missing(res, 'FRONTDESK_LOST_FOUND_NOT_FOUND', 'Lost-and-found item not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    dashboard: async (req, res, next) => {
      try { res.json({ data: await repo.getFrontDeskDashboard(req.user) }); }
      catch (error) { next(error); }
    },
    settings: async (req, res, next) => {
      try { res.json({ data: await repo.getFrontDeskSettings(req.user) }); }
      catch (error) { next(error); }
    },
    updateSettings: async (req, res, next) => {
      try { res.json({ data: await repo.updateFrontDeskSettings(
        parse(frontDeskSettingsSchema, req.body), req.user) }); } catch (error) { next(error); }
    }
  };
}
