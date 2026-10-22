# SmartSchool Ethiopia (SIMS) — AI Implementation Playbook

How to use this file:
1. Save **Section 0 (Master Brief)** as `PROJECT_SPEC.md` in the repo root (or `CLAUDE.md` if you use Claude Code). Every phase prompt assumes the AI can read it.
2. Give the AI **one phase prompt at a time**, in order. Do not start the next phase until the current phase's **Done when** list passes.
3. After each phase, commit and start the next in a fresh session. The AI re-reads `PROJECT_SPEC.md` and `docs/PROGRESS.md` to pick up where it stopped.

Stack: React (Vite) + CSS · Node.js + Express · MySQL 8 · Socket.IO · jsonwebtoken · vite-plugin-pwa · MAMP (dev) · Apache + Yegara Host (production) · school-local installer option

Scope of this playbook: **Release 1 — SIMS Core** exactly as in the proposal (Section 10). Payroll, library, inventory/stores, transport, bidirectional cloud↔local sync, payment-gateway APIs, online admission portal, LMS and extra languages are **Release 2** and must not be built now (leave clean extension points only).

> **Change from the proposal's technology section:** the proposal text mentions a "containerized local deployment option". Because your environment is MAMP/Apache/Yegara, this playbook uses a **guided installer (no Docker)** for school-local installs. Containers can be added later if a customer wants them.

---

## 0. MASTER BRIEF (save as PROJECT_SPEC.md)

### 0.1 What we are building
**SmartSchool SIMS:** a bilingual (English + Amharic), multi-campus Student Information Management System for Ethiopian schools. Release 1 modules: organization/campus/academic setup; admissions and enrolment; student information (students, guardians, documents, ID cards); timetable; attendance (offline-capable); assessment, grading, ranking, promotion and report cards; fees and finance (invoices, payments, receipts, cashier shifts, expenses); parent and student portals (PWA); communication (announcements, SMS, email, notifications); core staff management; student welfare/conduct; reports and official statistics; multi-campus/group management; rule-based automation; platform administration (packages, plan limits, licensing).

### 0.2 Tech stack (fixed — do not substitute)
| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite, hand-written CSS (CSS variables, responsive for phone/tablet/desktop). No Tailwind/UI kit. React Router. Small chart lib allowed. **i18n from day one** (`en` and `am` dictionaries, no hard-coded strings). Bundle **Noto Sans Ethiopic** (and a Latin font) locally; never rely on a CDN. |
| PWA | `vite-plugin-pwa` (`injectManifest`, custom service worker), IndexedDB (`idb`), Background Sync where available, Web Push (`web-push`) optional |
| Backend | Node.js 20 LTS + Express, JavaScript (ES modules), `mysql2/promise`, `zod`, `pino`, `helmet`, `cors`, `express-rate-limit`, `bcrypt`, `node-cron` |
| Real-time | Socket.IO with rooms per campus/role (e.g. `c:7:registrar`, `c:7:teachers`), automatic **long-polling fallback**, used for notifications and live dashboards only |
| Database | MySQL 8, InnoDB, utf8mb4 (`utf8mb4_unicode_ci`), Knex migrations (no heavy ORM) |
| Auth | `jsonwebtoken` access (15 min) + rotating refresh token stored hashed; RBAC with configurable permissions; campus and class scoping |
| Documents | Server-side PDF (Puppeteer or `pdfkit`) with **embedded Ethiopic fonts**; QR codes (`qrcode`) |
| SMS/Email | `SmsProvider` and `EmailProvider` interfaces with a **mock** (default), and a generic HTTP gateway adapter configurable per organization |
| Tests | Vitest, Supertest, Playwright (incl. network emulation), k6/Artillery |
| Dev | **MAMP** MySQL (`127.0.0.1:8889`, root/root default, configurable); Node servers run natively; **no Docker** |
| Deploy | Apache serves `dist/`; Node API on **Yegara Host** (cPanel Setup Node.js App/Passenger, or VPS); MySQL via cPanel; GitHub Actions CI only. **School-local:** guided installer for a school server |

### 0.3 Tenancy and roles
Hierarchy: **Organization** (school or group) → **Campuses** → academic data, users, students. Every operational row has `campus_id` (and the campus has `organization_id`).

Roles (permissions configurable): `owner_director`, `group_executive`, `principal`, `registrar`, `academic_head`, `homeroom_teacher`, `subject_teacher`, `accountant_cashier`, `hr_admin`, `counsellor`, `system_admin`, `parent_guardian`, `student`, `auditor`. Platform-level `super_admin` (vendor staff) manages organizations, packages and licences and has **no access to student data** without an approved, time-limited, audited support session.

