# API contract (initial implementation)

Base URL: `http://localhost:4000`. JSON API responses wrap success data in `{ "data": ... }`; failures use `{ "error": { "code": "...", "message": "...", "details": [] } }`. Operational routes require `Authorization: Bearer <accessToken>`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | Liveness and configured storage mode |
| POST | `/api/auth/login` | Public, rate-limited | Login by email/phone and password; returns access token and sets HTTP-only refresh cookie |
| POST | `/api/auth/refresh` | Refresh cookie | Rotates stored hashed refresh token and returns a new access token |
| POST | `/api/auth/logout` | Refresh cookie optional | Revokes refresh token and clears cookie |
| POST | `/api/auth/switch-branch` | Authenticated member of the selected branch, rate-limited | Revoke the presented refresh token, issue a new branch-scoped token pair and cookie, and audit the switch |
| POST | `/api/auth/password/forgot` | Public, rate-limited | Request a generic-response reset email; reset tokens are random, hashed at rest, single-use, and expire after 30 minutes |
| POST | `/api/auth/password/reset` | Public, rate-limited | Consume a valid reset token, require matching 12+ character passwords, and revoke all access/refresh sessions |
| GET | `/api/auth/me` | `account.view` | Current account, including portal roles |
| POST | `/api/auth/password/change` | Authenticated account | Verify current password, set a new password, and clear the first-login requirement |
| GET | `/api/audit-log` | `audit.view` | Filtered, paginated audit events within the caller's organization and active campus; platform administrators can query across schools |
| GET | `/api/audit-log.csv` | `audit.view` | Export the matching filtered audit events as CSV |
| GET | `/api/login-history` | `audit.view` | Paginated login, failed-login and logout events in the caller's authorized scope |
| GET | `/api/audit-sessions` | `session.manage` | List unexpired, unrevoked sessions in the caller's organization and active campus; platform administrators can list across schools |
| DELETE | `/api/audit-sessions/:sessionId` | `session.manage` | Revoke a session and its refresh tokens; revocation blocks associated access tokens immediately. Revoking the current session signs the caller out |
| GET | `/api/accounts` | `accounts.manage` | List accounts belonging to the authenticated school organization |
| PATCH | `/api/accounts/:userId/status` | `accounts.manage` | Activate/deactivate an account in the authenticated organization; self-deactivation and deactivation of the final active school administrator are rejected, and status changes revoke all sessions |
| GET | `/api/roles` | `accounts.manage` | List global system roles, this school's custom roles, and the permission catalog |
| POST | `/api/roles` | `accounts.manage` | Create a school-scoped custom role; grants must be a subset of the caller's effective permissions |
| PUT | `/api/roles/:roleKey/permissions` | `accounts.manage` | Replace permissions on a custom role in the caller's school; system roles are read-only |
| PUT | `/api/accounts/:userId/role` | `accounts.manage` | Assign a system or school custom role to a same-school account; platform roles are refused, the final active school administrator cannot be demoted, and existing sessions are revoked |
| GET | `/api/accounts/:userId/permissions` | `accounts.manage` | Show effective permissions for a same-school account |
| GET | `/api/platform/users` | `platform.view` | List platform administrator accounts |
| POST | `/api/platform/users/invitations` | `platform.manage` | Create a password-less, 48-hour invitation for a platform administrator |
| PATCH | `/api/platform/users/:userId` | `platform.manage` | Edit a platform administrator's name or email |
| PATCH | `/api/platform/users/:userId/status` | `platform.manage` | Activate/deactivate a platform administrator; refuses to deactivate the last active administrator and revokes sessions |
| PUT | `/api/platform/users/:userId/role` | `platform.manage` | Assign the currently defined `super_admin` platform role |
| GET | `/api/auth/invitations/:token` | Public, rate-limited | Check a valid, unused account invitation |
| POST | `/api/auth/invitations/accept` | Public, rate-limited | Set a 12+ character password and activate a single-use invitation |
| POST | `/api/account-invitations` | `accounts.manage` | Create a 48-hour invitation for a staff member, enrolled student, or verified guardian; response includes the one-time share URL. Staff-role invitations are checked against the inviter allowlist; only an owner can invite a role with `accounts.manage` or `platform.manage`. A Principal can additionally invite a Registrar or HR Administrator in the active branch. Violations return `403 STAFF_ROLE_INVITATION_FORBIDDEN`. |
| POST | `/api/platform/schools` | `platform.manage` | Atomically create an organization, Main Branch, Starter trial, and password-less school-administrator invitation; returns the one-time invitation URL |
| POST | `/api/platform/schools/:organizationId/admin-invitation/regenerate` | `platform.manage` | Replace a pending school-administrator invitation and invalidate its previous link |
| GET | `/api/platform` | `platform.view` | Platform dashboard metrics, database reachability, school totals, subscription revenue/refunds, and storage usage |
| GET | `/api/platform/settings` | `platform.view` | Global locale, currency, date/calendar and SMTP settings; SMTP credentials are never returned |
| PUT | `/api/platform/settings` | `platform.manage` | Update global settings; SMTP passwords are encrypted at rest and responses expose configuration state only |
| GET | `/api/platform/reports/revenue.csv` | `platform.view` | Download subscription invoice/payment/refund totals as formula-safe CSV |
| GET | `/api/platform/reports/outstanding?from=:date&to=:date` | `platform.view` | List outstanding subscription invoices issued in the inclusive date range, with totals grouped by currency |
| GET | `/api/platform/reports/outstanding.csv?from=:date&to=:date` | `platform.view` | Download the filtered outstanding invoice rows and per-currency totals as formula-safe CSV |
| PUT | `/api/platform/schools/:organizationId/logo` | `platform.manage` | Upload a PNG, JPEG or WebP logo up to 2 MB for the specified school |
| GET | `/api/platform/schools/:organizationId/logo` | `platform.view` | Retrieve the specified school's uploaded logo |
| PUT | `/api/platform/subscription-plans/:code` | `platform.manage` | Create or update a plan, including billing cycle, user/storage quotas and modules; reductions below current usage are rejected |
| POST | `/api/platform/schools/:organizationId/invoices` | `platform.manage` | Create a manual subscription invoice |
| POST | `/api/platform/subscription-invoices/:invoiceId/payments` | `platform.manage` | Record a payment against an invoice; a fully paid invoice renews the subscription using its plan billing cycle |
| POST | `/api/platform/subscription-payments/:paymentId/refunds` | `platform.manage` | Record a partial or full refund up to the payment's remaining refundable amount |

