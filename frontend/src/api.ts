import { openDB } from 'idb';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
let accessToken: string | null = null;

export type Student = {
  id: string; campusId: string; studentNo: string; givenNameAm: string;
  fatherNameAm: string; grandfatherNameAm: string; givenNameEn: string;
  fatherNameEn: string; grandfatherNameEn: string; gender: 'female' | 'male' | 'other';
  sectionName: string; status: string;
};
export type User = { id: string; name: string; email?: string; role: string; campusIds: string[]; activeCampusId: string };
export type Dashboard = {
  studentCount: number; attendanceSessions: number; marksRecorded: number; attendanceToday: number;
  recentStudents: Student[]; sectionDistribution: { sectionName: string; count: number }[];
  genderTotals: { female: number; male: number; other: number }; mode: string
};
export type Mark = { id: string; studentId: string; assessmentName: string; maxValue: number; value: number; state: string };
export type AttendanceSession = { id: string; date: string; sectionId: string; records?: { studentId: string; status: string }[]; clientUuid?: string };
export type SchoolProfile = { id: string; name: string; address: string; phone: string; timezone: string };
export type Section = { id: string; campusId: string; name: string; gradeName?: string; gradeLevelId?: string; capacity?: number | null };
export type AcademicYear = { id: string; campusId: string; labelEc: string; startDate: string; endDate: string; status: string } | null;
export type AcademicYearRecord = NonNullable<AcademicYear>;
export type GradeLevel = { id: string; campusId: string; code: string; nameEn: string; nameAm: string; band: string; sortOrder: number };
export type Term = { id: string; academicYearId: string; name: string; startDate: string; endDate: string; isCurrent: boolean };
export type Subject = { id: string; campusId: string; code: string; nameEn: string; nameAm: string };
export type Department = { id: string; campusId: string; name: string; description: string };
export type StaffMember = {
  id: string; campusId: string; userId: string | null; departmentId: string | null;
  givenNameEn: string; fatherNameEn: string; grandfatherNameEn: string;
  givenNameAm: string; fatherNameAm: string; grandfatherNameAm: string;
  jobTitle: string; qualification: string; employmentStatus: string; hiredOn: string | null;
  name: string; departmentName: string; teachingAssignmentCount: number; homeroomCount: number
};
export type TeachingAssignment = {
  id: string; campusId: string; staffId: string; sectionId: string; subjectId: string;
  dayOfWeek: number | null; periodNumber: number | null; staffName: string;
  sectionName: string; subjectName: string
};
export type LeaveRequest = {
  id: string; staffId: string; staffName: string; startDate: string; endDate: string;
  reason: string; status: 'pending' | 'approved' | 'rejected'; reviewNote: string
};
export type StaffAttendance = {
  id: string; staffId: string; name?: string; department?: string; date: string;
  status: string; clockIn: string | null; clockOut: string | null
};
export type StaffMessage = {
  id: string; departmentId: string | null; type: 'handover' | 'announcement';
  title: string; body: string; createdAt?: string
};

type ApiEnvelope<T> = { data: T };
type PendingOperation = { id: string; ownerId: string; path: string; body: Record<string, unknown>; createdAt: number };

async function offlineDb() {
  return openDB('sims-offline', 1, {
    upgrade(db) { db.createObjectStore('operations', { keyPath: 'id' }); }
  });
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

async function request<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (response.status === 401 && allowRefresh && path !== '/api/auth/login' && path !== '/api/auth/refresh') {
    const refresh = await fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refresh.ok) {
      const payload = await refresh.json() as ApiEnvelope<{ accessToken: string }>;
      setAccessToken(payload.data.accessToken);
      headers.set('Authorization', `Bearer ${payload.data.accessToken}`);
      response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
    } else setAccessToken(null);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
    const error = new Error(payload?.error?.message ?? `Request failed (${response.status})`);
    Object.assign(error, { status: response.status, code: payload?.error?.code });
    throw error;
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json() as ApiEnvelope<T>;
  return payload.data;
}

