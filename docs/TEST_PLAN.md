# Focused test plan

## Automated checks in this pass

- Node API tests with Supertest and a temporary in-memory repository: public health, protected route authentication, campus-only reads, body-supplied campus ignored, validation/error envelope, attendance idempotency, cross-campus record rejection, role denial, draft marks/max validation, refresh-token rotation/reuse denial.
- Ethiopian/Gregorian conversion: Ethiopian New Year boundary, Pagume leap/non-leap boundaries, 1920–2025 representative Gregorian round trips, bilingual date formatting.
- Frontend TypeScript check and Vite production build.
- Backend JavaScript syntax check.

## Still required

- MySQL 8 migration/seed/re-entrant seed/rollback and utf8mb4 round-trip tests on clean MAMP.
- Full route×role×organization/campus×assigned-class×guardian-child authorization matrix.
- JWT expiry/revocation and refresh reuse across persistent concurrent sessions; rate-limit and lockout tests.
- Attendance and marks offline replay during app restart/network loss; property tests under retries.
- Browser E2E for enrolment, attendance and marks; responsive and keyboard-only checks; service-worker/PWA install and offline behavior.
- Security testing, dependency audit, upload abuse tests, XSS/SQLi checks, error/log redaction and audit tamper controls.
- Release 1 module acceptance tests, report reconciliation, load tests, DB backup and restore drills.
