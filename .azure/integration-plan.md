# SIMS integration hand-off

## Services

- **Essential — API:** project `backend/`; run from workspace root `npm run dev:api` (port `4000`); syntax check `npm run lint --workspace backend`; health `GET /api/health`.
- **Essential — Web/PWA:** project `frontend/`; run from workspace root `npm run dev:web` (port `5174`); build `npm run build` from the workspace root (or `npm run build` with `frontend/` as cwd).
- **Enhancement — Socket.IO:** API server enables WebSocket and polling transports; authenticated campus/role rooms are not implemented and the client does not yet depend on notifications.

## Frontend data seam

- API seam to maintain: `frontend/src/api.ts`.
- API base: `VITE_API_BASE_URL`, default `http://localhost:4000`.
- No standalone frontend mock client, mock dataset, duplicate type package, preview state switcher, or mock-state corner component exists. Keep the API-backed demo data in backend memory mode; do not silently replace with hardcoded frontend records.
- Shared types currently live alongside the client in `frontend/src/api.ts`; there is no shared workspace package or typed-client alias yet.
- Offline queue: attendance/marks only, IndexedDB records are principal-scoped and use client UUIDs; syncing requires the app to be open and online.

## API route inventory

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/dashboard`
- `GET /api/school`
- `PUT /api/school`
- `GET /api/academic-year`
- `GET /api/students`
- `POST /api/students`
- `GET /api/sections`
- `GET /api/attendance`
- `POST /api/attendance`
- `GET /api/marks`
- `POST /api/marks`

## Database

- MySQL 8 / InnoDB / utf8mb4; Knex migration directory `backend/migrations/`; repeatable developer sample seed `backend/seeds/`.
- Connection environment variables: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`; MAMP default example port is 8889.
- The initial migration covers tenancy/users, academic skeleton, student/guardian links, attendance, marks, refresh tokens, and audit log. Schema for other Release 1 modules remains deferred.
- **When expanding migrations or writing integration tests, add NO seed data.** Existing idempotent sample seed is only for a developer’s local MySQL demo and is documented separately.

## Integration tasks / safeguards

- Verify each listed route is smoke-testable; expand endpoint tests while preserving token-derived organization/campus scope and idempotency.
- Keep API writes behind the typed/validated seam; remove any synthetic display-only numbers rather than treating them as production metrics.
- Create integration/schema test coverage without adding demo/seed fixtures or migrations that seed records.
- Database mode is required for durable tests. Current focused tests use the isolated memory repository; MAMP port 8889 was not running during this pass.
- No deployment, payment gateway, public admissions, or Release 2 feature work is approved by this hand-off.
