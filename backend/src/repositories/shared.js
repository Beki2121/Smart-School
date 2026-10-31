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

export function setupConflict(message) {
  const error = new Error(message);
  error.code = 'SETUP_CONFLICT';
  return error;
}

export function planLimitError(resource, limit) {
  const error = new Error(`The active plan ${resource} limit of ${limit} has been reached.`);
  error.status = 409;
  error.code = 'PLAN_LIMIT_REACHED';
  return error;
}

export function scheduleConflict(message) {
  const error = new Error(message);
  error.code = 'SCHEDULE_CONFLICT';
  return error;
}
