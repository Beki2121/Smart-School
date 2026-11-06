# Smart School (SIMS) – Gap Fix Prompts (Phase 1 & Phase 2)

Based on your status report: 134 menus, 26 Implemented, 59 Partial, 49 Not Implemented (about 41% complete).

## How to use
1. Create a new git branch for each work package (WP), for example `feat/wp1-audit-viewer`.
2. Paste **PROJECT RULES** (below) once at the start of each new AI chat, or save it in your repo's AI instructions file so it always applies.
3. Paste ONE work package prompt at a time. Review the diff, run tests, then commit. Do not start the next WP until the current one passes.
4. After WP15, re-run the audit prompt to confirm the gaps are closed.

Order is by risk and dependency: governance first, then core academic and finance, then portals and reports, then Phase 2 modules.

---

## PROJECT RULES (paste first, every chat)

You are working in the SIMS repository (React/Vite frontend, Express/Node backend, Knex + MySQL repositories, plus an in-memory adapter). Follow these rules for every change:

1. Read the existing code first and copy its patterns: route registration in `backend/src/routes/register.routes.js`, permission map in `backend/src/middleware/permissions.js`, module gating in `module-access.js`, navigation in `frontend/src/navigation.ts`, page guards in `App.tsx`, audit writes via the shared `audit_log` helper, validation with Zod schemas, migrations in `backend/migrations`.
2. Every new table has `organization_id` (and `campus_id` where data is campus-scoped). Every query must be scoped by the authenticated user's organization and active campus. Never trust IDs from the client without checking they belong to the user's tenant.
3. Implement every feature in BOTH the MySQL repository and the in-memory repository, with the same behavior.
4. Add server-side permission checks for every route (not only UI hiding). Add new permissions to `permissions.js` and assign them only to the roles that need them.
5. Gate new modules through `module-access.js` so subscription plans can enable or disable them.
6. Write an audit event for every create, update, status change, approval, and delete/archive. Prefer archive over hard delete.
7. Validate all input with Zod. Return clear error messages. Block duplicates and invalid state transitions.
8. Add the standard features to each new list page: search, filters, add, view details, edit, archive, status, attachments where relevant, export (CSV at minimum), print where relevant, activity history, notifications for approvals and status changes.
9. Add tests: permission tests (allowed and denied roles), tenant isolation tests (user from school A cannot read or change school B data), validation tests, and the main workflow end to end. Run the existing test suite and make sure nothing breaks.
10. Do not touch Phase 3 features (transport, GPS, payment gateways, SMS automation, advanced analytics, mobile apps).
11. Do not remove or rewrite working code unless required. Keep changes focused on the work package.
12. At the end, update `docs/PROGRESS.md` and give me: files changed, migrations added, permissions added, tests added, and anything left undone.

---

## WP1 – Audit log viewer and login history (Priority: High, Phase 1)
Closes: Security & Audit (Platform Admin, School Admin), Security (School IT Admin).

Task: The `audit_log` table already records events, but nobody can view them. Build:
- Backend: scoped read APIs. Platform admins can query across schools. School roles see only their own organization/campus. Support filters: date range, user, action, entity type, entity id, and free-text search; paginate and sort newest first. Add a CSV export.
- A separate login-history view built from `auth.login`, `auth.login_failed` and `auth.logout` events (user, time, IP/user agent if stored, success or failure), plus a list of active sessions for the school IT administrator with the ability to revoke a session if the auth layer supports it.
- Frontend: an Audit page and a Login History page in the platform area and the school area, with filters, detail drawer showing before/after values, and navigation entries.
- Permissions: new `audit.view` (and `session.manage`) for platform admin, school administrator (`owner_director`) and `system_admin` only. Principal gets read-only if appropriate.
- Audit coverage review: list which sensitive actions do NOT write audit events yet (permission or role changes, approvals, fee and result changes, account activation, subscription changes, data import) and add the missing ones.
- Tests: tenant isolation for log queries, permission denial for other roles.

---

## WP2 – Application-managed roles and permissions, platform users (Priority: High, Phase 1)
Closes: Users & Permissions (School Admin), Roles & Permissions (School IT Admin), Platform Users (Platform Admin).