### 0.4 Non-negotiable rules
1. **Isolation:** `organization_id`/`campus_id` always come from the token/session, **never from the request body**. Teachers see only assigned classes/sections/subjects. Guardians see only **verified, linked children**. Students see only themselves. Cross-campus access requires an explicit grant. Violations → `403`. A permission/isolation **matrix test** runs in CI and grows every phase.
2. **Ethiopian calendar:** store all dates as Gregorian (`DATE`/UTC `DATETIME`) and convert at the edges using a **pure, unit-tested converter** (13 months, Pagume 5 or 6 days, leap-year rule). Every date input/display component supports Ethiopian and Gregorian (per-user preference, school default Ethiopian). Academic years are labelled in E.C. (e.g. "2019 E.C.") and map to Gregorian start/end dates.
3. **Ethiopian names:** `given_name`, `father_name`, `grandfather_name`, each with an Amharic-script and a Latin-script value. Search matches both scripts and partial names. Sorting and report layouts support both. Never assume a surname.
4. **Language:** UI, notifications, report cards and PDFs are available in English and Amharic; templates are stored per language. Amharic SMS is Unicode (UCS-2, **70 chars/segment**): the SMS composer shows segment count and cost estimate. Design for later Afaan Oromo/Tigrigna (locale files only).
5. **Marks integrity:** marks follow `draft → submitted → approved → locked`. After lock, changes only through an **amendment** (new record with reason, user, old/new value, approver above a threshold). Every mark write is audited. No silent updates, no deletes.
6. **Grading is configuration, not code:** assessment components, weights, grading scales, pass marks, rank rules and promotion rules are data per grade band/stream, versioned per academic year. Defaults (editable): pass mark 50%, letter bands A ≥80, B 70–79, C 60–69, D 50–59, F <50 (confirm in discovery). Ranking supports ties (document tie policy) and excludes withdrawn/absent-all students per rule.
7. **Financial integrity:** money is `DECIMAL(12,2)` ETB. Invoices, charges, payments and adjustments are **append-only**; corrections are new reversing entries with reason and approval above a limit. Invoice and receipt numbers are **gapless and sequential per campus** (counter table with row lock). Closed cashier shifts are immutable. The system is **operational fee management, not statutory accounting**; show a configurable disclaimer. Any release-of-results-for-unpaid-fees policy is a **school setting, off by default**.
8. **Children's data protection:** collect the minimum; encrypt sensitive fields (national/ID numbers, health, counselling notes) at rest (AES-256-GCM, key from env) with HMAC hashes for lookup; mask by default; every reveal/view of sensitive data is audited; guardians are verified before linking; consent records (photos, communication) are stored; no marketing/profiling use; retention settings; anonymise/alumni mode keeping required academic and financial records; per-person data export; documented **incident-response/breach runbook** (72-hour notification target). Planning reference: Ethiopia's Personal Data Protection Proclamation No. 1321/2024 (minors, sensitive data, data-subject rights, cross-border limits) — confirm with legal counsel.
9. **Audit log is append-only:** logins, sensitive-record views, mark changes/amendments, fee adjustments/refunds/voids, permission/role changes, merges, exports, shift closures, promotions.
10. **Soft delete** for students, guardians, staff, classes, subjects, fee items, campuses. History stays readable.
11. **Offline rule:** only attendance and marks entry work offline in Release 1. Offline submissions carry a client UUID and are **idempotent**; server conflict rules are explicit (e.g. marks already locked → rejected with a clear message shown to the teacher). **No bidirectional cloud↔local replication in Release 1.**
12. **Plan limits and feature flags** (students, campuses, users, modules) enforced server-side; local installs verify a signed licence file.
13. **Rule-based automation is explainable:** every automatic action is logged with the rule and reason. No AI.
14. Security baseline: bcrypt cost ≥ 12, zod validation on every endpoint, parameterised SQL only, rate-limited login with lockout, helmet, strict CORS, secrets only in env, request-size limits, upload type/size limits, no secrets in the repo.

### 0.5 Repository layout
```
smartschool/
  apps/
    api/            # Express + Socket.IO
      src/{config,db,middleware,modules,realtime,jobs,services,utils,i18n}
      migrations/  seeds/  tests/
    web/            # React (Vite) PWA
      src/{app,components,features,pages,realtime,offline,styles,i18n,calendar}
      src/sw.js
  docs/{PROGRESS.md,API.md,RUNBOOK.md,DECISIONS.md,TEST_PLAN.md,PRIVACY.md}
  deploy/{apache/.htaccess,cpanel-notes.md,local-install/}
  .github/workflows/
  PROJECT_SPEC.md
```

### 0.6 Working agreement for the AI (every phase)
- **Start by reading** `PROJECT_SPEC.md` and `docs/PROGRESS.md`; post a short plan (files, endpoints, tables) before coding.
- Work in small runnable steps. Run migrations, tests and dev servers yourself; never claim something works without running it.
- Write tests alongside code; extend the **permission/isolation matrix** each phase.
- API responses: `{ data }` / `{ error: { code, message, details? } }`; paginate lists; document endpoints in `docs/API.md`.
- Every user-facing string goes through i18n with both `en` and `am` values (flag Amharic strings as "needs native review" in `docs/DECISIONS.md`).
- At the end: update `docs/PROGRESS.md` (done, deferred, questions), list how to run/verify, and **stop**. Do not start the next phase.
- If the spec is ambiguous, choose the simplest option consistent with the rules, record it in `docs/DECISIONS.md`, continue.

---

## PHASE 1 — Repository, tooling, MAMP and i18n foundation
*(Proposal Phase 2–3 start)*

**Prompt:**
> Read PROJECT_SPEC.md. Create the monorepo per section 0.5. `apps/api`: Express (ES modules), pino, helmet, cors, zod env loader validating on boot, `GET /api/health` pinging MySQL. `apps/web`: Vite + React + React Router, CSS design system (variables for colour/spacing/type, responsive breakpoints, app shell with sidebar), **i18n framework with `en` and `am` dictionaries and a language switcher**, locally bundled Noto Sans Ethiopic, and a fallback chain (missing `am` key → `en`). Add ESLint + Prettier, Vitest in both apps, root npm workspaces with scripts `dev`, `test`, `lint`, `build`. **No Docker.** Read DB settings from `.env` for MAMP (host `127.0.0.1`, port `8889`, user `root`, password `root`, all configurable); add `db:create`; add `.env.example` for MAMP-dev and production; verify MySQL 8 (or MariaDB ≥ 10.5) at boot and warn otherwise. Add a GitHub Actions workflow running lint + tests with a MySQL service. Create the `docs/` files, including MAMP setup steps in `RUNBOOK.md`.

