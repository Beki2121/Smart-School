# Refactor notes

## What moved

- Backend routes, controllers, schemas, and service logic are separated into domain modules; frontend workflows are split into page/component modules.
- Repository methods are split into matching memory and MySQL bundles for communications, staff, fees, attendance, marks, timetable, platform, accounts, portal, academic, students, and admissions. Their shared mapping and validation helpers live in `backend/src/repositories`.
- `backend/src/repository.js` remains the compatibility facade and composes all 12 memory and all 12 MySQL bundles. Each class still declares its constructor, dashboard aggregation, audit append, campus read/update, and close methods. The memory constructor also initializes the domain state collections. No extracted-domain method implementations remain there.
- The runtime route snapshot contains 187 routes; the post-extraction route and guard check matched all 187.
- `backend/test/fixtures/repository-methods-baseline.json` preserves the sorted pre-extraction public API: 205 memory methods and 200 MySQL methods. The method-baseline test verifies the composed public API and rejects duplicate method names. Final review also checked every individual bundle's method names against the fixture.
- Methods present only on `MemoryRepository`: `campusNotificationRecipients`, `findInvitationTarget`, `mapAdmission`, `mapAdmissionDocument`, `mapAssignment`, `mapLeaveRequest`, `mapStaffAttendance`, `mapStaffWithWorkload`, `visibleStaff`.
- Methods present only on `MysqlRepository`: `enrichAdmission`, `findLeaveRequest`, `getInvitationTarget`, `staffVisibility`.
- `tools/verify-pure-move.js` results for the requested extractions:
  - `f38257f` staff: 35 methods compared; one difference in `MysqlRepository.createTeachingAssignment` (`subject.id` versus `data.subjectId`). Commit `4835ef9` restored `subject.id`.
  - `6a525df` fees: 32 compared; no differing bodies.
  - `5c09e40` attendance: 20 compared; no differing bodies.
  - `d6cdee8` marks: 26 compared; no differing bodies.
  - `7c0be3b` timetable: 12 compared; no differing bodies.
  - `e2659e8` platform: 38 compared; no differing bodies.
- Run all checks from the repository root as described in README's "How to run the checks". Contract tests require the local `_test` MySQL database and localhost-only test account; setup, migration, and teardown use the backend `test-db:*` scripts.
- The fee-item category migration is additive and idempotent: existing rows receive the `core` default, and repeated application does not recreate the column. Back up the database before applying migrations.

## Non-refactor fixes already on this branch

| Commit | Change | Adapter and file | Schema |
|---|---|---|---|
| `d752773` | Added the idempotent `fee_items.category` migration with a `core` default for existing rows. | Migration: [`202610300002_fee_item_category.js`](./backend/migrations/202610300002_fee_item_category.js) | Yes |
| `e58802b` | Convert MySQL DECIMAL payment amounts to numbers before comparing remaining reversible amounts. | MySQL fees repository (originally `repository.js`, now [`fees.repository.js`](./backend/src/repositories/mysql/fees.repository.js)) | No |
| `efb8bd0` | Roll back memory staff creation when the audit write fails. | Memory: [`staff.repository.js`](./backend/src/repositories/memory/staff.repository.js) | No |
| `30f07f1` | Use the bounded attendance session UUID as the correction audit entity ID; retain student-specific details in the audit payload. | MySQL attendance repository (originally `repository.js`, now [`attendance.repository.js`](./backend/src/repositories/mysql/attendance.repository.js)) | No |
| `1f8cc82` | Roll back memory attendance submission when the audit write fails. | Memory attendance repository (originally `repository.js`, now [`attendance.repository.js`](./backend/src/repositories/memory/attendance.repository.js)) | No |
| `4835ef9` | Restore `subject.id` in the teaching-assignment return value to preserve the original implementation. | MySQL: [`staff.repository.js`](./backend/src/repositories/mysql/staff.repository.js) | No |
| `ec052d8` | Restore the `bcrypt` import needed by the compatibility facade after extraction. | Shared facade: [`repository.js`](./backend/src/repository.js) | No |

## Known bugs not fixed

- Memory `activateAcademicYear` does not roll back its active-year state if the audit write fails. That memory contract is skipped; the MySQL rollback case passes.
- The MySQL admission mapper omits `privacyConsentAt` from the returned public-submission object even though it persists the timestamp. The contract checks persistence; this mapping difference remains unchanged.
- The MySQL `sections` table has no `is_active` column, but `readmitStudent` and `transferStudentSection` query it. Their MySQL contract is skipped; the corresponding memory cases run. No migration or behavior change was made.
- The Fees payment-entry controls are inside a `div`, not a `form`; native required-field validation and Enter-key submission do not apply.
