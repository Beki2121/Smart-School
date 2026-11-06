# System integration testing

## What this suite covers

The supplied checklist contains 230 role-specific menu rows (183 unique labels), plus 18 common-functionality checks and 27 Phase 1/2 module checks. Its opening status report instead gives a 134-menu baseline. Because these totals conflict, this suite does not infer a 134-item list or claim that all 230 checklist rows are verified.

`frontend/src/navigation.integration.test.tsx` derives all 27 unique active path-based destinations exposed to current school roles and verifies that each resolves to a page-specific breadcrumb title. `frontend/src/App.test.tsx` exercises the application authorization boundary for every one of those destinations using a signed-in user with no permissions. These tests automatically include added route-based school menu destinations. Existing route and feature integration coverage is also exercised by:

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

## Limits

The suite checks the current 27 active path-based destinations and runs the existing feature suites; it does not prove that every checklist menu or common functionality is implemented. In particular, it does not provide an item-by-item test result for the 230 role/menu rows. Route-title and denied-access checks do not replace successful end-to-end workflow tests. There is no browser-driven end-to-end runner or production integration environment configured. Resolve the 134-versus-230 discrepancy and map each checklist row to its intended screen/workflow before claiming complete checklist coverage.
