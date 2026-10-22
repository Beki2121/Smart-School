# SmartSchool SIMS — Release 1 Project Plan

## Approved objective

Build the Release 1 foundation of SmartSchool SIMS: a bilingual, multi-campus Student Information Management System for Ethiopian schools. The user approved the captured Release 1 scope and requested proceeding with the best professional approach.

## Architecture

- `frontend/`: React 18, TypeScript, Vite, React Router, handwritten responsive CSS, English/Amharic dictionaries, and a PWA shell. Offline writes are limited to attendance and marks and must be idempotent.
- `backend/`: Node.js 20, Express, JavaScript ES modules, Zod validation, Pino logging, Helmet, strict CORS, rate limiting, JWT authentication, Socket.IO with polling fallback, and MySQL 8 through Knex migrations.
- Keep the existing `backend/` and `frontend/` workspaces rather than relocating them into the playbook's `apps/api` and `apps/web` layout during feature implementation.
- MySQL is the source of truth; uploaded documents use a storage adapter suitable for local or hosted installs. Development is native Node.js and MAMP-compatible; do not add Docker.
- Root npm workspaces provide development, test, lint, build, and database scripts. Document local setup and API contracts.

## Release 1 product scope

Organization/campus and academic setup; admissions and enrolment; student, guardian, and document records; timetable; attendance; assessment, grading, ranking, promotion, and report cards; fee operations; core staff workflows; welfare/conduct; reports; announcements/notifications; parent/student portals; multi-campus administration; and platform administration.

Support English and Amharic, Ethiopian names and calendar presentation, responsive phone/tablet/desktop layouts, and PWA offline entry only for attendance and marks. Use adaptable defaults and record school-specific grading, promotion, and fee rules as configuration.

## Security, privacy, and integrity

- Derive organization/campus scope from authenticated claims, never request payloads; enforce role, campus, class, and guardian-child access server-side.
- Validate every endpoint; use parameterized SQL, secure password hashing, short-lived access tokens, hashed rotating refresh tokens, rate limits, request-size and upload limits, and environment-only secrets.
- Append-only audit events for authentication, sensitive-data access, permission changes, marks, and financial actions. Preserve mark and finance histories; corrections require attributable amendments/reversals.
- Minimize children's data, encrypt sensitive fields, mask by default, verify guardian links, record consent, and document privacy/incident handling. Legal counsel must validate jurisdictional compliance before production.
- Use mock SMS/email providers by default. No external provider credentials or payment-gateway integration in development.

## Delivery sequence

1. Establish runnable monorepo, responsive application shell, i18n, environment validation, API health check, MySQL connection/migration baseline, tests, lint, and documentation.
2. Implement authenticated tenant/campus foundation and audited role-scoped APIs.
3. Deliver core school setup and student/admission records.
4. Add timetable, attendance with constrained offline queue, and marks workflow.
5. Add grading/report cards and operational fees with immutable histories.
6. Add communication, portals, reporting, privacy hardening, and release validation.

## Explicit exclusions

Release 2: payroll calculations, library, inventory/stores, transport, bidirectional cloud/local sync, payment gateways, public online admissions, LMS, and additional languages. Deployment and production provisioning are not included in this build.

## Acceptance criteria

- A developer can install dependencies, configure the example environment, run API and web apps, and execute focused tests/builds.
- Both locales render through dictionaries with an English fallback; layout is usable on mobile and desktop.
- Authentication and tenant/campus scope are enforced by server middleware and tested; operational writes are validated and audited.
- Attendance/marks offline submissions use client-generated IDs and cannot replay into duplicate writes.
- MySQL migrations and seeds are repeatable, and API errors use `{ error: { code, message, details? } }`.
- Document implemented, deferred, setup, testing, and school/legal decisions. Do not claim full Release 1 completion for modules not implemented.