Authentication uses one role per account. Runtime authorization reads the assigned permission records from the database; global system roles retain the seeded baseline matrix, while custom roles are scoped to one school. Custom role permissions are not cached so changes take effect on the next request across application instances; immutable system-role assignments use a short-lived cache. Role, permission, user-role, platform-user and account-status mutations are audited with before/after state in the actor's organization scope. Role changes and deactivation revoke the affected user's sessions. School administrators can grant only permissions they currently hold, cannot edit or delete system roles, and cannot grant platform permissions. The final active `owner_director` in a school cannot be deactivated or demoted. Platform-user management currently supports the only defined platform role, `super_admin`, and prevents deactivation of the final active administrator. Migration `202611020002_seed_role_permissions` seeds the existing system roles and assignments; `202611020003_platform_user_invitations` allows campus-less platform invitations. Password recovery requires an SMTP provider; configure the `SMTP_*` environment variables before production startup. Reset requests do not reveal whether an email belongs to an active account. Login, logout, reset, refresh, account activation and deactivation security events are audited without storing passwords or reset tokens. Audit events record request IP and user-agent metadata for login and failed-login events. `audit.view` and `session.manage` are available to platform administrators, school owners and system administrators only.
Branch switching is restricted to an active branch membership. It rotates and revokes the presented refresh token, replaces the refresh cookie and records an audit event. Access tokens for a deactivated branch are rejected immediately with `401 SESSION_CAMPUS_UNAVAILABLE`; they are not accepted until natural expiry.
| GET | `/api/dashboard` | `dashboard.view` | Active-campus counts and recent students |
| GET | `/api/portal/home` | `portal.view` | Own student record or verified guardian-linked students, recent attendance, locked results, explicitly permitted published report snapshots and fee summaries |
| GET | `/api/school` | `school.view` | Active-campus profile |
| PUT | `/api/school` | `school.edit` | Update active-campus name, address and phone; audit recorded |
| GET | `/api/school/branches` | `school.branches.manage` | List organization branches for an owner |
| POST | `/api/school/branches` | `school.branches.manage` | Create a branch subject to the subscription site limit; all school administrators receive membership |
| PATCH | `/api/school/branches/:branchId` | `school.branches.manage` | Update branch name or active status; the current branch cannot be deactivated |
| GET | `/api/academic-year` | `school.view` | Current academic year for the active campus |
| GET | `/api/academic-years` | `school.view` | List active-campus academic years |
| POST | `/api/academic-years` | `school.edit` | Create a planned academic year; campus comes from the token |
| PATCH | `/api/academic-years/:yearId/activate` | `school.edit` | Activate a campus-owned year and close the previously active year |
| GET | `/api/terms` | `school.view` | List terms belonging to active-campus academic years |
| POST | `/api/terms` | `school.edit` | Add a term or semester within the active academic year's date range |
| PATCH | `/api/terms/:termId/current` | `school.edit` | Set a term in the active academic year as current; clears the previous current term and audits the switch |
| GET | `/api/school-calendar?from=:date&to=:date` | `school.view` | List campus calendar events overlapping the optional Gregorian date range |
| POST | `/api/school-calendar` | `school.edit` | Add a bilingual holiday, event, exam, or closure; optional academic-year dates are range-checked |
| PUT | `/api/school-calendar/:entryId` | `school.edit` | Update a campus calendar entry |
| DELETE | `/api/school-calendar/:entryId` | `school.edit` | Delete a campus calendar entry |
| GET | `/api/curriculum/grades` | `school.view` | List the supported Grade 1–12 school levels |
| GET | `/api/grades` | `school.view` | List active-campus grade levels |
| POST | `/api/grades` | `school.edit` | Add a supported bilingual grade and seed editable grade-specific subject defaults |
| GET | `/api/grades/:gradeId/subjects` | `school.view` | List a grade's subject mappings, optionally filtered to a stream |
| PUT | `/api/grades/:gradeId/subjects` | `school.edit` | Replace grade subjects, stream assignments and weekly-period defaults |
| POST | `/api/sections` | `school.edit` | Add a section for a grade in the active academic year; Grades 11–12 require a Natural or Social Science stream |
| PATCH | `/api/sections/:sectionId/capacity` | `school.edit` | Update a section capacity; values below current active enrolment are rejected |
| GET | `/api/subjects` | `school.view` | List active-campus subjects |
| POST | `/api/subjects` | `school.edit` | Add a bilingual subject with a subject category |
| GET | `/api/curriculum/units?academicYearId=:id&gradeLevelId=:id&subjectId=:id` | `school.view` | List campus syllabus units by optional year, grade and subject |
| POST | `/api/curriculum/units` | `school.edit` | Add a bilingual syllabus unit mapped to a grade, subject, stream and academic year |
| PUT | `/api/curriculum/units/:unitId` | `school.edit` | Update a campus syllabus unit |
| DELETE | `/api/curriculum/units/:unitId` | `school.edit` | Delete an unreferenced syllabus unit |
| GET | `/api/lesson-plans?from=:date&to=:date&sectionId=:id` | `lesson_plans.view` | List lesson plans for assignments visible to the caller |
| POST | `/api/lesson-plans` | `lesson_plans.manage` | Create a bilingual plan for an active-year teaching assignment; linked units must match its grade and subject |
| PUT | `/api/lesson-plans/:lessonPlanId` | `lesson_plans.manage` | Update a planned lesson or mark it completed/cancelled; teacher scope is enforced |
| GET | `/api/promotion-rules` | `school.view` | List promotion criteria for the active academic year |
| PUT | `/api/grades/:gradeId/promotion-rule` | `school.edit` | Configure the minimum annual average and maximum failed required subjects for a grade |
| GET | `/api/students/:studentId/progression-eligibility` | `admissions.view` | Evaluate published prior-year results against the configured rule; missing rules/results block standard promotion |
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
| GET | `/api/admissions/public-link` | `admissions.manage` | Retrieve the active campus's public application link |
| GET | `/api/public/admissions/:token` | Public, rate-limited | Read the school identity for a campus-specific application link |
| POST | `/api/public/admissions/:token` | Public, rate-limited | Submit an application after required privacy consent; response is no-store |
| POST | `/api/admissions` | `admissions.manage` | Create an enquiry for the active academic year and a campus grade |
| PUT | `/api/admissions/student-id-pattern` | `admissions.manage` | Set the campus student-number pattern using `{CAMPUS}`, `{YEAR}` and `{SEQ}` |
| POST | `/api/admissions/:admissionId/interview` | `admissions.manage` | Schedule or update an applicant interview |
| PATCH | `/api/admissions/:admissionId/status` | `admissions.manage` | Advance an enquiry/application through application, decision and waitlist states |
| POST | `/api/admissions/:admissionId/enrol` | `admissions.manage` | Enrol an accepted applicant after required documents and section-capacity checks; returns one-time student login credentials |
| GET | `/api/admissions/:admissionId/documents` | `admissions.view` | List private applicant-document metadata |
| POST | `/api/admissions/:admissionId/documents` | `admissions.manage` | Upload a PDF/JPEG/PNG document (5 MB maximum; content signature checked) |
| GET | `/api/admissions/:admissionId/documents/:documentId` | `admissions.view` | Download a private campus-scoped admission document |
| GET | `/api/admissions/:admissionId/offer-letter` | `admissions.view` | Get printable HTML for an accepted applicant's offer letter |
| POST | `/api/students/:studentId/withdraw` | `admissions.manage` | Withdraw an enrolled student with a reason and status-history entry |
| POST | `/api/students/:studentId/readmit` | `admissions.manage` | Readmit a withdrawn student to a section in the active academic year |
| POST | `/api/students/:studentId/transfer-out` | `admissions.manage` | Transfer an enrolled student out with a reason and status-history entry |
| POST | `/api/students/:studentId/section-transfer` | `admissions.manage` | Transfer a student to another section in the active academic year with a reason and capacity check |
| GET | `/api/students/:studentId/section-transfers` | `students.view` | Read campus-scoped internal section-transfer history |
| GET | `/api/students/:studentId/documents` | `students.view` | List campus-scoped private student photo/document metadata |
| POST | `/api/students/:studentId/documents?type=:type&name=:name` | `students.edit` | Upload a PDF/JPEG/PNG document (5 MB maximum; content signature checked) |
| GET | `/api/students/:studentId/documents/:documentId` | `students.view` | Download a private campus-scoped student document |
| GET | `/api/students/:studentId/transfer-packages` | `admissions.view` | List transfer packets and their approval state |
| POST | `/api/students/:studentId/transfer-packages` | `admissions.manage` | Request a packet for a named receiving school, with guardian consent metadata and a consent-document reference |
| POST | `/api/students/:studentId/transfer-packages/:packageId/approve` | `students.transfer.approve` | Approve a consented packet and issue an expiring share link |
| GET | `/api/public/student-transfers/:token` | Public, rate-limited | Retrieve the approved, limited transfer packet through its expiring one-time link |
| GET | `/api/alumni` | `students.alumni.view` | List graduated students; restricted to school leadership, registrar, and system administrators |
| GET | `/api/students/:studentId/discipline` | `students.discipline.view` | Read restricted, audited student discipline records |
| POST | `/api/students/:studentId/discipline` | `students.discipline.manage` | Record an incident with encrypted details and action taken |
| GET | `/api/students/:studentId/enrolments` | `students.view` | List campus-scoped academic-year placements, outcomes, and dates; teachers must be assigned to the student's active section |
| POST | `/api/students/:studentId/progression` | `admissions.manage` | Record an audited promoted, repeated, or graduated outcome after an earlier enrolment is completed and a later academic year is active; destination sections are capacity-checked |
| GET | `/api/students/:studentId/transfer-certificate` | `admissions.view` | Get printable HTML for a recorded transfer-out |
| GET | `/api/students/:studentId/commendations` | `students.commendations.view` | List bilingual commendations for an active-campus student |
| POST | `/api/students/:studentId/commendations` | `students.commendations.manage` | Record an audited bilingual student commendation |
| GET | `/api/students` | `students.view` | Active-campus student list; teachers see assigned-class students only |
| POST | `/api/students/import/preview` | `students.edit` | Validate a UTF-8 CSV upload (maximum 1 MB / 600 records); reports field errors, campus/section conflicts, duplicate student identities, and non-blocking shared guardian-phone warnings without writing data |
| POST | `/api/students/import/commit` | `students.edit` | Revalidate and atomically import eligible CSV rows with student portal accounts; response is no-store and contains one-time credentials for secure office handoff |
| GET | `/api/students/:studentId` | `students.view` | Read a student only if visible under campus/class scope |
| GET | `/api/students/:studentId/sensitive-data` | `students.sensitive.view` | Explicitly reveal protected student fields; campus-scoped, no-store, and audited by field name only |
| PUT | `/api/students/:studentId/sensitive-data` | `students.sensitive.manage` | Encrypt and update student ID, health notes, learning-support notes and allergies; audit stores field names only |
| GET | `/api/students/:studentId/emergency-contacts` | `students.emergency.view` | Reveal ordered emergency contacts; names and phone numbers are encrypted at rest, response is no-store, and each view is audited |
| POST | `/api/students/:studentId/emergency-contacts` | `students.emergency.manage` | Add a protected emergency contact with a call priority from 1 to 10; audit omits the contact's name and phone |
| DELETE | `/api/students/:studentId/emergency-contacts/:contactId` | `students.emergency.manage` | Remove a campus-scoped emergency contact and audit the removal |
| POST | `/api/students` | `students.edit` | Create an enrolled student and linked login; returns one-time generated username and temporary password |
| PATCH | `/api/students/:studentId/guardians/:guardianId/access` | `students.guardians.manage` | Verify a linked guardian and explicitly grant results/fee visibility; grants are audited |

