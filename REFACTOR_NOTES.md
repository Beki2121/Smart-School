# Refactor notes

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
