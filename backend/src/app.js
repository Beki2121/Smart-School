import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { logger } from './logger.js';
import {
  clearRefreshCookie, createRefreshSecret, getRefreshCookie, hashRefreshSecret,
  issueAccessToken, refreshExpiresAt, setRefreshCookie, verifyAccessToken
} from './auth.js';

const loginSchema = z.object({
  login: z.string().trim().min(3).max(254),
  password: z.string().min(8).max(128)
});
const studentSchema = z.object({
  studentNo: z.string().trim().min(1).max(32),
  givenNameAm: z.string().trim().min(1).max(100),
  fatherNameAm: z.string().trim().min(1).max(100),
  grandfatherNameAm: z.string().trim().min(1).max(100),
  givenNameEn: z.string().trim().min(1).max(100),
  fatherNameEn: z.string().trim().min(1).max(100),
  grandfatherNameEn: z.string().trim().min(1).max(100),
  gender: z.enum(['female', 'male', 'other']),
  sectionName: z.string().trim().min(1).max(80)
});
const attendanceSchema = z.object({
  clientUuid: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sectionId: z.string().uuid(),
  records: z.array(z.object({
    studentId: z.string().uuid(),
    status: z.enum(['present', 'absent', 'late', 'excused'])
  })).min(1).max(100)
}).superRefine((data, context) => {
  const ids = data.records.map((record) => record.studentId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Each student may appear only once.', path: ['records'] });
  }
});
const markSchema = z.object({
  clientUuid: z.string().uuid(),
  studentId: z.string().uuid(),
  assessmentName: z.string().trim().min(1).max(100),
  maxValue: z.number().positive().max(1000),
  value: z.number().min(0).max(1000)
}).refine((row) => row.value <= row.maxValue, {
  message: 'Mark cannot exceed its maximum value.',
  path: ['value']
});
const schoolProfileSchema = z.object({
  name: z.string().trim().min(2).max(180),
  address: z.string().trim().max(500).optional().default(''),
  phone: z.string().trim().max(32).optional().default('')
});
const academicYearSchema = z.object({
  labelEc: z.string().trim().min(4).max(24),
  startDate: z.string().date(),
  endDate: z.string().date()
}).refine((year) => year.startDate < year.endDate, {
  message: 'Academic year end must be after its start.',
  path: ['endDate']
});
const academicYearIdSchema = z.string().uuid();
const termSchema = z.object({
  name: z.string().trim().min(1).max(80),
  startDate: z.string().date(),
  endDate: z.string().date()
}).refine((term) => term.startDate < term.endDate, {
  message: 'Term end must be after its start.',
  path: ['endDate']
});
const gradeSchema = z.object({
  code: z.string().trim().min(1).max(24),
  nameEn: z.string().trim().min(1).max(80),
  nameAm: z.string().trim().min(1).max(80),
  band: z.string().trim().min(1).max(32),
  sortOrder: z.number().int().min(0).max(1000)
});
const sectionSchema = z.object({
  gradeLevelId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  capacity: z.number().int().positive().max(1000).nullable().optional()
});
const subjectSchema = z.object({
  code: z.string().trim().min(1).max(24),
  nameEn: z.string().trim().min(1).max(100),
  nameAm: z.string().trim().min(1).max(100)
});
const departmentSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional().default('')
});
const staffSchema = z.object({
  userId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  givenNameEn: z.string().trim().min(1).max(100),
  fatherNameEn: z.string().trim().min(1).max(100),
  grandfatherNameEn: z.string().trim().min(1).max(100),
  givenNameAm: z.string().trim().min(1).max(100),
  fatherNameAm: z.string().trim().min(1).max(100),
  grandfatherNameAm: z.string().trim().min(1).max(100),
  jobTitle: z.string().trim().min(1).max(120),
  qualification: z.string().trim().max(255).optional().default(''),
  employmentStatus: z.enum(['active', 'on_leave', 'terminated']).default('active'),
  hiredOn: z.string().date().nullable().optional()
});
const assignmentSchema = z.object({
  staffId: z.string().uuid(),
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  dayOfWeek: z.number().int().min(1).max(7).nullable().optional(),
  periodNumber: z.number().int().min(1).max(20).nullable().optional()
}).refine((assignment) =>
  (assignment.dayOfWeek == null) === (assignment.periodNumber == null), {
  message: 'Set both timetable day and period, or leave both unset.',
  path: ['periodNumber']
});
const staffDateSchema = z.object({
  staffId: z.string().uuid().optional(),
  date: z.string().date(),
  status: z.enum(['present', 'absent', 'late', 'excused']),
  clockIn: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  clockOut: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional()
});
const leaveSchema = z.object({
  staffId: z.string().uuid().optional(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  reason: z.string().trim().min(3).max(1000)
}).refine((leave) => leave.startDate <= leave.endDate, {
  message: 'Leave end date must be on or after the start date.',
  path: ['endDate']
});
const leaveReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional().default('')
});
const staffMessageSchema = z.object({
  departmentId: z.string().uuid().nullable().optional(),
  type: z.enum(['handover', 'announcement']),
  title: z.string().trim().min(2).max(180),
  body: z.string().trim().min(1).max(10000)
});