| GET | `/api/sections` | `attendance.view` | Current academic-year sections; teachers see assigned sections only |
| GET | `/api/attendance/sections/:sectionId/roster` | `attendance.view` | Current active roster for a visible section |
| GET | `/api/attendance` | `attendance.view` | Active-campus attendance sessions |
| GET | `/api/attendance/summary?from=:date&to=:date` | `attendance.view` | Summarize recorded attendance by status, section and date (maximum 367 calendar days; teacher assignments are enforced) |
| POST | `/api/attendance` | `attendance.take` | Create attendance for currently enrolled students in an active-campus section; client UUID makes retries idempotent |
| GET | `/api/attendance/sessions/:sessionId` | `attendance.view` | Read a session and its student status records within campus and assigned-section scope |
| PATCH | `/api/attendance/sessions/:sessionId/records/:studentId` | `attendance.edit` | Correct a record immediately within 24 hours after the attendance day ends; older corrections create a pending request and leave the record unchanged |
| GET | `/api/attendance/correction-requests` | `attendance.corrections.review` | List pending late corrections for the active campus |
| PATCH | `/api/attendance/correction-requests/:requestId` | `attendance.corrections.review` | Approve or reject a pending correction with a required review note; requesters cannot review their own requests |
| GET | `/api/marks` | `marks.view` | Active-campus marks |
| GET | `/api/marks/context` | `marks.view` | Terms and subjects available for mark entry at the active campus |
| GET | `/api/marks/summary?termId=:termId` | `marks.view` | Points-weighted provisional results by subject; all mark states, including drafts, are included and teacher sections are enforced |
| POST | `/api/marks` | `marks.enter` | Create a bounded draft mark for an assigned class; term and subject are required together for report-card results; client UUID makes retries idempotent |
| POST | `/api/marks/:markId/submit` | `marks.enter` | Submit a draft mark for academic review |
| POST | `/api/marks/:markId/approve` | `marks.approve` | Approve a submitted mark; the approving user must differ from its author |
| POST | `/api/marks/:markId/publish` | `marks.publish` | Lock and publish an approved mark to explicitly authorized student/guardian portals |
| POST | `/api/marks/:markId/amend` | `marks.amend` | Correct a published score with a required reason; returns it to draft and clears review attribution |
| GET | `/api/marks/students/:studentId` | `marks.view` | Read marks visible to the caller for one student |
| GET | `/api/grading/bands` | `marks.view` | Read the active campus's configured bilingual grade thresholds |
| PUT | `/api/grading/bands` | `school.edit` | Replace and audit the campus grading scale; thresholds must be unique and include 0% |
| GET | `/api/grading/policy` | `marks.view` | Read campus scoring method and school-approval confirmation status |
| PUT | `/api/grading/policy` | `school.edit` | Confirm a campus scoring method; requires a configured scale and is audited |
| GET | `/api/report-cards/students/:studentId?termId=:termId` | `marks.view` | Calculate a provisional term report card within student/campus/class scope using the campus scoring method |
| POST | `/api/report-cards/students/:studentId/drafts` | `marks.approve` | Create an immutable report revision after all linked marks are published and grading policy is confirmed; include `amendmentReason` (5–500 characters) when revising a previously published report |
| POST | `/api/report-cards/:reportId/submit` | `marks.approve` | Submit a report draft for a distinct approver |
| POST | `/api/report-cards/:reportId/approve` | `marks.approve` | Approve a submitted report; the approver must differ from its submitter |
| POST | `/api/report-cards/:reportId/publish` | `marks.publish` | Publish an approved report; publisher must differ from submitter and approver |
| GET | `/api/exam-types` | `exams.view` | List this organization's exam types and weights |
| POST | `/api/exam-types` | `exams.manage` | Create a school-scoped exam type with a weight (up to two decimal places) |
| PATCH | `/api/exam-types/:examTypeId` | `exams.manage` | Update a type's name, weight, or active status; weights cannot change once marks are open or exist in a term/grade/subject result context |
| GET | `/api/exams?termId=:termId` | `exams.view` | List campus exams; teachers see assigned sections, and students/verified guardians see only published schedules for their own or linked students |
| GET | `/api/exams/monitoring` | `exams.monitor` | Compare expected enrolled students with recorded marks for each exam |
| POST | `/api/exams` | `exams.manage` | Create a term/grade/subject/type exam; an empty `scheduleEntries` array creates an unscheduled draft, otherwise the exam is scheduled immediately |
| PATCH | `/api/exams/:examId` | `exams.manage` | Edit an exam before marks are submitted; after submission, use the existing mark correction workflow |
| POST | `/api/exams/:examId/schedule` | `exams.schedule.manage` | Add the first schedule entry to a draft or add an entry to a scheduled exam; draft transitions to scheduled |
| PUT | `/api/exams/:examId/schedule/:entryId` | `exams.schedule.manage` | Reschedule an entry before marks are submitted; conflict checks run under the campus lock. Rescheduling a published schedule or open exam returns it to scheduled so it must be republished |
| POST | `/api/exams/:examId/schedule/publish` | `exams.schedule.manage` | Publish a scheduled exam timetable to authorized students/guardians |
| POST | `/api/exams/:examId/marks/open` | `exams.schedule.manage` | Open mark entry after active exam types are configured for that term/grade/subject and their weights total exactly 100% |
| GET | `/api/fees/items` | `fees.view` | List active-campus fee items |
| POST | `/api/fees/items` | `fees.manage` | Create a bilingual fee item with amount and ISO 4217 currency code |
| PUT | `/api/fees/items/:itemId` | `fees.manage` | Update a fee item or deactivate it; existing invoice lines remain unchanged |
| GET | `/api/fees/invoices?studentId=:studentId` | `fees.view` | List active-campus invoices, optionally filtered to a student |
| POST | `/api/fees/invoices` | `fees.manage` | Issue an invoice for a student from active fee items; descriptions and amounts are snapshotted |
| POST | `/api/fees/invoices/:invoiceId/payments` | `fees.collect` | Record a manual cash, bank transfer, mobile money or other payment; returns a receipt number |
| GET | `/api/fees/receipts/:receiptNumber` | `fees.view` | Retrieve a campus-scoped receipt |
| POST | `/api/fees/payments/:paymentId/reversals` | `fees.reverse` | Append an auditable full or partial reversal with a reason |
| POST | `/api/fees/invoices/:invoiceId/void` | `fees.manage` | Void an unpaid invoice with a reason; invoices with payment history cannot be voided |
| GET | `/api/fees/shifts/current` | `fees.shifts` | Read the caller's active cashier shift |
| GET | `/api/fees/shifts` | `fees.shifts` | List recent campus cashier shifts; cashiers see only their own |
| POST | `/api/fees/shifts` | `fees.shifts` | Open a cashier shift with opening float and currency |
| POST | `/api/fees/shifts/:shiftId/close` | `fees.shifts` | Close the caller's open shift with counted cash; returns expected cash and variance |
| GET | `/api/fees/expenses?from=:date&to=:date` | `fees.expenses.view` | List recorded campus expenses in a date range |
| POST | `/api/fees/expenses` | `fees.expenses.manage` | Append a categorized expense to the caller's active shift |
| GET | `/api/fees/summary?from=:date&to=:date` | `fees.reports.view` | Summarize payments less reversals and expenses by currency (maximum 367 calendar days) |
| GET | `/api/communications/announcements` | `communications.view` | List published bilingual campus announcements |
| POST | `/api/communications/announcements` | `communications.manage` | Publish a bilingual campus-wide announcement immediately |
| GET | `/api/communications/events?from=:date&to=:date` | `communications.view` | List campus events overlapping the date range (defaults to today through the next year) |
| POST | `/api/communications/events` | `communications.manage` | Add a bilingual campus event with validated dates and optional times/location |
| GET | `/api/notifications` | `notifications.view` | List the caller's latest 50 active-campus notifications and unread count |
| PATCH | `/api/notifications/:notificationId/read` | `notifications.view` | Mark the caller's active-campus notification as read |

