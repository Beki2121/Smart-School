# Deployment and pilot guide

## Scope

This document captures the next deployment-focused milestones in the approved SIMS roadmap: local install readiness, infrastructure checks, and a pilot rollout checklist. It is intentionally scoped to the existing project structure and avoids production claims or live migration work.

## Apache Node deployment: iLink Market domains

Target hostnames:

- Frontend: `https://school.ilink.market`
- Backend API: `https://bschool.ilink.market`

The frontend build embeds its public API base URL. The project-root `.env.production` sets `VITE_API_BASE_URL=https://bschool.ilink.market`; this is intentionally public configuration, not a place for secrets. Local development continues to use `http://localhost:4000`. Vite reads the project-root environment files through the configured `envDir`.

### Backend Node application

1. Create the database and a dedicated database user in the hosting panel. Do not use the database `root` user. The reported MariaDB 10.11.19 speaks the MySQL protocol used by Knex/mysql2, but the live server has not been reachable for direct migration/integration testing. Confirm MariaDB support and the supported database host/connection mode with the host before importing school data.
   - Create a new database with `utf8mb4` and `utf8mb4_unicode_ci`. The phpMyAdmin report says its current server connection uses `utf8mb3`; do not assume that new tables will inherit the application's required charset. Check database and table collations after import. Ethiopic characters are within utf8mb3's BMP range, but utf8mb4 is the project target and handles the full Unicode range.
