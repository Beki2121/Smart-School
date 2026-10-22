# Local development runbook

1. Install Node.js 20+ and npm. For durable workflows, start a local MySQL 8 or MAMP service.
2. Copy `.env.example` to `.env`. Leave `STORAGE_MODE=memory` only for temporary UI/API exploration. For durable data, create the UTF-8 database, configure credentials, set `STORAGE_MODE=mysql`, and run migrations/seeds.
3. Run `npm install`, then `npm run dev`. Web runs on Vite port 5174; API defaults to port 4000.
4. Check `GET /api/health` and the UI login. In MySQL mode, use the demo account set by the environment and rotate that password immediately.
5. Run `npm test`, `npm run lint` and `npm run build`.

In PowerShell, if script execution policy blocks `npm.ps1`, use `npm.cmd` in place of `npm`.

This is a development runbook only. No production deployment, hosting, migrations of customer data, release process, backup schedule, or live support procedure is provided. Do not expose the memory-mode demo or sample password to a network.