Student commendations are limited to campus leadership, counsellors and system administrators, and every new record is audited. These are positive recognition records only; incident reports, guardian meeting histories and counselling/welfare notes are not implemented by this endpoint.

Attendance summaries count recorded student-status rows in the requested inclusive date range. The attendance-rate denominator is present + absent + late; the numerator is present + late, so excused records are excluded. Empty denominators return a null rate. Counts reconcile to stored attendance records; only sections assigned to the requesting teacher are included.

Exam definitions and exam types are scoped to both organization and active campus. Exams are unique by campus, term, grade, subject, and exam type. Exams can begin as unscheduled drafts; adding the first schedule entry advances the draft to scheduled. Schedule dates must fall within the term. MySQL serializes additions and reschedules on the campus row inside the transaction; section, room, and invigilator overlaps return `EXAM_SCHEDULE_CONFLICT` with clashing entries. Rescheduling a published schedule or marks-open exam resets it to scheduled and clears its publication timestamp, so parents and students see no schedule for that exam until it is republished; republishing exposes the updated schedule. Submitted or approved marks lock schedule changes. The server only publishes a scheduled exam with entries and only opens marks for a schedule-published exam. Submitted, reviewed, approved, and published exam states are derived from the existing mark submission, approval, and publication workflow; invalid mark transitions are rejected by that workflow. A configured weight set must include every active exam type and total exactly 10,000 basis points (100%) before marks open; otherwise `EXAM_WEIGHTS_INVALID` reports the configured types and total. Weight changes are rejected once any exam in an affected term/grade/subject result context is open for marks or has marks, preserving the in-progress weight rule and published result basis. Scores and weighted contributions use integer basis points, rounding half-up at each conversion/contribution. Historical marks are grouped by campus, term (including null), inferred grade (including null), and subject (including null) into `Legacy` exams; marks without enough academic context remain in the corresponding null-context group. Scores and academic context are preserved, and `exam_id` is made non-null after the backfill.

New marks may include `examId`; the selected exam supplies its title, term, subject, and maximum mark, and must be open for marks. Calls that omit `examId` retain compatibility by linking the mark to a campus-scoped `Legacy` exam. Mark monitoring counts active enrolments in each scheduled section. Marks-due notices go to assigned subject teachers and invigilators; published-results notices go to the scheduled students and verified guardians with result access. A unique exam/recipient/type key prevents duplicate notices.

Publishing an announcement or creating an event creates an in-app notification for active campus users whose role can view communications. Notification records and read state are private to the recipient and active campus. No SMS or email is sent.

Academic-year creation produces a `planned` year. Activating a planned year closes the prior active year; this is audited. Terms can currently be added only to the active year and must fall within its Gregorian date boundaries. Organization and campus IDs are read from signed token claims; request-body campus IDs are not used. Routes, permissions and schemas remain incomplete for the full Release 1 inventory. This document is not a statement that all planned endpoints exist.

When an academic year is closed by activating its successor, active enrolments from that year become completed without an outcome. A registrar must record each student's school-approved progression decision through the progression endpoint; promotion, repetition, and graduation are never inferred from marks. Graduation updates the student status and completes the previous enrolment without creating a destination-year enrolment.

Report-card subject percentages use total earned points divided by total possible points. The campus may calculate its overall term percentage either by pooling points across subjects or by giving each subject equal weight. Grade bands are campus-wide minimum percentage thresholds shared by all grades; a starter scale is seeded when the first grade is created and may be edited by the campus. Editing bands invalidates the grading-policy confirmation. A school administrator must explicitly confirm the configured scale and scoring method. Provisional previews remain available; an immutable report snapshot can move through draft → submitted → approved → published only after all linked marks are locked. Approval and publication require separate users, and any grading-policy or source-mark change makes an older draft ineligible for transition. Creating a revision after a published report requires a 5–500 character reason, stored with that revision and in the audit event; the prior published revision remains unchanged, and the new revision must pass the complete review and publication workflow. Published marks can only be corrected by authorized campus leadership with a reason; the correction resets the mark to draft and clears approval/publication attribution, so it must pass review and publication again. Term summaries remain provisional and include all mark states. Mark workflow transitions are one-way: draft → submitted → approved → locked/published; the author cannot approve a mark, and its approver cannot publish it. Only locked marks appear in student/guardian result feeds. Existing marks without term/subject links remain readable but are excluded from report cards.

Attendance corrections require a new status and a reason of at least three characters. Corrections update the current record but preserve before/after status and reason in the append-only audit log. Teachers can inspect or correct records only for assigned sections; authorized leadership roles follow campus scope. Verified guardians and students can see a limited recent attendance feed for only their linked/own student records; absence notifications are not sent because no delivery provider is connected.

Student CSV imports use UTF-8 with a header row. Required headers are `studentNo`, `givenNameAm`, `fatherNameAm`, `grandfatherNameAm`, `givenNameEn`, `fatherNameEn`, `grandfatherNameEn`, `gender`, and `sectionName`. Optional headers are `dateOfBirth` (Gregorian `YYYY-MM-DD`), `guardianPhone`, and `previousSchool`. `sectionName` must resolve to one active section in the token-scoped campus/year. Invalid rows are skipped; repeated student IDs and exact name/date-of-birth matches are errors, while a shared guardian phone is a warning so siblings can be imported. Importing creates the same first-login student accounts as manual registration; temporary credentials are returned only once and must be saved securely by the school office.

Public admissions links are campus-specific and can be retrieved by authorized admissions staff. Applicants submit through the public link with affirmative privacy consent; requests are rate-limited and responses are not cached. Student photos and documents, including guardian transfer-consent files, are signature-checked, limited to 5 MB, and stored outside the public web root under `PRIVATE_DOCUMENTS_DIR`; only authorized campus staff can list or retrieve them. Allergy information uses the protected encrypted student-data workflow and is not included in ordinary student profile responses.

Internal section transfers are recorded with a reason and checked against destination capacity. Cross-school transfer packets require guardian consent metadata and a stored consent document before leadership approval. The approved packet is limited to student demographics, guardian/consent metadata, and academic history; its random share token is stored hashed and expires after 72 hours. Reissuing approval replaces the previous token. The receiving school can view the packet from the share link, but automated receiving-school import is not implemented. Printable student ID cards are available in the student-management UI; the current card layout does not embed the student's uploaded photo.

The school curriculum catalog supports Grades 1–12 only. Kindergarten, college, university and higher-education campus structures are outside the product scope. Creating a grade copies an editable starter subject set and weekly-period values into that school's tenant; sections in Grades 11–12 must select Natural Science or Social Science. The bilingual subject labels and periods are not certified as the current federal or regional curriculum; schools should verify them against the applicable education-authority guidance.

The term-results summary uses the same points-weighted formula, groups linked marks by subject, and reports distinct students and assessment counts. It includes all states (including drafts), is explicitly provisional, validates the requested term against the active campus, and applies teacher assigned-section scope. Empty result sets have a null percentage.

Academic-year, term, school-calendar, syllabus and lesson-plan dates are stored and exchanged as Gregorian ISO `YYYY-MM-DD` dates. The School Setup screen shows converted Ethiopian calendar dates alongside Gregorian dates, while date entry remains the browser's Gregorian date input; Ethiopian year labels are entered separately. Promotion eligibility is advisory and requires every term report and required-subject result for the completed prior year. A configured rule never makes the final student outcome automatic: an authorized registrar records a reasoned promotion, repetition or graduation decision, with leadership override rules enforced and audited. Timetable periods and classroom assignments remain part of the timetable workflow.

The attendance and term-results summary screens can export their currently loaded, access-scoped data as CSV. Exports include UTF-8 BOM for spreadsheet compatibility and neutralize formula-like text cells.

Staff scope is derived from the signed-in account's campus-linked staff profile: HR/directors and principals/registrars can view campus staff for their operational and account-invitation duties, department heads are limited to their department for staff operations, and other linked employees see their own profile, leave, and attendance. Staff accounts are activated by a single-use invitation that links the new login to the existing staff record. Owner invitations can assign any supported staff role except `owner_director`; other roles are constrained by a server-side least-privilege allowlist, and only owners may invite roles that have `accounts.manage` or `platform.manage`. Student accounts are created automatically when a student record is created or an accepted applicant is enrolled. The system returns a name/student-number-based username and a cryptographically random temporary password once; staff should provide those credentials privately through the school office. The password is stored only as a hash, and the student cannot access any portal data until changing it. Student usernames are also stored uniquely and can be used in the normal login field. Guardian invitations require a school-verified linked record and the email on that record. Invitation tokens are stored hashed, expire after 48 hours, and are not sent by email; an authorized administrator must share the generated URL securely. Guardians see only verified linked students and receive results/fee visibility only when each permission is explicitly granted. Students see their own profile and locked marks. Teacher access to student/attendance/marks routes is filtered by homeroom or teaching assignment. Timetable-period collisions are rejected; room/section clash checks require the full timetable module. Internal messages are in-app records, not SMS/email delivery.

