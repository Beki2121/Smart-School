# SmartSchool SIMS

SmartSchool SIMS is a responsive-web-first, bilingual (English / Amharic) multi-school SaaS Student Information Management System for independent private primary and secondary schools. Its supported student levels are Grade 1 through Grade 12 only. It is not a kindergarten, college, university, or higher-education campus-management product. Each school is an organization tenant; campus-scoped records represent that school's operational site and are not a higher-education campus model. Built with React 18 + Vite, Express, Node.js ES modules, and Knex/mysql2 for MySQL-protocol databases. No Docker is used.

> **Implementation status:** this is an initial buildable foundation, not a completed Release 1 product. Implemented and deferred modules are itemized in [`docs/PROGRESS.md`](docs/PROGRESS.md). Do not enter real student information until the security, privacy, role/class/guardian access, retention, and school policy work is reviewed and completed.

## Requirements

- Node.js 20 or newer and npm
- A MySQL-protocol database supported by the selected hosting provider for durable use. Configure the provider's host and port in `.env`; verify the live database connection and migration history before importing school data.
- The API can also run in explicitly temporary `memory` mode for a first-run demo. Data disappears when the API restarts.

## Run the demo

In PowerShell, if script execution policy blocks `npm.ps1`, use `npm.cmd` in place of `npm` in the commands below.

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Open <http://localhost:5174>. Development credentials in memory mode:

- Email: `admin@school.local`
- Password: `ChangeMe123!`

The demo credentials and memory mode are for local development only. Never expose them publicly or use them for production.

## Use MySQL

1. Create an empty MySQL database named `smartschool_sims` using `utf8mb4` / `utf8mb4_unicode_ci`.
2. Edit root `.env`, set `STORAGE_MODE=mysql`, and set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` for the local server. MAMP on Windows commonly uses port `3306`; other MAMP installations may use a different port.
3. Run:

```powershell
npm run db:migrate
$env:NODE_ENV='development'
$env:ALLOW_DEMO_SEED='true'
npm run db:seed
$env:ALLOW_DEMO_SEED=''
npm run dev
```

The seed creates a fictional demo organization, campus, administrator and sample school records spanning students, staff, timetable, assessments, fees, admissions and communications. Seeding requires explicit opt-in with `ALLOW_DEMO_SEED=true`. Development seeding is repeatable. Production seeding requires a dedicated empty demo database plus a unique administrator email and password; never run it against real school data. The default demo credentials below are for local development only.

When `STORAGE_MODE=mysql`, the memory-mode credentials above do not apply. The demo administrator email and password are taken from `DEMO_LOGIN_EMAIL` and `DEMO_LOGIN_PASSWORD` when the initial demo seed runs; changing those environment values later does not change the stored password. Use the account's password-reset email flow, or rerun the demo seed only on a dedicated demo database. New school registrations start an active Starter trial and can sign in immediately. Schools registered under the earlier approval-first workflow remain pending until a platform administrator activates them.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Starts the API on port 4000 and Vite on port 5174 |
| `npm run dev:api` / `npm run dev:web` | Starts one workspace service |
| `npm run build` | Type-checks and builds the frontend PWA |
| `npm test` | Runs backend tests and frontend characterization tests |
| `npm run lint` | Checks backend JavaScript syntax and frontend TypeScript |
| `npm run check:env` | Validates local installation settings before a demo or pilot |
| `npm run db:migrate` | Applies Knex migrations |
| `npm run db:rollback` | Rolls back the most recent migration |
| `npm run db:seed` | Seeds fictional school records for local or explicitly enabled demo use |

API readiness: `GET http://localhost:4000/api/health`. API errors use `{ "error": { "code", "message", "details?" } }`. Route inventory is in [`docs/API.md`](docs/API.md).

## Deployment and pilot notes

This project is intended for school-local or controlled hosted deployment, not for simultaneous bidirectional cloud/local sync. The operational guidance for local installs, hosting checks, and pilot readiness is documented in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

