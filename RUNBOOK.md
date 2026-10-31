# SIMS runbook

## Local development and school-local installation

1. Install Node.js 20+ and npm. For durable workflows, use the MySQL/MariaDB version supported by the selected hosting provider.
2. Copy `.env.example` to `.env` and validate the configuration with `npm run check:env`.
3. Choose a deployment mode:
   - `STORAGE_MODE=memory` for temporary demo or UI exploration only.
   - `STORAGE_MODE=mysql` for durable local usage; create the UTF-8 database, configure `DB_*`, then run `npm run db:migrate`. This applies pending migrations, including `202610290007_sis_completion.js` for the SIS completion workflows and `202610300001_academic_planning.js` for term/semester typing, subject categories, school-calendar entries, syllabus units, lesson plans, and promotion rules. Back up the database and review pending migrations before applying them to an existing installation. Demo seeds are opt-in only: set `ALLOW_DEMO_SEED=true` and run `npm run db:seed` only against a dedicated demo database. Never seed a school database with showcase data.
4. Run `npm install`, then `npm run dev`.
5. Check `GET http://localhost:4000/api/health` and sign in to the UI. In MySQL mode, rotate the demo password immediately before any live or pilot usage.
6. Run `npm test`, `npm run lint`, and `npm run build` before moving to a pilot or wider school testing.

In PowerShell, if script execution policy blocks `npm.ps1`, use `npm.cmd` instead of `npm`.

## Local deployment notes

- This build is designed for school-local installation or controlled hosted deployment without Docker.
- No simultaneous bidirectional cloud/local sync is included.
- If the environment is behind a shared host or cPanel, confirm that Node.js is supported, WebSockets are allowed or long-polling fallback is accepted, MySQL version is compatible, SSH/cron are available, and idle process limits will not kill the API unexpectedly.
- Keep the private JWT secret and any support/licence keys outside the repository. Never commit secrets or production credentials.
- Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and a public `SMTP_FROM` address for production password recovery. Store the credentials in the hosting provider's secret store, not in source control. The reset email link expires after 30 minutes and can be used once.
- Set `PRIVATE_DOCUMENTS_DIR` to a persistent directory outside the public web root, with read/write access limited to the API service. It holds admission and student documents; back it up securely alongside the database, and verify restore permissions before launch. The SIS completion migration is not automatically applied to a live database by this development task.
- SaaS platform access requires an initial `super_admin` account. After applying migrations, provision it with `npm run platform-admin:create` from the backend workspace, using `ALLOW_PLATFORM_ADMIN_BOOTSTRAP=true` and private `PLATFORM_ADMIN_NAME`, `PLATFORM_ADMIN_EMAIL`, and `PLATFORM_ADMIN_PASSWORD` values in a protected, temporary process environment. The password must be at least 16 characters. The script refuses to run without the explicit opt-in and writes an audit event; remove the bootstrap values immediately afterward. Do not store the password in source control or shared shell history.
- School registration is approval-based and subscription billing is manual. Closure is export-first; after its personal-data deadline a platform administrator must explicitly confirm pseudonymization. Financial records are retained beyond their configured deadline until a reviewed purge workflow is implemented. Review [`docs/API.md`](docs/API.md) before representing these workflows as production-ready.
- Academic dates are stored as Gregorian ISO dates. School Setup displays their Ethiopian-calendar equivalents and accepts Gregorian date input; enter the Ethiopian academic-year label separately. Confirm regional curriculum mappings and promotion criteria with school leadership before operational use. Promotion eligibility is an audited decision aid, not automatic promotion.

## Pilot and release checklist

- Confirm the school role matrix, acceptable guardian-child access, and retention expectations.
- Review the privacy and incident-handling notes in [`docs/PRIVACY.md`](docs/PRIVACY.md).
- Test backup/restore and school-local restore steps before pilot.
- Run a controlled pilot over a full assessment cycle (marks entry to report-card review) with training for staff and administrators.
- Use the deployment notes in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for environment-specific configuration and rollout steps.

This runbook remains a local deployment and pilot guide only. It is not a production compliance statement or a substitute for legal review.