Admissions records and documents are scoped to the authenticated active campus. Required documents are stored outside the public web root under `PRIVATE_DOCUMENTS_DIR` (default `.private/admissions`) with metadata and audit events in MySQL. Offer letters and transfer certificates are generated as printable HTML for browser print/save-as-PDF; PDF file generation is not implemented. Staff manage the admissions queue internally, and applicants can submit through the school's campus-specific public link.

Fee items and invoices are campus-scoped. Invoice lines retain bilingual descriptions and prices from issue time. Every new payment, reversal, or expense requires the caller's open cashier shift, whose currency must match the transaction. Opening/closing shifts and financial writes are audited; shift close calculates expected cash as opening float plus cash payments, less cash reversals and cash expenses. Closed shifts cannot be changed. Expenses are append-only; bank transfer and mobile money entries require a reference. Existing invoice/payment calculations remain unchanged.

WP5 adds the following campus- and organization-scoped finance routes. New workflow amounts use integer minor units; percentage calculations round half-up at each invoice line. A structure total is the exact sum of its installment minor-unit amounts, so no remainder is lost to rounding. Refund requests cannot exceed the remaining payment amount, and an invoice cannot be reduced below zero.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET/POST | `/api/fees/structures` | `fees.structure.manage` | List or create academic-year/grade fee structures with installments |
| GET | `/api/fees/structures/:structureId/preview?sectionId=:sectionId` | `fees.structure.manage` | Preview eligible students and invoice generation before committing |
| POST | `/api/fees/structures/:structureId/generate` | `fees.structure.manage` | Generate invoices idempotently using an idempotency key; existing invoices are not duplicated |
| GET/POST | `/api/fees/discount-types` | `fees.discount.request` | List or configure percentage/fixed discount categories |
| GET/POST | `/api/fees/discount-requests` | `fees.reports.view` / `fees.discount.request` | List requests or request a student/period discount |
| PATCH | `/api/fees/discount-requests/:requestId` | `fees.discount.approve` | Approve or reject a discount; requester self-approval is refused |
| GET/POST | `/api/fees/refund-requests` | `fees.reports.view` / `fees.refund.request` | List or request a reasoned refund against an original payment |
| PATCH | `/api/fees/refund-requests/:requestId` | `fees.refund.approve` | Approve or reject a refund; requester self-approval is refused |
| GET/POST | `/api/fees/adjustment-requests` | `fees.reports.view` / `fees.adjustment.request` | List or request an explicit credit/debit adjustment with a reason |
| PATCH | `/api/fees/adjustment-requests/:requestId` | `fees.adjustment.approve` | Approve or reject an adjustment |
| GET | `/api/fees/arrears?asOf=:date` | `fees.arrears.view` | List outstanding invoices in current, 1–30, 31–60, 61–90, and over-90-day buckets |
| GET | `/api/fees/arrears.csv?asOf=:date` | `fees.arrears.view` | Export formula-safe arrears rows as CSV |
| POST | `/api/fees/invoices/:invoiceId/followups` | `fees.arrears.view` | Record an arrears follow-up note and optional next-contact date |
| GET | `/api/fees/students/:studentId/statement` | `fees.reports.view` | Read a scoped student statement |
| GET | `/api/fees/portal/invoices` | `fees.portal.view` | List only the caller's or linked children's invoices |
| GET | `/api/fees/portal/students/:studentId/statement` | `fees.portal.view` | Read a statement only for the caller's own or linked student |
| GET | `/api/fees/reports?type=:type&from=:date&to=:date[&format=csv]` | `fees.reports.view` | Date-filtered finance report; CSV exports neutralize spreadsheet formulas |
| GET | `/api/fees/dashboard` | `fees.reports.view` | Read today's collections, overdue count, and outstanding amounts by currency |
| GET/POST | `/api/fees/cashbook/accounts` | `fees.cashbook.manage` | List balances or create an idempotent campus cash/bank account with an idempotency key |
| POST | `/api/fees/cashbook/accounts/:accountId/deposits` | `fees.cashbook.manage` | Record an idempotent deposit |
| POST | `/api/fees/cashbook/transfers` | `fees.cashbook.manage` | Transfer between same-currency accounts atomically |
| GET | `/api/fees/cashbook/entries?accountId=:id&from=:date&to=:date` | `fees.cashbook.manage` | List scoped cashbook entries |
| POST | `/api/fees/cashbook/accounts/:accountId/reconciliations` | `fees.cashbook.manage` | Reconcile through a statement date and record the balance difference |
| POST | `/api/fees/cashbook/entries/:entryId/reversals` | `fees.cashbook.manage` | Append an audited reversal; reconciled entries are otherwise locked |

New finance permissions are `fees.structure.manage`, `fees.discount.request`, `fees.discount.approve`, `fees.refund.request`, `fees.refund.approve`, `fees.adjustment.request`, `fees.adjustment.approve`, `fees.arrears.view`, and `fees.cashbook.manage`. Approval permissions are principal-only; parent/student roles receive only `fees.portal.view`. The permissions are seeded by `202611030006_wp5_finance_permissions` and mirrored in the runtime defaults. Money-changing writes are transactional and audited with before/after state in organization/campus scope. MySQL locks affected invoices/payments/accounts; transfer entries are committed atomically. Legacy finance scope is backfilled without changing stored amounts or balances. The finance UI offers CSV export and browser print. Bank-statement import/matching and payment gateways are not implemented.

## WP6 — assignments and homework

Assignment and submission operations are scoped to the caller's organization and active campus. Teachers can manage only assignments for sections and subjects in their teaching assignments. Students see and submit only for their own active enrolments; parents can read assignments and submission status for verified linked children. Submissions are unique per assignment/student and are updated on resubmission; the server computes `isLate` from the due date. Submissions are accepted only while the assignment is published. Attachment uploads are limited to 5 MB, signature-validated, stored privately by organization/campus, and counted against the WP3 storage quota. Assignment events and submission changes are audited; notifications are deduplicated by recipient and source.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/assignments` | `assignments.manage` or `assignments.view` | List non-archived assignments in the active campus and permitted teacher scope |
| POST | `/api/assignments` | `assignments.manage` | Create a draft assignment |
| PATCH | `/api/assignments/:assignmentId` | `assignments.manage` | Edit a draft assignment |
| POST | `/api/assignments/:assignmentId/status` | `assignments.manage` | Publish, close, or archive an assignment subject to valid state transitions |
| POST | `/api/assignments/:assignmentId/attachments` | `assignments.manage` | Upload a private assignment attachment while the assignment is a draft |
| GET | `/api/assignments/:assignmentId/submissions` | `assignments.manage` | List submissions for the assigned class and subject |
| PATCH | `/api/assignments/:assignmentId/submissions/:submissionId/grade` | `assignments.manage` | Grade a submission and provide feedback |
| GET | `/api/assignments/attachments/:attachmentId` | `assignments.manage` or `assignments.view` | Download an attachment after scoped authorization |
| GET | `/api/portal/assignments` | `assignments.submit` or `assignments.view_child` | List the caller's assignments or linked children's assignments |
| PUT | `/api/portal/assignments/:assignmentId/submission` | `assignments.submit` | Submit or resubmit text before the assignment closes |
| POST | `/api/portal/assignments/:assignmentId/attachments` | `assignments.submit` | Upload a submission attachment |
| GET | `/api/portal/assignment-attachments/:attachmentId` | `assignments.submit` or `assignments.view_child` | Download an attachment belonging to the caller or linked child |

Migration `202611030008_wp6_assignments` creates tenant-scoped assignment, submission, and attachment metadata tables without a legacy-data backfill. Migration `202611030009_wp6_assignments_permissions` seeds `assignments.manage`, `assignments.view`, `assignments.submit`, and `assignments.view_child`; the same permissions are enforced by the API and gated through the existing `academic_setup` module.

Campus announcements and events are bilingual, campus-scoped, visible to authorized signed-in campus users and audited on publication/creation. Announcements are published immediately and are not editable; events are listed when their date range overlaps the requested period. These are in-app records only. SMS/email providers, consent/preferences, delivery outbox/retries and push notifications are not implemented.