The local installation checklist can be run before a demo or pilot:

```powershell
npm run check:env
```

The current build remains a controlled, phase-based implementation. Do not load real children’s data or claim production compliance until the hardening, privacy, access matrix, and legal-review items in [`docs/PRIVACY.md`](docs/PRIVACY.md) and [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) are complete.

## Implemented workflows

- Sign in/out, short-lived JWT access, HTTP-only rotating refresh cookie with hashed refresh-token storage, login attempt lockout, role checks, and access-token organization/campus claims.
- Invite-only staff, student, and guardian login setup. Invitations are single-use, expire after 48 hours, and require the recipient to set a 12+ character password. Links must currently be shared manually; no email sender is configured.
- New student logins are generated automatically at record creation or admissions enrolment. The system displays a name/student-number-based username and a random temporary password once for private handoff at the school office; portal access is blocked until the student sets a new password.
- Separate student/family portal views. Students see their own profile and finalized marks; guardians see only verified linked students, with results and fee summaries controlled by explicit per-child permissions.
- Campus-scoped dashboard and school profile read.
- School setup for academic-year planning and activation, terms, Grades 1–12 only, grade-specific editable subject/weekly-period defaults, upper-secondary streams, sections and a school-wide grading scale. Academic setup writes are validated, school-tenant scoped and audited. Subject/period templates are starter defaults; schools must verify them against current regional curriculum requirements.
- Core staff profiles and departments, teaching/homeroom assignment, assigned-class teacher scoping, staff attendance, leave review, in-app staff messages, and staff attendance CSV export. Payroll calculations are not included.
- Internal admissions workflow from enquiry through application, interview, decisions, protected document checklist, capacity-checked enrolment, sibling links, withdrawal/readmission/transfer, and printable HTML documents. There is no public admissions portal or generated PDF output.
- Bilingual student listing/search and create form using Amharic and Latin name fields.
- Student ID, health, learning-support and emergency-contact values use authenticated encryption at rest; sensitive views are role-restricted, no-store, and audited without copying plaintext values into audit events. Production requires a dedicated, backed-up `SENSITIVE_DATA_KEY`.
- Daily attendance by class with status selection and idempotent client UUIDs; an IndexedDB queue allows attendance submissions to be retried after connectivity returns.
- Draft marks entry with score validation, audit events, and idempotent client UUIDs.
- English / Amharic shell and responsive dashboard; Ethiopian calendar converter and Ethiopian-date display; locally bundled Inter and Noto Sans Ethiopic fonts.
- Installable PWA with 192/512 app icons, precached app shell, offline route fallback, and IndexedDB-backed attendance/marks retry queue. The UI adapts across phone, tablet, and desktop widths, with a scrollable labeled bottom navigation and sign-out control on phones. Demo mode supports an in-memory first run; MySQL mode uses Knex migrations and seeds.

## Important limitations

- Authentication, sample data, and implemented APIs are a foundation, not a production security certification. A role-by-route and cross-school authorization matrix, consent and retention workflows, end-to-end backup/restore evidence, and comprehensive security review remain incomplete. Sensitive student values are encrypted and audited as described above; configure and back up the production key before enabling their use.
- Portal invitations are created in Staff or a student's profile. Verify a guardian relationship and choose their results/fee permissions in the student's profile before creating the guardian invitation. Share invitation links only through a trusted channel; automated email delivery is not configured.
- Memory mode is ephemeral. Configure MySQL for persistent local workflows.
- Offline replay is limited to attendance and marks, requires the app to be open and online for sync, and has no background-sync guarantee.
- No public online admissions, payment gateway, payroll calculations, library, inventory, transport, LMS, extra languages, deployment, or cloud/local bidirectional sync is included.
- Ethiopian calendar UI preference is not yet persisted or honored across all date inputs; the converter is implemented, while reusable date-input coverage remains deferred.
- The release is not ready for production or real children’s data. Legal counsel must validate jurisdictional requirements before production.