const permissionRoles = {
  'dashboard.view': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin'],
  'students.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'counsellor', 'system_admin'],
  'students.edit': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'school.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'],
  'school.edit': ['owner_director', 'principal', 'system_admin'],
  'attendance.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'attendance.take': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'marks.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'marks.enter': ['owner_director', 'principal', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'staff.view': ['owner_director', 'group_executive', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'staff.manage': ['owner_director', 'principal', 'hr_admin', 'system_admin'],
  'assignments.manage': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'system_admin'],
  'staff.attendance': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'leave.request': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'leave.approve': ['owner_director', 'principal', 'hr_admin', 'system_admin'],
  'staff.messages': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin']
};

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const error = new Error('Request validation failed.');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    error.details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'), message: issue.message
    }));
    throw error;
  }
  return result.data;
}

export function createApp({ repo, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'], connectSrc: ["'self'", config.WEB_ORIGIN],
        fontSrc: ["'self'", 'data:'], objectSrc: ["'none'"], frameAncestors: ["'none'"]
      }
    }
  }));
  app.use(cors({
    origin: config.WEB_ORIGIN,
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

  app.get('/api/health', (request, response) => {
    response.json({ data: { status: 'ok', service: 'sims-api', storage: repo.mode, timestamp: new Date().toISOString() } });
  });

  app.post('/api/auth/login', async (request, response, next) => {
    try {
      const input = parse(loginSchema, request.body);
      const failures = repo.loginFailures?.get(input.login)?.count ?? 0;
      const locked = failures >= 5 &&
        Date.now() - repo.loginFailures.get(input.login).since < 15 * 60_000;
      if (locked) return response.status(429).json({ error: { code: 'LOGIN_LOCKED', message: 'Too many attempts. Try again in 15 minutes.' } });
      const user = await repo.findUserByLogin(input.login);
      const valid = user && user.isActive && await bcrypt.compare(input.password, user.passwordHash);
      if (!valid) {
        const count = await repo.recordLoginFailure(input.login);
        await repo.appendAudit({
          sub: user?.id ?? 'unknown', orgId: user?.orgId ?? null,
          activeCampusId: user?.activeCampusId ?? null
        }, 'auth.login_failed', 'user', user?.id ?? null, null, { login: input.login });
        return response.status(count >= 5 ? 429 : 401).json({
          error: { code: count >= 5 ? 'LOGIN_LOCKED' : 'INVALID_CREDENTIALS', message: count >= 5 ? 'Too many attempts. Try again in 15 minutes.' : 'Invalid login or password.' }
        });
      }
      if (!user.activeCampusId || !user.campusIds.includes(user.activeCampusId)) {
        return response.status(403).json({
          error: { code: 'CAMPUS_ACCESS_REQUIRED', message: 'No active campus access is assigned to this account.' }
        });
      }
      await repo.clearLoginFailures(input.login);
      const token = issueAccessToken(user, config);
      const refresh = createRefreshSecret();
      await repo.storeRefreshToken(refresh.hash, user.id, refreshExpiresAt());
      await repo.appendAudit({
        sub: user.id, orgId: user.orgId, activeCampusId: user.activeCampusId
      }, 'auth.login', 'user', user.id, null, null);
      setRefreshCookie(response, refresh.value, config.NODE_ENV === 'production');
      response.json({ data: { accessToken: token, user: publicUser(user) } });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/refresh', async (request, response, next) => {
    try {
      const value = getRefreshCookie(request);
      if (!value) return response.status(401).json({ error: { code: 'REFRESH_REQUIRED', message: 'Sign in again.' } });
      const user = await repo.consumeRefreshToken(hashRefreshSecret(value));
      if (!user) {
        clearRefreshCookie(response, config.NODE_ENV === 'production');
        return response.status(401).json({ error: { code: 'REFRESH_INVALID', message: 'Refresh token is expired or already used.' } });
      }
      const refresh = createRefreshSecret();
      await repo.storeRefreshToken(refresh.hash, user.id, refreshExpiresAt());
      setRefreshCookie(response, refresh.value, config.NODE_ENV === 'production');
      response.json({ data: { accessToken: issueAccessToken(user, config), user: publicUser(user) } });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/logout', async (request, response, next) => {
    try {
      const value = getRefreshCookie(request);
      if (value) await repo.revokeRefreshToken(hashRefreshSecret(value));
      clearRefreshCookie(response, config.NODE_ENV === 'production');
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.use('/api', authenticate(config));
  app.get('/api/auth/me', requirePermission('dashboard.view'), async (request, response, next) => {
    try {
      const user = await repo.findUserById(request.user.sub);
      if (!user || !user.isActive) return response.status(401).json({ error: { code: 'USER_INACTIVE', message: 'Account is unavailable.' } });
      response.json({ data: publicUser(user) });
    } catch (error) { next(error); }
  });
  app.get('/api/dashboard', requirePermission('dashboard.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.getDashboard(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.get('/api/school', requirePermission('school.view'), async (request, response, next) => {
    try {
      const campus = await repo.getCampus(request.user.activeCampusId);
      if (!campus) return response.status(404).json({ error: { code: 'CAMPUS_NOT_FOUND', message: 'Campus not found.' } });
      response.json({ data: campus });
    } catch (error) { next(error); }
  });
  app.get('/api/academic-year', requirePermission('school.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.getAcademicYear(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.get('/api/academic-years', requirePermission('school.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listAcademicYears(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.post('/api/academic-years', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const year = await repo.createAcademicYear(parse(academicYearSchema, request.body), request.user);
      response.status(201).json({ data: year });
    } catch (error) { next(error); }
  });
  app.patch('/api/academic-years/:yearId/activate', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const yearId = parse(academicYearIdSchema, request.params.yearId);
      const year = await repo.activateAcademicYear(yearId, request.user);
      if (!year) return response.status(404).json({ error: { code: 'ACADEMIC_YEAR_NOT_FOUND', message: 'Academic year not found.' } });
      response.json({ data: year });
    } catch (error) { next(error); }
  });
  app.get('/api/terms', requirePermission('school.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listTerms(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.post('/api/terms', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const term = await repo.createTerm(parse(termSchema, request.body), request.user);
      response.status(201).json({ data: term });
    } catch (error) { next(error); }
  });
  app.get('/api/grades', requirePermission('school.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listGrades(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.post('/api/grades', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const grade = await repo.createGrade(parse(gradeSchema, request.body), request.user);
      response.status(201).json({ data: grade });
    } catch (error) { next(error); }
  });
  app.get('/api/subjects', requirePermission('school.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listSubjects(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.post('/api/subjects', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const subject = await repo.createSubject(parse(subjectSchema, request.body), request.user);
      response.status(201).json({ data: subject });
    } catch (error) { next(error); }
  });
  app.get('/api/departments', requirePermission('staff.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listDepartments(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.post('/api/departments', requirePermission('staff.manage'), async (request, response, next) => {
    try {
      const department = await repo.createDepartment(parse(departmentSchema, request.body), request.user);
      response.status(201).json({ data: department });
    } catch (error) { next(error); }
  });
  app.get('/api/staff', requirePermission('staff.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listStaff(request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/staff', requirePermission('staff.manage'), async (request, response, next) => {
    try {
      const staff = await repo.createStaff(parse(staffSchema, request.body), request.user);
      response.status(201).json({ data: staff });
    } catch (error) { next(error); }
  });
  app.get('/api/teaching-assignments', requirePermission('staff.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listTeachingAssignments(request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/teaching-assignments', requirePermission('assignments.manage'), async (request, response, next) => {
    try {
      const assignment = await repo.createTeachingAssignment(parse(assignmentSchema, request.body), request.user);
      response.status(201).json({ data: assignment });
    } catch (error) { next(error); }
  });
  app.put('/api/sections/:sectionId/homeroom', requirePermission('assignments.manage'), async (request, response, next) => {
    try {
      const input = parse(z.object({ staffId: z.string().uuid() }), request.body);
      const sectionId = parse(z.string().uuid(), request.params.sectionId);
      const assignment = await repo.assignHomeroom(sectionId, input.staffId, request.user);
      if (!assignment) return response.status(404).json({ error: { code: 'SECTION_NOT_FOUND', message: 'Section not found.' } });
      response.json({ data: assignment });
    } catch (error) { next(error); }
  });
  app.get('/api/staff/attendance', requirePermission('staff.attendance'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listStaffAttendance(request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/staff/attendance', requirePermission('staff.attendance'), async (request, response, next) => {
    try {
      const record = await repo.recordStaffAttendance(parse(staffDateSchema, request.body), request.user);
      response.status(record.duplicate ? 200 : 201).json({ data: record });
    } catch (error) { next(error); }
  });
  app.get('/api/staff/attendance.csv', requirePermission('staff.manage'), async (request, response, next) => {
    try {
      const rows = await repo.listStaffAttendance(request.user);
      response.set('Content-Type', 'text/csv; charset=utf-8');
      response.attachment('staff-attendance.csv');
      response.send(toCsv([
        ['Staff ID', 'Name', 'Department', 'Date', 'Status', 'Clock in', 'Clock out'],
        ...rows.map((row) => [
          row.staffId, row.name, row.department ?? '', row.date, row.status,
          row.clockIn ?? '', row.clockOut ?? ''
        ])
      ]));
    } catch (error) { next(error); }
  });
  app.get('/api/leave-requests', requirePermission('leave.request'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listLeaveRequests(request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/leave-requests', requirePermission('leave.request'), async (request, response, next) => {
    try {
      const leave = await repo.createLeaveRequest(parse(leaveSchema, request.body), request.user);
      response.status(201).json({ data: leave });
    } catch (error) { next(error); }
  });
  app.patch('/api/leave-requests/:leaveId', requirePermission('leave.approve'), async (request, response, next) => {
    try {
      const leaveId = parse(z.string().uuid(), request.params.leaveId);
      const input = parse(leaveReviewSchema, request.body);
      const leave = await repo.reviewLeaveRequest(leaveId, input, request.user);
      if (!leave) return response.status(404).json({ error: { code: 'LEAVE_NOT_FOUND', message: 'Leave request not found.' } });
      response.json({ data: leave });
    } catch (error) { next(error); }
  });
  app.get('/api/staff/messages', requirePermission('staff.messages'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listStaffMessages(request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/staff/messages', requirePermission('staff.manage'), async (request, response, next) => {
    try {
      const message = await repo.createStaffMessage(parse(staffMessageSchema, request.body), request.user);
      response.status(201).json({ data: message });
    } catch (error) { next(error); }
  });
  app.post('/api/sections', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const section = await repo.createSection(parse(sectionSchema, request.body), request.user);
      response.status(201).json({ data: section });
    } catch (error) { next(error); }
  });
  app.put('/api/school', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const campus = await repo.updateCampus(parse(schoolProfileSchema, request.body), request.user);
      if (!campus) return response.status(404).json({ error: { code: 'CAMPUS_NOT_FOUND', message: 'Campus not found.' } });
      response.json({ data: campus });
    } catch (error) { next(error); }
  });
  app.get('/api/students', requirePermission('students.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listStudentsFor(request.user) });
    } catch (error) { next(error); }
  });
  app.get('/api/sections', requirePermission('attendance.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listSections(request.user.activeCampusId, request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/students', requirePermission('students.edit'), async (request, response, next) => {
    try {
      const student = await repo.createStudent(parse(studentSchema, request.body), request.user);
      response.status(201).json({ data: student });
    } catch (error) { next(error); }
  });
  app.get('/api/students/:studentId', requirePermission('students.view'), async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const student = (await repo.listStudentsFor(request.user)).find((item) => item.id === studentId);
      if (!student) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: student });
    } catch (error) { next(error); }
  });
  app.get('/api/attendance', requirePermission('attendance.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listAttendance(request.user.activeCampusId, request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/attendance', requirePermission('attendance.take'), async (request, response, next) => {
    try {
      const item = await repo.saveAttendance(parse(attendanceSchema, request.body), request.user);
      response.status(item.duplicate ? 200 : 201).json({ data: item });
    } catch (error) { next(error); }
  });
  app.get('/api/attendance/sections/:sectionId/roster', requirePermission('attendance.view'), async (request, response, next) => {
    try {
      const sectionId = parse(z.string().uuid(), request.params.sectionId);
      const students = await repo.listRoster(request.user, sectionId);
      response.json({ data: students });
    } catch (error) { next(error); }
  });
  app.get('/api/marks', requirePermission('marks.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listMarks(request.user.activeCampusId, request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/marks', requirePermission('marks.enter'), async (request, response, next) => {
    try {
      const input = parse(markSchema, request.body);
      const item = await repo.saveMark(input, request.user);
      response.status(item.duplicate ? 200 : 201).json({ data: item });
    } catch (error) { next(error); }
  });
  app.get('/api/marks/students/:studentId', requirePermission('marks.view'), async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const marks = await repo.listMarks(request.user.activeCampusId, request.user);
      response.json({ data: marks.filter((item) => item.studentId === studentId) });
    } catch (error) { next(error); }
  });

  app.use((request, response) => response.status(404).json({
    error: { code: 'NOT_FOUND', message: 'API route not found.' }
  }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error.status ?? (['STUDENT_NO_CONFLICT', 'ACADEMIC_YEAR_CONFLICT', 'SETUP_CONFLICT', 'SCHEDULE_CONFLICT'].includes(error.code) ? 409 :
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

function authenticate(config) {
  return (request, response, next) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } });
    try {
      const claims = verifyAccessToken(token, config);
      if (!claims.sub || !claims.orgId || !claims.activeCampusId ||
          !Array.isArray(claims.campusIds) || !claims.campusIds.includes(claims.activeCampusId)) {
        return response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid access token.' } });
      }
      request.user = claims;
      next();
    } catch {
      response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Access token expired or invalid.' } });
    }
  };
}

function requirePermission(permission) {
  return (request, response, next) => {
    const roles = permissionRoles[permission] ?? [];
    if (!roles.includes(request.user.role)) {
      return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' } });
    }
    if (!request.user.campusIds.includes(request.user.activeCampusId)) {
      return response.status(403).json({ error: { code: 'CAMPUS_SCOPE_DENIED', message: 'Campus access is not granted.' } });
    }
    next();
  };
}

function publicUser(user) {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    campusIds: user.campusIds, activeCampusId: user.activeCampusId
  };
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function toCsv(rows) {
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',')).join('\r\n');
}
