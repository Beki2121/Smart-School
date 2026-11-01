import { randomUUID } from 'node:crypto';

export const now = () => new Date().toISOString();

export const addisDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Addis_Ababa', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

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

export function feeConflict(message) {
  const error = new Error(message);
  error.code = 'FEE_CONFLICT';
  return error;
}