## WP7 — reports center and role dashboards

Reports are defined in one catalog with category, filters, columns, role scope, CSV and print metadata. Requests are scoped to the caller's organization and active campus; teacher academic data is additionally limited to assigned sections. Results are paginated (default 50, maximum 100 per page); CSV export is bounded and neutralizes spreadsheet formulas. Common filters are academic year, term, grade, section, and date range. Export requests are audited; report and dashboard reads are otherwise read-only.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/reports/catalog` | Any `reports.*.view` permission | List reports available to the caller's role and permissions |
| GET | `/api/reports/filters` | Any `reports.*.view` permission | Get scoped year, term, grade and section filter options |
| GET | `/api/reports/:reportId?year=:id&term=:id&grade=:id&section=:id&from=:date&to=:date&page=:n&pageSize=:n` | Report category permission | Read a paginated, role-scoped report |
| GET | `/api/reports/:reportId.csv?year=:id&term=:id&grade=:id&section=:id&from=:date&to=:date` | Report category permission | Export a formula-safe CSV report |
| GET | `/api/dashboard` | `dashboard.view` | Read role-specific dashboard metrics and shortcuts, including teacher-scoped class data and WP1 failed-login alerts for school IT |

Report IDs include `student-directory`, `admissions-enrolment`, `attendance-class`, `attendance-student`, `attendance-trend`, `academic-pass-rates`, `subject-performance`, `class-comparison`, `student-progress`, `finance-collection`, `finance-arrears`, `hr-employees`, `hr-leave`, `hr-staff-attendance`, `syllabus-coverage`, `teacher-workload`, `my-classes`, and `operations-placeholder`. The HR reports provide employee statistics, leave records, and staff attendance; they use the shared filters, pagination, CSV export and print metadata. CSV export neutralizes formula-leading cells and is audited. Finance reports reuse the WP5 finance data. Syllabus coverage is based on completed lesson plans; teacher workload reports assigned classes and timetable periods and flags counts above the requested workload limit. The HR placeholder has been removed; operations remains a catalog placeholder. Student Progress is the academic progress report, not a separate notes workflow.

Migration `202611030011_wp7_reports_permissions` seeds `reports.students.view`, `reports.admissions.view`, `reports.attendance.view`, `reports.academics.view`, `reports.finance.view`, `reports.hr.view`, and `reports.operations.view` for their configured school roles. No WP7 report tables or business-data backfills are introduced.

## WP8 — portal extensions and parent-teacher communication

Portal calendar data is scoped to the caller's active organization and campus. Students see their own section; parents see only sections of verified linked children. School- and class-audience announcements/events are supported. Timetable reads use those same sections. Parent requests are linked to a verified child; students can submit profile-update requests and academic/technical support requests. Office roles handle requests using explicit status transitions. Parent-teacher threads require a verified parent link and an active teaching assignment, are limited to participants (or authorized moderators), and are denied whenever school messaging is disabled. Messages have a 4,000-character limit; request/support inputs are validated and length-limited. Requests, status changes, messages, moderation, event changes, and messaging-setting changes are audited; notifications are created for requests, status changes, events, announcements, and messages.

