import { createPortalExtensionsController } from '../controllers/portal-extensions.controller.js';

const registrations = {
  getPortalCalendar(app, context, controller) {
    app.get('/api/portal/calendar', context.requirePermission('portal.calendar.view'), controller.getCalendar);
  },
  getPortalRequests(app, context, controller) {
    app.get('/api/portal/requests', context.requirePermission('portal.requests.view'), controller.getRequests);
  },
  postPortalRequests(app, context, controller) {
    app.post('/api/portal/requests', context.requirePermission('portal.requests.create'), controller.postRequests);
  },
  patchPortalRequestStatus(app, context, controller) {
    app.patch('/api/portal/requests/:requestId/status', context.requirePermission('portal.requests.manage'), controller.patchRequestStatus);
  },
  getPortalSupportRequests(app, context, controller) {
    app.get('/api/portal/support', context.requirePermission('portal.support.view'), controller.getSupportRequests);
  },
  postPortalSupportRequests(app, context, controller) {
    app.post('/api/portal/support', context.requirePermission('portal.support.create'), controller.postSupportRequest);
  },
  patchPortalSupportRequest(app, context, controller) {
    app.patch('/api/portal/support/:requestId', context.requirePermission('portal.support.manage'), controller.patchSupportRequest);
  },
  getPortalMessageThreads(app, context, controller) {
    app.get('/api/portal/messages/threads', context.requirePermission('portal.messaging.view'), controller.getMessageThreads);
  },
  postPortalMessageThread(app, context, controller) {
    app.post('/api/portal/messages/threads', context.requirePermission('portal.messaging.send'), controller.postMessageThread);
  },
  postPortalThreadMessage(app, context, controller) {
    app.post('/api/portal/messages/threads/:threadId/messages', context.requirePermission('portal.messaging.send'), controller.postThreadMessage);
  },
  patchPortalThreadRead(app, context, controller) {
    app.patch('/api/portal/messages/threads/:threadId/read', context.requirePermission('portal.messaging.view'), controller.patchThreadRead);
  },
  patchPortalMessageModeration(app, context, controller) {
    app.patch('/api/portal/messages/:messageId/moderation', context.requirePermission('portal.messaging.moderate'), controller.patchMessageModeration);
  },
  getSchoolMessagingSettings(app, context, controller) {
    app.get('/api/school/messaging-settings', context.requirePermission('portal.messaging.configure'), controller.getMessagingSettings);
  },
  putSchoolMessagingSettings(app, context, controller) {
    app.put('/api/school/messaging-settings', context.requirePermission('portal.messaging.configure'), controller.putMessagingSettings);
  },
  patchCommunicationsEventStatus(app, context, controller) {
    app.patch('/api/communications/events/:eventId/status', context.requirePermission('communications.manage'), controller.patchEventStatus);
  }
};

export function registerPortalExtensionsRoutes(app, context, routeIds) {
  const controller = createPortalExtensionsController(context);
  for (const routeId of routeIds) registrations[routeId](app, context, controller);
}
