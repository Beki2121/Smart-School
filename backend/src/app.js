import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as schoolSchemas from './schemas/school.schema.js';
import * as studentSchemas from './schemas/students.schema.js';
import * as admissionSchemas from './schemas/admissions.schema.js';
import * as attendanceSchemas from './schemas/attendance.schema.js';
import * as assessmentSchemas from './schemas/assessments.schema.js';
import * as examSchemas from './schemas/exams.schema.js';
import * as academicSchemas from './schemas/academic.schema.js';
import * as curriculumSchemas from './schemas/curriculum.schema.js';
import * as timetableSchemas from './schemas/timetable.schema.js';
import * as staffSchemas from './schemas/staff.schema.js';
import * as communicationSchemas from './schemas/communications.schema.js';
import * as feeSchemas from './schemas/fees.schema.js';
import * as accountSchemas from './schemas/accounts.schema.js';
import * as authSchemas from './schemas/auth.schema.js';
import * as platformSchemas from './schemas/platform.schema.js';
import * as auditSchemas from './schemas/audit.schema.js';
import * as assignmentSchemas from './schemas/assignments.schema.js';
import * as reportSchemas from './schemas/reports.schema.js';
import { logger } from './logger.js';
import { SCHOOL_GRADE_CATALOG } from './school-curriculum.js';
import { requireAnyPermission, requirePermission } from './middleware/permissions.js';
import { registerApplicationRoutes } from './routes/register.routes.js';
import { addDays, addisDate } from './utils/dates.js';
import { parse } from './utils/validation.js';
import { previewStudentCsv } from './utils/student-import.js';
import { toCsv } from './utils/csv.js';
import { offerLetterHtml, transferCertificateHtml } from './utils/printable-documents.js';

export function createApp({ repo, config, mailer = null }) {
  const permissionGuard = (permission) => requirePermission(permission, repo);
  const app = express();
  const webOrigins = [...new Set([config.WEB_ORIGIN, ...(config.WEB_ALLOWED_ORIGINS ?? [])])];
  app.disable('x-powered-by');
  app.set('trust proxy', config.NODE_ENV === 'production' ? 1 : false);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'], connectSrc: ["'self'", ...webOrigins],
        fontSrc: ["'self'", 'data:'], objectSrc: ["'none'"], frameAncestors: ["'none'"]
      }
    }
  }));
  app.use(cors({
    origin: webOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  }));
  app.use(express.json({ limit: '256kb' }));
  app.use((request, response, next) => {
    response.setHeader('X-Request-Id', request.headers['x-request-id']?.toString().slice(0, 100) ?? cryptoRandomId());
    next();
  });
  app.use('/api/auth', rateLimit({
    windowMs: 15 * 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false
  }));

  const routeContext = {
    ...schoolSchemas, ...studentSchemas, ...admissionSchemas, ...attendanceSchemas,
    ...assessmentSchemas, ...examSchemas, ...academicSchemas, ...curriculumSchemas, ...timetableSchemas, ...staffSchemas,
    ...communicationSchemas, ...feeSchemas, ...accountSchemas, ...authSchemas, ...platformSchemas,
    ...auditSchemas, ...assignmentSchemas, ...reportSchemas,
    SCHOOL_GRADE_CATALOG, addDays, addisDate, bcrypt, config, createHash, express, logger,
    offerLetterHtml, parse, previewStudentCsv, randomBytes, rateLimit, repo, requirePermission,
    toCsv, transferCertificateHtml, z
  };
  routeContext.requirePermission = permissionGuard;
  routeContext.requireAnyPermission = (permissions) => requireAnyPermission(permissions, repo);

  registerApplicationRoutes(app, routeContext, {
    repo, config, mailer, parse, requirePermission: permissionGuard
  });

  app.use((request, response) => response.status(404).json({
    error: { code: 'NOT_FOUND', message: 'API route not found.' }
  }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error.status ?? (['STUDENT_NO_CONFLICT', 'ACADEMIC_YEAR_CONFLICT', 'SETUP_CONFLICT', 'SCHEDULE_CONFLICT', 'FEE_CONFLICT'].includes(error.code) ? 409 :
      error.code === 'CAMPUS_SCOPE_VIOLATION' ? 403 : 500);
    if (status >= 500) {
      logger.error({ err: error, requestId: response.getHeader('X-Request-Id'), path: request.path }, 'Request failed');
    }
    const code = error.code ?? 'INTERNAL_ERROR';
    const message = status >= 500 ? 'An unexpected error occurred.' : error.message;
    response.status(status).json({
      error: { code, message, ...(error.details ? { details: error.details } : {}) }
    });
  });
  return app;
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
