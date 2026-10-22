# Implementation progress

## Current status — runnable foundation, academic setup, staff and admissions workflows

The approved plan and playbook are the scope authority. This pass establishes a runnable bilingual web/API foundation and the first registrar/teacher workflows; it does **not** complete Release 1.

### Implemented now

- Root npm workspaces and developer scripts; example environment and no-Docker local workflow.
- React/Vite responsive shell, English and Amharic dictionaries, local Inter and Noto Sans Ethiopic fonts, PWA manifest/custom service worker.
- Ethiopian↔Gregorian conversion utilities with boundary and century round-trip tests; Ethiopian date display in the dashboard.
- Express API health, login, refresh rotation, logout, current-user, dashboard and active-campus profile view/edit endpoints.
- Zod validation, Helmet, strict configured CORS, request-size limit, rate-limited authentication, Pino error logs, JWT access claims, role checks and campus-derived data scope.
- Knex/MySQL initial migration for organization/campus, users/campus membership, role/permission primitives, academic years/terms/grades/sections/subjects, students/guardians/links, attendance, marks, refresh tokens and audit events.
- Idempotent sample-data seed and explicitly temporary in-memory demo mode.
- Student search/create and active-year enrolment to campus sections; active-campus profile edit; section-roster attendance capture; draft marks entry; audit entries for student/school/attendance/mark writes; attendance/marks offline queue and idempotent replay keys.
- API tests for authentication, permissions, campus derivation, validation, attendance idempotency, mark bounds, and refresh rotation.
- Initial dashboard metrics for real student sections/gender and current-day attendance; the grade bar chart is based on stored section counts.
- School setup APIs and bilingual UI forms for planned academic years, activation/closure, terms, grade levels, sections and bilingual subjects. Academic setup writes are campus-scoped and audited; terms are date-bounded to the active year.
- Phase 5 staff foundation: departments; bilingual staff records with optional link to an existing campus account; teaching assignments and homeroom assignment; workload counts; teacher timetable-period clash rejection; staff attendance; leave request and one-time approval/rejection; internal handover notes/announcements; staff attendance CSV export.
- Staff authorization applies role visibility (campus HR/directors, department heads, employee self-service); teacher class-scope checks cover student lists/detail, sections, attendance, roster, and mark reads/writes. Timetable collisions reject both teacher and section double-booking for a period.
- Phase 6 internal admissions: enquiry intake with duplicate checking, admissions funnel/search, interview scheduling, accept/waitlist/reject decisions, required-document checklist and private PDF/JPEG/PNG uploads/downloads, printable offer letters, capacity-checked enrolment with campus student-number sequence and sibling links, and withdrawal/readmission/transfer workflows with status history and printable transfer certificates.
- The registrar-facing admissions page is bilingual and role-gated. Offer letters and transfer certificates are printable HTML rather than generated PDF files. Public intake, guardian verification/account provisioning, and broader student-profile completion remain deferred.
- Admissions migrations were applied successfully to the local MAMP MySQL database on port 3306. A partial Phase 5 migration was safely resumed after replacing an overlong MySQL index name and making that migration tolerate already-created tables. The database is currently empty; no demo/sample records were seeded.

### Release 1 modules deferred

These are intentionally not represented as complete:

- Guardian verification/account provisioning and student profile completion/soft-delete/anonymisation.
- Remaining setup management, campus administration, full term lifecycle, calendar/date controls across forms, grade/stream/curriculum/timetable.
- Guardian-child and student-self portals, configurable persisted RBAC and role/user administration; teacher assignment class scope is implemented for the available academic workflows.
- Attendance editing/approval and staff attendance; marks submission/approval/locking/amendments, grading configuration, ranking, promotion, and report cards.
- Fees/invoices/payments/receipts/cashier shifts/expenses and financial controls.
- SMS/email providers, message outbox/consent/quiet hours, announcements and event calendar.
- Full staff HR workflows and richer notifications, welfare/conduct, encrypted sensitive-field handling and audited reveals. Initial Phase 5 staff workflows are implemented; payroll remains excluded.
- Reports/official statistics, group-wide multi-campus dashboards/transfers, automation, platform console/packages/licensing, migration toolkit, export workflows.
- Background Sync, fully offline read cache, complete guardian/student portal, generated PDF files, Web Push and notification rooms.
- Full schema and seeds for all Release 1 modules; database-backed role-permission mapping and MySQL application-workflow integration test suite.
- Complete privacy runbook, breach-response exercises, retention/export/erase workflows, accessibility/native-speaker review, load/E2E testing and production readiness.

### Explicit exclusions kept out of scope

No payroll calculations, library, inventory/stores, transport, payment gateway, public online admissions, LMS, extra languages, Docker, deployment or simultaneous bidirectional cloud/local sync.

## Validation record

- `npm install`: passed; patched dependencies resolved and npm reported 0 vulnerabilities.
- `npm test`: passed — 23 tests (19 API tests + 4 Ethiopian calendar tests). Coverage includes admissions enquiry-to-enrolment, private document access, capacity limits, lifecycle history, staff scope and calendar conversion.
- `npm run lint`: frontend TypeScript and backend syntax checks passed after the admissions additions.
- `npm run build`: passed after the admissions UI, localization and PWA changes.
- `npm audit`: passed — 0 dependency vulnerabilities.
- Live `npm run dev` smoke: passed — SIMS page HTML served on `http://localhost:5174` (port 5173 was occupied by an unrelated workspace and left untouched); API health `ok`; demo login succeeded; active academic year and section list retrieved; school profile updated; student created; attendance created and duplicate replay returned idempotently; marks created in `draft`.
- Browser smoke test: passed — signed into demo mode, opened School Setup, created and activated a planned academic year, and verified the Amharic setup UI.
- Admissions browser smoke test: passed — opened the registrar page, created an enquiry in temporary memory mode, moved it to application, and verified the Amharic page and funnel copy.
- Admissions/staff API workflows are covered using the in-memory repository. A rollback-only MySQL smoke test also exercised enquiry creation, interview timestamps, decisions, ID sequencing, capacity rejection, enrolment, dashboard aggregation, withdrawal, readmission and transfer; it verified four history events and rolled back all fixture rows. Private-file disk I/O was not part of that database smoke.
- The local MAMP server is on `127.0.0.1:3306`; migrations 001–003 are recorded. The database has zero organization, campus, user, and admission rows; seed execution was intentionally skipped to avoid adding synthetic student data without approval.
- No deployment or production validation was performed.