Task:
- Move the hardcoded role-to-permission map into the existing `roles`, `permissions`, `role_permissions` tables. Seed the current defaults with a migration so behavior does not change on day one. Keep system roles protected (cannot be deleted; critical permissions cannot be removed from the owner role).
- Backend APIs: list roles and permissions, create a custom role per school, edit its permissions, assign roles to users, deactivate a user, and show an effective-permission view for a user. Cache permissions safely and invalidate on change.
- Frontend: Roles & Permissions page (permission matrix grouped by module) and role assignment in the accounts page.
- Platform Users: list, invite, edit, deactivate and assign platform roles (platform administrator, support staff). Prevent removing the last active platform administrator.
- Safety: a school admin cannot grant permissions they do not hold, and cannot touch platform roles. Audit every change.
- Tests: privilege escalation attempts, last-admin protection, tenant isolation, and that existing role behavior is unchanged after seeding.

---

## WP3 – Platform dashboard, finance and quotas (Priority: High, Phase 1)
Closes: Platform Dashboard, School Management, Subscription Plans, Platform Finance, Global Settings.

Task:
- Dashboard metrics: total users, active subscriptions, expired subscriptions, revenue (by period and currency), outstanding invoice balance, and a basic system-health block (API up, database reachable, last backup time if available).
- School Management: add a unique school code (generated, immutable after creation), logo upload (with file type and size limits and per-school storage), and full academic configuration defaults at provisioning.
- Plans: add billing cycle (monthly, termly, yearly), maximum users (separate from staff limit), and storage limit. Enforce user and storage limits server-side where users are created and files are uploaded; return a clear error when a limit is reached.
- Subscription management: renewal and expiry handling (status becomes expired after the end date; warn before expiry; block or restrict per your existing gating rules), upgrade and downgrade with a check that current usage fits the new plan.
- Platform Finance: refunds (against payments, with reason and audit), revenue report and outstanding balances report with CSV export.
- Global Settings page: default language, currency, date format, calendar type, email settings (do not expose secrets).
- Tests: limit enforcement, expiry, refund rules, tenant isolation.

---

## WP4 – Exam types and exam schedules (Priority: High, Phase 1)
Closes: Exams & Results (School Admin), Exams & Assessment (Academic Director), Teacher marks context.

Task:
- Data model: exam types (for example quiz, midterm, final, with weight), exams per term/grade/subject, schedule entries (date, start and end time, room, invigilators), and links to the existing marks entry so marks belong to a defined exam.
- Workflow: define exam, schedule, publish schedule, open marks entry, submit, review, approve, publish (reuse the existing approval and publication lifecycle). Detect schedule conflicts (same section or room at the same time).
- Result calculation: configurable grading scale and weighted totals per term; ensure report cards use the exam definitions.
- Frontend: exam setup page, exam timetable view for teachers, coordinators and (once published) parents and students; marks monitoring view showing which exams still have missing marks.
- Notifications: notify teachers when marks are due and parents when results are published.
- Tests: conflict detection, weighted result math, permissions, tenant isolation.

---

## WP5 – Fees: discounts, refunds, arrears, bank and reconciliation (Priority: High, Phase 1)
Closes: Fees & Finance, Fee Structures, Invoices, Discounts & Scholarships, Arrears, Refunds & Adjustments, Cashbook, Finance Reports, Principal fee approvals.

Task:
- Fee structures: class-based fee schedules and payment schedules (installments with due dates) per academic year and grade; generate invoices in bulk from a structure.
- Discounts and scholarships: define discount types (percentage or fixed, sibling, staff child, scholarship), apply to a student, approval workflow (accountant requests, principal approves), automatic effect on invoices, full audit.
- Refunds and adjustments: refund request with reason, approval by principal, link to the original payment, adjustment entries; keep the existing reversal feature.
- Arrears: ageing buckets (current, 30, 60, 90+), overdue list per class and student, follow-up notes and next-contact date, CSV export and printable statement per student.
- Cashbook: cash and bank accounts, deposits, transfers, and reconciliation (mark entries as reconciled against a statement date; show differences).
- Finance reports: daily collection, collection by class and fee type, student statement, arrears report, daily cash report, expense report, with date filters, CSV export and print.
- Accountant dashboard: today's collections, overdue invoices, outstanding total.
- Tests: money math (rounding, multi-currency), approval permissions, no negative balances, reconciliation, tenant isolation.

---

## WP6 – Assignments and homework (Priority: High, Phase 1)
Closes: Assignments & Homework (Teacher), Homework (Parent), Assignments (Student).

Task:
- Data model: assignments (class/section/subject, title, instructions, due date, attachments, status), student submissions (text, file, submitted time, late flag, grade and feedback optional).
- Teacher: create, edit, publish, close, view submissions, grade and give feedback; add a navigation entry and page.
- Student and parent portals: list assignments with due dates, view details, students submit work; parents view children's assignments and submission status read-only.
- Permissions: teachers only for classes they are assigned to (reuse teaching assignments); students only their own; parents only linked children.
- Notifications: students and parents on new assignment and approaching due date; teacher on submission.
- File handling: type and size limits, per-school storage, count toward the storage quota from WP3.
- Tests: assignment scoping, cross-class access denial, tenant isolation.