The current communications forms publish school-wide announcements/events only; class-targeted audience and section values are accepted by the API but do not yet have form controls. Parent-teacher messages are text-only in this phase; there is no message-attachment upload endpoint or attachment size limit.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/portal/calendar?from=:date&to=:date` | `portal.calendar.view` | Read scoped announcements, events, linked-child/own timetable, and section data |
| GET, POST | `/api/portal/requests` | `portal.requests.view` / `portal.requests.create` | Read own requests or create absence, document, or profile-update requests |
| PATCH | `/api/portal/requests/:requestId/status` | `portal.requests.manage` | Approve/reject pending requests or complete approved requests |
| GET, POST | `/api/portal/support` | `portal.support.view` / `portal.support.create` | Read own/assigned support requests or create a student support request |
| PATCH | `/api/portal/support/:requestId` | `portal.support.manage` | Advance a support request through its status workflow |
| GET, POST | `/api/portal/messages/threads` | `portal.messaging.view` / `portal.messaging.send` | List permitted inbox threads or open/reuse a scoped teacher-parent thread and send its first message |
| POST | `/api/portal/messages/threads/:threadId/messages` | `portal.messaging.send` | Send a message in an open participant thread |
| PATCH | `/api/portal/messages/threads/:threadId/read` | `portal.messaging.view` | Update the caller's read state |
| PATCH | `/api/portal/messages/:messageId/moderation` | `portal.messaging.moderate` | Archive or restore a message with an audited reason |
| GET, PUT | `/api/school/messaging-settings` | `portal.messaging.configure` | Read or change the organization messaging-enabled setting |
| PATCH | `/api/communications/events/:eventId/status` | `communications.manage` | Publish, cancel, or archive an event through valid transitions |
| GET, PATCH | `/api/notifications`, `/api/notifications/:notificationId/read` | `notifications.view` | Read or mark read the caller's own notification inbox |

Forward-only migrations `202611030012_wp8_portal_communication` and `202611030013_wp8_portal_permissions` add the scoped request/support/thread/message structures, class-audience fields, event status, messaging setting, and portal permissions. `202611030014_wp8_portal_notifications` extends notification access to students and parents. The data backfill only fills missing `organization_id` values on existing campus announcements/events from their campus; it does not change content or timestamps. It also explicitly removes MySQL's implicit `ON UPDATE CURRENT_TIMESTAMP` behavior from `campus_events.updated_at`. New WP8 tables use explicit timestamp defaults/nullability and the existing `utf8mb4_general_ci` collation.

Timestamp scan: committed migrations using `table.timestamps(true, true)` remain unchanged and may have MySQL-managed `updated_at` columns: `202610220001_initial_core`, `202610220002_staff`, `202610220003_admissions`, `202610220004_timetable`, `202610220005_grading`, `202610220006_fees`, `202610220008_cashier_finance`, `202610220009_communications`, `202610230001_account_invitations`, `202610230004_student_emergency_contacts`, `202610230005_grading_policy`, `202610230006_term_report_workflow`, `202610290001_attendance_correction_approvals`, `202610290003_saas_platform`, `202610290007_sis_completion`, `202610300001_academic_planning`, `202611030001_platform_dashboard_quotas`, `202611030004_wp4_exams`, `202611030005_wp5_finance`, and `202611030008_wp6_assignments`. No unrelated committed timestamp definitions were changed. WP6 also has required `due_at` and `submitted_at` columns without defaults, which are event times written explicitly by the assignment workflow.

Verification on the local MySQL test database: the WP8 scope backfill was retried and preserved announcement/event content and timestamps; existing balances/content were not rewritten. The shared adapter contract suite passed 64 tests with 0 failures and 2 existing conditional skips, API tests passed 92/92, and frontend tests passed 51/51. Lint, production build, route parity (287/287), and `git diff --check` passed. Browser behavior has not been manually verified.

## WP9 — HR completion

HR endpoints are under `/api/hr`, gated by the staff module and the specific HR permission listed below. Operations are scoped to both the caller's organization and active campus. New private documents are limited to PDF/JPEG/PNG, 5 MiB, use per-school private storage, enforce the WP3 storage quota, and audit upload, access, and download. Staff archive retains associated documents. Staff CSV import accepts at most 600 rows and 1 MiB; preview reports row validation and duplicates before commit.

| Method | Path | Access | Purpose |
|---|---|---|---|
| PATCH, POST | `/api/hr/staff/:staffId`, `/api/hr/staff/:staffId/archive` | `hr.staff.manage`, `hr.staff.archive` | Edit or retain/archive a staff profile |
| POST | `/api/hr/staff/import/preview`, `/api/hr/staff/import/commit` | `hr.staff.import` | Validate CSV rows, then import eligible rows |
| GET, POST | `/api/hr/staff/:staffId/documents`, `/api/hr/staff/:staffId/documents/:documentId` | `hr.documents.view`, `hr.documents.manage` | List/download or upload staff documents |
| GET, POST | `/api/hr/contracts`, `/api/hr/staff/:staffId/contracts` | `hr.contracts.view`, `hr.contracts.manage` | List and create non-overlapping staff contracts |
| GET, POST | `/api/hr/contracts/:contractId/renewals`, `/api/hr/contracts/:contractId/renewals` | `hr.contracts.view`, `hr.contracts.manage` | Read audited renewal history or renew an active contract |
| GET, POST | `/api/hr/leave-types`, `/api/hr/leave-balances` | `hr.leave.view`, `hr.leave.configure`, `hr.leave.balance.manage` | Configure leave types and set/read half-day balances |
| GET, POST | `/api/hr/vacancies`, `/api/hr/vacancies/:vacancyId/applicants` | `hr.recruitment.view`, `hr.recruitment.manage` | List/create vacancies and add applicants |
| GET, POST, PATCH | `/api/hr/applicants`, `/api/hr/applicants/:applicantId/interviews`, `/api/hr/applicants/:applicantId/decision` | `hr.recruitment.view`, `hr.recruitment.manage` | Review applicants, schedule interviews, shortlist/reject/hire |
| GET, POST | `/api/hr/applicants/:applicantId/documents` and document download path | `hr.recruitment.view`, `hr.recruitment.manage` | List/download or upload applicant documents |
| GET, POST | `/api/hr/performance/cycles`, `/api/hr/performance/goals`, `/api/hr/performance/evaluations` | `hr.performance.view`, `hr.performance.manage` | Create/read review cycles, goals and evaluations |
| GET, POST, PATCH | `/api/hr/training/courses`, `/api/hr/training/courses/:courseId/enrollments`, `/api/hr/training/enrollments/:enrollmentId/attendance` | `hr.training.view`, `hr.training.manage` | Manage courses, enrollments, attendance and certificates |
| GET, PUT | `/api/hr/training/enrollments/:enrollmentId/certificate` | `hr.training.view`, `hr.training.manage` | Download/upload a training certificate |
| GET | `/api/hr/dashboard` | `hr.dashboard.view` | Read active staff, pending leave, and contracts expiring within 30 days |

Migration `202611030015_wp9_hr_foundation` adds `staff.organization_id`, backfills it from each staff record's campus, adds its tenant index, and creates `staff_documents`; it does not alter staff amounts or delete staff records. Migration `202611030016_wp9_hr_permissions` seeds role permissions. Migration `202611030017_wp9_hr_contracts_leave` creates contract, renewal, leave-type, and leave-balance tables; it backfills `leave_requests.organization_id` from campus and adds `leave_type_id` and `requested_half_days` with legacy-safe defaults. Migration `202611030018_wp9_hr_programs` creates recruitment, performance, and training tables. Migration `202611030019_wp9_hr_dashboard_permission` seeds the dashboard permission. These are forward-only migrations; new HR timestamps are explicitly defined without implicit MySQL `ON UPDATE` behavior. Existing committed migrations using `table.timestamps(true, true)` remain unchanged (see the timestamp scan above).

The phrase “lease/tenant awareness” used in an earlier progress note was inaccurate: WP9 adds no lease-related entity or billing behavior. The intended wording is “leave and tenant scoping/backfill”; the tenant backfills derive `organization_id` from an existing campus relationship.

### Stable payroll-facing HR repository reads

WP10 must use these tenant-scoped repository methods rather than reimplementing HR calculations:

| Method | Inputs | Output and rules |
|---|---|---|
| `listHrLeaveBalances(actor, staffId?)` | Actor scope and optional staff UUID | Rows include `staffId`, `leaveTypeId`, `year`, `entitledHalfDays`, `carryOverHalfDays`, `usedHalfDays`, and nonnegative `remainingHalfDays`; values are integer half-days. |
| `getApprovedHrLeaveForPeriod(staffId, from, to, actor)` | Staff UUID, inclusive ISO date range, actor scope | Approved overlapping requests only, with `kind` (`annual`, `sick`, or `unpaid`), date bounds, and `requestedHalfDays`. Payroll distinguishes unpaid leave by `kind === 'unpaid'`. |
| `listHrContracts(actor, staffId?)` | Actor scope and optional staff UUID | Active/history rows include `contractType`, `startsOn`, `endsOn`, `renewalDueOn`, and `status`; renewal changes `endsOn` and appends a renewal-history row without rewriting start date. |
| `getStaffAttendanceForPeriod(staffId, from, to, actor)` | Staff UUID, inclusive ISO date range, actor scope | Attendance rows include `date`, `status`, `clockIn`, and `clockOut`. |

The same methods and output shapes are implemented by the memory and MySQL adapters and covered by shared repository contracts. Annual leave proration uses half-day units, inclusive calendar days from the hire date through year-end, and rounds down with `Math.floor`; the year length uses the Gregorian leap-year calendar. Payroll should consume these outputs as inputs and preserve their integer/date semantics.

## WP10 — payroll

Payroll is gated by the subscription plan's `payroll` module and by route-level permissions. All data is scoped to the authenticated organization and active campus. Salary amounts are integer minor units; percentage and bracket calculations use integer arithmetic and round half-up to the nearest minor unit at each line component. Payroll periods use the organization's configured currency, and each salary structure must use that same currency.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/payroll/dashboard` | `payroll.run.view` | Current payroll period counts and gross, net, approval, and payment status by currency |
| GET, POST | `/api/payroll/rules` | `payroll.structures.view`, `payroll.structures.manage` | List or create organization-configured flat-rate or progressive tax/pension rules |
| GET, POST, PATCH | `/api/payroll/structures`, `/api/payroll/structures/:structureId` | `payroll.structures.view`, `payroll.structures.manage` | List/create dated staff salary structures and update/archive a structure |
| GET, POST | `/api/payroll/periods` | `payroll.run.view`, `payroll.periods.manage` | List or create a one-calendar-month payroll period |
| POST | `/api/payroll/periods/:periodId/open` | `payroll.periods.manage` | Open a draft period |
| GET | `/api/payroll/periods/:periodId/inputs` | `payroll.run.view` | Read period inputs |
| POST | `/api/payroll/periods/:periodId/inputs/load` | `payroll.inputs.manage` | Load WP9 attendance and approved leave through the stable HR repository methods |
| PUT | `/api/payroll/periods/:periodId/inputs/:staffId` | `payroll.inputs.manage` | Update attendance days, overtime, bonus, and reasoned adjustments while the period is open |
| POST | `/api/payroll/periods/:periodId/adjustments` | `payroll.inputs.manage` | Record an audited adjustment; corrections can reference a locked line from an earlier period |
| POST | `/api/payroll/periods/:periodId/runs` | `payroll.run.calculate` | Create the period's idempotent run |
| GET, POST | `/api/payroll/runs/:runId`, `/api/payroll/runs/:runId/calculate` | `payroll.run.view`, `payroll.run.calculate` | Read or deterministically calculate/recalculate an unlocked run |
| POST | `/api/payroll/runs/:runId/submit` | `payroll.run.submit` | Submit a calculated run for approval |
| POST | `/api/payroll/runs/:runId/approve`, `/api/payroll/runs/:runId/reject` | `payroll.run.approve` | Approve or reject; the preparer cannot review their own run |
| POST | `/api/payroll/runs/:runId/lock`, `/api/payroll/runs/:runId/close` | `payroll.run.lock` | Lock an approved run, or close after all required payments and payslips exist |
| POST | `/api/payroll/runs/:runId/payments` | `payroll.payments.manage` | Record an idempotent payment with amount, reference, and payment date |
| POST | `/api/payroll/runs/:runId/payslips` | `payroll.payslips.generate` | Generate immutable, idempotent payslip snapshots |
| GET | `/api/payroll/payslips`, `/api/payroll/payslips/:payslipId` | `payroll.payslips.view` | Read payslips; access is limited to payroll staff and authorized school owners/system administrators |
| GET | `/api/reports/payroll-monthly`, `/api/reports/payroll-department-expense`, `/api/reports/payroll-deductions` and matching `.csv` paths | `payroll.reports.view` | Paginated payroll reports and formula-safe CSV exports through the shared WP7 report engine |

`payroll_officer` receives preparation, input, payment, and payslip permissions but not approval or locking permission. Approval is separately granted to authorized leadership; a prepared run cannot be approved by its preparer even if that account has both permissions. Teachers, parents, students, and non-payroll roles cannot access payroll reports, payslips, or payroll APIs. No employee payslip self-service route is currently exposed.

Payroll calculations read leave and attendance through `getApprovedHrLeaveForPeriod` and `getStaffAttendanceForPeriod`. Unpaid leave is deducted by half-day units; monthly base salary and fixed components are prorated for partial months from the hire date. Tax/pension rates and brackets are organization-configured data; no country-specific rates are hardcoded. Negative net is rejected unless a caller with `payroll.net.override` supplies an audited reason. Locked/closed runs and periods reject edits and recalculation; corrections use reasoned adjustment entries in a later open period.

Approvals repeated by the same reviewer with the same decision return the existing run; a conflicting decision or a different reviewer retry after transition is rejected. Payment requests are idempotent by key. The MySQL adapter locks the run and line and uses a locking current read of payment rows before checking the unpaid amount, preventing stale snapshots from permitting concurrent overpayment.

