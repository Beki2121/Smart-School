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
| GET | `/api/accounts` | `accounts.manage` | List accounts belonging to the authenticated school organization |
| PATCH | `/api/accounts/:userId/status` | `accounts.manage` | Activate/deactivate an account in the authenticated organization; self-deactivation is rejected and status changes revoke all sessions |
| GET | `/api/auth/invitations/:token` | Public, rate-limited | Check a valid, unused account invitation |
| POST | `/api/auth/invitations/accept` | Public, rate-limited | Set a 12+ character password and activate a single-use invitation |
| POST | `/api/account-invitations` | `accounts.manage` | Create a 48-hour invitation for a staff member, enrolled student, or verified guardian; response includes the one-time share URL. Staff-role invitations are checked against the inviter allowlist; only an owner can invite a role with `accounts.manage` or `platform.manage`. A Principal can additionally invite a Registrar or HR Administrator in the active branch. Violations return `403 STAFF_ROLE_INVITATION_FORBIDDEN`. |

Authentication uses one role per account for this release. Multiple role grants per user are deferred. Password recovery requires an SMTP provider; configure the `SMTP_*` environment variables before production startup. Reset requests do not reveal whether an email belongs to an active account. Login, logout, reset, refresh, account activation and deactivation security events are audited without storing passwords or reset tokens.
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

Fee items and invoices are campus-scoped. Invoice lines retain bilingual descriptions and prices from issue time. Every new payment, reversal, or expense requires the caller's open cashier shift, whose currency must match the transaction. Opening/closing shifts and financial writes are audited; shift close calculates expected cash as opening float plus cash payments, less cash reversals and cash expenses. Closed shifts cannot be changed. Expenses are append-only; bank transfer and mobile money entries require a reference. The basic summary is grouped by currency and based on recorded transactions, not bank reconciliation. Payment gateways, refunds with second approval, bank imports, arrears ageing, and production accounting controls are not implemented.

Campus announcements and events are bilingual, campus-scoped, visible to authorized signed-in campus users and audited on publication/creation. Announcements are published immediately and are not editable; events are listed when their date range overlaps the requested period. These are in-app records only. SMS/email providers, consent/preferences, delivery outbox/retries, push notifications and role/grade-targeted messages are not implemented.

## SaaS school lifecycle

`POST /api/school-registration` creates an active school, owner account, active operational site, and a trialing Starter subscription. The configured Starter trial begins immediately, so the owner can sign in as soon as registration succeeds. A platform administrator can suspend/reactivate a school, configure plans and modules, assign plans without resetting an existing trial or paid period, issue manual invoices, and record received payments. Starter trial length defaults to 30 days and is configurable; no payment gateway or automated recurring billing is connected. Operational school APIs enforce organization status, subscription validity, plan module entitlements, and student/staff capacity. Site limits are stored in plan configuration but are not enforceable until multi-site creation is implemented. Schools registered under the earlier approval-first workflow remain pending until a platform administrator activates them.

School owners can read `/api/school/subscription`, request closure with `/api/school/closure`, and download `/api/school/export`. The versioned JSON export includes organization, school-site, account (without password hashes), academic, student/guardian, staff, attendance, assessment/report, finance, admissions, timetable, communication, notification, subscription, audit, and private admission-document data. Uploaded admission files are embedded as base64 content. Sensitive student fields remain encrypted in the export and require the same `SENSITIVE_DATA_KEY` for restoration. Password hashes, refresh tokens, and account-invitation token hashes are intentionally excluded. An export is generated from a consistent database snapshot, scoped to the owning organization and its sites.

A platform administrator can approve closure only after export. Approval sets a personal-data retention period (the current UI uses 90 days) and requires a separately configured financial-record retention period (30–36,500 days). After the personal-data deadline, a platform administrator can call `POST /api/platform/closures/:closureId/pseudonymize` with `{"confirmation":"PSEUDONYMIZE"}`. This action is due-date gated, audited, and idempotent by closure status; it disables tenant accounts, replaces student, guardian, applicant, and staff identifiers, removes sensitive student fields and private admission documents, redacts report snapshots and audit before/after payloads, and retains academic and financial ledger rows linked by pseudonymous IDs. This is pseudonymization, not guaranteed irreversible anonymization, because historical records remain linked.

The personal-data pseudonymization action is manual and requires an authorized operator; no scheduler invokes it. Financial records remain after the configured financial deadline as well—the future purge stage for those records and a hosted-MySQL end-to-end exercise are still outstanding. Do not treat the configured deadline as proof that financial data is automatically purged, or as a legal retention recommendation.

The first platform administrator is provisioned out of band after applying the SaaS migration. From the backend directory, explicitly set `ALLOW_PLATFORM_ADMIN_BOOTSTRAP=true`, `PLATFORM_ADMIN_NAME`, `PLATFORM_ADMIN_EMAIL`, and a private `PLATFORM_ADMIN_PASSWORD` of at least 16 characters, then run `npm run platform-admin:create`. The script requires the opt-in flag, rejects existing email addresses, and records the bootstrap in the platform audit log. Remove the bootstrap variables after use. Never put the password in source control or shared shell history.
