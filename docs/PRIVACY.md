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
- Guardian links created by the current workflow default to unverified with student-results and fee access disabled. Authorized school roles can explicitly verify the relationship and grant portal permissions; invitation-based guardian accounts are supported. Unlinking removes only the student relationship and retains the guardian record.
- Student ID, health, learning-support and emergency-contact values are stored with AES-256-GCM using keys derived from the separately configured `SENSITIVE_DATA_KEY`. ID lookup hashes use a distinct derived HMAC key. Protected reads are explicit, campus-scoped, no-store and audited; audit fields exclude plaintext contact/sensitive values.
- Authentication uses bcrypt password hashes, short-lived JWT access tokens, an HTTP-only SameSite=Strict refresh cookie, hashed one-time refresh secrets, rate limits and a development login lockout.
- API request payload size is capped; Zod validates implemented writes; production requires MySQL and a non-default secret.
- **Not complete:** guardian consent lifecycle, configured retention, data-subject export/erase/anonymisation, complete route-by-route cross-tenant/class/guardian authorization matrix, production MySQL/browser E2E evidence, incident-response runbook, backup/restore evidence, threat model, and legal review. Guardian verification is an administrative verification step, not identity proofing or proof of consent.
- Audit log has insert-only application behavior for implemented writes; database-level immutability and complete auditing coverage are not established.

## Required before production

Minimize student data; define purpose/legal basis and retention; review all role and object-level access with school stakeholders; implement consent; confirm hosting/data location and transfers; configure and back up the sensitive-data key; exercise restore and breach-response procedures; obtain local counsel review of applicable Ethiopian law; and complete a security/privacy review with real-device accessibility and native Amharic review.

## Incident response placeholder

No operational runbook is implemented yet. Before production, the school must appoint an incident lead and counsel, preserve logs/evidence, contain affected accounts/systems, assess affected children/guardians and data, document decisions, notify authorities/data subjects according to counsel-confirmed deadlines (planning target 72 hours), restore safely, and record corrective actions. This paragraph is not a substitute for a tested legal runbook.
