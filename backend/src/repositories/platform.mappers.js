export function mapOrganization(row) {
  let branding = row.branding_json ?? row.branding;
  if (typeof branding === 'string') {
    try { branding = JSON.parse(branding); } catch { branding = {}; }
  }
  return {
    id: row.id, name: row.name, status: row.status,
    preferredLocale: row.preferred_locale ?? row.preferredLocale ?? 'en',
    currencyCode: row.currency_code ?? row.currencyCode ?? 'ETB',
    branding: branding ?? {}, requestedAt: row.requested_at ?? row.requestedAt ?? null,
    activatedAt: row.activated_at ?? row.activatedAt ?? null,
    suspendedAt: row.suspended_at ?? row.suspendedAt ?? null,
    closedAt: row.closed_at ?? row.closedAt ?? null,
    closureRetentionUntil: row.closure_retention_until ?? row.closureRetentionUntil ?? null,
    trialEndsAt: row.trial_ends_at ?? row.trialEndsAt ?? null
  };
}

export function mapSubscriptionPlan(row) {
  let modules = row.modules_json ?? row.modules ?? [];
  if (typeof modules === 'string') {
    try { modules = JSON.parse(modules); } catch { modules = []; }
  }
  return {
    id: row.id, code: row.code, name: row.name, description: row.description ?? '',
    monthlyPrice: Number(row.monthly_price ?? row.monthlyPrice ?? 0),
    currencyCode: row.currency_code ?? row.currencyCode ?? 'ETB',
    trialDays: Number(row.trial_days ?? row.trialDays ?? 30),
    studentLimit: row.student_limit == null ? null : Number(row.student_limit),
    staffLimit: row.staff_limit == null ? null : Number(row.staff_limit),
    siteLimit: row.site_limit == null ? null : Number(row.site_limit),
    modules, isActive: Boolean(row.is_active ?? row.isActive)
  };
}

export function fromMysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const iso = String(value).replace(' ', 'T');
  return iso.endsWith('Z') ? iso : `${iso}Z`;
}
