import rateLimit from 'express-rate-limit';
import { createPublicController } from '../controllers/public.controller.js';

const routeRegistrations = {
  getHealth(app, context, controller) {
    app.get("/api/health", controller.getHealth);
  },
  getPublicAdmissionsBytoken(app, context, controller) {
    app.get("/api/public/admissions/:token", rateLimit({
    windowMs: 15 * 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false
  }), controller.getPublicAdmissionsBytoken);
  },
  postPublicAdmissionsBytoken(app, context, controller) {
    app.post("/api/public/admissions/:token", rateLimit({
    windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false
  }), controller.postPublicAdmissionsBytoken);
  },
  getPublicStudentTransfersBytoken(app, context, controller) {
    app.get("/api/public/student-transfers/:token", rateLimit({
    windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false
  }), controller.getPublicStudentTransfersBytoken);
  }
};

export function registerPublicRoutes(app, context, routeIds) {
  const controller = createPublicController(context);
  for (const routeId of routeIds) routeRegistrations[routeId](app, context, controller);
}
