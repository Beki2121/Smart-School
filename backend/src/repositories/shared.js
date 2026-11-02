import { randomUUID } from 'node:crypto';

export const now = () => new Date().toISOString();

export function billingPeriodEnd(startValue, cycle) {
  const date = new Date(startValue);
  if (Number.isNaN(date.getTime())) throw new TypeError('Invalid billing period start date.');
  const months = { monthly: 1, termly: 4, yearly: 12 }[cycle];
  if (!months) throw new TypeError('Invalid subscription billing cycle.');
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const endOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, endOfMonth));
  return date.toISOString();
}

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

export function organizationAdministratorConflict() {
  const error = new Error('At least one active school administrator must remain.');
  error.code = 'SCHOOL_LAST_ADMIN';
  error.status = 409;
  return error;
}

export function planLimitError(resource, limit, current = null) {
  const error = new Error(`The active plan ${resource} limit of ${limit} has been reached.`);
  error.status = 409;
  error.code = 'PLAN_LIMIT_REACHED';
  error.details = [{ resource, limit, ...(current == null ? {} : { current }) }];
  return error;
}

export function planLimitsExceededError(details) {
  const error = new Error(`Current usage exceeds the new plan limits: ${
    details.map(({ resource }) => resource).join(', ')
  }.`);
  error.status = 409;
  error.code = 'PLAN_LIMIT_REACHED';
  error.details = details;
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