export const api = {
  login: async (login: string, password: string) => {
    const data = await request<{ accessToken: string; user: User }>('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ login, password })
    }, false);
    setAccessToken(data.accessToken);
    return data.user;
  },
  me: () => request<User>('/api/auth/me'),
  logout: async () => {
    await request<void>('/api/auth/logout', { method: 'POST' }, false).catch(() => undefined);
    setAccessToken(null);
  },
  dashboard: () => request<Dashboard>('/api/dashboard'),
  school: () => request<SchoolProfile>('/api/school'),
  academicYear: () => request<AcademicYear>('/api/academic-year'),
  academicYears: () => request<AcademicYearRecord[]>('/api/academic-years'),
  createAcademicYear: (body: Omit<AcademicYearRecord, 'id' | 'campusId' | 'status'>) =>
    request<AcademicYearRecord>('/api/academic-years', { method: 'POST', body: JSON.stringify(body) }),
  activateAcademicYear: (yearId: string) =>
    request<AcademicYearRecord>(`/api/academic-years/${yearId}/activate`, { method: 'PATCH' }),
  terms: () => request<Term[]>('/api/terms'),
  createTerm: (body: Pick<Term, 'name' | 'startDate' | 'endDate'>) =>
    request<Term>('/api/terms', { method: 'POST', body: JSON.stringify(body) }),
  grades: () => request<GradeLevel[]>('/api/grades'),
  createGrade: (body: Omit<GradeLevel, 'id' | 'campusId'>) =>
    request<GradeLevel>('/api/grades', { method: 'POST', body: JSON.stringify(body) }),
  createSection: (body: { gradeLevelId: string; name: string; capacity: number | null }) =>
    request<Section>('/api/sections', { method: 'POST', body: JSON.stringify(body) }),
  subjects: () => request<Subject[]>('/api/subjects'),
  createSubject: (body: Omit<Subject, 'id' | 'campusId'>) =>
    request<Subject>('/api/subjects', { method: 'POST', body: JSON.stringify(body) }),
  departments: () => request<Department[]>('/api/departments'),
  createDepartment: (body: Pick<Department, 'name' | 'description'>) =>
    request<Department>('/api/departments', { method: 'POST', body: JSON.stringify(body) }),
  staff: () => request<StaffMember[]>('/api/staff'),
  createStaff: (body: Omit<StaffMember, 'id' | 'campusId' | 'name' | 'departmentName' | 'teachingAssignmentCount' | 'homeroomCount'>) =>
    request<StaffMember>('/api/staff', { method: 'POST', body: JSON.stringify(body) }),
  teachingAssignments: () => request<TeachingAssignment[]>('/api/teaching-assignments'),
  createTeachingAssignment: (body: Pick<TeachingAssignment, 'staffId' | 'sectionId' | 'subjectId' | 'dayOfWeek' | 'periodNumber'>) =>
    request<TeachingAssignment>('/api/teaching-assignments', { method: 'POST', body: JSON.stringify(body) }),
  assignHomeroom: (sectionId: string, staffId: string) =>
    request<{ sectionId: string; staffId: string; staffName: string; sectionName: string }>(
      `/api/sections/${sectionId}/homeroom`, { method: 'PUT', body: JSON.stringify({ staffId }) }
    ),
  staffAttendance: () => request<StaffAttendance[]>('/api/staff/attendance'),
  downloadStaffAttendanceCsv: async () => {
    const headers = new Headers();
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    let response = await fetch(`${API_BASE}/api/staff/attendance.csv`, { headers, credentials: 'include' });
    if (response.status === 401) {
      const refresh = await fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (refresh.ok) {
        const payload = await refresh.json() as ApiEnvelope<{ accessToken: string }>;
        setAccessToken(payload.data.accessToken);
        headers.set('Authorization', `Bearer ${payload.data.accessToken}`);
        response = await fetch(`${API_BASE}/api/staff/attendance.csv`, { headers, credentials: 'include' });
      }
    }
    if (!response.ok) throw new Error(`Attendance export failed (${response.status}).`);
    return response.blob();
  },
  recordStaffAttendance: (body: { staffId?: string; date: string; status: string; clockIn?: string; clockOut?: string }) =>
    request<StaffAttendance>('/api/staff/attendance', { method: 'POST', body: JSON.stringify(body) }),
  leaveRequests: () => request<LeaveRequest[]>('/api/leave-requests'),
  createLeaveRequest: (body: { staffId?: string; startDate: string; endDate: string; reason: string }) =>
    request<LeaveRequest>('/api/leave-requests', { method: 'POST', body: JSON.stringify(body) }),
  reviewLeaveRequest: (id: string, decision: 'approved' | 'rejected', note = '') =>
    request<LeaveRequest>(`/api/leave-requests/${id}`, {
      method: 'PATCH', body: JSON.stringify({ decision, note })
    }),
  staffMessages: () => request<StaffMessage[]>('/api/staff/messages'),
  createStaffMessage: (body: { departmentId: string | null; type: 'handover' | 'announcement'; title: string; body: string }) =>
    request<StaffMessage>('/api/staff/messages', { method: 'POST', body: JSON.stringify(body) }),
  updateSchool: (body: Pick<SchoolProfile, 'name' | 'address' | 'phone'>) =>
    request<SchoolProfile>('/api/school', { method: 'PUT', body: JSON.stringify(body) }),
  students: () => request<Student[]>('/api/students'),
  sections: () => request<Section[]>('/api/sections'),
  createStudent: (body: Omit<Student, 'id' | 'campusId' | 'status'>) =>
    request<Student>('/api/students', { method: 'POST', body: JSON.stringify(body) }),
  attendance: () => request<AttendanceSession[]>('/api/attendance'),
  submitAttendance: (body: Record<string, unknown>) =>
    request<AttendanceSession>('/api/attendance', { method: 'POST', body: JSON.stringify(body) }),
  marks: () => request<Mark[]>('/api/marks'),
  submitMark: (body: Record<string, unknown>) =>
    request<Mark>('/api/marks', { method: 'POST', body: JSON.stringify(body) })
};

export async function queueOfflineOperation(path: string, body: Record<string, unknown>, ownerId: string) {
  const db = await offlineDb();
  await db.put('operations', {
    id: `${ownerId}:${String(body.clientUuid)}`, ownerId, path, body, createdAt: Date.now()
  } satisfies PendingOperation);
  const rows = await db.getAll('operations') as PendingOperation[];
  return rows.filter((row) => row.ownerId === ownerId).length;
}

export async function pendingOfflineCount(ownerId?: string) {
  const db = await offlineDb();
  if (!ownerId) return 0;
  const rows = await db.getAll('operations') as PendingOperation[];
  return rows.filter((row) => row.ownerId === ownerId).length;
}

export async function syncOfflineOperations(ownerId: string) {
  if (!navigator.onLine) return 0;
  const db = await offlineDb();
  const operations = (await db.getAll('operations') as PendingOperation[])
    .filter((operation) => operation.ownerId === ownerId);
  let synced = 0;
  for (const operation of operations) {
    try {
      await request(operation.path, { method: 'POST', body: JSON.stringify(operation.body) });
      await db.delete('operations', operation.id);
      synced += 1;
    } catch {
      break;
    }
  }
  return synced;
}

export function hasAccessToken() { return Boolean(accessToken); }
