import { randomUUID } from 'node:crypto';

export const now = () => new Date().toISOString();

export function campusScopeError(message) {
  const error = new Error(message);
  error.code = 'CAMPUS_SCOPE_VIOLATION';
  return error;
}

export function auditRow(actor, action, entityType, entityId, before, after) {
  return {
    id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
    actor_id: actor.sub, action, entity_type: entityType, entity_id: entityId,
    before_json: before ? JSON.stringify(before) : null,
    after_json: after ? JSON.stringify(after) : null
  };
}
