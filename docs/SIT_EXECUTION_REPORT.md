# SIT execution report

## Execution record

- **Execution date:** 2026-11-06
- **Environment:** Local Windows development workspace; Node.js test runner, Vitest/JSDOM, shared MySQL/in-memory adapter contract runner, isolated test fixtures. No production database, deployment, external mail service, or live school data was used.
- **Branch:** `feat/sit-menu-integration-tests`
- **Checklist source:** user-supplied full checklist in the working tree's `Gap Fix Prompts.md`; a snapshot of its individual cases is in `backend/test/fixtures/sit-cases.json`.

## Scope and case-status totals

| Checklist area | Total | PASS | FAIL | BLOCKED | NOT TESTED | NOT APPLICABLE |
|---|---:|---:|---:|---:|---:|---:|
| Role/menu combinations | 230 | 0 | 0 | 12 | 218 | 0 |
| Common-functionality checks | 18 | 0 | 0 | 0 | 18 | 0 |
| Phase 1/2 modules | 27 | 25 | 0 | 1 | 1 | 0 |
| **Total checklist cases** | **275** | **25** | **0** | **13** | **237** | **0** |

`PASS` on a module means the cited representative automated workflows passed; it is not a claim that every role/menu row or every subfeature passed. The transport cases are blocked by conflicting scope instructions. Every other role/menu and common-functionality case is explicitly left NOT TESTED rather than inferred from a visible route.

The SIT manifest-integrity suite separately checks that all requested entries have case IDs and the required test-case fields. Its assertions validate the register, not the underlying business feature.

## Executed commands

| Command | Result |
|---|---|
| `npm.cmd run report:sit` | PASS: rendered 275 checklist cases and 8 critical workflows into `docs/SIT_TEST_CASES.md`. |
| `npm.cmd run test:sit` | PASS: backend 382/382 tests (including 278 case-register integrity checks); frontend 30 files, 107/107 tests; shared contracts 103 passed, 0 failed, 2 skipped; route parity 458/458. |
| `npm.cmd run lint` | PASS: backend syntax checks and frontend TypeScript check. |
| `npm.cmd run build` | PASS; Vite reported a JavaScript chunk over 500 kB. |
| `git diff --check` | PASS for SIT-owned changes. |

### Executed behavior represented by the module PASS rows

The module evidence references executed API tests and memory/MySQL contracts for SaaS onboarding and limits, authentication/session rotation, permission denial, school/academic setup, admissions and enrolment, student lifecycle, attendance, exam scheduling and mark publication, fee lifecycle and receipts, guardian portal scope, reports/audit, HR, payroll, library circulation, communications/events, inventory/assets, and Front Desk. Exact evidence is recorded per case in `SIT_TEST_CASES.md`.

## Security and tenant isolation

- The route inventory validates 458 current routes against the snapshot and access table.
- The backend denial regression exercised every 446 permission-guarded API route with a no-permission account during the full backend suite.
- Existing tests/contracts cover representative school/campus isolation for students, admissions, reports, finance, payroll, library, inventory, portal, communications, support tickets and Front Desk.
- This run does **not** prove an allowed-role matrix for all 15 checklist roles, or cross-school read/write attempts against every checklist feature, export, download and background job. Those cases remain untested.

## Failures, skips, and blocked items

- **Failures:** 0 in the executed gates.
- **Contract skips:** 2, reported by the shared contract runner.
- **Build advisory:** production build passed; Vite reported a JavaScript chunk over 500 kB.
- **Blocked:** 12 Transport Manager role/menu cases and the Transport Management module. The project rules in `Gap Fix Prompts.md` exclude transport, while its Phase 2 checklist includes basic transport management. No transport feature was added.
- **Other untested cases:** 218 role/menu combinations, all 18 common-functionality checks, and the complete timetable lifecycle module case.

See `SIT_GAP_REPORT.md` for remaining validation and implementation work. This report does not certify complete SIT acceptance.
