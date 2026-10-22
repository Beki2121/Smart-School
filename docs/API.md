# API contract (initial implementation)

Base URL: `http://localhost:4000`. JSON API responses wrap success data in `{ "data": ... }`; failures use `{ "error": { "code": "...", "message": "...", "details": [] } }`. Operational routes require `Authorization: Bearer <accessToken>`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | Liveness and configured storage mode |
| POST | `/api/auth/login` | Public, rate-limited | Login by email/phone and password; returns access token and sets HTTP-only refresh cookie |
| POST | `/api/auth/refresh` | Refresh cookie | Rotates stored hashed refresh token and returns a new access token |
| POST | `/api/auth/logout` | Refresh cookie optional | Revokes refresh token and clears cookie |
| GET | `/api/auth/me` | `dashboard.view` | Current account |
| GET | `/api/dashboard` | `dashboard.view` | Active-campus counts and recent students |
| GET | `/api/school` | `school.view` | Active-campus profile |
| PUT | `/api/school` | `school.edit` | Update active-campus name, address and phone; audit recorded |
| GET | `/api/academic-year` | `school.view` | Current academic year for the active campus |
| GET | `/api/academic-years` | `school.view` | List active-campus academic years |
| POST | `/api/academic-years` | `school.edit` | Create a planned academic year; campus comes from the token |
| PATCH | `/api/academic-years/:yearId/activate` | `school.edit` | Activate a campus-owned year and close the previously active year |
| GET | `/api/terms` | `school.view` | List terms belonging to active-campus academic years |
| POST | `/api/terms` | `school.edit` | Add a term within the active academic year's date range |
| GET | `/api/grades` | `school.view` | List active-campus grade levels |
| POST | `/api/grades` | `school.edit` | Add a bilingual grade level |
| POST | `/api/sections` | `school.edit` | Add a section for a grade in the active academic year |
| GET | `/api/subjects` | `school.view` | List active-campus subjects |
| POST | `/api/subjects` | `school.edit` | Add a bilingual subject |
| GET | `/api/departments` | `staff.view` | Active-campus departments |
| POST | `/api/departments` | `staff.manage` | Create an active-campus department |
| GET | `/api/staff` | `staff.view` | Staff list, restricted to self or department based on role |
| POST | `/api/staff` | `staff.manage` | Create a staff profile and optionally link an existing campus user |
| GET | `/api/teaching-assignments` | `staff.view` | Active-campus assignments, filtered by staff visibility |
| POST | `/api/teaching-assignments` | `assignments.manage` | Assign teacher, subject, section and optional weekly period; timetable conflicts are rejected |
| PUT | `/api/sections/:sectionId/homeroom` | `assignments.manage` | Set or replace the section homeroom teacher |
| GET | `/api/staff/attendance` | `staff.attendance` | List visible staff attendance records |
| POST | `/api/staff/attendance` | `staff.attendance` | Record or update daily staff attendance; non-managers can only submit their own |
| GET | `/api/staff/attendance.csv` | `staff.manage` | Export staff attendance for external payroll processing (no payroll calculation) |
| GET | `/api/leave-requests` | `leave.request` | List own, departmental or campus leave requests according to role |
| POST | `/api/leave-requests` | `leave.request` | Submit a leave request; non-managers can only request for themselves |
| PATCH | `/api/leave-requests/:leaveId` | `leave.approve` | Approve/reject a pending campus leave request |
| GET | `/api/staff/messages` | `staff.messages` | Read campus-wide and own-department announcements/handover notes |
| POST | `/api/staff/messages` | `staff.manage` | Publish an internal staff announcement or handover note |
| GET | `/api/admissions/dashboard` | `admissions.view` | Active-campus admissions funnel counts by status and grade |
| GET | `/api/admissions/duplicates` | `admissions.view` | Check applicant name/date of birth and guardian phone against campus records |
| GET | `/api/admissions` | `admissions.view` | List/search active-campus admissions; supports `q` and `status` |
| POST | `/api/admissions` | `admissions.manage` | Create an enquiry for the active academic year and a campus grade |
| PUT | `/api/admissions/student-id-pattern` | `admissions.manage` | Set the campus student-number pattern using `{CAMPUS}`, `{YEAR}` and `{SEQ}` |
| POST | `/api/admissions/:admissionId/interview` | `admissions.manage` | Schedule or update an applicant interview |
| PATCH | `/api/admissions/:admissionId/status` | `admissions.manage` | Advance an enquiry/application through application, decision and waitlist states |
| POST | `/api/admissions/:admissionId/enrol` | `admissions.manage` | Enrol an accepted applicant after required documents and section-capacity checks |
| GET | `/api/admissions/:admissionId/documents` | `admissions.view` | List private applicant-document metadata |
| POST | `/api/admissions/:admissionId/documents` | `admissions.manage` | Upload a PDF/JPEG/PNG document (5 MB maximum; content signature checked) |
| GET | `/api/admissions/:admissionId/documents/:documentId` | `admissions.view` | Download a private campus-scoped admission document |
| GET | `/api/admissions/:admissionId/offer-letter` | `admissions.view` | Get printable HTML for an accepted applicant's offer letter |
| POST | `/api/students/:studentId/withdraw` | `admissions.manage` | Withdraw an enrolled student with a reason and status-history entry |
| POST | `/api/students/:studentId/readmit` | `admissions.manage` | Readmit a withdrawn student to a section in the active academic year |
| POST | `/api/students/:studentId/transfer-out` | `admissions.manage` | Transfer an enrolled student out with a reason and status-history entry |
| GET | `/api/students/:studentId/transfer-certificate` | `admissions.view` | Get printable HTML for a recorded transfer-out |
| GET | `/api/students` | `students.view` | Active-campus student list; teachers see assigned-class students only |
| GET | `/api/students/:studentId` | `students.view` | Read a student only if visible under campus/class scope |
| POST | `/api/students` | `students.edit` | Validate/create an active-campus student |
| GET | `/api/sections` | `attendance.view` | Current academic-year sections; teachers see assigned sections only |
| GET | `/api/attendance/sections/:sectionId/roster` | `attendance.view` | Current active roster for a visible section |
| GET | `/api/attendance` | `attendance.view` | Active-campus attendance sessions |
| POST | `/api/attendance` | `attendance.take` | Create attendance for currently enrolled students in an active-campus section; client UUID makes retries idempotent |
| GET | `/api/marks` | `marks.view` | Active-campus marks |
| POST | `/api/marks` | `marks.enter` | Create a bounded draft mark for an assigned class; client UUID makes retries idempotent |
| GET | `/api/marks/students/:studentId` | `marks.view` | Read marks visible to the caller for one student |

Academic-year creation produces a `planned` year. Activating a planned year closes the prior active year; this is audited. Terms can currently be added only to the active year and must fall within its Gregorian date boundaries. Organization and campus IDs are read from signed token claims; request-body campus IDs are not used. Routes, permissions and schemas remain incomplete for the full Release 1 inventory. This document is not a statement that all planned endpoints exist.

Staff scope is derived from the signed-in account's campus-linked staff profile: HR/directors can view campus staff, department heads are limited to their department, and other linked employees see their own profile, leave, and attendance. A staff profile can optionally link to one existing account; account provisioning/invitations are not implemented. Teacher access to student/attendance/marks routes is filtered by homeroom or teaching assignment. Timetable-period collisions are rejected; room/section clash checks require the full timetable module. Internal messages are in-app records, not SMS/email delivery.

Admissions records and documents are scoped to the authenticated active campus. Required documents are stored outside the public web root under `PRIVATE_DOCUMENTS_DIR` (default `.private/admissions`) with metadata and audit events in MySQL. Offer letters and transfer certificates are generated as printable HTML for browser print/save-as-PDF; PDF file generation is not implemented. Admissions are internal registrar workflows only; public online intake and guardian verification are deferred.