**Done when:**
- With MAMP running, `db:create` works; `npm run dev` starts API and web; the shell calls `/api/health`; switching to Amharic renders Ethiopic text correctly; lint and tests pass locally and in CI.

---

## PHASE 2 — Database schema, migrations and seed data
*(Proposal Phase 2: database model)*

**Prompt:**
> Write Knex migrations for the **complete Release 1 schema** with foreign keys and indexes for the main query paths (campus + academic_year + class + date). Tables (operational tables carry `campus_id`):
> **Platform/tenancy:** `organizations` · `packages(max_students,max_campuses,max_users,modules JSON)` · `licences` · `campuses(id,organization_id,name,address,phone,timezone,default_calendar,logo_path,stamp_path,signature_path,is_active)` · `users(id,organization_id,name,email nullable,phone,password_hash,role_id,preferred_locale,preferred_calendar,is_active)` · `user_campuses` · `roles` · `permissions` · `role_permissions` · `refresh_tokens` · `audit_log(before/after JSON, append-only)` · `consents(subject_type,subject_id,purpose,granted_by,granted_at,revoked_at)` · `system_settings`.
> **Academic structure:** `academic_years(id,campus_id,label_ec,start_date,end_date,status)` · `terms(id,academic_year_id,name,start_date,end_date,is_current)` · `holidays` · `grade_levels(id,campus_id,code,name_en,name_am,band,order)` · `streams` · `sections(id,campus_id,academic_year_id,grade_level_id,stream_id,name,homeroom_teacher_id,capacity,shift)` · `subjects(id,campus_id,code,name_en,name_am)` · `curriculum(id,grade_level_id,stream_id,subject_id,credit_hours,is_core)` · `teaching_assignments(id,section_id,subject_id,teacher_id,academic_year_id)` · `periods` · `timetable_entries(id,section_id,subject_id,teacher_id,period_id,weekday,room)` · `rooms`.
> **People:** `students(id,campus_id,student_no,given_name_am,given_name_en,father_name_am,father_name_en,grandfather_name_am,grandfather_name_en,gender,date_of_birth,birth_place,nationality,mother_tongue,religion nullable,photo_path,status enum[applicant,enrolled,transferred_out,withdrawn,graduated],id_number_enc,id_number_hash,health_notes_enc,special_needs_enc,previous_school,admitted_on,anonymised_at)` · `guardians(id,organization_id,names…,phone,alt_phone,email,occupation,address,national_id_enc,national_id_hash)` · `student_guardians(student_id,guardian_id,relationship,is_primary,is_fee_payer,verified_by,verified_at,can_view_results,can_view_fees)` · `student_documents` · `enrolments(id,student_id,academic_year_id,section_id,status,enrolled_on,left_on,outcome enum[promoted,repeated,graduated,transferred,withdrawn,pending])` · `transfers` · `siblings` view/relation.
> **Admissions:** `enquiries` · `applications(id,campus_id,applicant names…,grade_applied,status,test_score,interview_notes,decision,decided_by)` · `application_documents` · `admission_tests`.
> **Attendance:** `attendance_sessions(id,campus_id,section_id,date,period_id nullable,taken_by,client_uuid unique,status,closed_at)` · `attendance_records(session_id,student_id,status enum[present,absent,late,excused],reason,note)` · `staff_attendance`.
> **Assessment:** `grading_scales(id,campus_id,band,name,version,config JSON)` · `assessment_schemes(id,campus_id,academic_year_id,grade_level_id,subject_id,term_id,config JSON)` · `assessment_components(id,scheme_id,name,max_marks,weight)` · `marks(id,campus_id,enrolment_id,component_id,value,state enum[draft,submitted,approved,locked],entered_by,client_uuid,updated_at)` · `mark_amendments(id,mark_id,old_value,new_value,reason,requested_by,approved_by)` · `term_results(id,enrolment_id,term_id,subject_id,total,grade,rank_in_section)` · `year_results(id,enrolment_id,average,rank_section,rank_grade,promotion_decision,decided_by)` · `report_cards(id,enrolment_id,term_id,language,pdf_path,verify_code unique,published_at,published_by)` · `conduct_grades` · `exam_records` (national/regional exam results, optional).
> **Finance:** `fee_items(id,campus_id,name_en,name_am,category)` · `fee_structures(id,campus_id,academic_year_id,grade_level_id,student_category,items JSON,term_schedule JSON)` · `discounts(id,campus_id,type,rule JSON)` · `student_discounts` · `invoices(id,campus_id,student_id,family_id nullable,number,term_id,issued_on,due_on,status,total)` · `invoice_lines` · `payments(id,campus_id,invoice_id nullable,student_id,method enum[cash,bank_transfer,telebirr_ref,other],amount,reference,shift_id,received_by,created_at,reverses_payment_id)` · `payment_allocations` · `adjustments(id,invoice_id,type,amount,reason,requested_by,approved_by,status)` · `receipts(id,payment_id,number,issued_at)` · `number_counters` · `cashier_shifts` · `expenses` · `expense_categories` · `bank_import_batches` · `bank_import_rows`.
> **Communication & ops:** `announcements` · `message_templates(id,key,locale,subject,body)` · `outbox(id,channel,recipient,payload JSON,status,attempts,provider_ref,segments,cost_estimate,created_at)` · `notifications` · `events_calendar` · `staff(id,campus_id,user_id,names…,department,job_title,qualification,employment_status,hired_on)` · `departments` · `leave_requests` · `handover_notes` · `conduct_incidents` · `welfare_notes_enc` · `guardian_meetings` · `automation_rules` · `automation_log` · `at_risk_flags`.
> **Seed (idempotent):** super admin; 2 packages; 1 organization with 1 campus; academic year with 2 terms; grade levels KG1–KG3 and 1–12 with bands and streams for 11–12; sample sections and subjects; default grading scale and assessment scheme; default fee items/structure; roles and sensitive-action permission keys; message templates in `en` and `am`; plus `db:seed:demo` generating ~600 students, guardians, a year of attendance, marks and invoices. Add DB tests for unique constraints (`student_no` per campus, gapless counters) and FK integrity.

