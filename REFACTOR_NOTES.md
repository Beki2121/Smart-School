# Refactor notes

## Scope from 2026-11-01

- Remaining work is repository movement only. Do not change runtime behavior, add migrations, features, endpoints, or dependencies.
- If a contract test finds a bug, skip that specific case, document it under “Known bugs found by contract tests,” and continue without fixing it.

## Non-refactor changes already on this branch

| Commit | Change | Adapter and file at the time | Database schema |
|---|---|---|---|
| `d752773` | Added the idempotent `fee_items.category` migration, defaulting existing rows to `core`. | Database migration: [`202610300002_fee_item_category.js`](./backend/migrations/202610300002_fee_item_category.js) | **Yes** |
| `e58802b` | Converted the MySQL DECIMAL payment amount to a number before comparing the remaining reversible amount. | MySQL, [`repository.js`](./backend/src/repository.js) at the time; now in the MySQL fees adapter. | No |
| `efb8bd0` | Rolled back in-memory staff creation when its audit write fails. | Memory, [`staff.repository.js`](./backend/src/repositories/memory/staff.repository.js) | No |
| `30f07f1` | Used the bounded attendance session UUID as the correction audit entity ID; retained student details in the audit payload. | MySQL, [`repository.js`](./backend/src/repository.js) at the time; now in the MySQL attendance adapter. | No |
| `1f8cc82` | Rolled back in-memory attendance submission when its audit write fails. | Memory, [`repository.js`](./backend/src/repository.js) at the time; now in the memory attendance adapter. | No |

`4835ef9` separately restored `subject.id` in the MySQL teaching-assignment return value so the staff extraction matches the original method. It adds no behavior change and does not touch the schema.

## Known bugs found by contract tests

- No contract cases are currently skipped. The bugs found before the move-only scope were fixed in the commits above; future findings must be skipped and recorded here rather than fixed.

## Known issue

- The Fees payment-entry controls are rendered inside a `div`, not a `form`. The inputs' native required-field validation and Enter-key form submission therefore do not apply to payment collection. This was observed during the refactor review and has not been changed.

## Repository adapter baseline

Before repository extraction, the sorted public prototype method lists were captured in [repository-methods-baseline.json](./backend/test/fixtures/repository-methods-baseline.json). The baseline contains 205 `MemoryRepository` methods and 200 `MysqlRepository` methods.

Methods present only on `MemoryRepository`:

- `campusNotificationRecipients`
- `findInvitationTarget`
- `mapAdmission`
- `mapAdmissionDocument`
- `mapAssignment`
- `mapLeaveRequest`
- `mapStaffAttendance`
- `mapStaffWithWorkload`
- `visibleStaff`

Methods present only on `MysqlRepository`:

- `enrichAdmission`
- `findLeaveRequest`
- `getInvitationTarget`
- `staffVisibility`

The adapter contract test checks these baseline lists remain unchanged during extraction. Use `npm run test:contracts --workspace backend` to run the MySQL-backed contract suite; it requires the local, ignored `.env.mysql-test` file and refuses to connect unless `DB_NAME` ends in `_test`.

## Extracted-domain contract coverage

Run the parity suite with:

```powershell
npm run test:contracts --workspace backend
```

The test database must already have all backend migrations applied. The suite reads the ignored repository-root `.env.mysql-test`, verifies the connected database name ends in `_test`, and runs identical cases against `MemoryRepository` and `MysqlRepository`.

- Staff coverage includes plan capacity, duplicate linked accounts, cross-campus department/account rejection, teacher/section/room timetable conflicts, duplicate-key error mapping, rollback on audit failure, attendance upserts, leave approval/rejection transitions, and audit events.
- Attendance coverage includes idempotent submissions, roster and section scoping, campus isolation, and correction-request approval/rejection. MySQL correction audits use the session ID as the bounded entity key and keep the student-specific change in the audit payload.
- Attendance audit-failure contract coverage found that memory submissions were retained after a failed audit write. `MemoryRepository.saveAttendance` now removes the new session and rethrows, matching MySQL transaction rollback.
- Attendance methods now live in parallel memory and MySQL repository bundles, composed through the compatibility facade. Attendance summary and correction helpers are in `attendance.mappers.js`; shared student mapping helpers are in `students.mappers.js`.
- Marks and report-card methods now live in parallel memory and MySQL repository bundles, composed through the compatibility facade. Their grading, mark-workflow, fingerprint, and report-revision helpers live in `marks.mappers.js`; published report mapping remains imported by the portal methods in the facade.
- Timetable period, room, substitution, and timetable-query methods now live in parallel memory and MySQL bundles. The shared weekday calculation is in `timetable.mappers.js`.
- Platform, subscription, school-export, and closure methods now live in parallel memory and MySQL bundles. Organization, plan, and date mapping helpers are in `platform.mappers.js`.
- Auth and account lookup, invitation, password, refresh-token, and organization-account methods now live in parallel memory and MySQL bundles. The repository compatibility facade still composes both adapter classes.
- Portal home, portal data views, and guardian-access updates now live in parallel memory and MySQL bundles; the shared portal student view mapper lives in `portal.mappers.js`.
- Communications coverage includes campus-scoped announcements and events, active notification recipients, campus isolation, and notification read status.
- Fees coverage includes campus-scoped fee setup and invoices, cashier shifts, payments, reversals, transaction rollback, and audit events. Fee methods are now composed from separate memory and MySQL repository bundles.
- Auth/account contracts now cover refresh-token rotation and reuse, login lockout, single-use password reset, invitation acceptance with role/campus assignment, and cross-organization invitation-target rejection in both adapters.
- The audit-failure contract found that memory staff creation retained the profile after a failed audit write. `MemoryRepository.createStaff` now removes the profile and rethrows, matching MySQL transaction rollback.

## Fee schema and decimal handling

- Migration [`202610300002_fee_item_category.js`](./backend/migrations/202610300002_fee_item_category.js) adds `fee_items.category` only when absent, as `NOT NULL` with the `core` default. Existing rows receive that default when the column is added; the existence check makes repeated `up` calls a no-op. It is additive and does not drop or rewrite existing fee records.
- The MySQL fee repository converts the DECIMAL value returned by MySQL to a number before comparing remaining reversible amounts. This prevents DECIMAL strings from producing incorrect over-reversal comparisons.

## Test database lifecycle

The disposable test database name must end in `_test`. Use `npm run test-db:setup --workspace backend` to create the database and recreate the dedicated test account as `'user'@'localhost'`, granting it privileges only on that database. Setup requires `TEST_DB_ADMIN_USER` and `TEST_DB_ADMIN_PASSWORD` in the local process environment; neither is committed or printed. Apply migrations with `npm run test-db:migrate --workspace backend`, then run `npm run test:contracts --workspace backend`.

Use `npm run test-db:teardown --workspace backend` to drop the configured `_test` database and its dedicated test account. The teardown script refuses database names without the `_test` suffix and only targets the configured test username at `localhost` and `%`.
