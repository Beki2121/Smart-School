# SmartSchool SIMS

Release 1 foundation for a bilingual (English / Amharic), multi-campus Student Information Management System. Built with React 18 + Vite, Express, Node.js ES modules, MySQL 8 / Knex, and a handwritten responsive UI. No Docker is used.

> **Implementation status:** this is an initial buildable foundation, not a completed Release 1 product. Implemented and deferred modules are itemized in [`docs/PROGRESS.md`](docs/PROGRESS.md). Do not enter real student information until the security, privacy, role/class/guardian access, retention, and school policy work is reviewed and completed.

## Requirements

- Node.js 20 or newer and npm
- MySQL 8 for durable use. MAMP works with the example `127.0.0.1:8889` settings.
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
2. Edit root `.env`, set `STORAGE_MODE=mysql`, and set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` for the local server. MAMP commonly uses port `8889`.
3. Run:

```powershell
npm run db:migrate
npm run db:seed
npm run dev
```

The seed is repeatable. It creates a local demo administrator and sample learners. Change the demo password in `.env` before seeding. The current migration establishes the core organization/campus, access, academic structure, people, attendance, marks, refresh-token, and audit tables. Schema coverage for remaining Release 1 modules is deferred.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Starts the API on port 4000 and Vite on port 5174 |
| `npm run dev:api` / `npm run dev:web` | Starts one workspace service |
| `npm run build` | Type-checks and builds the frontend PWA |
| `npm test` | Runs API and calendar tests |
| `npm run lint` | Checks backend JavaScript syntax and frontend TypeScript |
| `npm run db:migrate` | Applies Knex migrations |
| `npm run db:rollback` | Rolls back the most recent migration |
| `npm run db:seed` | Idempotently creates sample organization, campus and demo records |

API readiness: `GET http://localhost:4000/api/health`. API errors use `{ "error": { "code", "message", "details?" } }`. Route inventory is in [`docs/API.md`](docs/API.md).

## Implemented workflows

- Sign in/out, short-lived JWT access, HTTP-only rotating refresh cookie with hashed refresh-token storage, login attempt lockout, role checks, and access-token organization/campus claims.
- Campus-scoped dashboard and school profile read.
- School setup for academic-year planning and activation, terms, grade levels, sections and bilingual subjects. Academic setup writes are validated, campus-scoped and audited.
- Bilingual student listing/search and create form using Amharic and Latin name fields.
- Daily attendance by class with status selection and idempotent client UUIDs; an IndexedDB queue allows attendance submissions to be retried after connectivity returns.
- Draft marks entry with score validation, audit events, and idempotent client UUIDs.
- English / Amharic shell and responsive dashboard; Ethiopian calendar converter and Ethiopian-date display; locally bundled Inter and Noto Sans Ethiopic fonts.
- PWA manifest/service-worker shell; demo mode supports an in-memory first run. MySQL mode uses Knex migrations and seeds.

## Important limitations

- Authentication, sample data, and implemented APIs are a foundation, not a production security certification. Class assignment checks, guardian-child restrictions, configurable persisted RBAC, sensitive-field encryption, consent workflows, upload controls, and audited sensitive-data viewing are not complete.
- Memory mode is ephemeral. Configure MySQL for persistent local workflows.
- Offline replay is limited to attendance and marks, requires the app to be open and online for sync, and has no background-sync guarantee.
- No public admissions, payment gateway, payroll calculations, library, inventory, transport, LMS, extra languages, deployment, or cloud/local bidirectional sync is included.
- Ethiopian calendar UI preference is not yet persisted or honored across all date inputs; the converter is implemented, while reusable date-input coverage remains deferred.
- The release is not ready for production or real children’s data. Legal counsel must validate jurisdictional requirements before production.
