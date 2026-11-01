import { createCommunicationsController } from '../controllers/communications.controller.js';

const routeRegistrations = {
  getCommunicationsAnnouncements(app, context, controller) {
    app.get("/api/communications/announcements", context.requirePermission('communications.view'), controller.getCommunicationsAnnouncements);
  },
  postCommunicationsAnnouncements(app, context, controller) {
    app.post("/api/communications/announcements", context.requirePermission('communications.manage'), controller.postCommunicationsAnnouncements);
  },
  getCommunicationsEvents(app, context, controller) {
    app.get("/api/communications/events", context.requirePermission('communications.view'), controller.getCommunicationsEvents);
  },
  postCommunicationsEvents(app, context, controller) {
    app.post("/api/communications/events", context.requirePermission('communications.manage'), controller.postCommunicationsEvents);
  },
  getNotifications(app, context, controller) {
    app.get("/api/notifications", context.requirePermission('notifications.view'), controller.getNotifications);
  },
  patchNotificationsByNotificationIdRead(app, context, controller) {
    app.patch("/api/notifications/:notificationId/read", context.requirePermission('notifications.view'), controller.patchNotificationsByNotificationIdRead);
  }
};

export function registerCommunicationsRoutes(app, context, routeIds) {
  const controller = createCommunicationsController(context);
  for (const routeId of routeIds) routeRegistrations[routeId](app, context, controller);
}
