# Refactor PR description

## Title

Complete the layered SIMS refactor with domain repository adapters

## Summary

- Split backend routes, controllers, schemas, and services into domain-oriented modules, and divide frontend workflows into page/component modules.
- Move repository methods into parallel memory and MySQL bundles for communications, staff, fees, attendance, marks, timetable, platform, accounts, portal, academic, students, and admissions.
- Preserve `repository.js` as the compatibility facade and preserve both adapters' public method inventories.
- Record the route/guard inventory and pure-move verification results in the refactor notes.
- Add README instructions for unit, lint, build, route, and dual-adapter contract checks.

### Extracted repository bundles

Memory:

- `backend/src/repositories/memory/academic.repository.js`
- `backend/src/repositories/memory/accounts.repository.js`
- `backend/src/repositories/memory/admissions.repository.js`
- `backend/src/repositories/memory/attendance.repository.js`
- `backend/src/repositories/memory/communications.repository.js`
- `backend/src/repositories/memory/fees.repository.js`
- `backend/src/repositories/memory/marks.repository.js`
- `backend/src/repositories/memory/platform.repository.js`
- `backend/src/repositories/memory/portal.repository.js`
- `backend/src/repositories/memory/staff.repository.js`
- `backend/src/repositories/memory/students.repository.js`
- `backend/src/repositories/memory/timetable.repository.js`

MySQL:

- `backend/src/repositories/mysql/academic.repository.js`
- `backend/src/repositories/mysql/accounts.repository.js`
- `backend/src/repositories/mysql/admissions.repository.js`
- `backend/src/repositories/mysql/attendance.repository.js`
- `backend/src/repositories/mysql/communications.repository.js`
- `backend/src/repositories/mysql/fees.repository.js`
- `backend/src/repositories/mysql/marks.repository.js`
- `backend/src/repositories/mysql/platform.repository.js`
- `backend/src/repositories/mysql/portal.repository.js`
- `backend/src/repositories/mysql/staff.repository.js`
- `backend/src/repositories/mysql/students.repository.js`
- `backend/src/repositories/mysql/timetable.repository.js`

## Verification

- `npm test`: passed after the admissions extraction (61 backend tests and 20 frontend tests).
- `npm run lint`: passed.
- `npm run build`: passed; Vite reports the existing large-chunk advisory.
- `npm run check:routes`: passed; 187 snapshot routes matched 187 runtime routes and guards.
- `npm run test:contracts --workspace backend`: 29 passed, 0 failed, 2 intentionally skipped documented cases.
- Repository method-baseline test: 2 passed; all 12 bundles per adapter and their methods are represented in the existing baseline.
- `npx madge --circular --extensions js,ts,tsx backend/src frontend/src`: 149 files processed; no circular dependencies found.
- `npm audit --omit=dev`: found 0 vulnerabilities.
- Pure-move verifier: staff 35 methods (one historical return-mapping difference, restored by `4835ef9`); fees 32, attendance 20, marks 26, timetable 12, and platform 38 methods compared with no other body differences.
- Credential-value, JWT, PEM private-key, and AWS access-key signature scans of branch additions found no matches. `.env.mysql-test` remains ignored and untracked.

## Review notes

The repository facade contains shared adapter setup and core operations, including dashboard aggregation, campus access/profile updates, audit append, and close. Its memory constructor still initializes the in-memory state collections across domains; no extracted-domain method implementations remain in the facade.

### Unfixed bugs and known issues

- Memory `activateAcademicYear` does not roll back its active-year state if the audit write fails. The memory audit-failure contract is skipped; the MySQL rollback case passes.
- The MySQL admission mapper omits `privacyConsentAt` from the returned public-submission object even though it persists the timestamp; the contract checks persistence.
- The MySQL `sections` table has no `is_active` column, but `readmitStudent` and `transferStudentSection` query it. Their MySQL contract is skipped; the corresponding memory cases run.
- The Fees payment-entry controls are inside a `div`, not a `form`; native required-field validation and Enter-key submission do not apply.

These known issues remain unchanged by the refactor.

The migration `202610300002_fee_item_category.js` is additive and idempotent, but a database backup is recommended before applying migrations.
