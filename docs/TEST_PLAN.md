# Focused test plan

## Automated checks in the current pass

- Node API tests with the in-memory repository: authentication, protected-route enforcement, campus-scoped access, role denial, validation/error envelopes, attendance idempotency and reasoned/audited correction, guardian attendance visibility, cross-campus rejection, draft marks and maximum-value validation, refresh-token rotation/reuse denial, and signed-licence platform validation.
- Attendance correction workflow: immediate same-day/24-hour grace-period edits; older edits remain unchanged while pending, duplicate pending requests are rejected, reviewers must differ from requesters, review notes are required, approved changes are audited/applied, rejected changes leave the original attendance intact, and non-review roles cannot access the campus queue.
- Report-card amendment workflow: creating a revision after publication requires a 5–500 character reason; the reason is retained in the revision and audit record, the former published snapshot remains immutable, and the new revision must pass submit/approve/publish again.
- Academic term lifecycle: only a term in the active campus academic year can become current; switching clears the previous current term and creates an audit event; missing, unauthorized or out-of-scope term changes are rejected.
- Student CSV import acceptance: quoted/validated upload preview, row errors, duplicate student number and identity detection, shared-guardian-phone warnings, no writes during preview, 600-row maximum and oversized rejection, one-time account credentials, and role denial.
- Header-hardening checks: Helmet CSP + frame-ancestors guard, X-Powered-By removal, and secure refresh-cookie attributes (HttpOnly, SameSite=Strict, Path=/api/auth).
- Ethiopian/Gregorian conversion: Ethiopian New Year boundary, Pagume leap/non-leap boundaries, 1920–2025 representative Gregorian round trips, bilingual date formatting.
- Frontend TypeScript check and Vite production build.
- Backend JavaScript syntax check.

## Phase 19 status

The project has moved into the hardening and QA phase described in the approved playbook. The current work establishes the baseline checks for security headers, cookie protection, attendance correction audit, guardian attendance visibility, and signed-platform validation. It does not claim production-hardening completion.

## Still required before production or real student data

- MySQL 8 migration/seed/re-entrant seed/rollback and utf8mb4 round-trip tests on a clean MAMP or local database instance.
- Full route×role×organization/campus×assigned-class×guardian-child authorization matrix, including support-session boundaries for super-admin access.
- JWT expiry/refresh-replay and concurrent-session validation against long-lived persistence.
- Attendance and marks offline replay during app restart/network loss; property tests under repeated retries and flush failures.
- Browser E2E for enrolment, attendance, marks, and campus communications; responsive and keyboard-only checks; service-worker/PWA install and offline behavior.
- Security testing, dependency audit, upload abuse tests, XSS/SQLi checks, error/log redaction, and audit-tamper controls.
- Release 1 module acceptance tests, report reconciliation, backup/restore drills, and controlled load tests.
