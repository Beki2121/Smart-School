# Implementation progress

## Current status — runnable foundation plus academic setup

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

### Release 1 modules deferred

These are intentionally not represented as complete:

- Admissions/enquiry lifecycle, documents/uploads, guardian verification/account provisioning, and student profile completion/soft-delete/anonymisation.
- Remaining setup management, campus administration, full term lifecycle, calendar/date controls across forms, grade/stream/curriculum/timetable.
- Teacher/class/subject assignment enforcement, guardian-child and student-self portals, configurable persisted RBAC and role/user administration.
- Attendance editing/approval and staff attendance; marks submission/approval/locking/amendments, grading configuration, ranking, promotion, and report cards.
- Fees/invoices/payments/receipts/cashier shifts/expenses and financial controls.
- SMS/email providers, message outbox/consent/quiet hours, announcements and event calendar.
- Staff HR workflows, welfare/conduct, encrypted sensitive-field handling and audited reveals.
- Reports/official statistics, group-wide multi-campus dashboards/transfers, automation, platform console/packages/licensing, migration toolkit, export workflows.
- Background Sync, fully offline read cache, complete guardian/student portal, file/PDF generation, Web Push and notification rooms.
- Full schema and seeds for all Release 1 modules; database-backed role-permission mapping and MySQL integration test suite.
- Complete privacy runbook, breach-response exercises, retention/export/erase workflows, accessibility/native-speaker review, load/E2E testing and production readiness.

### Explicit exclusions kept out of scope

No payroll calculations, library, inventory/stores, transport, payment gateway, public online admissions, LMS, extra languages, Docker, deployment or simultaneous bidirectional cloud/local sync.

## Validation record

- `npm install`: passed; patched dependencies resolved and npm reported 0 vulnerabilities.
- `npm test`: passed — 21 tests (17 API tests + 4 Ethiopian calendar tests). New coverage verifies academic-year planning/activation, term date constraints, and campus-scoped grade/section/subject setup.
- `npm run lint`: passed — backend syntax check and frontend TypeScript check.
- `npm run build`: passed — Vite production web build and `injectManifest` service worker after the academic setup changes.
- `npm audit`: passed — 0 dependency vulnerabilities.
- Live `npm run dev` smoke: passed — SIMS page HTML served on `http://localhost:5174` (port 5173 was occupied by an unrelated workspace and left untouched); API health `ok`; demo login succeeded; active academic year and section list retrieved; school profile updated; student created; attendance created and duplicate replay returned idempotently; marks created in `draft`.
- Browser smoke test: passed — signed into demo mode, opened School Setup, created and activated a planned academic year, and verified the Amharic setup UI.
- MySQL migration/seed execution was not run: MAMP default `127.0.0.1:8889` was not listening. The other reachable local database port was not touched. DB migration behavior remains unverified against a real MySQL instance.
- No deployment or production validation was performed.
