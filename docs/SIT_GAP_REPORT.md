# SIT gap report

## P0 — scope and authorization

1. **Transport scope contradiction (`SCOPE-TRANSPORT-001`)**
   `Gap Fix Prompts.md` project rules exclude transport, but the checklist includes 12 Transport Manager menus and Phase 2 basic transport management. Those 13 cases are BLOCKED; obtain an explicit scope decision before adding or testing transport.
2. **All-role authorization matrix incomplete**
   Current tests cover selected role matrices and deny all 446 guarded API routes for a no-permission account. They do not prove successful access and prohibited operations for every one of the 15 role groups and 230 role/menu rows. Add role-specific API and direct-navigation tests, including tenant scoping, before marking these cases passed.
3. **Cross-tenant route matrix incomplete**
   Existing adapter/API tests prove representative isolation, but not a two-school read/write attempt through every relevant API, export, file download, search, report and worker. Add endpoint/category-specific adversarial fixtures and record each result.

## P1 — critical workflows and Phase 1

1. **Role/menu cases not executed**
   218 of 230 checklist role/menu cases are NOT TESTED. The 25 module PASS entries cite representative integration workflows only; they do not imply all row-level role capabilities are verified.
2. **Common-functionality sweep absent**
   All 18 common checks remain NOT TESTED as a cross-module applicability matrix. Existing feature tests prove examples of create, validation, attachments, exports, notifications, and audit behavior, but no systematic test checks every applicable module.
3. **Result/fees/report end-to-end depth**
   Existing API and adapter tests cover important segments. The SIT does not run a single browser-to-API-to-MySQL flow from setup through publication/payment/report consumption for all listed roles.

## P2 — Phase 2

1. **Timetable lifecycle (`GAP-TIMETABLE-SIT-001`)**
   A read-only timetable UI test exists, but a full create/configure/assign/conflict/persist/retrieve and portal-visibility integration scenario was not identified; the module case is NOT TESTED.
2. **HR-to-payroll end-to-end**
   Separate HR and payroll adapter workflows pass, but a single staff creation → salary setup → attendance/leave → payroll calculation → payslip/history workflow is not evidenced.
3. **Reception, inventory, and library per-role paths**
   Representative subsystem contracts and selected UI/API tests exist. Specific checklist submenus and all role variants remain untested.

## P3 — cross-cutting / environment

1. **Mobile/responsive acceptance**
   No viewport-based browser E2E run was executed.
2. **External and deployment behavior**
   Hosted MySQL, SMTP delivery, backup restore, production monitoring, and live deployment integrations were not exercised in this SIT run.
3. **Checklist count discrepancy**
   The overview baseline says 134 menus; the detailed checklist has 230 role/menu rows and 183 unique labels. This SIT uses the explicit 230-row acceptance requirement and preserves role-specific duplicates.
