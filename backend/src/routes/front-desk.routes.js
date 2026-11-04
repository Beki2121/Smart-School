import { createFrontDeskController } from '../controllers/front-desk.controller.js';

const routes = {
  visitors(app, c, x) { app.get('/api/front-desk/visitors', c.requirePermission('frontdesk.visitors.view'), x.visitors); },
  createVisitor(app, c, x) { app.post('/api/front-desk/visitors', c.requirePermission('frontdesk.visitors.manage'), x.createVisitor); },
  checkoutVisitor(app, c, x) { app.post('/api/front-desk/visitors/:visitorId/checkout', c.requirePermission('frontdesk.visitors.manage'), x.checkoutVisitor); },
  appointments(app, c, x) { app.get('/api/front-desk/appointments', c.requireAnyPermission([
    'frontdesk.appointments.view', 'frontdesk.appointments.self.view'
  ]), x.appointments); },
  createAppointment(app, c, x) { app.post('/api/front-desk/appointments', c.requirePermission('frontdesk.appointments.manage'), x.createAppointment); },
  appointmentStatus(app, c, x) { app.patch('/api/front-desk/appointments/:appointmentId/status', c.requirePermission('frontdesk.appointments.manage'), x.appointmentStatus); },
  messages(app, c, x) { app.get('/api/front-desk/messages', c.requireAnyPermission([
    'frontdesk.messages.view', 'frontdesk.messages.self.view'
  ]), x.messages); },
  createMessage(app, c, x) { app.post('/api/front-desk/messages', c.requirePermission('frontdesk.messages.manage'), x.createMessage); },
  messageStatus(app, c, x) { app.patch('/api/front-desk/messages/:messageId/status', c.requirePermission('frontdesk.messages.manage'), x.messageStatus); },
  authorizations(app, c, x) { app.get('/api/front-desk/pickup/authorizations', c.requireAnyPermission([
    'frontdesk.pickup.authorizations.view', 'frontdesk.pickup.authorizations.manage'
  ]), x.authorizations); },
  createAuthorization(app, c, x) { app.post('/api/front-desk/pickup/authorizations', c.requirePermission('frontdesk.pickup.authorizations.manage'), x.createAuthorization); },
  authorizationStatus(app, c, x) { app.patch('/api/front-desk/pickup/authorizations/:authorizationId/status', c.requirePermission('frontdesk.pickup.authorizations.manage'), x.authorizationStatus); },
  pickupReleases(app, c, x) { app.get('/api/front-desk/pickup/releases', c.requirePermission('frontdesk.pickup.log.view'), x.pickupReleases); },
  pickupAttempts(app, c, x) { app.get('/api/front-desk/pickup/attempts', c.requirePermission('frontdesk.pickup.log.view'), x.pickupAttempts); },
  releasePickup(app, c, x) { app.post('/api/front-desk/pickup/releases', c.requirePermission('frontdesk.pickup.release'), x.releasePickup); },
  correctPickup(app, c, x) { app.post('/api/front-desk/pickup/releases/:releaseId/corrections', c.requirePermission('frontdesk.pickup.authorizations.manage'), x.correctPickup); },
  deliveries(app, c, x) { app.get('/api/front-desk/deliveries', c.requirePermission('frontdesk.deliveries.view'), x.deliveries); },
  createDelivery(app, c, x) { app.post('/api/front-desk/deliveries', c.requirePermission('frontdesk.deliveries.manage'), x.createDelivery); },
  deliveryStatus(app, c, x) { app.patch('/api/front-desk/deliveries/:deliveryId/status', c.requirePermission('frontdesk.deliveries.manage'), x.deliveryStatus); },
  lostFound(app, c, x) { app.get('/api/front-desk/lost-found', c.requirePermission('frontdesk.lost-found.view'), x.lostFound); },
  createLostFound(app, c, x) { app.post('/api/front-desk/lost-found', c.requirePermission('frontdesk.lost-found.manage'), x.createLostFound); },
  lostFoundStatus(app, c, x) { app.patch('/api/front-desk/lost-found/:itemId/status', c.requirePermission('frontdesk.lost-found.manage'), x.lostFoundStatus); },
  dashboard(app, c, x) { app.get('/api/front-desk/dashboard', c.requirePermission('frontdesk.dashboard.view'), x.dashboard); },
  settings(app, c, x) { app.get('/api/front-desk/settings', c.requirePermission('frontdesk.settings.manage'), x.settings); },
  updateSettings(app, c, x) { app.put('/api/front-desk/settings', c.requirePermission('frontdesk.settings.manage'), x.updateSettings); }
};

export function registerFrontDeskRoutes(app, context, routeIds) {
  const controller = createFrontDeskController(context);
  for (const routeId of routeIds) routes[routeId](app, context, controller);
}
