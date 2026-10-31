# Repository audit and QA status — 2026-10-29

This is an implementation-status report, not a security certification, school-policy approval, or legal compliance attestation. The attached MVP brief was compared with the checked-in application structure and tests. Existing uncommitted changes were preserved.

## A. Repository findings

- **Repository:** `Beki2121/Smart-School`, branch `main`; repository root is the current SIMS workspace. The working tree contains numerous pre-existing modified and untracked files. No reset, cleanup, or commit was performed.
- **Frontend:** React 18, TypeScript, Vite, React Router and a custom responsive bilingual English/Amharic UI; PWA/service worker and IndexedDB retry queue.
- **Backend:** Node.js ES modules, Express, Zod request validation, JWT access tokens, rotating HTTP-only refresh cookie, role permission map, campus-derived authorization, Pino logging and Knex.
- **Persistence:** MySQL-protocol databases via `mysql2`/Knex; an in-memory repository supports API tests and ephemeral demos. Local migrations are applied. The intended hosted database has not been directly reached or migration-tested in this session.
- **Existing, tested workflows:** admission-to-enrolment/lifecycle, student and guardian profiles, guardian verification and portal permissions, staff/leave, timetable, attendance entry/correction and guardian attendance feed, mark review/approval/publication, report-card revisions, manual fee invoices/payments/reversals, communications/notifications, student/emergency-contact encryption, and the SaaS onboarding/subscription/plan/closure lifecycle in the in-memory API tests.
- **Automated test setup:** Node test runner with Supertest and an in-memory repository; no checked-in browser E2E runner or CI workflow was found. These API tests are not evidence of full MySQL or browser acceptance.
- **Deployment:** cPanel/LiteSpeed Node bridge and static Vite deployment guidance exist. No deployment, DNS change, live API, or hosted application was tested.

## B. Gap analysis

| Status | Findings |
|---|---|
| **EXISTING AND VERIFIED** | API authentication and role checks; school/campus-scoped student and finance paths in the in-memory suite; invitation-based student/guardian accounts; attendance idempotency and reasoned/audited correction; verified guardian attendance visibility; student lifecycle and CSV import preview/atomic eligible-row commit (up to 600 records); editable Grade 1–12 starter curriculum (no kindergarten or higher education); manual finance with audited reversals; AES-GCM sensitive fields and emergency contacts; mark draft → submit → distinct-user approval → publication transitions; frontend typecheck and production build. |
| **EXISTING BUT INCOMPLETE** | SaaS billing is manual; site limits are not enforceable until multi-site creation is exposed; the first platform administrator requires an operator-run bootstrap. Personal-data pseudonymization after closure is a due-date-gated, explicitly confirmed manual action; financial-record purge after its separate retention deadline is not implemented. Persisted hosted-database workflow tests and browser E2E acceptance are not present. Attendance notifications, provider-backed SMS/email, and payment-gateway integrations are not connected. |
| **MISSING** | Financial-record purge after the separately configured deadline; automated scheduling of due closure pseudonymization; hosted migration/integration test; browser E2E acceptance suite; automated backup/restore exercise; production monitoring and incident-response exercise. |
| **BLOCKED / REQUIRES OWNER ACTION** | The hosted database connection and credentials are outside this workspace/session, so migrations, backups, and persisted workflows against that database have not been tested. Do not copy a local/demo database dump over live data. The owner must provision the first platform administrator, then test against the intended hosted test database using its provider-approved backup and migration process. |

## C. Verification performed

| Check | Result | Evidence / limitation |
|---|---|---|
| `npm.cmd run test --workspace backend` | **PASS** | 53 tests passed, 0 failed, including closure pseudonymization date gating and tenant scoping in the in-memory API suite. This does not establish live MariaDB persistence or filesystem cleanup against production storage. |
| `npm.cmd run lint` | **PASS** | Backend syntax checks and frontend TypeScript check passed. |
| `npm.cmd run build --workspace frontend` | **PASS** | Production Vite/PWA build completed. Existing >500 kB chunk-size warning remains. |
| `npm.cmd audit --omit=dev` | **PASS** | Initial audit found a high Zod advisory; Zod was upgraded to v4.6.7. Runtime dependency audit reports 0 vulnerabilities and API regression tests pass on the upgraded version. |
| `npm.cmd audit` | **PARTIAL** | Non-breaking `npm audit fix` removed the serialize-javascript advisory. Four low findings remain in the development-only Workbox build chain via deepmerge. `npm audit fix --force` proposes a breaking downgrade of vite-plugin-pwa; it was not applied. |
| `npm.cmd run check:env` | **PASS** | Current local configuration passes; output contains no credentials. |
| `git diff --check` | **PASS** | No whitespace errors. |
| Local migration and backup | **PASS** | A fresh backup was created outside the repository and the additive SaaS migration applied locally; Knex reports no pending migrations. This is not a substitute for the hosted database's own backup and restore checks. |
| Versioned school export | **PASS** | Read-only smoke test resolved all 55 export sections against local data without printing school records. The API lifecycle test verifies export scope/shape and closure gating. Hosted database/export-file restore remains untested. |
| Hosted database migration, browser E2E, live provider delivery | **NOT TESTED** | Hosted DB is not connected in this session; no production/test-host writes or external delivery checks were performed. |

## D. Prioritized implementation checklist

1. **NEXT — add a dry-run and scheduled worker for closure pseudonymization**, then implement the separate financial-record purge only after the owner approves an appropriate retention policy.
2. **NEXT — provision the first platform administrator** through the guarded audited bootstrap and remove its temporary environment variables immediately after use.
3. **NEXT — validate deployment on the intended hosted test database.** Take and verify a provider-side backup, migrate an empty/test schema, and run smoke tests without importing local demo records into a school database.
4. **NEXT — add persisted multi-tenant integration and browser acceptance tests** for onboarding, isolation, enrolment, attendance, results, guardian access, fees, exports, suspension, and closure.
5. **BEFORE PILOT — add upload abuse tests, responsive/keyboard review, complete route-permission review, and an isolated backup/restore drill.**
6. **BEFORE PRODUCTION — configure/back up `SENSITIVE_DATA_KEY`, validate hosting/data location and privacy obligations, complete incident response and legal review, and obtain explicit deployment authorization.**

## E. Current recommendation

**NOT READY** for production or real student data. Controlled local/demo testing is appropriate. Staging acceptance is blocked until the hosted migration chain, persisted tenant-isolation tests, browser acceptance flows, and backup/restore evidence are verified. No hosted deployment, production migration, DNS change, or live gateway test was performed.
