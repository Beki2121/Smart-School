import { randomUUID } from 'node:crypto';
import { auditRow } from '../shared.js';
import { calculatePayrollLine, payrollInputFingerprint } from '../payroll.math.js';

function payrollError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function duplicate(error) {
  return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
}

function json(value, fallback = null) {
  if (value == null) return fallback;
  try { return JSON.parse(value); }
  catch (error) { throw new Error('Stored payroll JSON is invalid.', { cause: error }); }
}

function asMinor(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new TypeError('Stored amount exceeds safe integer precision.');
  return result;
}

function mapRule(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    code: row.code, idempotencyKey: row.idempotency_key, name: row.name,
    kind: row.kind, configuration: json(row.configuration_json), status: row.status,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function mapStructure(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    staffId: row.staff_id, currencyCode: row.currency_code,
    idempotencyKey: row.idempotency_key,
    basicSalaryMinor: asMinor(row.basic_salary_minor),
    allowances: json(row.allowances_json, []), deductions: json(row.deductions_json, []),
    taxRuleId: row.tax_rule_id, pensionRuleId: row.pension_rule_id,
    overtimeRateMinorPerHour: asMinor(row.overtime_rate_minor_per_hour),
    effectiveFrom: dateOnly(row.effective_from),
    effectiveTo: dateOnly(row.effective_to),
    status: row.status, createdBy: row.created_by, updatedBy: row.updated_by,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function mapPeriod(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    code: row.code, idempotencyKey: row.idempotency_key,
    currencyCode: row.currency_code, startsOn: dateOnly(row.starts_on),
    endsOn: dateOnly(row.ends_on), status: row.status,
    createdBy: row.created_by, openedAt: row.opened_at, closedAt: row.closed_at,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function mapRun(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    periodId: row.period_id, activePeriodId: row.active_period_id,
    idempotencyKey: row.idempotency_key, status: row.status, preparedBy: row.prepared_by,
    reviewedBy: row.reviewed_by, inputFingerprint: row.input_fingerprint,
    calculatedAt: row.calculated_at, submittedAt: row.submitted_at,
    approvedAt: row.approved_at, rejectedAt: row.rejected_at, lockedAt: row.locked_at,
    closedAt: row.closed_at, rejectionReason: row.rejection_reason,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function mapInput(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    periodId: row.period_id, staffId: row.staff_id,
    attendanceDays: row.attendance_days, overtimeMinutes: row.overtime_minutes,
    bonusMinor: asMinor(row.bonus_minor), adjustmentMinor: asMinor(row.adjustment_minor),
    adjustmentReason: row.adjustment_reason,
    sourceAttendanceDays: row.source_attendance_days,
    sourceUnpaidLeaveHalfDays: row.source_unpaid_leave_half_days,
    loadedFromHr: Boolean(row.loaded_from_hr), updatedBy: row.updated_by,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function mapLine(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    runId: row.run_id, periodId: row.period_id, staffId: row.staff_id,
    staffName: [row.given_name_en, row.father_name_en, row.grandfather_name_en]
      .filter(Boolean).join(' '),
    departmentId: row.department_id, salaryStructureId: row.salary_structure_id,
    currencyCode: row.currency_code, baseSalaryMinor: asMinor(row.base_salary_minor),
    proratedBaseMinor: asMinor(row.prorated_base_minor),
    allowancesMinor: asMinor(row.allowances_minor), overtimeMinor: asMinor(row.overtime_minor),
    bonusMinor: asMinor(row.bonus_minor), adjustmentMinor: asMinor(row.adjustment_minor),
    unpaidLeaveDeductionMinor: asMinor(row.unpaid_leave_deduction_minor),
    taxMinor: asMinor(row.tax_minor), pensionMinor: asMinor(row.pension_minor),
    otherDeductionsMinor: asMinor(row.other_deductions_minor),
    grossMinor: asMinor(row.gross_minor), netMinor: asMinor(row.net_minor),
    calculationDetails: json(row.calculation_details_json, {}),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function mapAdjustment(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    periodId: row.period_id, staffId: row.staff_id, sourceLineId: row.source_line_id,
    idempotencyKey: row.idempotency_key, amountMinor: asMinor(row.amount_minor),
    reason: row.reason, createdBy: row.created_by, createdAt: row.created_at
  };
}

function mapPayment(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    runId: row.run_id, periodId: row.period_id, lineId: row.line_id,
    staffId: row.staff_id, idempotencyKey: row.idempotency_key,
    reference: row.reference, amountMinor: asMinor(row.amount_minor),
    currencyCode: row.currency_code,
    paymentDate: dateOnly(row.payment_date),
    paidAt: row.paid_at, recordedBy: row.recorded_by, createdAt: row.created_at
  };
}

function mapPayslip(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    runId: row.run_id, periodId: row.period_id, lineId: row.line_id,
    staffId: row.staff_id, snapshot: json(row.snapshot_json, {}),
    generatedBy: row.generated_by, generatedAt: row.generated_at
  };
}

function dateOnly(value) {
  if (value == null) return null;
  return value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value).slice(0, 10);
}

async function findPeriod(query, periodId, actor, lock = false) {
  const builder = query('payroll_periods').where({
    id: periodId, organization_id: actor.orgId, campus_id: actor.activeCampusId
  });
  if (lock) builder.forUpdate();
  return builder.first();
}

async function findRun(query, runId, actor, lock = false) {
  const builder = query('payroll_runs').where({
    id: runId, organization_id: actor.orgId, campus_id: actor.activeCampusId
  });
  if (lock) builder.forUpdate();
  return builder.first();
}

async function audit(trx, actor, action, entityType, entityId, before, after) {
  await trx('audit_log').insert(auditRow(actor, action, entityType, entityId, before, after));
}

async function notify(trx, actor, sourceType, sourceId, title, body, roles, extraUsers = []) {
  const users = await trx('user_campuses as uc').join('users as u', 'u.id', 'uc.user_id')
    .where({
      'uc.campus_id': actor.activeCampusId, 'uc.is_active': true, 'u.is_active': true
    }).whereIn('u.role', roles).select('u.id');
  const userIds = new Set([...users.map(({ id }) => id), ...extraUsers.filter(Boolean)]);
  if (!userIds.size) return;
  const existing = new Set(await trx('user_notifications').where({
    organization_id: actor.orgId, campus_id: actor.activeCampusId,
    source_type: sourceType, source_id: sourceId
  }).whereIn('user_id', [...userIds]).pluck('user_id'));
  const rows = [...userIds].filter((id) => !existing.has(id)).map((userId) => ({
    id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
    user_id: userId, source_type: sourceType, source_id: sourceId,
    title_en: title, title_am: title, body_en: body, body_am: body
  }));
  if (rows.length) {
    await trx('user_notifications').insert(rows)
      .onConflict(['user_id', 'source_type', 'source_id']).ignore();
  }
}

async function lineRows(query, runId, actor) {
  return query('payroll_lines as pl').join('staff as s', function joinStaff() {
    this.on('s.id', '=', 'pl.staff_id').andOn('s.organization_id', '=', 'pl.organization_id')
      .andOn('s.campus_id', '=', 'pl.campus_id');
  }).where({
    'pl.organization_id': actor.orgId, 'pl.campus_id': actor.activeCampusId,
    'pl.run_id': runId
  }).select('pl.*', 's.given_name_en', 's.father_name_en',
    's.grandfather_name_en', 's.department_id').orderBy('s.given_name_en');
}

async function payrollRunResult(query, runId, actor) {
  const runRow = await findRun(query, runId, actor);
  if (!runRow) return null;
  const periodRow = await findPeriod(query, runRow.period_id, actor);
  const lineRowsFound = await lineRows(query, runId, actor);
  const lines = [];
  let grossMinor = 0;
  let netMinor = 0;
  for (const row of lineRowsFound) {
    const line = mapLine(row);
    const payments = (await query('payroll_payments').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, line_id: line.id
    }).orderBy('created_at')).map(mapPayment);
    line.payments = payments;
    line.paidMinor = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
    grossMinor += line.grossMinor;
    netMinor += line.netMinor;
    lines.push(line);
  }
  return {
    ...mapRun(runRow), period: periodRow ? mapPeriod(periodRow) : null, lines,
    summary: { staffCount: lines.length, grossMinor, netMinor,
      currencyCode: periodRow?.currency_code }
  };
}