Migrations `202611030020_wp10_payroll_schema` and `202611030021_wp10_payroll_permissions` are forward-only. The schema migration creates payroll rules, structures, periods, runs, inputs, lines, adjustments, payments, and payslips with organization/campus scope, unique idempotency keys, explicit timestamps, and `utf8mb4_general_ci`; it does not backfill or change existing finance or HR balances. Period and payment date columns remain unchanged through status transitions. The permission migration adds the `payroll_officer` system role and narrowly scoped payroll permissions.

## SaaS school lifecycle

Public school self-registration has been removed: `POST /api/school-registration` is no longer registered and returns `404 NOT_FOUND`. An authenticated platform administrator creates a school with `POST /api/platform/schools`; the operation creates an active organization, its `Main Branch`, a trialing Starter subscription, and a password-less `owner_director` invitation in one transaction. The response includes a one-time invitation URL; the administrator shares it with the school administrator, who sets a password through the existing invitation acceptance flow. A pending link can be replaced with `POST /api/platform/schools/:organizationId/admin-invitation/regenerate`; regeneration invalidates the previous link and returns a new one-time URL. The invitation target is the organization ID, and acceptance grants membership in every active branch of that organization.

A platform administrator can suspend/reactivate a school, configure plans and modules, assign plans without resetting an existing trial or paid period, issue manual invoices, and record received payments. Starter trial length defaults to 30 days and is configurable; no payment gateway or automated recurring billing is connected. Operational school APIs enforce organization status, subscription validity, plan module entitlements, and student/staff capacity. Branch creation is limited by the assigned plan's site limit. All school administrators receive membership in branches created later; a Principal remains restricted to their own branch. Existing schools continue to use their current accounts and invitations.

On subscription plans, `maxUsers: null` and `storageLimitBytes: null` mean unlimited. Existing Starter plans are kept unlimited; newly created plans default to 50 users and 1 GiB unless a quota or `null` is explicitly supplied. User quotas count active accounts plus unexpired invitations and are checked for school provisioning, invitation creation and acceptance, student creation/import, and admission enrollment (which creates a student portal account). Subscription expiry is refreshed on access and by an hourly worker. The worker sends organization-scoped, audited in-app notices and, when SMTP is configured, email notices at 30, 7, and 1 days before expiry and when expiry occurs. Each threshold is deduplicated by subscription period. Stored SMTP credentials are decrypted with `SENSITIVE_DATA_KEY`; missing or default encryption keys fail closed.

School owners can read `/api/school/subscription`, request closure with `/api/school/closure`, and download `/api/school/export`. The versioned JSON export includes organization, school-site, account (without password hashes), academic, student/guardian, staff, attendance, assessment/report, finance, admissions, timetable, communication, notification, subscription, audit, and private admission-document data. Uploaded admission files are embedded as base64 content. Sensitive student fields remain encrypted in the export and require the same `SENSITIVE_DATA_KEY` for restoration. Password hashes, refresh tokens, and account-invitation token hashes are intentionally excluded. An export is generated from a consistent database snapshot, scoped to the owning organization and its sites.

A platform administrator can approve closure only after export. Approval sets a personal-data retention period (the current UI uses 90 days) and requires a separately configured financial-record retention period (30–36,500 days). After the personal-data deadline, a platform administrator can call `POST /api/platform/closures/:closureId/pseudonymize` with `{"confirmation":"PSEUDONYMIZE"}`. This action is due-date gated, audited, and idempotent by closure status; it disables tenant accounts, replaces student, guardian, applicant, and staff identifiers, removes sensitive student fields and private admission documents, redacts report snapshots and audit before/after payloads, and retains academic and financial ledger rows linked by pseudonymous IDs. This is pseudonymization, not guaranteed irreversible anonymization, because historical records remain linked.

The personal-data pseudonymization action is manual and requires an authorized operator; no scheduler invokes it. Financial records remain after the configured financial deadline as well—the future purge stage for those records and a hosted-MySQL end-to-end exercise are still outstanding. Do not treat the configured deadline as proof that financial data is automatically purged, or as a legal retention recommendation.

The first platform administrator is provisioned out of band after applying the SaaS migration. From the backend directory, explicitly set `ALLOW_PLATFORM_ADMIN_BOOTSTRAP=true`, `PLATFORM_ADMIN_NAME`, `PLATFORM_ADMIN_EMAIL`, and a private `PLATFORM_ADMIN_PASSWORD` of at least 16 characters, then run `npm run platform-admin:create`. The script requires the opt-in flag, rejects existing email addresses, and records the bootstrap in the platform audit log. Remove the bootstrap variables after use. Never put the password in source control or shared shell history.

## WP11 — library

The Library module is subscription-gated by the `library` plan module. Every library record and library query is scoped to the authenticated organization and active campus. New forward-only migrations `202611030022_wp11_library_schema` and `202611030023_wp11_library_permissions` add library settings, categories, books, copies, members, loans, reservations, fines, system role permissions, and the `library_librarian` role. They do not backfill or change existing student, staff, finance, or balance data. New timestamps have explicit defaults or nullability and no implicit `ON UPDATE` behavior. Migration `202611030024_cashbook_account_idempotency_repair` separately repairs a partial legacy cashbook idempotency schema: it fills only null idempotency keys from the existing account IDs and ensures the organization/campus/key unique index; it does not change account balances.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET, POST, PATCH | `/api/library/categories`, `/api/library/categories/:categoryId` | `library.catalog.view`, `library.catalog.manage` | List, add, and edit categories |
| GET, POST, PATCH | `/api/library/books`, `/api/library/books/:bookId` | `library.catalog.view`, `library.catalog.manage` | Search/filter, create, and edit catalogue records |
| POST | `/api/library/books/:bookId/archive` | `library.catalog.manage` | Archive a book without deleting history |
| GET, POST, PATCH | `/api/library/copies`, `/api/library/copies/:copyId` | `library.catalog.view`, `library.catalog.manage` | Search/filter, add, and edit copies |
| GET | `/api/library/barcodes/:barcode` | `library.catalog.view` | Find a copy by its barcode |
| POST | `/api/library/copies/:copyId/archive` | `library.catalog.manage` | Archive a copy unless loaned or reserved |
| GET, POST | `/api/library/members` | `library.members.manage` | List members and enroll an active student or staff member |
| GET, PUT | `/api/library/settings` | `library.catalog.view`, `library.catalog.manage` | Read or configure loan, renewal, fine, and currency rules |
| GET | `/api/library/dashboard` | `library.catalog.view` | Counts of total, available, borrowed, and overdue copies |
| GET, POST | `/api/library/loans` | `library.circulation.manage` | List loans and issue an available copy with an idempotency key |
| POST | `/api/library/loans/:loanId/return` | `library.circulation.manage` | Return a loan, record condition, and create any overdue fine |
| POST | `/api/library/loans/:loanId/renew` | `library.circulation.manage` | Renew an eligible loan within the configured limit |
| GET, POST | `/api/library/reservations` | `library.circulation.manage` | View the FIFO queue and create an idempotent reservation |
| POST | `/api/library/reservations/:reservationId/cancel` | `library.circulation.manage` | Cancel a queued or ready reservation |
| GET | `/api/library/fines` | `library.fines.view` | List fines in the active organization and campus |
| POST | `/api/library/fines/:fineId/pay` | `library.fines.manage` | Record a fine as paid; no payment gateway is connected |
| POST | `/api/library/fines/:fineId/waive` | `library.fines.waive` | Waive an unpaid fine with an audited reason |
| GET | `/api/portal/library` | `library.portal.view` | Read only the caller's own loans, reservations, and fines; parents see verified linked children |
| GET | `/api/reports/library-inventory`, `/api/reports/library-copies`, `/api/reports/library-circulation` and matching `.csv` paths | `library.reports.view` | Paginated reports and formula-safe CSV exports through the WP7 report engine |

`library_librarian`, school administrators, and system administrators receive only the corresponding management permissions. Fine waiver is restricted to `owner_director`, `principal`, and `system_admin`. Students and parents have portal-only reads; teachers have portal-only reads for their own staff loans. The catalogue/copy page includes search, category and status filters, add/view/edit/archive controls, barcode lookup, CSV export, and print. The Student portal page shows the member's due dates, reservations, and fines.

Fines are unsigned integer minor units. The calculation is `overdue calendar days × configured minor units per day`; both operands and the result are integers, so no fractional rounding is performed. Issue, return, renewal, reservation fulfillment, fine payment, and waiver operations use MySQL transactions and locking reads. A unique active-copy key prevents simultaneous loans for one copy, and a unique fine-per-loan key prevents duplicate return fines. Reservation fulfillment locks the copy and the oldest queued reservation. Issue and reservation retries return the existing row by their organization/campus idempotency key. Notifications are deduplicated by recipient and source event.
