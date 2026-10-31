export function createCommunicationsController(context) {
  const { addDays, addisDate, campusAnnouncementSchema, campusEventSchema, eventRangeSchema, parse, repo, z } = context;
  return {
    getCommunicationsAnnouncements: async (request, response, next) => {
    try {
      response.json({ data: await repo.listCampusAnnouncements(request.user.activeCampusId) });
    } catch (error) { next(error); }
  },
    postCommunicationsAnnouncements: async (request, response, next) => {
    try {
      const announcement = await repo.createCampusAnnouncement(
        parse(campusAnnouncementSchema, request.body), request.user
      );
      response.status(201).json({ data: announcement });
    } catch (error) { next(error); }
  },
    getCommunicationsEvents: async (request, response, next) => {
    try {
      const today = addisDate();
      const range = parse(eventRangeSchema, {
        from: request.query.from ?? today,
        to: request.query.to ?? addDays(today, 365)
      });
      response.json({ data: await repo.listCampusEvents(
        request.user.activeCampusId, range.from, range.to
      ) });
    } catch (error) { next(error); }
  },
    postCommunicationsEvents: async (request, response, next) => {
    try {
      const event = await repo.createCampusEvent(parse(campusEventSchema, request.body), request.user);
      response.status(201).json({ data: event });
    } catch (error) { next(error); }
  },
    getNotifications: async (request, response, next) => {
    try {
      response.json({ data: await repo.listUserNotifications(request.user) });
    } catch (error) { next(error); }
  },
    patchNotificationsByNotificationIdRead: async (request, response, next) => {
    try {
      const id = parse(z.string().uuid(), request.params.notificationId);
      const notification = await repo.markUserNotificationRead(id, request.user);
      if (!notification) {
        return response.status(404).json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' } });
      }
      response.json({ data: notification });
    } catch (error) { next(error); }
  }
  };
}
