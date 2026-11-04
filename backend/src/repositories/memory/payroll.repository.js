import { randomUUID } from 'node:crypto';
import { now } from '../shared.js';
import { calculatePayrollLine, payrollInputFingerprint } from '../payroll.math.js';

function payrollError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function clone(value) {
  return structuredClone(value);
}

function dateOnly(value) {
  return String(value).slice(0, 10);
}

function periodDays(period) {
  return Math.floor((Date.parse(`${period.endsOn}T00:00:00Z`) -
    Date.parse(`${period.startsOn}T00:00:00Z`)) / 86400000) + 1;
}

function mapPayment(payment) {
  return { ...payment };
}

export const memoryPayrollBundle = {
  payrollScope(actor) {
    return { organizationId: actor.orgId, campusId: actor.activeCampusId };
  },
  findPayrollPeriod(periodId, actor) {
    return this.payrollPeriods.find((item) => item.id === periodId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId) ?? null;
  },
  findPayrollRun(runId, actor) {
    return this.payrollRuns.find((item) => item.id === runId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId) ?? null;
  },
  async appendPayrollAudit(actor, action, entityType, entityId, before, after) {
    await this.appendAudit(actor, action, entityType, entityId, before, after);
  },
  addPayrollNotification(actor, sourceType, sourceId, title, body, recipientRoles) {
    const userIds = new Set(this.users.filter((user) => user.isActive !== false &&
      user.campusIds?.includes(actor.activeCampusId) && recipientRoles.includes(user.role))
      .map((user) => user.id));
    for (const user of this.users.filter((item) => userIds.has(item.id))) {
      if (this.userNotifications.some((item) => item.userId === user.id &&
          item.sourceType === sourceType && item.sourceId === sourceId)) continue;
      this.userNotifications.unshift({
        id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
        userId: user.id, sourceType, sourceId, titleEn: title, titleAm: title,
        bodyEn: body, bodyAm: body, readAt: null, createdAt: now()
      });
    }
  },
  async listPayrollRules(actor) {
    return this.payrollSalaryRules.filter((item) => item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId).sort((a, b) => a.name.localeCompare(b.name));
  },
  async createPayrollRule(data, actor) {
    const repeated = this.payrollSalaryRules.find((item) => item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && item.idempotencyKey === data.idempotencyKey);
    if (repeated) return clone(repeated);
    if (this.payrollSalaryRules.some((item) => item.organizationId === actor.orgId &&
        item.campusId === actor.activeCampusId && item.code === data.code)) {
      throw payrollError('PAYROLL_RULE_CONFLICT', 'A rule with this code already exists.');
    }
    const rule = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'active', createdBy: actor.sub, createdAt: now(), updatedAt: now()
    };
    this.payrollSalaryRules.push(rule);
    await this.appendPayrollAudit(actor, 'payroll.rule_created', 'payroll_salary_rule',
      rule.id, null, rule);
    return clone(rule);
  },
  async listPayrollSalaryStructures(actor, staffId) {
    if (staffId && !this.staff.some((item) => item.id === staffId &&
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)) return null;
    return this.payrollSalaryStructures.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      (!staffId || item.staffId === staffId))
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  },
  async createPayrollSalaryStructure(data, actor) {
    const repeated = this.payrollSalaryStructures.find((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.idempotencyKey === data.idempotencyKey);
    if (repeated) return clone(repeated);
    const staff = this.staff.find((item) => item.id === data.staffId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.employmentStatus === 'active' && !item.archivedAt);
    if (!staff) throw payrollError('PAYROLL_STAFF_NOT_FOUND', 'Active staff member not found.', 404);
    if (this.payrollSalaryStructures.some((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.staffId === data.staffId && item.effectiveFrom === data.effectiveFrom)) {
      throw payrollError('PAYROLL_STRUCTURE_CONFLICT', 'A salary structure already exists for this effective date.');
    }
    for (const ruleId of [data.taxRuleId, data.pensionRuleId].filter(Boolean)) {
      if (!this.payrollSalaryRules.some((item) => item.id === ruleId &&
          item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
          item.status === 'active')) {
        throw payrollError('PAYROLL_RULE_NOT_FOUND', 'Selected salary rule is not available.', 404);
      }
    }
    const structure = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'active', createdBy: actor.sub, updatedBy: actor.sub,
      createdAt: now(), updatedAt: now()
    };
    this.payrollSalaryStructures.push(structure);
    await this.appendPayrollAudit(actor, 'payroll.salary_structure_created',
      'payroll_salary_structure', structure.id, null, structure);
    return clone(structure);
  },
  async updatePayrollSalaryStructure(structureId, data, actor) {
    const structure = this.payrollSalaryStructures.find((item) => item.id === structureId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    if (!structure) return null;
    if (Object.hasOwn(data, 'effectiveTo') && data.effectiveTo !== null &&
        data.effectiveTo < structure.effectiveFrom) {
      throw payrollError('PAYROLL_STRUCTURE_DATES_INVALID',
        'Salary structure end date must not precede its effective date.');
    }
    for (const ruleId of [data.taxRuleId, data.pensionRuleId].filter(Boolean)) {
      if (!this.payrollSalaryRules.some((item) => item.id === ruleId &&
          item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
          item.status === 'active')) {
        throw payrollError('PAYROLL_RULE_NOT_FOUND', 'Selected salary rule is not available.', 404);
      }
    }
    const before = clone(structure);
    Object.assign(structure, data, { updatedBy: actor.sub, updatedAt: now() });
    await this.appendPayrollAudit(actor, 'payroll.salary_structure_updated',
      'payroll_salary_structure', structure.id, before, structure);
    return clone(structure);
  },
  async listPayrollPeriods(actor) {
    return this.payrollPeriods.filter((item) => item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId).sort((a, b) => b.startsOn.localeCompare(a.startsOn))
      .map((period) => ({
        ...clone(period),
        run: clone(this.payrollRuns.find((item) => item.periodId === period.id) ?? null)
      }));
  },
  async createPayrollPeriod(data, actor) {
    const repeated = this.payrollPeriods.find((item) => item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && item.idempotencyKey === data.idempotencyKey);
    if (repeated) return clone(repeated);
    const existing = this.payrollPeriods.find((item) => item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && item.code === data.code);
    if (existing) throw payrollError('PAYROLL_PERIOD_CONFLICT', 'A payroll period with this code already exists.');
    const organization = this.organizations.find((item) => item.id === actor.orgId);
    const period = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, currencyCode: organization?.currencyCode ?? 'ETB',
      status: 'draft', createdBy: actor.sub, openedAt: null, closedAt: null,
      createdAt: now(), updatedAt: now()
    };
    this.payrollPeriods.push(period);
    await this.appendPayrollAudit(actor, 'payroll.period_created', 'payroll_period',
      period.id, null, period);
    return clone(period);
  },
  async openPayrollPeriod(periodId, actor) {
    const period = this.findPayrollPeriod(periodId, actor);
    if (!period) return null;
    if (period.status === 'open') return clone(period);
    if (period.status !== 'draft') {
      throw payrollError('PAYROLL_INVALID_TRANSITION', 'Only a draft payroll period can be opened.');
    }
    const before = { status: period.status, startsOn: period.startsOn, endsOn: period.endsOn };
    period.status = 'open';
    period.openedAt = now();
    period.updatedAt = now();
    await this.appendPayrollAudit(actor, 'payroll.period_opened', 'payroll_period',
      period.id, before, { status: period.status, startsOn: period.startsOn, endsOn: period.endsOn });
    return clone(period);
  },
  async listPayrollInputs(periodId, actor) {
    if (!this.findPayrollPeriod(periodId, actor)) return null;
    return clone(this.payrollInputs.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.periodId === periodId).sort((a, b) => a.staffId.localeCompare(b.staffId)));
  },
  async loadPayrollInputs(periodId, actor) {
    const period = this.findPayrollPeriod(periodId, actor);
    if (!period) return null;
    if (period.status !== 'open') {
      throw payrollError('PAYROLL_PERIOD_LOCKED', 'Inputs can only be loaded into an open period.');
    }
    const existing = this.payrollInputs.filter((item) => item.periodId === periodId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    if (existing.length && existing.every((item) => item.loadedFromHr)) return clone(existing);
    const activeStaff = this.staff.filter((staff) => staff.organizationId === actor.orgId &&
      staff.campusId === actor.activeCampusId && staff.employmentStatus === 'active' &&
      !staff.archivedAt);
    const loaded = [];
    for (const staff of activeStaff) {
      const attendance = await this.getStaffAttendanceForPeriod(
        staff.id, period.startsOn, period.endsOn, actor
      ) ?? [];
      const leave = await this.getApprovedHrLeaveForPeriod(
        staff.id, period.startsOn, period.endsOn, actor
      ) ?? [];
      const unpaidHalfDays = leave.filter((item) => item.kind === 'unpaid')
        .reduce((sum, item) => sum + (item.requestedHalfDays ?? 0), 0);
      const presentDays = attendance.filter((item) =>
        ['present', 'late'].includes(item.status)).length;
      let input = existing.find((item) => item.staffId === staff.id);
      const before = input ? clone(input) : null;
      if (!input) {
        input = {
          id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
          periodId, staffId: staff.id, attendanceDays: presentDays, overtimeMinutes: 0,
          bonusMinor: 0, adjustmentMinor: 0, adjustmentReason: '',
          sourceAttendanceDays: presentDays, sourceUnpaidLeaveHalfDays: unpaidHalfDays,
          loadedFromHr: true, updatedBy: actor.sub, createdAt: now(), updatedAt: now()
        };
        this.payrollInputs.push(input);
      } else {
        Object.assign(input, {
          attendanceDays: presentDays, sourceAttendanceDays: presentDays,
          sourceUnpaidLeaveHalfDays: unpaidHalfDays, loadedFromHr: true,
          updatedBy: actor.sub, updatedAt: now()
        });
      }
      await this.appendPayrollAudit(actor, 'payroll.inputs_loaded', 'payroll_input',
        input.id, before, input);
      loaded.push(clone(input));
    }
    return loaded;
  },
  async updatePayrollInput(periodId, staffId, data, actor) {
    const period = this.findPayrollPeriod(periodId, actor);
    if (!period) return null;
    if (period.status !== 'open') {
      throw payrollError('PAYROLL_PERIOD_LOCKED', 'Inputs for a locked period cannot be edited.');
    }
    const input = this.payrollInputs.find((item) => item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && item.periodId === periodId &&
      item.staffId === staffId);
    if (!input) return null;
    const before = clone(input);
    Object.assign(input, data, { updatedBy: actor.sub, updatedAt: now() });
    await this.appendPayrollAudit(actor, 'payroll.input_updated', 'payroll_input',
      input.id, before, input);
    return clone(input);
  },
  async createPayrollAdjustment(periodId, data, actor) {
    const repeated = this.payrollAdjustments.find((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.idempotencyKey === data.idempotencyKey);
    if (repeated) return clone(repeated);
    const period = this.findPayrollPeriod(periodId, actor);
    if (!period) return null;
    if (period.status !== 'open') {
      throw payrollError('PAYROLL_PERIOD_LOCKED', 'Adjustments can only be entered in an open period.');
    }
    if (!this.staff.some((item) => item.id === data.staffId &&
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)) {
      throw payrollError('PAYROLL_STAFF_NOT_FOUND', 'Staff member not found.', 404);
    }
    if (data.sourceLineId) {
      const source = this.payrollLines.find((item) => item.id === data.sourceLineId &&
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
        item.staffId === data.staffId);
      const sourceRun = source && this.payrollRuns.find((item) =>
        item.id === source.runId && ['locked', 'closed'].includes(item.status));
      const sourcePeriod = sourceRun && this.findPayrollPeriod(sourceRun.periodId, actor);
      if (!source || !sourcePeriod || sourcePeriod.endsOn >= period.startsOn) {
        throw payrollError('PAYROLL_ADJUSTMENT_SOURCE_INVALID',
          'Correction must reference a locked line from an earlier period.');
      }
    }
    const adjustment = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      periodId, ...data, createdBy: actor.sub, createdAt: now()
    };
    this.payrollAdjustments.push(adjustment);
    await this.appendPayrollAudit(actor, 'payroll.adjustment_created',
      'payroll_adjustment', adjustment.id, null, adjustment);
    return clone(adjustment);
  },
  async createPayrollRun(periodId, idempotencyKey, actor) {
    const repeated = this.payrollRuns.find((item) => item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && item.idempotencyKey === idempotencyKey);
    if (repeated) return this.getPayrollRun(repeated.id, actor);
    const period = this.findPayrollPeriod(periodId, actor);
    if (!period) throw payrollError('PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found.', 404);
    if (period.status !== 'open') {
      throw payrollError('PAYROLL_INVALID_TRANSITION', 'A run can only be created for an open period.');
    }
    if (this.payrollRuns.some((item) => item.activePeriodId === period.id &&
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)) {
      throw payrollError('PAYROLL_ACTIVE_RUN_EXISTS', 'This period already has an active payroll run.');
    }
    const run = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      periodId, activePeriodId: period.id, idempotencyKey, status: 'draft',
      preparedBy: actor.sub, reviewedBy: null, inputFingerprint: null,
      calculatedAt: null, submittedAt: null, approvedAt: null, rejectedAt: null,
      lockedAt: null, closedAt: null, rejectionReason: null, createdAt: now(), updatedAt: now()
    };
    this.payrollRuns.push(run);
    await this.appendPayrollAudit(actor, 'payroll.run_created', 'payroll_run',
      run.id, null, run);
    return this.getPayrollRun(run.id, actor);
  },
  async calculatePayrollRun(runId, options, actor) {
    const run = this.findPayrollRun(runId, actor);
    if (!run) return null;
    if (!['draft', 'calculated'].includes(run.status)) {
      throw payrollError('PAYROLL_RUN_LOCKED', 'This payroll run cannot be recalculated.');
    }
    const period = this.findPayrollPeriod(run.periodId, actor);
    if (!period || period.status !== 'open') {
      throw payrollError('PAYROLL_PERIOD_LOCKED', 'Only an open payroll period can be calculated.');
    }
    if (options.allowNegativeNet) {
      const granted = await this.getRolePermissions(actor.orgId, actor.role);
      if (!granted.includes('payroll.net.override')) {
        throw payrollError('PAYROLL_OVERRIDE_FORBIDDEN', 'You cannot override a negative net amount.', 403);
      }
    }
    const inputs = this.payrollInputs.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.periodId === period.id).sort((a, b) => a.staffId.localeCompare(b.staffId));
    if (!inputs.length) throw payrollError('PAYROLL_INPUTS_REQUIRED', 'Load payroll inputs before calculating.');
    const lines = [];
    for (const input of inputs) {
      const staff = this.staff.find((item) => item.id === input.staffId &&
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
        !item.archivedAt);
      const structure = this.payrollSalaryStructures.find((item) =>
        item.staffId === input.staffId && item.organizationId === actor.orgId &&
        item.campusId === actor.activeCampusId && item.status === 'active' &&
        item.effectiveFrom <= period.endsOn &&
        (!item.effectiveTo || item.effectiveTo >= period.startsOn));
      if (!staff || !structure) {
        throw payrollError('PAYROLL_STRUCTURE_REQUIRED',
          `An active salary structure is required for staff ${input.staffId}.`);
      }
      if (structure.currencyCode !== period.currencyCode) {
        throw payrollError('PAYROLL_CURRENCY_MISMATCH',
          'Salary structure currency must match the payroll period currency.');
      }
      const additionalAdjustments = this.payrollAdjustments.filter((item) =>
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
        item.periodId === period.id && item.staffId === staff.id);
      const taxRule = this.payrollSalaryRules.find((item) => item.id === structure.taxRuleId &&
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
      const pensionRule = this.payrollSalaryRules.find((item) =>
        item.id === structure.pensionRuleId && item.organizationId === actor.orgId &&
        item.campusId === actor.activeCampusId);
      const result = calculatePayrollLine({
        period, staff, structure, input, adjustments: additionalAdjustments,
        taxRule, pensionRule
      });
      if (result.netMinor < 0 && !options.allowNegativeNet) {
        throw payrollError('PAYROLL_NEGATIVE_NET',
          'The calculated net pay is negative; an authorised, audited override is required.');
      }
      lines.push({ id: randomUUID(), organizationId: actor.orgId,
        campusId: actor.activeCampusId, runId: run.id, periodId: period.id,
        staffId: staff.id, staffName: [staff.givenNameEn, staff.fatherNameEn,
          staff.grandfatherNameEn].filter(Boolean).join(' '),
        departmentId: staff.departmentId ?? null, salaryStructureId: structure.id,
        ...result, calculationDetailsJson: JSON.stringify(result.calculationDetails),
        createdAt: now(), updatedAt: now() });
    }
    const fingerprint = payrollInputFingerprint(inputs) + ':' +
      JSON.stringify(lines.map((item) => [
        item.staffId, item.salaryStructureId, item.currencyCode, item.baseSalaryMinor,
        item.proratedBaseMinor, item.allowancesMinor, item.overtimeMinor,
        item.bonusMinor, item.adjustmentMinor, item.unpaidLeaveDeductionMinor,
        item.taxMinor, item.pensionMinor, item.otherDeductionsMinor,
        item.grossMinor, item.netMinor, item.calculationDetails
      ]));
    if (run.status === 'calculated' && run.inputFingerprint === fingerprint) {
      return this.getPayrollRun(run.id, actor);
    }
    const before = { status: run.status, inputFingerprint: run.inputFingerprint };
    this.payrollLines = this.payrollLines.filter((item) =>
      item.organizationId !== actor.orgId || item.campusId !== actor.activeCampusId ||
      item.runId !== run.id);
    this.payrollLines.push(...lines);
    run.status = 'calculated';
    run.calculatedAt = now();
    run.inputFingerprint = fingerprint;
    run.updatedAt = now();
    await this.appendPayrollAudit(actor, 'payroll.run_calculated', 'payroll_run',
      run.id, before, { status: run.status, lineCount: lines.length, fingerprint });
    if (options.allowNegativeNet) {
      await this.appendPayrollAudit(actor, 'payroll.net_override', 'payroll_run',
        run.id, null, { reason: options.overrideReason, negativeLineIds: lines
          .filter((line) => line.netMinor < 0).map((line) => line.id) });
    }
    return this.getPayrollRun(run.id, actor);
  },
  async getPayrollRun(runId, actor) {
    const run = this.findPayrollRun(runId, actor);
    if (!run) return null;
    const period = this.findPayrollPeriod(run.periodId, actor);
    const lines = this.payrollLines.filter((item) => item.runId === run.id &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)
      .sort((a, b) => a.staffName.localeCompare(b.staffName)).map((line) => {
        const payments = this.payrollPayments.filter((item) =>
          item.lineId === line.id && item.organizationId === actor.orgId &&
          item.campusId === actor.activeCampusId);
        return { ...clone(line), payments: payments.map(mapPayment),
          paidMinor: payments.reduce((sum, item) => sum + item.amountMinor, 0) };
      });
    return {
      ...clone(run), period: clone(period), lines,
      summary: lines.reduce((total, line) => ({
        staffCount: total.staffCount + 1,
        grossMinor: total.grossMinor + line.grossMinor,
        netMinor: total.netMinor + line.netMinor,
        currencyCode: line.currencyCode
      }), { staffCount: 0, grossMinor: 0, netMinor: 0, currencyCode: period?.currencyCode })
    };
  },
  async submitPayrollRun(runId, actor) {
    const run = this.findPayrollRun(runId, actor);
    if (!run) return null;
    if (run.status === 'pending_approval') return this.getPayrollRun(runId, actor);
    if (run.status !== 'calculated') {
      throw payrollError('PAYROLL_INVALID_TRANSITION', 'Only a calculated run can be submitted.');
    }
    const before = { status: run.status };
    run.status = 'pending_approval';
    run.submittedAt = now();
    run.updatedAt = now();
    await this.appendPayrollAudit(actor, 'payroll.run_submitted', 'payroll_run',
      run.id, before, { status: run.status });
    this.addPayrollNotification(actor, 'payroll_approval_requested', run.id,
      'Payroll approval requested', 'A payroll run is ready for review.',
      ['owner_director', 'principal', 'system_admin']);
    return this.getPayrollRun(runId, actor);
  },
  async reviewPayrollRun(runId, decision, reason, actor) {
    const run = this.findPayrollRun(runId, actor);
    if (!run) return null;
    if (run.status === decision && run.reviewedBy === actor.sub) {
      return this.getPayrollRun(runId, actor);
    }
    if (run.status !== 'pending_approval') {
      throw payrollError('PAYROLL_INVALID_TRANSITION', 'Only a pending payroll run can be reviewed.');
    }
    if (run.preparedBy === actor.sub) {
      throw payrollError('PAYROLL_SELF_APPROVAL', 'The preparer cannot approve or reject their own payroll run.', 403);
    }
    const before = { status: run.status, reviewedBy: run.reviewedBy };
    run.status = decision;
    run.reviewedBy = actor.sub;
    run.rejectionReason = decision === 'rejected' ? reason : null;
    const timestamp = now();
    if (decision === 'approved') run.approvedAt = timestamp;
    else {
      run.rejectedAt = timestamp;
      run.activePeriodId = null;
    }
    run.updatedAt = timestamp;
    await this.appendPayrollAudit(actor, `payroll.run_${decision}`, 'payroll_run',
      run.id, before, { status: run.status, reason });
    this.addPayrollNotification(actor, `payroll_${decision}`, run.id,
      `Payroll ${decision}`, `A payroll run was ${decision}.`, [this.users.find((item) =>
        item.id === run.preparedBy)?.role].filter(Boolean));
    return this.getPayrollRun(runId, actor);
  },
  async lockPayrollRun(runId, actor) {
    const run = this.findPayrollRun(runId, actor);
    if (!run) return null;
    if (run.status === 'locked') return this.getPayrollRun(runId, actor);
    if (run.status !== 'approved') {
      throw payrollError('PAYROLL_INVALID_TRANSITION', 'Only an approved payroll run can be locked.');
    }
    const before = { status: run.status };
    run.status = 'locked';
    run.lockedAt = now();
    run.updatedAt = now();
    await this.appendPayrollAudit(actor, 'payroll.run_locked', 'payroll_run',
      run.id, before, { status: run.status });
    return this.getPayrollRun(runId, actor);
  },
  async recordPayrollPayment(runId, data, actor) {
    const repeated = this.payrollPayments.find((item) => item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && item.idempotencyKey === data.idempotencyKey);
    if (repeated) return clone(repeated);
    const run = this.findPayrollRun(runId, actor);
    if (!run) return null;
    if (run.status !== 'locked') {
      throw payrollError('PAYROLL_INVALID_TRANSITION', 'Payments can only be recorded for a locked run.');
    }
    const line = this.payrollLines.find((item) => item.id === data.lineId &&
      item.runId === runId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId);
    if (!line) return null;
    const paid = this.payrollPayments.filter((item) => item.lineId === line.id &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)
      .reduce((sum, item) => sum + item.amountMinor, 0);
    if (line.netMinor < 0 || data.amountMinor > line.netMinor - paid) {
      throw payrollError('PAYROLL_OVERPAYMENT', 'Payment exceeds the unpaid net salary.');
    }
    const payment = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      runId, periodId: run.periodId, lineId: line.id, staffId: line.staffId,
      ...data, currencyCode: line.currencyCode, paidAt: now(),
      recordedBy: actor.sub, createdAt: now()
    };
    this.payrollPayments.push(payment);
    await this.appendPayrollAudit(actor, 'payroll.payment_recorded', 'payroll_payment',
      payment.id, null, payment);
    return clone(payment);
  },
  async generatePayrollPayslips(runId, actor) {
    const run = this.findPayrollRun(runId, actor);
    if (!run) return null;
    if (!['locked', 'closed'].includes(run.status)) {
      throw payrollError('PAYROLL_INVALID_TRANSITION', 'Payslips are generated after the run is locked.');
    }
    const lines = this.payrollLines.filter((item) => item.runId === run.id &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    const created = [];
    for (const line of lines) {
      let payslip = this.payrollPayslips.find((item) => item.lineId === line.id);
      if (!payslip) {
        const staff = this.staff.find((item) => item.id === line.staffId);
        payslip = {
          id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
          runId, periodId: run.periodId, lineId: line.id, staffId: line.staffId,
          snapshot: { ...clone(line), staffName: line.staffName,
            period: clone(this.findPayrollPeriod(run.periodId, actor)) },
          generatedBy: actor.sub, generatedAt: now()
        };
        this.payrollPayslips.push(payslip);
        await this.appendPayrollAudit(actor, 'payroll.payslip_generated',
          'payroll_payslip', payslip.id, null, { lineId: line.id });
        if (staff?.userId) {
          this.addPayrollNotification({ ...actor, sub: staff.userId },
            'payroll_payslip_ready', payslip.id, 'Payslip ready',
            'Your payslip is ready.', [this.users.find((item) => item.id === staff.userId)?.role]
              .filter(Boolean));
        }
      }
      created.push(clone(payslip));
    }
    return created;
  },
  async listPayrollPayslips(actor) {
    return clone(this.payrollPayslips.filter((item) => item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId).sort((a, b) =>
      b.generatedAt.localeCompare(a.generatedAt)));
  },
  async getPayrollPayslip(payslipId, actor) {
    const payslip = this.payrollPayslips.find((item) => item.id === payslipId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    return payslip ? clone(payslip) : null;
  },
  async closePayrollRun(runId, actor) {
    const run = this.findPayrollRun(runId, actor);
    if (!run) return null;
    if (run.status === 'closed') return this.getPayrollRun(runId, actor);
    if (run.status !== 'locked') {
      throw payrollError('PAYROLL_INVALID_TRANSITION', 'Only a locked payroll run can be closed.');
    }
    const lines = this.payrollLines.filter((item) => item.runId === run.id);
    const slips = this.payrollPayslips.filter((item) => item.runId === run.id);
    const unpaid = lines.some((line) => line.netMinor > this.payrollPayments
      .filter((item) => item.lineId === line.id)
      .reduce((sum, item) => sum + item.amountMinor, 0));
    if (unpaid || slips.length !== lines.length) {
      throw payrollError('PAYROLL_CLOSE_INCOMPLETE', 'All net pay must be paid and payslips generated before closing.');
    }
    const before = { status: run.status };
    run.status = 'closed';
    run.closedAt = now();
    run.activePeriodId = null;
    run.updatedAt = now();
    const period = this.findPayrollPeriod(run.periodId, actor);
    if (period) {
      period.status = 'closed';
      period.closedAt = run.closedAt;
      period.updatedAt = run.closedAt;
    }
    await this.appendPayrollAudit(actor, 'payroll.run_closed', 'payroll_run',
      run.id, before, { status: run.status });
    return this.getPayrollRun(runId, actor);
  },
  async getPayrollDashboard(actor) {
    const periods = this.payrollPeriods.filter((item) => item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId);
    const runs = this.payrollRuns.filter((item) => item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId);
    const summary = new Map();
    for (const run of runs) {
      const lines = this.payrollLines.filter((item) => item.runId === run.id);
      const key = lines[0]?.currencyCode ?? 'N/A';
      const item = summary.get(key) ?? { currencyCode: key, grossMinor: 0, netMinor: 0,
        pendingApprovals: 0, pendingPayments: 0 };
      item.grossMinor += lines.reduce((sum, line) => sum + line.grossMinor, 0);
      item.netMinor += lines.reduce((sum, line) => sum + line.netMinor, 0);
      if (run.status === 'pending_approval') item.pendingApprovals++;
      if (run.status === 'locked') item.pendingPayments += lines.filter((line) =>
        this.payrollPayments.filter((payment) => payment.lineId === line.id)
          .reduce((sum, payment) => sum + payment.amountMinor, 0) < line.netMinor).length;
      summary.set(key, item);
    }
    return {
      currentPeriods: periods.filter((item) => !['closed'].includes(item.status)).length,
      periods: periods.slice().sort((a, b) => b.startsOn.localeCompare(a.startsOn)).slice(0, 12),
      currencies: [...summary.values()]
    };
  }
};
