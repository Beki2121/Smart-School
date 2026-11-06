# SIT coverage progress

## Checklist coverage

| Area | Required | Mapped | Functional PASS | BLOCKED | NOT TESTED |
|---|---:|---:|---:|---:|---:|
| Role-specific menu rows | 230 | 230 | 0 | 12 | 218 |
| Common functionality | 18 | 18 | 0 | 0 | 18 |
| Phase 1/2 modules | 27 | 27 | 25 | 1 | 1 |
| **Total** | **275** | **275** | **25** | **13** | **237** |

`backend/test/fixtures/sit-cases.json` is the canonical generated case register. Every case includes an ID, phase, module, role, scenario, preconditions, synthetic test-data description, steps, expected result, actual result, status, defect reference, and priority. The source checklist itself remains a user-owned working-tree change and is not required by the automated test runner.

## Role/menu mapping

| Checklist role | Application role key | Rows mapped |
|---|---|---:|
| Platform Administrator | `super_admin` | 17 |
| School Administrator | `owner_director` | 20 |
| Principal / School Director | `principal` | 14 |
| Academic Director / Coordinator | `academic_head` | 17 |
| Registrar / Admission Officer | `registrar` | 16 |
| Teacher | `subject_teacher` | 20 |
| Accountant / Finance Officer | `accountant_cashier` | 18 |
| HR Manager | `hr_admin` | 15 |
| Payroll Officer | `payroll_officer` | 13 |
| Librarian | `library_librarian` | 13 |
| Transport Manager | `transport_manager` | 12 |
| Receptionist / Front Desk Officer | `receptionist` | 11 |
| Parent / Guardian | `parent_guardian` | 16 |
| Student | `student` | 15 |
| School IT Administrator | `system_admin` | 13 |

The transport mapping is BLOCKED due to conflicting source scope. For other role/menu rows, role-to-application mapping is recorded, but full feature behavior is NOT TESTED unless that exact row cites a qualifying workflow (none do in this pass).

## Module and workflow coverage

Twenty-five module rows cite representative passing tests; the case register explains each assertion boundary. Transport management is blocked. Timetable management has an existing read-only page test but no complete lifecycle SIT and remains NOT TESTED.

Critical workflow summary:

| Workflow | Result | Coverage note |
|---|---|---|
| A — Student admission | PASS (representative) | API and both adapter contracts cover application through capacity-checked enrolment and history. |
| B — Student attendance | PASS (representative) | API and both adapter contracts cover attendance, corrections and scope. |
| C — Examination and results | PASS (representative) | Both adapter contracts cover scheduling, marks, approval/publication and immutable reports. |
| D — Fees and payments | PASS (representative) | API/contracts cover structures, payments/receipts, adjustments and reports. |
| E — Parent portal | PASS (representative) | Both adapter contracts cover linked-child scope and published-only data; UI portal smoke test exists. |
| F — HR and payroll | NOT TESTED end-to-end | Separate HR/payroll contracts pass; combined staff-to-payslip flow is not evidenced. |
| G — Library | PASS (representative) | Both adapter contracts cover circulation, fines, reservations and portal scope. |
| H — Timetable | NOT TESTED end-to-end | Read-only UI behavior only; lifecycle workflow is missing. |

## Automated coverage checks

- `backend/test/sit-matrix.test.js` validates all 275 case records and required fields; these are mapping-integrity assertions, not business-feature passes.
- `frontend/src/navigation.integration.test.tsx` verifies route titles for 27 active path-based school destinations.
- `frontend/src/App.test.tsx` checks denied direct navigation for each of those 27 destinations.
- Existing backend, frontend and shared adapter tests provide representative feature behavior.

Execution evidence and current gate results are recorded in `SIT_EXECUTION_REPORT.md`; unresolved issues are tracked in `SIT_GAP_REPORT.md`.