**Done when:**
- `db:migrate`, `db:seed`, `db:seed:demo` run on a clean DB and are re-runnable; rollback works; a Mermaid ER diagram is in `docs/DECISIONS.md`; Amharic and Latin names round-trip through MySQL unchanged.

---

## PHASE 3 — Authentication, RBAC, tenancy, consent and audit
*(Proposal Phase 3: platform foundation)*

**Prompt:**
> Implement `POST /api/auth/login` (email or phone + password), `/refresh` (rotating, reuse detection), `/logout`, `GET /api/auth/me`, change-password and admin password reset; JWT `{ sub, orgId, role, campusIds[], activeCampusId }`; `POST /api/auth/switch-campus`. Middleware: `authenticate`, `requirePermission(key)`, `campusScope`, **`classScope`** (teachers limited to `teaching_assignments`/homeroom), **`guardianScope`** (parents limited to verified `student_guardians`), `requireModule(key)` (stub until Phase 18), and an `auditable()` helper writing before/after JSON in the same transaction. A repository helper **always** injects `campus_id`. Define the full permission-key list (e.g. `students.view|edit`, `students.view_sensitive`, `admissions.manage`, `attendance.take|edit_late`, `marks.enter|approve|amend`, `reportcards.publish`, `fees.configure`, `invoices.create`, `payments.record`, `adjustments.approve`, `refunds.approve`, `messages.send`, `reports.financial`, `users.manage`, `audit.view`) and map the roles. Build user/role management UI (every change audited), parent/student account provisioning (SMS/email invite, forced password change), login lockout (5 failures/15 min), property-aware API client with auto refresh, role-based navigation, language/calendar preference.
> Create the **permission/isolation matrix test** (route × role × own/other campus × assigned/unassigned class × linked/unlinked child).

**Done when:**
- Teachers cannot open unassigned classes; a guardian gets `403` for a non-linked child; body-supplied campus ids are ignored; all permission changes appear in the audit log.

---

## PHASE 4 — Academic setup and the Ethiopian calendar
*(Proposal Phase 3: academic setup)*

**Prompt:**
> First implement the **Ethiopian calendar library** (`apps/web/src/calendar` and a shared server util): Gregorian↔Ethiopian conversion, month names in Amharic and English, Pagume length, weekday names, date-range helpers, parsing and formatting — with **exhaustive unit tests** (leap years, boundary dates, round trips over 100 years) — and reusable `<DateInput>` / `<DateText>` components that follow the user's calendar preference. Then build setup screens and APIs: campus profile (logo, stamp, signature uploads), academic years (labelled in E.C.) with terms, holidays and exam periods, grade levels and streams, sections (capacity, shift, homeroom teacher), subjects and the curriculum matrix (subject × grade/stream), rooms and periods, **configurable grading scales**, **assessment schemes** (components, max marks, weights per subject/term), **promotion rules** (pass mark, max failed subjects, supplementary-exam rule) stored as versioned config with a rule-evaluation function unit-tested against sample cases. Provide an "Academic setup wizard" for new schools and clone-from-previous-year.

**Done when:**
- A school can be fully configured from the UI; calendar tests pass; promotion-rule evaluator passes a table of cases (e.g. fails 2 subjects → supplementary; ≥3 → repeat; average below pass mark → repeat).

---

## PHASE 5 — Core staff management and teaching assignments
*(Proposal Phase 4 prerequisite)*

**Prompt:**
> Implement core staff features (§5.10): staff profiles, departments, job titles, qualifications, employment status, linkage to user accounts; **teaching assignments** (teacher × subject × section) and homeroom assignment with workload summary and clash detection; staff attendance (clock in/out or marked by HR) and **leave requests with approval**; handover notes and internal announcements; attendance summaries as CSV for external payroll. Permissions: HR sees all, heads see their department, staff see themselves. Notifications on approvals. No payroll calculation.

**Done when:**
- Assigning a teacher to two sections in the same period is flagged; leave workflow works end-to-end; `classScope` now reads real assignments in the matrix test.

---

## PHASE 6 — Admissions and enrolment
*(Proposal Phase 4)*