---

## WP7 – Reports center and role dashboards (Priority: High, Phase 1)
Closes: Reports (School Admin, Principal, Teacher, Registrar, Academic Director), Dashboards for most roles, Academic Oversight, Curriculum coverage, Teacher allocation.

Task:
- Build one Reports page with a catalog by category: student lists and profiles, admissions and enrolment statistics (including available seats per grade), attendance (by class, student, trend), academic (pass rates, subject performance, class comparison, progress), finance (reuse WP5 reports), and a placeholder hook for HR and operational reports added later.
- Every report: filters (year, term, grade, section, date range), CSV export, print view, and role-scoped data (teachers only see their classes).
- Dashboards: principal (academic and financial overview, attendance trend), school administrator (staff stats, fee collection and outstanding, upcoming exams), academic director (syllabus coverage, exam progress), teacher (today's classes, pending marks, pending attendance, announcements), registrar (available seats, pending applications), school IT (account counts, security alerts from WP1).
- Syllabus coverage: track covered units per class from lesson plans and show coverage percentage. Teacher workload view: periods and classes per teacher with warnings over a configurable limit.
- Teacher workspace: "My Classes" page (students, attendance, marks status per class) and navigation entry for Lesson Planning and Student Progress notes.
- Tests: scoping per role, totals match source data, tenant isolation.

---

## WP8 – Portal extensions and parent-teacher communication (Priority: Medium, Phase 2)
Closes: Parent portal Timetable, Communication, Events, Requests; Student portal Timetable, Announcements, Events, Support, Dashboard, Profile.

Task:
- Parent portal: child timetable, school events and meetings calendar, announcements, notifications list, and Requests (absence explanation, document request, profile update request) with a status workflow handled by the registrar or school office.
- Student portal: personal timetable (daily and weekly), announcements for school and class, events, support requests (academic or technical) routed to staff, richer dashboard (today's classes, upcoming assignments, recent results), and a profile page with a limited self-edit request flow.
- Parent-teacher messaging: threaded messages between a parent and the teachers of their linked children, with teacher-side inbox, read status, notification, and school-configurable rules (for example staff may disable messaging). Add moderation: messages are stored and auditable.
- Permissions: strict linked-child and own-data scoping; teachers can only message parents of students they teach.
- Tests: scoping, cross-family access denial, tenant isolation.

---

## WP9 – HR completion (Priority: Medium, Phase 2)
Closes: Contracts, Recruitment, Leave Management gaps, Performance, Training, HR Reports, HR Dashboard, staff import, staff documents.

Task:
- Contracts: employment contracts per staff (type, start, end, renewal), document upload, expiry tracking with alerts, renewal action with history.
- Staff documents: upload and categorize documents per staff member with access control.
- Leave: leave types with rules (annual, sick, unpaid; yearly entitlement), balances per staff, balance checks on request, carry-over option, existing approval flow retained.
- Recruitment: vacancies, applicants (with documents), interview scheduling and notes, decision (hire, reject, shortlist), and convert a hired applicant into a staff record.
- Performance: review cycles, goals, evaluations, evaluation history per staff.
- Training: courses, enrolment and attendance, certificate upload.
- Staff import: CSV import with preview and commit, mirroring the student import.
- HR dashboard (total and active staff, leave requests, contract expiry) and HR reports (employee statistics, leave report, staff attendance) with CSV export.
- Staff profile edit and archive with audit events and retention rules.
- Tests: balance math, contract expiry, permissions, tenant isolation.

---

## WP10 – Payroll (Priority: Medium, Phase 2; depends on WP9)
Closes: all Payroll Officer menus.

Task:
- Add a Payroll Officer role (permissions via WP2) and a Payroll module gated by subscription plan.
- Data model: salary structures per staff (basic, allowances, deductions, tax and pension rules configurable per organization; do not hardcode country rules without confirming), payroll periods, payroll inputs (attendance days, overtime, bonuses, adjustments), payroll runs, payroll lines, payments, payslips.
- Workflow: open period, load inputs (pull attendance and approved leave from HR), calculate gross and net, review, submit for approval, approve (separate approver from the preparer), lock, record payments with references, generate payslips (print and PDF), and close.
- Reports: monthly payroll, salary expense by department, deductions report, with CSV export.
- Dashboard: current period status, pending approvals, payment status.
- Controls: locked periods cannot be edited; every change audited; payslips visible only to the payroll team and the employee if a staff self-service view exists.
- Tests: calculation accuracy with edge cases (partial months, unpaid leave), approval separation, locking, tenant isolation.

---

## WP11 – Library (Priority: Medium, Phase 2)
Closes: all Librarian menus and the Student portal Library.

Task:
- Add a Librarian role and a Library module gated by plan.
- Data model: categories, books (title, author, ISBN, publisher), copies (copy number, barcode, condition, shelf location), members (students and staff), loans, reservations, fines.
- Workflow: issue book (checks availability, member limits and overdue blocks), return (record condition, calculate fine), renew, reserve (queue when all copies are out), overdue list and configurable fine rules.
- Pages: dashboard (totals, available, borrowed, overdue), catalogue, copies, members, issue, return, reservations, overdue, reports (inventory and circulation) with CSV export and barcode lookup.
- Student portal: borrowed books and due dates.
- Tests: availability logic, fines, reservations queue, tenant isolation.

---

## WP12 – Inventory and assets (Priority: Low, Phase 2)
Closes: Inventory & Assets (School Admin).

Task:
- Data model: item categories, stock items with units and reorder levels, suppliers, purchases (with receiving), stock movements (in, out, adjustment) with full history, fixed assets (tag, category, purchase info, condition, location), asset allocation to staff or rooms and returns, and maintenance notes.
- Pages: stock list with low-stock alerts, purchases, stock movements, assets, allocations, and reports (stock valuation, movement, asset register) with CSV export.
- Permissions: a store keeper style permission set assignable through WP2 roles.
- Tests: stock never goes negative, allocation rules, audit trail, tenant isolation.

---

## WP13 – Front desk (Receptionist) (Priority: Low, Phase 2)
Closes: all Receptionist menus.

Task:
- Add a Receptionist role and a Front Desk module gated by plan.
- Data model: visitors (name, purpose, host, check-in and check-out), appointments (parent meetings with staff), calls and messages for staff (with status), student pickup (authorized guardians list per student, verification, release log with time and staff member), deliveries, lost and found.
- Pickup safety: only guardians marked as authorized for that student may collect; record who released the student; optional photo or ID note; alert on unauthorized attempts.
- Notifications: notify staff on visitor arrival, appointments and messages.
- Pages: dashboard (today's visitors, appointments, pending messages) and reports (visitor log, appointments, pickups).
- Tests: authorization checks for pickup, scoping, tenant isolation.

---

## WP14 – Support tickets, system monitoring, backup status, integrations (Priority: Medium, Phase 2)
Closes: Support Center, System Monitoring (Platform Admin), Technical Support, Backup Status, Integrations (School IT).

Task:
- Support tickets: schools raise tickets (subject, category, priority, attachments); platform support staff assign, comment, change status and resolve; schools see their own tickets. School IT also has an internal IT ticket list for the school. Notifications on status changes.
- System monitoring (platform admin only): API health, database connectivity, storage usage per school, background job status, and error counts. Never expose secrets or connection strings.
- Backup status: record backup runs (time, size, result) from your existing backup process or a configurable status endpoint, show the latest status and history, and show recovery information (how to request a restore). If no backup system exists yet, add a minimal scheduled backup job and document it.
- Integrations page for school IT: email settings status and test-send (secrets stay in environment or encrypted storage and are never displayed). Do not add SMS or payment gateway integrations (Phase 3).
- Tests: access control, no secret leakage in responses, tenant isolation.

---

## WP15 – Final verification and hardening (Priority: Critical before release)
Task:
- Tenant isolation sweep: review every repository method in both adapters for organization/campus scoping. Write automated tests that create two schools and attempt cross-school reads and writes through every API route (including exports, search, file downloads, notifications and background jobs). Fix any leak found.
- Permission sweep: generate a table of every route and the permission it requires; confirm each role can access only its menus and that restricted URLs and APIs return denied responses.
- Subscription limits: verify student, staff, user, branch and storage limits, module gating, and expiry behavior in both adapters.
- Standard features: re-check the 12 standard features on every new module and list anything missing.
- Audit coverage: confirm sensitive actions across new modules write audit events.
- Performance: check list pages with large data sets (pagination, indexes on `organization_id`, `campus_id` and common filters).
- Update `docs/PROGRESS.md`, then re-run the original status audit prompt and give me the new Implemented / Partial / Not Implemented counts and the remaining gaps.