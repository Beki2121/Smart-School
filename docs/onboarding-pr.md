# Platform-led onboarding closeout

## Summary

Platform administrators provision schools instead of using public self-registration. Provisioning creates an organization, a `Main Branch`, a Starter trial, and a password-less school-administrator invitation in one transaction. School administrators manage branches, switch their branch-scoped sessions, and invite principals and other staff under the role matrix below.

The test-only onboarding flow uses randomly generated, in-memory credentials. It does not read or print database credentials and does not create real accounts.

## Migrations

| Migration | Purpose | Local development (`smartschool_sims`, `127.0.0.1`) | `_test` |
|---|---|---|---|
| `202611010001_refresh_token_campus_scope.js` | Adds nullable branch scope to refresh tokens; existing null-campus tokens remain supported. | Applied; confirmed by `knex migrate:list` on 2026-11-02. | Applied; contract suite passed. |
| `202611010002_platform_school_admin_invitations.js` | Supports password-less organization-targeted school-administrator invitations. | Applied; confirmed by `knex migrate:list` on 2026-11-02. | Applied; contract suite passed. |

No migration was pending on the local development database. The MySQL contract suite also exercised migration idempotence.

## Routes

Compared with `main`, the route inventory changed from **187 to 192**:

| Change | Route |
|---|---|
| Added | `POST /api/auth/switch-branch` |
| Added | `POST /api/platform/schools` |
| Added | `POST /api/platform/schools/:organizationId/admin-invitation/regenerate` |
| Added | `GET /api/school/branches` |
| Added | `POST /api/school/branches` |
| Added | `PATCH /api/school/branches/:branchId` |
| Removed | `POST /api/school-registration` — returns `404 NOT_FOUND` |

The route inventory snapshot and [API documentation](./API.md) include these differences.

## Repository methods

Added to both memory and MySQL bundles:

- `createOrganizationBranch`
- `createPlatformSchool`
- `listOrganizationBranches`
- `regenerateSchoolAdministratorInvitation`
- `switchRefreshTokenCampus`
- `updateOrganizationBranch`

Removed from both bundles: `registerSchool`.

## Invitation matrix

The exhaustive API matrix test covers every inviter/invitee cell for these supported staff roles:

| Inviter | Allowed invitee roles | Denied invitee roles |
|---|---|---|
| `owner_director` | All nine: `principal`, `registrar`, `system_admin`, `academic_head`, `homeroom_teacher`, `subject_teacher`, `hr_admin`, `accountant_cashier`, `counsellor` | None of the nine |
| `system_admin` | `homeroom_teacher`, `subject_teacher`, `accountant_cashier`, `counsellor` | `principal`, `registrar`, `system_admin`, `academic_head`, `hr_admin` |
| `principal` | `academic_head`, `registrar`, `homeroom_teacher`, `subject_teacher`, `hr_admin`, `accountant_cashier`, `counsellor` | `principal`, `system_admin` |
| `registrar` | `homeroom_teacher`, `subject_teacher`, `counsellor` | All other supported roles |
| `hr_admin` | `homeroom_teacher`, `subject_teacher`, `accountant_cashier`, `counsellor` | All other supported roles |

In particular, Registrar and HR invitations to their previously allowed staff roles remain intact, and Principals may now invite Registrar and HR Administrator. `group_executive` and `auditor` remain unchanged and are not creatable through this flow.

## Test coverage

| Case | Exact test |
|---|---|
| Every invitation-matrix cell, including retained Registrar/HR invitations and the Principal additions | `backend/test/api.test.js` — `enforces the least-privilege staff invitation matrix and rejects cross-school targets` |
| School creation, owner invitation, password-less provisioning, invitation expiry and single use; branch limit; switching and refresh; staff invitations; deactivation; retired route | `backend/test/api.test.js` — `completes platform-led onboarding with generated credentials and branch isolation` |
| Old regenerated link invalidation and cross-school regeneration isolation | `backend/test/api.test.js` — `onboards a school, activates its plan, enforces limits and completes export-first closure` |
| Cannot regenerate after acceptance; new branch membership for every owner and exclusion of Principals; cross-school list/update/switch isolation | `backend/scripts/repository-contracts.contract.js` — `memory/mysql: platform school provisioning, administrator invitation and branch membership` and `memory/mysql: branch limits, administrator membership and scoped session switching` |
| Creation limit and refusal to deactivate the last active branch | `backend/scripts/repository-contracts.contract.js` — `memory/mysql: branch limits, administrator membership and scoped session switching`; also covered by the onboarding API test |
| Switched branch survives refresh; legacy null-campus refresh remains usable; cross-branch switch refusal | `backend/test/api.test.js` — `completes platform-led onboarding with generated credentials and branch isolation`; `backend/scripts/repository-contracts.contract.js` — `memory/mysql: refresh-token rotation and reuse rejection` and `memory/mysql: branch limits, administrator membership and scoped session switching` |

The API suite now has one end-to-end onboarding test using generated, one-time secrets and an in-process memory repository. The existing role-matrix API test was expanded to cover all 45 cells. Existing repository contract cases were strengthened for branch-creation limits, legacy refresh tokens, cross-school switching, and post-acceptance invitation regeneration; no contract declarations were added.

## Known limits

- Memory-mode `createRepository` seeds a school `owner_director`, not a `super_admin`. There is currently **no supported platform-administrator login in the default memory-mode server**, so the platform-console click-through cannot be performed in that mode. The `platform-admin:create` bootstrap is MySQL-backed and is not a memory-mode login workaround.
- The end-to-end HTTP flow was exercised against the memory adapter. MySQL onboarding behavior is covered by repository contracts, not by a full MySQL HTTP flow.
- Contract skips remain: MySQL section readmission/transfer (the current `sections` schema has no `is_active` column) and memory academic-year audit rollback (known adapter parity issue).
- Invitation acceptance and password-reset completion require live API connectivity; offline browser verification covers route loading only.
- Amharic copy is marked for native-speaker review.

## Upgrade notes

Back up the target database before applying migrations in another environment. Apply migrations with the backend migration command before deploying the application version that uses branch-scoped refresh tokens and platform school-administrator invitations. Existing null-campus refresh tokens remain valid; new sessions store a branch scope. Public school self-registration has been removed, so deployment operators must provision the first platform administrator out of band and share school-administrator invitation links privately.

## Local commands and manual click-through

In PowerShell, run the API in memory mode from the repository root:

```powershell
$env:STORAGE_MODE = 'memory'
$env:PORT = '4000'
npm run dev:api
```

In a second terminal, direct the frontend dev proxy to that API:

```powershell
$env:VITE_API_BASE_URL = ''
$env:VITE_API_PROXY_TARGET = 'http://127.0.0.1:4000'
npm run dev:web
```

Open `http://localhost:5174`. Use only locally chosen credentials; never paste credentials into source control or shared logs. The default memory seed account is a school owner, not a platform administrator. Consequently, the platform-console checklist below requires a platform-admin account and cannot be completed using the default memory-mode seed. Do not use the MySQL bootstrap for this memory-mode test.

- [ ] Sign in as a platform administrator and create a school in the UI.
- [ ] Accept the one-time school-administrator invitation link.
- [ ] Create a second branch.
- [ ] Switch branches and add a Principal staff profile.
- [ ] Verify the role dropdown offers the approved Principal invitation roles, including Registrar and HR Administrator.
- [ ] Deactivate the second branch and verify its sessions are rejected.
- [ ] Open the landing page and switch between English and Amharic.