2. Configure a Node.js 20+ application for `bschool.ilink.market` using the host's Node/Passenger application manager. Use the project root as the application root and follow the LiteSpeed/cPanel startup-file instructions below. Do not configure the ESM `src/server.js` directly when the provider's loader uses synchronous `require()`.
3. Install dependencies from the project root with `npm ci` (or the provider's workspace-compatible install command). Ensure the installed deployment contains `backend/migrations`, `backend/seeds`, and root workspace dependencies.
4. Set the following environment variables in the host's application manager. Keep credentials there rather than in source control:

```text
NODE_ENV=production
PORT=<port assigned by the hosting Node application manager>
WEB_ORIGIN=https://school.ilink.market
WEB_ALLOWED_ORIGINS=https://school.ilink.market
JWT_ACCESS_SECRET=<unique randomly generated secret, at least 32 characters>
JWT_ACCESS_TTL=15m
SENSITIVE_DATA_KEY=<dedicated random 32-byte key encoded as base64url>
STORAGE_MODE=mysql
DB_HOST=<database host from provider, often localhost>
DB_PORT=<database port from provider, often 3306>
# Optional: set DB_SOCKET_PATH to the exact socket path only if the host requires it; then DB_HOST/DB_PORT are ignored.
DB_SOCKET_PATH=
DB_USER=<dedicated database user>
DB_PASSWORD=<database password>
DB_NAME=<database name>
PRIVATE_DOCUMENTS_DIR=<private directory outside the public web root>
```

Allow only the deployed frontend origin in production. The API rejects non-HTTPS/loopback production CORS origins. For local browser checks, use the Vite development proxy described below rather than adding localhost to production CORS. Browser cookie credentials are enabled, and the production refresh cookie is Secure; serve both subdomains over HTTPS.

Generate `SENSITIVE_DATA_KEY` locally with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` and set it only in the hosting environment manager. It is separate from `JWT_ACCESS_SECRET`; production startup rejects a missing key. Keep a protected backup and retain the same key across restarts and deployments: encrypted student fields cannot be recovered if it is lost, and replacing it without a data re-encryption procedure makes existing values unreadable. Local development may leave it unset until using the protected student-data panel; writes then fail explicitly.

5. Before importing or migrating, make a separate backup of the **target live database** and verify that it can be restored. A local MAMP backup is not a backup of the hosting database. Confirm the selected database is the intended target and inspect its row counts; do not overwrite existing live data unless that is explicitly intended. Keep SQL dumps/backups out of `public_html`, the source deployment, and Git.
6. For a new installation, leave the backed-up live database empty and let Knex create the application schema. Import an existing database dump only when migrating its real school data is explicitly intended; never overwrite a live database with a local development/demo dump. When importing a prior schema, verify its `knex_migrations` history before proceeding.
7. With the backend's production environment variables set and current working directory at the repository root, run `npm run db:migrate` using the host terminal. Check the migration output and `knex_migrations` afterward. Do not run `npm run db:seed` against a school database. Never run destructive rollback commands on the live database.
8. Configure the host's process manager to restart the application and verify `https://bschool.ilink.market/api/health` reports `storage: mysql`.

### Organization branches and active sessions

School owners manage branches from the SIMS branch page. Branch creation is checked against the assigned subscription's site limit, and every school administrator in the organization receives membership in newly created branches. A Principal remains limited to their assigned branch. Users can switch only to a branch where they have active membership; switching revokes the presented refresh token, replaces the refresh cookie, issues a new branch-scoped access token and records an audit event. Requests using an access token for a deactivated branch are rejected immediately.

The branch-session migration `202611010001_refresh_token_campus_scope.js` adds branch context to refresh tokens. Back up the target database before applying migrations, then deploy backend and frontend together so the branch switcher and API are available.

### Student, staff, and family account rollout

Deploy the backend with its migrations before uploading the updated frontend. The account workflow requires the `account_invitations` table, student/guardian `user_id` columns, and user `username`/`must_change_password` columns.

When staff create a student record or enrol an accepted applicant, the system creates a student login automatically. The response displays a generated username based on the student's Latin name and student number, plus a cryptographically random temporary password, exactly once. The password is stored only as a hash. Give the credential slip privately to the student/family through the school office; do not put it in notes, email, or public channels. On first sign-in, portal access is blocked until the student changes the temporary password to one with at least 12 characters.

Use **Staff** to invite eligible staff, and open an enrolled student's profile to invite that student through the separate invite flow or manage a linked guardian. School staff must verify a guardian relationship and explicitly select results and fee visibility before a guardian can be invited. Invitation links are one-time and expire after 48 hours. The application does not send email; copy and share each link manually through a trusted channel. Do not treat database credentials as application login credentials.

For this release, the updated build must also be uploaded from `frontend/dist/` to publish the Staff navigation, sign-out control, invitation forms, and portals. After upload, hard-refresh the site or clear the installed PWA's cached site data if it continues to show an older interface.

`backend/.htaccess` contains Apache access restrictions. Let cPanel's Node.js Setup generate the host-specific Passenger directives for the application root, URL, Node version, and startup file; preserve those generated directives when applying this file. Those paths depend on your hosting account and cannot be safely guessed in a reusable project template.

Keep the Node application and private uploads outside the frontend's public document root whenever the hosting panel permits it. The frontend document root should contain only the built `frontend/dist/` contents. If cPanel requires the Node app directory to be web-reachable, use the provider-generated routing and access restrictions and verify that source files, `.env`, dependency metadata, migration files, uploads, and backups cannot be fetched over HTTP.

### LiteSpeed/cPanel startup compatibility

Some LiteSpeed Node.js launchers load the startup file with synchronous `require()`. Do not set `src/server.js` as the Passenger startup file in that case: it is an ES module graph, and the loader can fail with `ERR_REQUIRE_ASYNC_MODULE`. Use the CommonJS bridge instead:

- If the application root contains `src/server.js` and `package.json`, upload `backend/start.cjs` into that root and set the startup file to `start.cjs`.
- If the application root is the repository root, set the startup file to `backend/start.cjs`.
- Keep the corresponding backend source, package metadata, runtime dependencies and migration files beside their expected paths.

In production, Express trusts one reverse-proxy hop so rate limiting can identify the forwarded client IP. This is deliberately limited to one hop; do not change it to trust every proxy or arbitrary forwarded headers.

Set `JWT_ACCESS_SECRET` in the Node application's environment manager to a private random value of at least 32 characters. Generate one locally, for example with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`, and do not share or commit it. A short value causes startup configuration validation to fail, independent of the Passenger loader fix.

### Client demonstration database

The demo seed creates a fictional organization and campus, one administrator, 12 learners across three grades, staff and teaching assignments, a timetable, grades/marks, attendance, admissions, ETB fee items and example invoices/payments, announcements and events. It contains fictional sample records only.

Use a dedicated empty database for the public client demo, not a school database or a database containing imported records. After applying migrations, run the seed once from the project root using the provider terminal, where the `DB_*` variables point to that demo database. Set `NODE_ENV=production`, `ALLOW_DEMO_SEED=true`, a demo-only `DEMO_LOGIN_EMAIL`, and a unique `DEMO_LOGIN_PASSWORD` of at least 16 characters. Enter the password securely in the terminal rather than putting it in a command, source file, or this conversation. Then run `npm run db:seed`. Demo seeding always requires explicit opt-in; production seeding permits only the reserved platform system organization and refuses to continue when any school, campus, user, or student records already exist. The showcase seed additionally verifies that it is writing only to the dedicated demo school. Remove the temporary `ALLOW_DEMO_SEED` setting after seeding, restart the API, and share the demo login only with intended viewers. The shared demo administrator has full access to the demo tenant; do not reuse its credentials elsewhere.

### Frontend static site

1. Build with `npm ci` and `npm run build` from the project root. The production API URL is in `.env.production`.
2. Upload the **contents** of `frontend/dist/` to the document root for `school.ilink.market`, including `.htaccess` (Vite copies it from `frontend/public/.htaccess`).
3. Enable HTTPS for both hostnames in the hosting panel.
4. Verify the frontend loads, direct navigation to a nested React route falls back to `index.html`, and sign-in requests reach the backend hostname.

`frontend/public/.htaccess` is for Apache static hosting. If the frontend is instead served by a Node process, use the provider's Node routing and retain the SPA fallback behavior.

### Local frontend against the hosted API

Run the frontend locally with `npm run dev:web` and open `http://localhost:5174`. By default, Vite proxies `/api` to the local backend at `http://localhost:4000`. To check the local frontend against the deployed backend before publishing, point the Vite proxy to the hosted API:

```powershell
$env:VITE_API_BASE_URL=''
$env:VITE_API_PROXY_TARGET="https://bschool.ilink.market"
npm.cmd run dev:web
```

Leave `VITE_API_BASE_URL` empty so browser requests remain same-origin with Vite and the proxy forwards them to the hosted API. This allows the hosted refresh cookie to work on the local frontend without a browser CORS exception. Restart Vite after changing these variables. The hosted API must be healthy and use the intended demo/test data; avoid testing with real student records. Never put database credentials or JWT secrets in a `VITE_` variable because Vite embeds those values in browser assets.

Before enabling the deployment with real student records, complete the authorization, privacy, consent, retention, backup/restore, and legal-review gates described in [PRIVACY.md](./PRIVACY.md) and [TEST_PLAN.md](./TEST_PLAN.md).

## Local install model

For the current project, the preferred local deployment model is a school-local installation running Node.js + Express + the provider-supported MySQL-protocol database directly on a machine or local server without Docker.

### Windows / MAMP checklist

- Install Node.js 20+ and npm.
- Start the configured local database service.
- Create an empty database with utf8mb4 encoding and a UTF-8 collation.
- Copy `.env.example` to `.env` and set the values for the local machine.
- Validate the environment with:

```powershell
npm run check:env
```

- If using MySQL, run:

```powershell
npm run db:migrate
$env:NODE_ENV='development'
$env:ALLOW_DEMO_SEED='true'
npm run db:seed
$env:ALLOW_DEMO_SEED=''
```

- Start the application:

```powershell
npm run dev
```

### Recommended readiness checks before pilot

- `GET http://localhost:4000/api/health` returns `ok`.
- `npm test` passes in the local backend workspace.
- `npm run lint` passes.
- `npm run build` succeeds.
- The principal, registrar, teacher, and accountant roles can complete a representative assignment flow without cross-campus leakage.
- A controlled pilot covers one assessment cycle and one fee collection cycle.

## Shared-hosting and cPanel considerations

Before using cPanel or a shared host, confirm the following with the provider:

- Whether Node.js is supported and which version is available.
- Whether WebSocket connections are allowed, or whether Socket.IO long-polling fallback is acceptable.
- The database version and supported connection modes, whether the Node process can connect over TCP or needs a UNIX socket (`DB_SOCKET_PATH`), and whether the database/table collations use utf8mb4.
- Whether SSH and cron are available for scheduled jobs.
- Whether idle Node.js processes are stopped or limited by memory or process quota.
- Where the hosting location is physically stored, because child-data handling has legal and privacy implications.

If idle spin-down is a problem, a cPanel cron job hitting an internal health/cron route can keep the app warm, but the school must still confirm this approach is permitted and reliable for the site.

## Cloud deployment posture

This build is not a simultaneous cloud/local sync system. In line with the approved roadmap, the project supports a single deployment model per installation:

- school-local installation; or
- controlled hosted deployment that continues to use the same backend structure and local deployment practices.

This is intentionally narrower than a bidirectional sync deployment and avoids overstating readiness.

## Pilot rollout checklist

1. Confirm a single campus and controlled subset of staff, guardians, and students for the pilot.
2. Review the role matrix and guardian-child visibility rules before enabling broader access.
3. Run the full API test suite and a local browser smoke pass.
4. Test the attendance and marks workflow from data entry to reporting.
5. Run a fee workflow: invoice, payment, receipt, and reversal.
6. Confirm the event and announcement flows and in-app notification readers.
7. Verify the school’s backup/restore and support process before the pilot begins.
8. Capture issues, decisions, and corrective actions in the project documentation.

## Production caution

Do not use real children’s data or make a public deployment until:

- the route-by-route access matrix is complete,
- guardian verification and consent flows are validated,
- privacy and incident-response procedures are reviewed,
- the school has approved retention and support terms,
- and legal counsel has cleared the deployment for the local jurisdiction.

This deployment guide is therefore a rollout and pilot readiness document, not a production certification.