export const mysqlPayrollBundle = {
  async listPayrollRules(actor) {
    const rows = await this.db('payroll_salary_rules').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('name').limit(200);
    return rows.map(mapRule);
  },
  async createPayrollRule(data, actor) {
    const values = {
      id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
      code: data.code, idempotency_key: data.idempotencyKey, name: data.name,
      kind: data.kind, configuration_json: JSON.stringify(data.configuration),
      status: 'active', created_by: actor.sub
    };
    try {
      await this.db.transaction(async (trx) => {
        const existing = await trx('payroll_salary_rules').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          idempotency_key: data.idempotencyKey
        }).first();
        if (existing) { values.id = existing.id; return; }
        await trx('payroll_salary_rules').insert(values);
        await audit(trx, actor, 'payroll.rule_created', 'payroll_salary_rule',
          values.id, null, data);
      });
    } catch (error) {
      if (!duplicate(error)) throw error;
      const existing = await this.db('payroll_salary_rules').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (existing) return mapRule(existing);
      throw payrollError('PAYROLL_RULE_CONFLICT', 'A rule with this code already exists.');
    }
    return mapRule(await this.db('payroll_salary_rules').where({
      id: values.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async listPayrollSalaryStructures(actor, staffId) {
    if (staffId && !await this.db('staff').where({
      id: staffId, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first('id')) return null;
    const query = this.db('payroll_salary_structures').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    });
    if (staffId) query.where({ staff_id: staffId });
    const rows = await query.orderBy('effective_from', 'desc').limit(1000);
    return rows.map(mapStructure);
  },
  async createPayrollSalaryStructure(data, actor) {
    const values = {
      id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
      staff_id: data.staffId, currency_code: data.currencyCode,
      idempotency_key: data.idempotencyKey, basic_salary_minor: data.basicSalaryMinor,
      allowances_json: JSON.stringify(data.allowances), deductions_json: JSON.stringify(data.deductions),
      tax_rule_id: data.taxRuleId ?? null, pension_rule_id: data.pensionRuleId ?? null,
      overtime_rate_minor_per_hour: data.overtimeRateMinorPerHour,
      effective_from: data.effectiveFrom, effective_to: data.effectiveTo ?? null,
      status: 'active', created_by: actor.sub, updated_by: actor.sub
    };
    try {
      await this.db.transaction(async (trx) => {
        const existing = await trx('payroll_salary_structures').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          idempotency_key: data.idempotencyKey
        }).first();
        if (existing) { values.id = existing.id; return; }
        const staff = await trx('staff').where({
          id: data.staffId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          employment_status: 'active'
        }).whereNull('archived_at').forUpdate().first();
        if (!staff) throw payrollError('PAYROLL_STAFF_NOT_FOUND', 'Active staff member not found.', 404);
        for (const ruleId of [data.taxRuleId, data.pensionRuleId].filter(Boolean)) {
          if (!await trx('payroll_salary_rules').where({
            id: ruleId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
            status: 'active'
          }).first('id')) {
            throw payrollError('PAYROLL_RULE_NOT_FOUND', 'Selected salary rule is not available.', 404);
          }
        }
        await trx('payroll_salary_structures').insert(values);
        await audit(trx, actor, 'payroll.salary_structure_created',
          'payroll_salary_structure', values.id, null, data);
      });
    } catch (error) {
      if (!duplicate(error)) throw error;
      const existing = await this.db('payroll_salary_structures').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (existing) return mapStructure(existing);
      throw payrollError('PAYROLL_STRUCTURE_CONFLICT',
        'A salary structure already exists for this staff member and effective date.');
    }
    return mapStructure(await this.db('payroll_salary_structures').where({
      id: values.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async updatePayrollSalaryStructure(structureId, data, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('payroll_salary_structures').where({
        id: structureId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      const before = mapStructure(row);
      if (Object.hasOwn(data, 'effectiveTo') && data.effectiveTo !== null &&
          data.effectiveTo < before.effectiveFrom) {
        throw payrollError('PAYROLL_STRUCTURE_DATES_INVALID',
          'Salary structure end date must not precede its effective date.');
      }
      for (const ruleId of [data.taxRuleId, data.pensionRuleId].filter(Boolean)) {
        if (!await trx('payroll_salary_rules').where({
          id: ruleId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          status: 'active'
        }).first('id')) {
          throw payrollError('PAYROLL_RULE_NOT_FOUND', 'Selected salary rule is not available.', 404);
        }
      }
      const columns = {
        currencyCode: 'currency_code', basicSalaryMinor: 'basic_salary_minor',
        allowances: 'allowances_json', deductions: 'deductions_json',
        taxRuleId: 'tax_rule_id', pensionRuleId: 'pension_rule_id',
        overtimeRateMinorPerHour: 'overtime_rate_minor_per_hour',
        effectiveTo: 'effective_to', status: 'status'
      };
      const update = { updated_by: actor.sub };
      for (const [key, column] of Object.entries(columns)) {
        if (Object.hasOwn(data, key)) {
          update[column] = ['allowances', 'deductions'].includes(key)
            ? JSON.stringify(data[key]) : data[key];
        }
      }
      await trx('payroll_salary_structures').where({
        id: structureId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).update(update);
      const after = mapStructure(await trx('payroll_salary_structures')
        .where({ id: structureId, organization_id: actor.orgId, campus_id: actor.activeCampusId }).first());
      await audit(trx, actor, 'payroll.salary_structure_updated',
        'payroll_salary_structure', structureId, before, after);
      return after;
    });
  },
  async listPayrollPeriods(actor) {
    const rows = await this.db('payroll_periods').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('starts_on', 'desc').limit(100);
    const results = [];
    for (const row of rows) {
      const run = await this.db('payroll_runs').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, period_id: row.id
      }).first();
      results.push({ ...mapPeriod(row), run: run ? mapRun(run) : null });
    }
    return results;
  },
  async createPayrollPeriod(data, actor) {
    const values = {
      id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
      code: data.code, idempotency_key: data.idempotencyKey,
      starts_on: data.startsOn, ends_on: data.endsOn, status: 'draft',
      created_by: actor.sub
    };
    try {
      await this.db.transaction(async (trx) => {
        const existing = await trx('payroll_periods').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          idempotency_key: data.idempotencyKey
        }).first();
        if (existing) { values.id = existing.id; return; }
        const org = await trx('organizations').where({ id: actor.orgId }).first('currency_code');
        if (!org?.currency_code) {
          throw payrollError('PAYROLL_CURRENCY_REQUIRED', 'Set the organization currency before payroll.');
        }
        values.currency_code = org.currency_code;
        await trx('payroll_periods').insert(values);
        await audit(trx, actor, 'payroll.period_created', 'payroll_period',
          values.id, null, data);
      });
    } catch (error) {
      if (!duplicate(error)) throw error;
      const existing = await this.db('payroll_periods').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (existing) return mapPeriod(existing);
      throw payrollError('PAYROLL_PERIOD_CONFLICT', 'A payroll period with this code already exists.');
    }
    return mapPeriod(await this.db('payroll_periods').where({
      id: values.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async openPayrollPeriod(periodId, actor) {
    return this.db.transaction(async (trx) => {
      const period = await findPeriod(trx, periodId, actor, true);
      if (!period) return null;
      if (period.status === 'open') return mapPeriod(period);
      if (period.status !== 'draft') {
        throw payrollError('PAYROLL_INVALID_TRANSITION', 'Only a draft payroll period can be opened.');
      }
      const before = { status: period.status, startsOn: dateOnly(period.starts_on),
        endsOn: dateOnly(period.ends_on) };
      await trx('payroll_periods').where({
        id: periodId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).update({ status: 'open', opened_at: trx.fn.now() });
      const updated = await trx('payroll_periods').where({ id: periodId,
        organization_id: actor.orgId, campus_id: actor.activeCampusId }).first();
      await audit(trx, actor, 'payroll.period_opened', 'payroll_period',
        periodId, before, { ...before, status: 'open' });
      return mapPeriod(updated);
    });
  },
  async listPayrollInputs(periodId, actor) {
    if (!await findPeriod(this.db, periodId, actor)) return null;
    const rows = await this.db('payroll_inputs').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, period_id: periodId
    }).orderBy('staff_id').limit(1000);
    return rows.map(mapInput);
  },
  async loadPayrollInputs(periodId, actor) {
    return this.db.transaction(async (trx) => {
      const period = await findPeriod(trx, periodId, actor, true);
      if (!period) return null;
      if (period.status !== 'open') {
        throw payrollError('PAYROLL_PERIOD_LOCKED', 'Inputs can only be loaded into an open period.');
      }
      const existingRows = await trx('payroll_inputs').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, period_id: periodId
      }).forUpdate();
      if (existingRows.length && existingRows.every((item) => item.loaded_from_hr)) {
        return existingRows.map(mapInput);
      }
      const staffRows = await trx('staff').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        employment_status: 'active'
      }).whereNull('archived_at').orderBy('id').limit(2000);
      const loaded = [];
      for (const staff of staffRows) {
        const [attendance, leave] = await Promise.all([
          this.getStaffAttendanceForPeriod(staff.id, dateOnly(period.starts_on),
            dateOnly(period.ends_on), actor),
          this.getApprovedHrLeaveForPeriod(staff.id, dateOnly(period.starts_on),
            dateOnly(period.ends_on), actor)
        ]);
        const presentDays = (attendance ?? []).filter((item) =>
          ['present', 'late'].includes(item.status)).length;
        const unpaidHalfDays = (leave ?? []).filter((item) => item.kind === 'unpaid')
          .reduce((sum, item) => sum + (item.requestedHalfDays ?? 0), 0);
        const existing = existingRows.find((item) => item.staff_id === staff.id);
        const values = {
          id: existing?.id ?? randomUUID(),
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          period_id: periodId, staff_id: staff.id,
          attendance_days: existing?.attendance_days ?? presentDays,
          overtime_minutes: existing?.overtime_minutes ?? 0,
          bonus_minor: existing?.bonus_minor ?? 0,
          adjustment_minor: existing?.adjustment_minor ?? 0,
          adjustment_reason: existing?.adjustment_reason ?? '',
          source_attendance_days: presentDays,
          source_unpaid_leave_half_days: unpaidHalfDays,
          loaded_from_hr: true, updated_by: actor.sub
        };
        if (existing) {
          await trx('payroll_inputs').where({
            id: existing.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
          }).update(values);
        } else await trx('payroll_inputs').insert(values);
        const after = await trx('payroll_inputs').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          period_id: periodId, staff_id: staff.id
        }).first();
        await audit(trx, actor, 'payroll.inputs_loaded', 'payroll_input',
          after.id, existing ? mapInput(existing) : null, mapInput(after));
        loaded.push(mapInput(after));
      }
      return loaded;
    });
  },
  async updatePayrollInput(periodId, staffId, data, actor) {
    return this.db.transaction(async (trx) => {
      const period = await findPeriod(trx, periodId, actor, true);
      if (!period) return null;
      if (period.status !== 'open') {
        throw payrollError('PAYROLL_PERIOD_LOCKED', 'Inputs for a locked period cannot be edited.');
      }
      const input = await trx('payroll_inputs').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        period_id: periodId, staff_id: staffId
      }).forUpdate().first();
      if (!input) return null;
      const before = mapInput(input);
      await trx('payroll_inputs').where({
        id: input.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).update({
        attendance_days: data.attendanceDays, overtime_minutes: data.overtimeMinutes,
        bonus_minor: data.bonusMinor, adjustment_minor: data.adjustmentMinor,
        adjustment_reason: data.adjustmentReason, updated_by: actor.sub
      });
      const updated = await trx('payroll_inputs').where({
        id: input.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).first();
      await audit(trx, actor, 'payroll.input_updated', 'payroll_input',
        input.id, before, mapInput(updated));
      return mapInput(updated);
    });
  },
  async createPayrollAdjustment(periodId, data, actor) {
    const repeated = await this.db('payroll_adjustments').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId,
      idempotency_key: data.idempotencyKey
    }).first();
    if (repeated) return mapAdjustment(repeated);
    try {
      return await this.db.transaction(async (trx) => {
        const period = await findPeriod(trx, periodId, actor, true);
        if (!period) return null;
        if (period.status !== 'open') {
          throw payrollError('PAYROLL_PERIOD_LOCKED', 'Adjustments can only be entered in an open period.');
        }
        if (!await trx('staff').where({
          id: data.staffId, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).first('id')) {
          throw payrollError('PAYROLL_STAFF_NOT_FOUND', 'Staff member not found.', 404);
        }
        if (data.sourceLineId) {
          const source = await trx('payroll_lines as l').join('payroll_runs as r', function joinRun() {
            this.on('r.id', '=', 'l.run_id').andOn('r.organization_id', '=', 'l.organization_id')
              .andOn('r.campus_id', '=', 'l.campus_id');
          }).join('payroll_periods as p', function joinPeriod() {
            this.on('p.id', '=', 'r.period_id').andOn('p.organization_id', '=', 'r.organization_id')
              .andOn('p.campus_id', '=', 'r.campus_id');
          }).where({
            'l.id': data.sourceLineId, 'l.staff_id': data.staffId,
            'l.organization_id': actor.orgId,
            'l.campus_id': actor.activeCampusId
          }).whereIn('r.status', ['locked', 'closed'])
            .where('p.ends_on', '<', period.starts_on).first('l.id');
          if (!source) {
            throw payrollError('PAYROLL_ADJUSTMENT_SOURCE_INVALID',
              'Correction must reference a closed line from an earlier period.');
          }
        }
        const id = randomUUID();
        const values = {
          id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          period_id: periodId, staff_id: data.staffId,
          source_line_id: data.sourceLineId ?? null,
          idempotency_key: data.idempotencyKey, amount_minor: data.amountMinor,
          reason: data.reason, created_by: actor.sub
        };
        await trx('payroll_adjustments').insert(values);
        await audit(trx, actor, 'payroll.adjustment_created',
          'payroll_adjustment', id, null, data);
        return mapAdjustment(await trx('payroll_adjustments').where({ id,
          organization_id: actor.orgId, campus_id: actor.activeCampusId }).first());
      });
    } catch (error) {
      if (!duplicate(error)) throw error;
      const existing = await this.db('payroll_adjustments').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (existing) return mapAdjustment(existing);
      throw error;
    }
  },
  async createPayrollRun(periodId, idempotencyKey, actor) {
    try {
      const id = randomUUID();
      await this.db.transaction(async (trx) => {
        const repeated = await trx('payroll_runs').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          idempotency_key: idempotencyKey
        }).first();
        if (repeated) { return; }
        const period = await findPeriod(trx, periodId, actor, true);
        if (!period) throw payrollError('PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found.', 404);
        if (period.status !== 'open') {
          throw payrollError('PAYROLL_INVALID_TRANSITION', 'A run can only be created for an open period.');
        }
        const active = await trx('payroll_runs').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          active_period_id: periodId
        }).first('id');
        if (active) throw payrollError('PAYROLL_ACTIVE_RUN_EXISTS',
          'This period already has an active payroll run.');
        await trx('payroll_runs').insert({
          id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          period_id: periodId, active_period_id: periodId, idempotency_key: idempotencyKey,
          status: 'draft', prepared_by: actor.sub
        });
        await audit(trx, actor, 'payroll.run_created', 'payroll_run', id, null,
          { periodId, status: 'draft' });
      });
      const existing = await this.db('payroll_runs').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: idempotencyKey
      }).first();
      return this.getPayrollRun(existing.id, actor);
    } catch (error) {
      if (!duplicate(error)) throw error;
      const existing = await this.db('payroll_runs').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: idempotencyKey
      }).first();
      if (existing) return this.getPayrollRun(existing.id, actor);
      throw error;
    }
  },
  async calculatePayrollRun(runId, options, actor) {
    return this.db.transaction(async (trx) => {
      const run = await findRun(trx, runId, actor, true);
      if (!run) return null;
      if (!['draft', 'calculated'].includes(run.status)) {
        throw payrollError('PAYROLL_RUN_LOCKED', 'This payroll run cannot be recalculated.');
      }
      const period = await findPeriod(trx, run.period_id, actor, true);
      if (!period || period.status !== 'open') {
        throw payrollError('PAYROLL_PERIOD_LOCKED', 'Only an open payroll period can be calculated.');
      }
      if (options.allowNegativeNet) {
        const permissions = await this.getRolePermissions(actor.orgId, actor.role);
        if (!permissions.includes('payroll.net.override')) {
          throw payrollError('PAYROLL_OVERRIDE_FORBIDDEN',
            'You cannot override a negative net amount.', 403);
        }
      }
      const inputRows = await trx('payroll_inputs').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        period_id: period.id
      }).orderBy('staff_id').forUpdate();
      if (!inputRows.length) {
        throw payrollError('PAYROLL_INPUTS_REQUIRED', 'Load payroll inputs before calculating.');
      }
      const lines = [];
      for (const inputRow of inputRows) {
        const staff = await trx('staff').where({
          id: inputRow.staff_id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).whereNull('archived_at').first();
        const structureRow = await trx('payroll_salary_structures').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          staff_id: inputRow.staff_id, status: 'active'
        }).where('effective_from', '<=', period.ends_on)
          .where((query) => query.whereNull('effective_to').orWhere('effective_to', '>=', period.starts_on))
          .orderBy('effective_from', 'desc').forUpdate().first();
        if (!staff || !structureRow) {
          throw payrollError('PAYROLL_STRUCTURE_REQUIRED',
            `An active salary structure is required for staff ${inputRow.staff_id}.`);
        }
        const structure = mapStructure(structureRow);
        if (structure.currencyCode !== period.currency_code) {
          throw payrollError('PAYROLL_CURRENCY_MISMATCH',
            'Salary structure currency must match the payroll period currency.');
        }
        const input = mapInput(inputRow);
        const adjustmentRows = await trx('payroll_adjustments').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          period_id: period.id, staff_id: staff.id
        }).orderBy('created_at').forUpdate();
        const taxRow = structure.taxRuleId ? await trx('payroll_salary_rules').where({
          id: structure.taxRuleId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          status: 'active'
        }).first() : null;
        const pensionRow = structure.pensionRuleId ? await trx('payroll_salary_rules').where({
          id: structure.pensionRuleId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          status: 'active'
        }).first() : null;
        const result = calculatePayrollLine({
          period: mapPeriod(period),
          staff: { ...staff, hiredOn: dateOnly(staff.hired_on) },
          structure, input, adjustments: adjustmentRows.map(mapAdjustment),
          taxRule: taxRow ? mapRule(taxRow) : null,
          pensionRule: pensionRow ? mapRule(pensionRow) : null
        });
        if (result.netMinor < 0 && !options.allowNegativeNet) {
          throw payrollError('PAYROLL_NEGATIVE_NET',
            'The calculated net pay is negative; an authorised, audited override is required.');
        }
        lines.push({
          id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
          run_id: runId, period_id: period.id, staff_id: staff.id,
          salary_structure_id: structure.id, currency_code: result.currencyCode,
          base_salary_minor: result.baseSalaryMinor, prorated_base_minor: result.proratedBaseMinor,
          allowances_minor: result.allowancesMinor, overtime_minor: result.overtimeMinor,
          bonus_minor: result.bonusMinor, adjustment_minor: result.adjustmentMinor,
          unpaid_leave_deduction_minor: result.unpaidLeaveDeductionMinor,
          tax_minor: result.taxMinor, pension_minor: result.pensionMinor,
          other_deductions_minor: result.otherDeductionsMinor,
          gross_minor: result.grossMinor, net_minor: result.netMinor,
          calculation_details_json: JSON.stringify(result.calculationDetails)
        });
      }
      const fingerprint = payrollInputFingerprint(inputRows.map(mapInput)) + ':' +
        JSON.stringify(lines.map((item) => [
          item.staff_id, item.salary_structure_id, item.currency_code,
          item.base_salary_minor, item.prorated_base_minor, item.allowances_minor,
          item.overtime_minor, item.bonus_minor, item.adjustment_minor,
          item.unpaid_leave_deduction_minor, item.tax_minor, item.pension_minor,
          item.other_deductions_minor, item.gross_minor, item.net_minor,
          item.calculation_details_json
        ]));
      if (run.status === 'calculated' && run.input_fingerprint === fingerprint) {
        return payrollRunResult(trx, runId, actor);
      }
      const before = { status: run.status, inputFingerprint: run.input_fingerprint };
      for (const line of lines) {
        const old = await trx('payroll_lines').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          run_id: runId, staff_id: line.staff_id
        }).first('id');
        if (old) {
          delete line.id;
          await trx('payroll_lines').where({ id: old.id,
            organization_id: actor.orgId, campus_id: actor.activeCampusId }).update(line);
        } else await trx('payroll_lines').insert(line);
      }
      await trx('payroll_runs').where({
        id: runId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).update({ status: 'calculated', calculated_at: trx.fn.now(),
        input_fingerprint: fingerprint });
      await audit(trx, actor, 'payroll.run_calculated', 'payroll_run',
        runId, before, { status: 'calculated', lineCount: lines.length, fingerprint });
      if (options.allowNegativeNet) {
        await audit(trx, actor, 'payroll.net_override', 'payroll_run', runId, null, {
          reason: options.overrideReason,
          negativeStaffIds: lines.filter((item) => item.net_minor < 0).map((item) => item.staff_id)
        });
      }
      return payrollRunResult(trx, runId, actor);
    });
  },
  async getPayrollRun(runId, actor) {
    return payrollRunResult(this.db, runId, actor);
  },
  async submitPayrollRun(runId, actor) {
    return this.db.transaction(async (trx) => {
      const run = await findRun(trx, runId, actor, true);
      if (!run) return null;
      if (run.status === 'pending_approval') return this.getPayrollRun(runId, actor);
      if (run.status !== 'calculated') {
        throw payrollError('PAYROLL_INVALID_TRANSITION', 'Only a calculated run can be submitted.');
      }
      await trx('payroll_runs').where({
        id: runId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).update({ status: 'pending_approval', submitted_at: trx.fn.now() });
      await audit(trx, actor, 'payroll.run_submitted', 'payroll_run',
        runId, { status: run.status }, { status: 'pending_approval' });
      await notify(trx, actor, 'payroll_approval_requested', runId,
        'Payroll approval requested', 'A payroll run is ready for review.',
        ['owner_director', 'principal', 'system_admin']);
      return payrollRunResult(trx, runId, actor);
    });
  },
  async reviewPayrollRun(runId, decision, reason, actor) {
    return this.db.transaction(async (trx) => {
      const run = await findRun(trx, runId, actor, true);
      if (!run) return null;
      if (run.status === decision && run.reviewed_by === actor.sub) {
        return payrollRunResult(trx, runId, actor);
      }
      if (run.status !== 'pending_approval') {
        throw payrollError('PAYROLL_INVALID_TRANSITION', 'Only a pending payroll run can be reviewed.');
      }
      if (run.prepared_by === actor.sub) {
        throw payrollError('PAYROLL_SELF_APPROVAL',
          'The preparer cannot approve or reject their own payroll run.', 403);
      }
      const update = {
        status: decision, reviewed_by: actor.sub,
        rejection_reason: decision === 'rejected' ? reason : null
      };
      if (decision === 'approved') update.approved_at = trx.fn.now();
      else {
        update.rejected_at = trx.fn.now();
        update.active_period_id = null;
      }
      await trx('payroll_runs').where({
        id: runId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).update(update);
      await audit(trx, actor, `payroll.run_${decision}`, 'payroll_run', runId,
        { status: run.status, reviewedBy: run.reviewed_by },
        { status: decision, reason });
      const preparer = await trx('users').where({ id: run.prepared_by }).first('id');
      if (preparer) await notify(trx, actor, `payroll_${decision}`, runId,
        `Payroll ${decision}`, `A payroll run was ${decision}.`, [], [preparer.id]);
      return payrollRunResult(trx, runId, actor);
    });
  },
  async lockPayrollRun(runId, actor) {
    return this.db.transaction(async (trx) => {
      const run = await findRun(trx, runId, actor, true);
      if (!run) return null;
      if (run.status === 'locked') return this.getPayrollRun(runId, actor);
      if (run.status !== 'approved') {
        throw payrollError('PAYROLL_INVALID_TRANSITION', 'Only an approved payroll run can be locked.');
      }
      await trx('payroll_runs').where({
        id: runId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).update({ status: 'locked', locked_at: trx.fn.now() });
      await audit(trx, actor, 'payroll.run_locked', 'payroll_run',
        runId, { status: run.status }, { status: 'locked' });
      return payrollRunResult(trx, runId, actor);
    });
  },
  async recordPayrollPayment(runId, data, actor) {
    try {
      return await this.db.transaction(async (trx) => {
        const repeated = await trx('payroll_payments').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          idempotency_key: data.idempotencyKey
        }).first();
        if (repeated) return mapPayment(repeated);
        const run = await findRun(trx, runId, actor, true);
        if (!run) return null;
        const repeatedAfterLock = await trx('payroll_payments').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          idempotency_key: data.idempotencyKey
        }).forUpdate().first();
        if (repeatedAfterLock) return mapPayment(repeatedAfterLock);
        if (run.status !== 'locked') {
          throw payrollError('PAYROLL_INVALID_TRANSITION',
            'Payments can only be recorded for a locked run.');
        }
        const line = await trx('payroll_lines').where({
          id: data.lineId, run_id: runId,
          organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).forUpdate().first();
        if (!line) return null;
        const payments = await trx('payroll_payments').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId, line_id: line.id
        }).select('amount_minor').forUpdate();
        const paid = payments.reduce((sum, payment) => sum + asMinor(payment.amount_minor), 0);
        const net = asMinor(line.net_minor);
        if (net < 0 || data.amountMinor > net - paid) {
          throw payrollError('PAYROLL_OVERPAYMENT', 'Payment exceeds the unpaid net salary.');
        }
        const values = {
          id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
          run_id: runId, period_id: run.period_id, line_id: line.id, staff_id: line.staff_id,
          idempotency_key: data.idempotencyKey, reference: data.reference,
          amount_minor: data.amountMinor, currency_code: line.currency_code,
          payment_date: data.paymentDate, paid_at: trx.fn.now(), recorded_by: actor.sub
        };
        await trx('payroll_payments').insert(values);
        await audit(trx, actor, 'payroll.payment_recorded', 'payroll_payment',
          values.id, null, data);
        return mapPayment(await trx('payroll_payments').where({
          id: values.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).first());
      });
    } catch (error) {
      if (!duplicate(error)) throw error;
      const existing = await this.db('payroll_payments').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (existing) return mapPayment(existing);
      throw error;
    }
  },
  async generatePayrollPayslips(runId, actor) {
    return this.db.transaction(async (trx) => {
      const run = await findRun(trx, runId, actor, true);
      if (!run) return null;
      if (!['locked', 'closed'].includes(run.status)) {
        throw payrollError('PAYROLL_INVALID_TRANSITION',
          'Payslips are generated after the run is locked.');
      }
      const period = await findPeriod(trx, run.period_id, actor);
      const lines = await lineRows(trx, runId, actor);
      const results = [];
      for (const row of lines) {
        let slip = await trx('payroll_payslips').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId, line_id: row.id
        }).first();
        if (!slip) {
          const line = mapLine(row);
          const snapshot = { ...line, period: mapPeriod(period) };
          const id = randomUUID();
          await trx('payroll_payslips').insert({
            id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
            run_id: runId, period_id: run.period_id, line_id: row.id, staff_id: row.staff_id,
            snapshot_json: JSON.stringify(snapshot), generated_by: actor.sub
          });
          await audit(trx, actor, 'payroll.payslip_generated', 'payroll_payslip',
            id, null, { lineId: row.id });
          const staffUser = await trx('staff').where({
            id: row.staff_id, organization_id: actor.orgId, campus_id: actor.activeCampusId
          }).first('user_id');
          await notify(trx, actor, 'payroll_payslip_ready', id,
            'Payslip ready', 'Your payslip is ready.', [], [staffUser?.user_id]);
          slip = await trx('payroll_payslips').where({
            id, organization_id: actor.orgId, campus_id: actor.activeCampusId
          }).first();
        }
        results.push(mapPayslip(slip));
      }
      return results;
    });
  },
  async listPayrollPayslips(actor) {
    const rows = await this.db('payroll_payslips').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('generated_at', 'desc').limit(1000);
    return rows.map(mapPayslip);
  },
  async getPayrollPayslip(payslipId, actor) {
    const row = await this.db('payroll_payslips').where({
      id: payslipId, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first();
    return row ? mapPayslip(row) : null;
  },
  async closePayrollRun(runId, actor) {
    return this.db.transaction(async (trx) => {
      const run = await findRun(trx, runId, actor, true);
      if (!run) return null;
      if (run.status === 'closed') return this.getPayrollRun(runId, actor);
      if (run.status !== 'locked') {
        throw payrollError('PAYROLL_INVALID_TRANSITION', 'Only a locked payroll run can be closed.');
      }
      const lines = await trx('payroll_lines').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, run_id: runId
      }).forUpdate();
      const slips = await trx('payroll_payslips').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, run_id: runId
      }).count({ count: '*' });
      if (Number(slips[0].count) !== lines.length) {
        throw payrollError('PAYROLL_CLOSE_INCOMPLETE', 'Generate every payslip before closing.');
      }
      for (const line of lines) {
        const payments = await trx('payroll_payments').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId, line_id: line.id
        }).sum({ amount: 'amount_minor' });
        if (asMinor(payments[0]?.amount ?? 0) < asMinor(line.net_minor)) {
          throw payrollError('PAYROLL_CLOSE_INCOMPLETE', 'All net pay must be paid before closing.');
        }
      }
      await trx('payroll_runs').where({
        id: runId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).update({ status: 'closed', closed_at: trx.fn.now(), active_period_id: null });
      await trx('payroll_periods').where({
        id: run.period_id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).update({ status: 'closed', closed_at: trx.fn.now() });
      await audit(trx, actor, 'payroll.run_closed', 'payroll_run',
        runId, { status: run.status }, { status: 'closed' });
      return payrollRunResult(trx, runId, actor);
    });
  },
  async getPayrollDashboard(actor) {
    const periods = await this.db('payroll_periods').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('starts_on', 'desc').limit(12);
    const rows = await this.db('payroll_runs as r').join('payroll_lines as l', function joinLines() {
      this.on('l.run_id', '=', 'r.id').andOn('l.organization_id', '=', 'r.organization_id')
        .andOn('l.campus_id', '=', 'r.campus_id');
    }).where({ 'r.organization_id': actor.orgId, 'r.campus_id': actor.activeCampusId })
      .select('r.status', 'l.currency_code')
      .sum({ gross_minor: 'l.gross_minor', net_minor: 'l.net_minor' })
      .countDistinct({ run_count: 'r.id' })
      .groupBy('r.status', 'l.currency_code');
    const currencies = new Map();
    for (const row of rows) {
      const item = currencies.get(row.currency_code) ?? {
        currencyCode: row.currency_code, grossMinor: 0, netMinor: 0,
        pendingApprovals: 0, pendingPayments: 0
      };
      item.grossMinor += asMinor(row.gross_minor);
      item.netMinor += asMinor(row.net_minor);
      if (row.status === 'pending_approval') item.pendingApprovals += Number(row.run_count);
      currencies.set(row.currency_code, item);
    }
    const pendingPayments = await this.db('payroll_runs as r')
      .join('payroll_lines as l', function joinLines() {
        this.on('l.run_id', '=', 'r.id').andOn('l.organization_id', '=', 'r.organization_id')
          .andOn('l.campus_id', '=', 'r.campus_id');
      }).leftJoin(this.db('payroll_payments').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).select('line_id').sum({ paid_minor: 'amount_minor' }).groupBy('line_id').as('p'),
      'p.line_id', 'l.id')
      .where({
        'r.organization_id': actor.orgId, 'r.campus_id': actor.activeCampusId,
        'r.status': 'locked'
      })
      .whereRaw('l.net_minor > COALESCE(p.paid_minor, 0)')
      .select('l.currency_code').countDistinct({ count: 'l.id' })
      .groupBy('l.currency_code');
    for (const row of pendingPayments) {
      const item = currencies.get(row.currency_code) ?? {
        currencyCode: row.currency_code, grossMinor: 0, netMinor: 0,
        pendingApprovals: 0, pendingPayments: 0
      };
      item.pendingPayments = Number(row.count);
      currencies.set(row.currency_code, item);
    }
    return {
      currentPeriods: periods.filter((item) => item.status !== 'closed').length,
      periods: periods.map(mapPeriod), currencies: [...currencies.values()]
    };
  }
};