**Prompt:**
> Implement admissions (§5.2): enquiries → applications → required-document checklist and uploads (type/size limits, stored outside the web root) → entrance test/interview scheduling and results → decision (accept/waitlist/reject) with offer letter PDF (bilingual) → **enrolment** into campus/grade/section creating the student record and **student ID** (configurable pattern, e.g. `CAMPUS-YEAR-SEQ`, gapless via counters). Sibling detection and linking. Transfers in (previous-school record) and out (**transfer certificate PDF**). Withdrawals and re-admission with preserved history. Section capacity checks. Admissions dashboard (funnel by grade, status). Staff-entered forms only (public online form is Release 2). UI optimised for a registrar at a desk: quick search, keyboard-friendly, duplicate warning while typing names/phone.

**Done when:**
- A full enquiry→enrolment flow produces one student with a unique ID; duplicate detection warns on same name+DOB or guardian phone; documents never accessible without permission.

---

## PHASE 7 — Student information, guardians and ID cards
*(Proposal Phase 4)*

**Prompt:**
> Implement the student record (§5.3): three-part names in both scripts with dual-script search; profile, photo, documents, previous school; **guardians** with relationship, primary/fee-payer flags and a **verification workflow** (registrar verifies identity before the guardian can see the child's data); emergency contacts; health/special-needs/ID numbers **encrypted at rest** with masking and audited reveal; consent records (photos, SMS, portal); enrolment history, promotion/repetition/graduation history; national/regional exam result records (optional); duplicate detection and a controlled **merge tool** (re-links all records, audited); bulk **CSV/Excel import** with a dry-run validation report (row errors, duplicates) and rollback; **ID card PDF** (photo, bilingual name, QR/barcode, school branding) in batch per class; student/guardian data export; anonymise (alumni mode) keeping academic and financial totals. Student list/search UI with filters and saved views.

**Done when:**
- Plaintext sensitive values never appear in DB dumps or logs (automated scan); revealing a sensitive field is audited; import of a messy 600-row sample reports errors and imports clean rows safely; ID cards render Amharic text correctly.

---

## PHASE 8 — Timetable
*(Proposal Phase 4)*

**Prompt:**
> Implement the timetable (§5.4): periods per campus and shift, section timetable grid (drag-and-drop or click-to-assign) with **hard clash detection** (teacher, room, section) enforced in the API, teacher timetable view and weekly workload, substitute assignment for absent teachers (linked to staff leave), printable PDF and portal-visible views. Automatic generation is out of scope.

**Done when:**
- Double-booking a teacher or room is impossible via UI and API; teachers see their own timetable; substitutes appear for the affected date only.

---

## PHASE 9 — Attendance with offline entry
*(Proposal Phase 5)*

**Prompt:**
> Implement attendance (§5.5): daily homeroom attendance and optional period attendance; statuses present/absent/late/excused with reasons; one-tap "mark all present" then exceptions; edit window (configurable) after which late edits need `attendance.edit_late` and a reason (audited); attendance for staff already exists (Phase 5). **Offline:** build the PWA layer — custom service worker, precache app shell, cache section rosters for the current day, store attendance submissions in IndexedDB with a client UUID, show "Saved offline — will sync", replay via Background Sync with fallback to the `online` event/app focus (iOS), idempotent server upsert keyed by `(section, date, period, client_uuid)`, conflict message if the session was already closed/edited. Guardian absence **events** feed the automation engine later (Phase 15). Reports: rates by student/section/grade/campus, chronic-absence lists, class register print (A4, bilingual). Teacher UI is mobile-first with large tap targets.

**Done when (Playwright with network emulation):**
- A teacher goes offline, records two classes, closes the browser, reopens online → both sessions sync exactly once; replaying the same UUID creates nothing new; a late edit without permission is rejected.

---

## PHASE 10 — Assessment and marks workflow
*(Proposal Phase 5)*

**Prompt:**
> Implement marks entry (§5.6, part 1): teacher screens listing only assigned section × subject × component; grid entry with keyboard navigation, validation against `max_marks`, absent/excused markers, import from CSV; **offline entry** reusing the Phase 9 PWA queue with idempotent upserts (client UUID per cell batch); workflow `draft → submitted (teacher) → approved (academic head) → locked`; deadline reminders hooks; **amendments** after lock (request → approver → applied) with full audit; submission completeness dashboard for academic heads (which teacher/section/subject is late). Server-side rules: no entry outside the term's marks window unless permitted; no edits in `approved`/`locked` states; every write audited with before/after. Add concurrency tests (two teachers/devices editing the same cell, offline replay after lock).

**Done when:**
- A locked mark cannot be changed except through an approved amendment; offline replays are idempotent; the completeness dashboard matches database state; matrix test covers all marks routes.

---

## PHASE 11 — Grading, ranks, promotion and report cards
*(Proposal Phase 5)*

**Prompt:**
> Implement computation and documents (§5.6, part 2). A pure, heavily unit-tested **results engine**: subject totals from components and weights, term and annual averages, grade/descriptor from the configured scale, **section and grade ranks** with a documented tie policy, exclusion rules (withdrawn, no-marks), promotion/repetition/supplementary decisions from the Phase 4 rule config, with manual override by authorised staff (audited). Recompute only from approved/locked marks. Generate **bilingual report cards** (per term and annual) with: bilingual names, student ID, class, attendance summary, subject marks and grades, average, ranks, conduct, teacher and principal comments, parent-signature box, school stamp/signature images, **QR verification code** linking to a public page that confirms authenticity (shows only valid/invalid, school, term, issue date — **no student data**). Batch generation per section with progress, publish/unpublish control, optional fee-clearance gate if the school enabled it. Transcripts (multi-year), certificates (templates), result analysis (subject averages, pass rates, top performers, students needing support), rank lists. PDFs must embed Ethiopic fonts and render identically across environments (snapshot-tested).

**Done when:**
- The engine passes a verified calculation fixture (hand-computed averages, ranks with ties, promotion outcomes); a section's report cards generate in minutes; the verification page works without exposing personal data; unpublished results are invisible to guardians.

---

## PHASE 12 — Fee structures, discounts and invoicing
*(Proposal Phase 6)*

**Prompt:**
> Implement fee configuration and invoicing (§5.7, part 1): fee items and **fee structures** by campus/grade/term/student category; discounts, scholarships and **sibling reductions** (rule-based, with approval and expiry); instalment plans; bulk invoice generation per term/section/grade with **dry-run preview**, per-student single invoice, family-level grouping for siblings; invoice PDF (bilingual, school branding); due dates and status (issued, partially paid, paid, overdue, void); opening balances import for migration. Invoices and lines are **append-only**; changes happen through credit notes/adjustments with reason and approval above a limit. Gapless numbering via counter row-locks, verified under concurrency.

**Done when:**
- Bulk-generating 600 invoices is idempotent (re-running creates none twice); a sibling discount applies correctly; numbering has no gaps under 20 concurrent generations; totals tie to fee structure rules in fixtures.

---

## PHASE 13 — Payments, receipts, cashier shifts, refunds and arrears
*(Proposal Phase 6)*

**Prompt:**
> Implement payments (§5.7, part 2): record **cash**, **bank transfer** (reference mandatory) and **Telebirr** (reference mandatory; recorded manually — gateway integration is Release 2, but define a `PaymentProvider` interface with a manual implementation and a mock); partial, advance and multi-invoice payments with allocation rules; **gapless receipts** (PDF + print CSS for A4 and 80 mm); **cashier shifts** (opening float, closing count, expected vs counted variance, immutable after close, shift report; payments require an open shift unless configured otherwise); **refunds and corrections** as new reversing entries with reason and second approval above a limit; student/family **fee statements**; **arrears ageing** and reminder lists; **bank-statement CSV import** with fuzzy matching of references/amounts to open invoices, proposed matches reviewed before posting; expense recording and simple income-vs-expense reports; unusual-adjustment warnings. UI: cashier console, accountant dashboard, adjustment-approval inbox.
> **Property tests:** balance = Σinvoices − Σpayments ± adjustments from raw rows equals the API balance for random operation sequences; receipt numbers have no gaps under concurrency.

**Done when:**
- A family's statement reconciles to the cent after partial payments, a refund and a discount; closed shifts cannot be edited; bank import never auto-posts without review; matrix test covers finance routes.

---

## PHASE 14 — Communication: announcements, SMS, email and notifications
*(Proposal Phase 7)*

**Prompt:**
> Implement communication (§5.9): announcements targeted to whole school/campus/grade/section/selected guardians; **message templates** in Amharic and English with variables; `SmsProvider` (mock + configurable HTTP gateway adapter, per-organization credentials stored encrypted) and `EmailProvider`; an **outbox** with queueing, retries with backoff, delivery status/callbacks, rate limiting, **quiet hours**, per-message **segment and cost estimate** (Amharic = UCS-2, 70 chars/segment), opt-out and consent checks, and a delivery log; in-app notification centre and Socket.IO live badge (with long-polling fallback); event calendar (exams, holidays, meetings) with reminders; direct messages from school to guardian (no student-to-student messaging). Provide an admin screen to test the provider and see balance/usage estimates.

**Done when:**
- A bulk SMS to a grade is queued once per recipient, retried on failure without duplicates, respects quiet hours and consent, and shows correct segment counts for Amharic and English text.

---

## PHASE 15 — Rule-based automation, welfare and conduct
*(Proposal Phase 7)*

**Prompt:**
> Build the rule engine (§5.14) with per-campus enable/threshold configuration and an `automation_log` entry for every execution (rule, entity, reason). Jobs run with `node-cron`, **derive state from the DB each run (idempotent, restart-safe)**, and are also callable via a secured `/api/internal/cron` endpoint so **cPanel cron** can trigger them. Rules: (1) guardian notification on absence/repeated lateness; (2) fee reminders before/after due dates and arrears lists; (3) teacher reminders for attendance and marks deadlines; (4) **at-risk list** when attendance or results cross configured thresholds; (5) promotion-eligibility computation at term/year end; (6) alerts on unusual financial adjustments or repeated mark amendments; (7) document/consent expiry reminders. Also implement **Student Welfare & Conduct** (§5.11): incident records with severity and actions, commendations, guardian meeting records, counselling/welfare notes **encrypted and visible only to permitted roles with audited views**, conduct grades feeding report cards.

**Done when:**
- Each rule has a test asserting exactly one notification/log row even if the job runs twice; restarting the server mid-day neither duplicates nor drops alerts; welfare notes are invisible to unauthorised roles in the matrix test.

---

## PHASE 16 — Parent and student portals
*(Proposal Phase 7)*

**Prompt:**
> Build the portals (§5.8) as part of the PWA: guardian login (phone/email + password, invite flow, optional one-time code by SMS), **child switcher** limited to verified links; dashboard with attendance, timetable, published results/report-card PDFs, fee balance, invoices, receipts and payment history, announcements, calendar and messages; **low-bandwidth** design (small bundles, lazy loading, no heavy images, graceful offline read of last-loaded data); large-text, simple Amharic-first UX tested with real devices; "install app" prompt; SMS summaries for guardians without smartphones (weekly/term digest, opt-in); **student portal** with age-appropriate limits controlled by school policy (default: timetable, own results when published, announcements). Respect consents, never show sensitive notes. All routes covered by the matrix test (parent A vs child of parent B).

**Done when:**
- A guardian with two children sees only them; unpublished results and welfare notes are never exposed; portal loads in under 3 s on a throttled 3G profile (Lighthouse); the Amharic UI passes native-speaker review notes in `docs/DECISIONS.md`.

---

## PHASE 17 — Reports, dashboards, official statistics and multi-campus
*(Proposal Phase 7)*

**Prompt:**
> Build the reporting layer (§5.12–5.13) with documented metric definitions: enrolment by campus/grade/section/**gender**, new/returning/transferred/withdrawn; attendance rates and chronic absence; results analysis (subject averages, pass/fail rates, rank lists, year-on-year); fee collection rate, arrears ageing, shift reconciliation, income and expenses; staff attendance, teacher workload, class sizes. A **configurable statistics export** engine (column mapping templates, CSV/XLSX) so formats required by regional/national education offices can be added after discovery without code changes. Role dashboards (owner, principal, registrar, accountant, teacher). **Multi-campus/group:** consolidated dashboards for `group_executive` only across authorised campuses, shared templates (grading scales, fee structures, report-card layouts) with campus overrides, **student transfer between campuses** preserving history. All reports respect scope, support date/term filters, CSV/PDF export, drill-down to records, and **reconcile to underlying rows** (tests). Use indexed aggregations; add rollup tables if reports exceed 500 ms on the demo dataset (≥ 5,000 students, 3 years).

**Done when:**
- Report totals equal row-level fixtures; group dashboards never leak an unauthorised campus; configurable exports work from a template without code changes; dashboards render in under 2 s on the large dataset.

---

## PHASE 18 — Year rollover, data migration and platform administration
*(Proposal Phase 8 preparation and commercial model)*

**Prompt:**
> (1) **Academic-year rollover tool:** preview then apply — promote, repeat, graduate or hold each student per results, create next-year sections and enrolments, carry open fee balances forward, copy structures from the previous year; dry run, per-section undo window, full audit. (2) **Migration toolkit:** CSV templates for students, guardians, staff, subjects, historical results and opening balances, with a validation report, duplicate handling, row-level error export and safe re-import. (3) **Platform console** (`super_admin`): organizations, campuses, packages (Starter/Standard/Group custom), usage (students, campuses, users, modules), subscription status and manual-invoicing notes (no payment gateway). **Plan enforcement** server-side with clear error codes (`PLAN_LIMIT_STUDENTS`, `MODULE_DISABLED`). (4) **Licence files for local installs:** Ed25519-signed JSON (organization, limits, modules, expiry, installation ID) verified at startup with an embedded public key; grace period with warnings; read-only mode after expiry (data never locked away; export always works); vendor script `tools/issue-licence.js` (private key kept offline, never in the repo). (5) Customer **full data export** (CSV/JSON) and **audited, customer-approved, time-limited support access** for vendor staff.

**Done when:**
- A rollover dry run matches expected promotion outcomes and can be undone within the window; migration of a messy sample reports every problem row; exceeding plan limits is rejected; an invalid or expired licence behaves as specified; super-admin cannot read student data without an approved support session.

---

## PHASE 19 — Hardening, privacy review, QA and load testing
*(Proposal Phase 8)*

**Prompt:**
> Produce `docs/TEST_PLAN.md`, `docs/QA_REPORT.md` and `docs/PRIVACY.md`. (1) **Security:** matrix test over every route; two-organization isolation test; guardian/child and teacher/class scoping; `npm audit`; fuzz tests on write endpoints; JWT expiry/refresh-reuse; strict CSP/CORS/cookie flags; SQLi/XSS checks; upload abuse tests; request-size limits; verify encryption and masking of sensitive fields; confirm no secrets in the repo; **restore a mysqldump** on a clean MAMP DB. (2) **Privacy:** data inventory, retention settings, consent flows, per-person export/erase/anonymise, **breach/incident runbook with 72-hour notification steps**, data-processing and hosting-location notes (in-country/local options). (3) **E2E (Playwright):** enquiry → enrolment → timetable → offline attendance → marks entry → approval/lock → report cards (en + am) → invoice → partial payment → refund → receipt → shift close → guardian portal view → dashboards. (4) **Calendar/language tests:** boundary dates, Pagume, Amharic rendering in PDFs, SMS segment counts. (5) **Load (k6/Artillery):** 3 schools × 600 students; **peak scenarios**: results-publish day (500 concurrent guardians opening report cards), fee-deadline day (payments + statements), morning attendance burst; p95 < 500 ms core APIs, < 2 s reports. (6) **Resilience:** API restart mid-bulk-invoice or mid-rank-computation, DB reconnect, offline replay storms, host idle spin-down. (7) **Usability:** first-time teacher and parent tests, keyboard-only registrar flow, accessibility and contrast. Fix all defects and report against the proposal's §15 acceptance criteria and §16 KPIs.

**Done when:**
- All suites green in CI; zero cross-tenant/scope leaks; no duplicate or missing numbers under load; results-day load test passes; no unresolved critical defects.

---

## PHASE 20 — Deployment, documentation, training and pilot
*(Proposal Phase 9)*

**Prompt:**
> Productionise for **both** models, without Docker. **Cloud (Yegara + Apache):** build `apps/web/dist`; `deploy/apache/.htaccess` (SPA fallback excluding `/api` and `/socket.io`, gzip/brotli, long-cache hashed assets, **no-cache for `index.html`, `sw.js`, manifest**, HTTPS redirect, security headers, correct MIME for fonts); API via cPanel **Setup Node.js App** (or PM2 + `mod_proxy`/`mod_proxy_wstunnel` on VPS); MySQL via cPanel; env vars in cPanel; Socket.IO long-polling fallback verified; cPanel cron hitting `/api/internal/cron` every minute; nightly `mysqldump` with retention and a documented restore drill; manual deploy steps plus optional GitHub Actions SFTP deploy with smoke tests and rollback checklist; `deploy/cpanel-notes.md` listing questions for Yegara support (Node version, WebSocket support, MySQL 8 vs MariaDB, SSH, cron, idle timeout, process/RAM limits, data location). **School-local:** `deploy/local-install/` with a **guided installer** and scripts for a school server (Windows or Linux): Node + MySQL 8 + Apache (or MAMP), run API as a service (PM2/NSSM), LAN access and optional local TLS, scheduled backups to external drive, restore, update procedure, licence installation, and a **readiness checklist** (hardware, UPS/power, network, backup owner, support access). State clearly in `RUNBOOK.md` that **Release 1 offers cloud with offline attendance/marks, or school-local — not simultaneous bidirectional sync**. **Handover pack:** `RUNBOOK.md`, admin guide, role-by-role user guides with screenshots **in English and Amharic**, staff training scripts and one-page quick-reference cards (teacher, registrar, accountant, guardian), report-card/receipt/ID-card template customisation guide, data-migration guide, **pilot plan** (one campus, a full assessment cycle, baseline sheet for report-card preparation time, attendance time, fee follow-up time and guardian reach, feedback log, go/no-go criteria from proposal §16), and a known-limitations/future-work list matching proposal §18.

**Done when:**
- Following RUNBOOK.md alone yields a working system on the Yegara account **and** on a clean local server; restoring a backup yields a working system; the PWA installs from the production HTTPS URL; teachers can take attendance offline on a real phone; the pilot plan and Amharic training materials are ready.

---

## Phase order cheat-sheet

| # | Phase | Proposal phase | Est. weeks |
|---|---|---|---|
| 1 | Repo, tooling, MAMP, i18n | 2–3 | 1 |
| 2 | Schema, migrations, seeds | 2 | 1–2 |
| 3 | Auth, RBAC, tenancy, consent, audit | 3 | 2–3 |
| 4 | Academic setup, Ethiopian calendar | 3 | 2–3 |
| 5 | Staff and teaching assignments | 4 | 1–2 |
| 6 | Admissions and enrolment | 4 | 2 |
| 7 | Student information, guardians, ID cards | 4 | 2–3 |
| 8 | Timetable | 4 | 1–2 |
| 9 | Attendance with offline entry | 5 | 2–3 |
| 10 | Marks workflow | 5 | 2–3 |
| 11 | Results engine and report cards | 5 | 3–4 |
| 12 | Fee structures and invoicing | 6 | 2–3 |
| 13 | Payments, receipts, shifts, refunds, arrears | 6 | 3 |
| 14 | SMS, email, announcements, notifications | 7 | 2 |
| 15 | Automation, welfare and conduct | 7 | 2 |
| 16 | Parent and student portals | 7 | 2–3 |
| 17 | Reports, statistics, multi-campus | 7 | 2–3 |
| 18 | Rollover, migration, platform admin, licensing | 8 | 2–3 |
| 19 | Hardening, privacy, QA, load | 8 | 3–4 |
| 20 | Deployment, docs, training, pilot | 9 | 3–4 |

(Several phases overlap in practice, which is how the proposal's 30–40 week estimate is reached.)

## Hosting check before you start (important)
Shared/cPanel hosting is built for PHP. Before Phase 3, ask Yegara support: (1) are **Node.js apps** supported and which versions; (2) are **WebSockets** allowed (if not, Socket.IO long-polling still works — school notifications arriving within seconds is acceptable); (3) **MySQL 8 or MariaDB**; (4) **SSH** and **cron**; (5) whether idle Node apps are **stopped** or limited by RAM/process count; (6) **where the servers are located** (important for children's-data policy). Scheduled jobs and SMS retries need a process that runs reliably; if idle spin-down is a problem, rely on cPanel cron hitting `/api/internal/cron`, or take their **VPS plan** — the code stays the same.

## Tips for getting the best results from the AI
- **One phase per session.** Paste only the phase prompt; context comes from `PROJECT_SPEC.md` and `docs/PROGRESS.md`.
- **Make it prove it.** End each phase with: *"Run the full test suite and the Done-when checks and show me the output."*
- **Review the dangerous parts yourself** (or with a second AI session): scoping middleware (Phase 3), sensitive-field encryption (Phase 7), the marks workflow and results engine (Phases 10–11), the financial ledger and numbering (Phases 12–13), licence verification (Phase 18).
- **Get native Amharic review** of every UI string, SMS template and report-card label before the pilot; machine-written Amharic is the biggest quality risk.
- **Confirm school rules in discovery** before Phase 4: grading scale, pass marks, rank/tie policy, promotion rules, report-card layout, fee policy, who may see what. Put them in the seed data, not in code.
- **Split big phases when needed:** *"Do only the backend half, then stop"* → *"Now the UI half."* Phases 11, 13, 17 and 20 are the likeliest.
- **Run the pilot over a full assessment cycle** (marks entry through report cards) — that is where a school information system proves its value.
