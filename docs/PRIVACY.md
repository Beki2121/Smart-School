# Privacy and children’s data — initial review notes

This file is a starting inventory, not a legal assessment or a production privacy program.

## Current data processed

- Account identifiers (name, email/phone), password hash, role, organization/campus membership and refresh-token hashes.
- Student names in Amharic and Latin scripts, student number, gender and section.
- Attendance dates/status and assessment name, score and draft state.
- Audit action, actor, entity and before/after snapshots for implemented writes.

Sample records are synthetic. Do not use real children’s data with the memory-mode demo.

## Current safeguards and gaps

- JWTs include tenant/campus claims and API query scope derives from the active-campus claim. Role checks limit route access.
- Student profile edits and guardian-link changes are campus-scoped and audited. Guardian contact reads/writes are limited to owner/director, principal, registrar and system-admin roles; teacher student list/detail responses omit guardian phone numbers.
- Guardian links created by the current workflow default to unverified with student-results and fee access disabled. Unlinking removes only the student relationship and retains the guardian record.
- Authentication uses bcrypt password hashes, short-lived JWT access tokens, an HTTP-only SameSite=Strict refresh cookie, hashed one-time refresh secrets, rate limits and a development login lockout.
- API request payload size is capped; Zod validates implemented writes; production requires MySQL and a non-default secret.
- **Not complete:** no AES-256-GCM/HMAC sensitive-field service, audited reveal flow, guardian verification/consent lifecycle, configured retention, data-subject export/erase/anonymisation, complete access/isolation matrix, guardian/student portal authorization, incident-response runbook, backup/restore evidence, threat model, or legal review. The current guardian workflow records contacts but does not verify identity or consent and must not be treated as a production-ready guardian process.
- Audit log has insert-only application behavior for implemented writes; database-level immutability and complete auditing coverage are not established.

## Required before production

Minimize student data; define purpose/legal basis and retention; review all role and object-level access with school stakeholders; implement guardian verification and consent; encrypt sensitive fields and audit reads; confirm hosting/data location and transfers; exercise restore and breach-response procedures; obtain local counsel review of Ethiopian law including Proclamation No. 1321/2024; and complete a security/privacy review with real-device accessibility and native Amharic review.

## Incident response placeholder

No operational runbook is implemented yet. Before production, the school must appoint an incident lead and counsel, preserve logs/evidence, contain affected accounts/systems, assess affected children/guardians and data, document decisions, notify authorities/data subjects according to counsel-confirmed deadlines (planning target 72 hours), restore safely, and record corrective actions. This paragraph is not a substitute for a tested legal runbook.
