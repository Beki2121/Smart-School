# System integration testing

## What this suite covers

The supplied checklist contains 230 role-specific menu rows (183 unique labels), 18 common-functionality checks, and 27 Phase 1/2 module checks. Its opening status report instead gives a 134-menu baseline. This suite uses the explicit 230-row acceptance requirement and preserves role-specific duplicates; it does not invent the missing 134-item set.

The full test-case register is `backend/test/fixtures/sit-cases.json`; the human-readable matrix is `docs/SIT_TEST_CASES.md`. `backend/test/sit-matrix.test.js` checks that all requested entries are mapped with complete test-case metadata. It does not mark a feature as passed merely because a path exists.

`frontend/src/navigation.integration.test.tsx` derives all 27 unique active path-based destinations exposed to current school roles and verifies that each resolves to a page-specific breadcrumb title. `frontend/src/App.test.tsx` exercises the application authorization boundary for every one of those destinations using a signed-in user with no permissions. These are navigation and denial checks, not successful feature workflows. Existing route and feature integration coverage is also exercised by:

| Area | Existing test coverage |
|---|---|
| UI shell, public routes, branch switching, guardian/student portal | `frontend/src/App.test.tsx` |
| Role-filtered school/platform/portal navigation | `frontend/src/navigation.test.tsx` |
| Feature page workflows | Frontend page tests under `frontend/src/pages/` |
| API authentication, validation, permissions, tenant behavior | `backend/test/api.test.js` |
| Shared MySQL and in-memory repository behavior | `backend/scripts/repository-contracts.contract.js` |
| Backend route access inventory | `npm.cmd run check:routes` and `docs/API-ROUTE-PERMISSIONS.md` |

Run the complete system test gate with:

```powershell
npm.cmd run test:sit
```

The gate runs all backend and frontend tests, shared MySQL/in-memory repository contracts, and route/permission inventory parity.

Regenerate the detailed test-case document from the checked-in manifest with:

```powershell
npm.cmd run report:sit
```

## Test environment and safety

- Tests use synthetic fixture data and the repository's existing in-memory and isolated MySQL contract adapters.
- Never point the contract runner at a production database. Do not copy production data into fixtures.
- External services and hosted deployment are not required for the local suite; their behavior remains unverified unless separately configured and explicitly tested.
- Keep separate results for role-menu behavior, feature workflow behavior, permission denial, and tenant isolation. A passing test in one dimension does not imply the others pass.
- Each test-case row uses `PASS`, `FAIL`, `BLOCKED`, `NOT TESTED`, or `NOT APPLICABLE`, plus priority `P0`–`P3`.

## Limits

The case register covers all 230 role/menu rows, 18 common checks, and 27 module checks, but executed functional coverage is incomplete: most cases are explicitly `NOT TESTED`. Twenty-five module entries cite representative passing tests; transport is blocked by conflicting scope instructions, and the complete timetable lifecycle is not tested. See `SIT_EXECUTION_REPORT.md`, `SIT_TEST_CASES.md`, `SIT_PROGRESS.md`, and `SIT_GAP_REPORT.md`.

There is no browser-driven end-to-end runner or production integration environment configured. Full acceptance requires successful-role workflows for every checklist row and applicable common checks—not only case mapping, route-title checks, or generic access denial.
