import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  api, PayrollDashboard, PayrollInput, PayrollPeriod, PayrollPayslip,
  PayrollRule, PayrollRun, PayrollSalaryStructure
} from '../../api';

type T = (key: string) => string;

const today = () => new Date().toISOString().slice(0, 10);
const idempotencyKey = () => crypto.randomUUID();
type PayrollBracket = { upToMinor: number | null; rateBps: number };
function isPayrollBracketArray(value: unknown): value is PayrollBracket[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 30 &&
    value.every((item) => typeof item === 'object' && item !== null &&
      ('upToMinor' in item) &&
      (item.upToMinor === null || (typeof item.upToMinor === 'number' &&
        Number.isSafeInteger(item.upToMinor) && item.upToMinor >= 0)) &&
      typeof item.rateBps === 'number' && Number.isInteger(item.rateBps) &&
      item.rateBps >= 0 && item.rateBps <= 10000);
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character] ?? character));

export default function PayrollPage({ t, permissions }: {
  t: T; permissions: string[]
}) {
  const can = (permission: string) => permissions.includes(permission);
  const [dashboard, setDashboard] = useState<PayrollDashboard | null>(null);
  const [rules, setRules] = useState<PayrollRule[]>([]);
  const [structures, setStructures] = useState<PayrollSalaryStructure[]>([]);
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [inputs, setInputs] = useState<PayrollInput[]>([]);
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [payslips, setPayslips] = useState<PayrollPayslip[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ruleCode, setRuleCode] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [ruleKind, setRuleKind] = useState<'tax' | 'pension'>('tax');
  const [ruleType, setRuleType] = useState<'flat_rate' | 'brackets'>('flat_rate');
  const [ruleRate, setRuleRate] = useState('0');
  const [ruleBrackets, setRuleBrackets] = useState('[{"upToMinor":null,"rateBps":0}]');
  const [staffId, setStaffId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('ETB');
  const [baseMinor, setBaseMinor] = useState('0');
  const [allowanceName, setAllowanceName] = useState('');
  const [allowanceMinor, setAllowanceMinor] = useState('0');
  const [deductionName, setDeductionName] = useState('');
  const [deductionMinor, setDeductionMinor] = useState('0');
  const [overtimeRate, setOvertimeRate] = useState('0');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [taxRuleId, setTaxRuleId] = useState('');
  const [pensionRuleId, setPensionRuleId] = useState('');
  const [periodCode, setPeriodCode] = useState('');
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [paymentLineId, setPaymentLineId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [decisionReason, setDecisionReason] = useState('');
  const [overrideNegativeNet, setOverrideNegativeNet] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [correctionStaffId, setCorrectionStaffId] = useState('');
  const [correctionLineId, setCorrectionLineId] = useState('');
  const [correctionAmount, setCorrectionAmount] = useState('0');
  const [correctionReason, setCorrectionReason] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [nextDashboard, nextRules, nextStructures, nextPeriods, nextPayslips] =
        await Promise.all([
          api.payrollDashboard(), api.payrollRules(), api.payrollSalaryStructures(),
          api.payrollPeriods(), can('payroll.payslips.view') ? api.payrollPayslips() : Promise.resolve([])
        ]);
      setDashboard(nextDashboard);
      setRules(nextRules);
      setStructures(nextStructures);
      setPeriods(nextPeriods);
      setPayslips(nextPayslips);
      setSelectedPeriodId((current) => current ||
        nextPeriods.find((item) => item.status !== 'closed')?.id || nextPeriods[0]?.id || '');
      const activeRun = nextPeriods.find((item) => item.run?.status &&
        !['closed', 'rejected'].includes(item.run.status))?.run;
      if (activeRun) setSelectedRunId((current) => current || activeRun.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    }
  }, [t]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadPeriod = useCallback(async () => {
    if (!selectedPeriodId) { setInputs([]); return; }
    try { setInputs(await api.payrollInputs(selectedPeriodId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  }, [selectedPeriodId, t]);
  useEffect(() => { void loadPeriod(); }, [loadPeriod]);

  const loadRun = useCallback(async () => {
    if (!selectedRunId) { setRun(null); return; }
    try { setRun(await api.payrollRun(selectedRunId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  }, [selectedRunId, t]);
  useEffect(() => { void loadRun(); }, [loadRun]);

  const locked = useMemo(() => ['locked', 'closed'].includes(run?.status ?? ''),
    [run?.status]);
  const selectedPeriod = periods.find((item) => item.id === selectedPeriodId);
  const lines = run?.lines ?? [];

  async function perform(action: () => Promise<unknown>, after?: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
      await after?.();
      if (selectedPeriodId) await loadPeriod();
      if (selectedRunId) await loadRun();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  }

  async function createRule(event: FormEvent) {
    event.preventDefault();
    let configuration: PayrollRule['configuration'];
    if (ruleType === 'flat_rate') {
      configuration = { type: 'flat_rate', rateBps: Number(ruleRate) };
    } else {
      let parsed: unknown;
      try { parsed = JSON.parse(ruleBrackets); }
      catch {
        setError(t('payrollBracketFormatError'));
        return;
      }
      if (!isPayrollBracketArray(parsed) ||
        parsed.filter((bracket) => bracket.upToMinor === null).length > 1 ||
        parsed.some((bracket, index) => index > 0 &&
          parsed[index - 1].upToMinor !== null &&
          bracket.upToMinor !== null &&
          bracket.upToMinor <= parsed[index - 1].upToMinor!) ||
        (parsed.at(-1)?.upToMinor !== null &&
          parsed.some((bracket) => bracket.upToMinor === null))) {
        setError(t('payrollBracketFormatError'));
        return;
      }
      configuration = { type: 'brackets', brackets: parsed };
    }
    await perform(() => api.createPayrollRule({
      code: ruleCode, name: ruleName, kind: ruleKind, configuration,
      idempotencyKey: idempotencyKey()
    }));
    setRuleCode(''); setRuleName('');
  }

  async function createStructure(event: FormEvent) {
    event.preventDefault();
    await perform(() => api.createPayrollSalaryStructure({
      staffId, currencyCode, basicSalaryMinor: Number(baseMinor),
      allowances: Number(allowanceMinor) > 0
        ? [{ code: 'allowance', name: allowanceName, amountMinor: Number(allowanceMinor) }] : [],
      deductions: Number(deductionMinor) > 0
        ? [{ code: 'deduction', name: deductionName, amountMinor: Number(deductionMinor) }] : [],
      taxRuleId: taxRuleId || null, pensionRuleId: pensionRuleId || null,
      overtimeRateMinorPerHour: Number(overtimeRate), effectiveFrom,
      idempotencyKey: idempotencyKey()
    }));
    setStaffId(''); setBaseMinor('0');
  }

  async function createPeriod(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      const created = await api.createPayrollPeriod({
        code: periodCode, startsOn, endsOn, idempotencyKey: idempotencyKey()
      });
      setSelectedPeriodId(created.id);
    });
    setPeriodCode('');
  }

  async function printPayslip(slip: PayrollPayslip) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setError(t('payrollPrintBlocked'));
      return;
    }
    const snapshot = slip.snapshot;
    const fields = [
      [t('payrollBasicPay'), snapshot.proratedBaseMinor],
      [t('payrollAllowances'), snapshot.allowancesMinor],
      [t('payrollOvertime'), snapshot.overtimeMinor],
      [t('payrollBonus'), snapshot.bonusMinor],
      [t('payrollUnpaidLeave'), -snapshot.unpaidLeaveDeductionMinor],
      [t('payrollTax'), -snapshot.taxMinor],
      [t('payrollPension'), -snapshot.pensionMinor],
      [t('payrollOtherDeductions'), -snapshot.otherDeductionsMinor],
      [t('payrollNetPay'), snapshot.netMinor]
    ];
    printWindow.document.write(`<html><head><title>${escapeHtml(t('payrollPayslip'))}</title>
      <meta charset="utf-8"><style>body{font:16px sans-serif;padding:32px}table{width:100%;border-collapse:collapse}
      td,th{padding:10px;border-bottom:1px solid #ccc;text-align:left}.amount{text-align:right}</style>
      </head><body><h1>${escapeHtml(t('payrollPayslip'))}</h1><p>${escapeHtml(snapshot.staffName ?? '')}</p>
      <p>${escapeHtml(snapshot.period?.code ?? '')} · ${escapeHtml(snapshot.currencyCode)}</p><table>
      ${fields.map(([label, amount]) => `<tr><th>${escapeHtml(String(label))}</th><td class="amount">${escapeHtml(String(amount))} ${escapeHtml(snapshot.currencyCode)}</td></tr>`).join('')}
      </table></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  return <section className="page-section payroll-page">
    <style>{'@media print { .payroll-page > :not(.payroll-print-area) { display:none !important; } }'}</style>
    <header className="section-heading">
      <div><span className="eyebrow">{t('navAdministration')}</span>
        <h1>{t('navPayroll')}</h1><p className="muted">{t('payrollHint')}</p></div>
      <button className="button button-quiet" onClick={() => void refresh()} disabled={busy}>
        {t('refresh')}
      </button>
    </header>
    {error && <div className="form-error" role="alert">{error}</div>}
    {dashboard && <div className="metric-grid">
      <Metric label={t('payrollCurrentPeriods')} value={dashboard.currentPeriods} />
      {dashboard.currencies.map((item) => <Metric key={item.currencyCode}
        label={`${item.currencyCode} ${t('payrollNetPay')}`} value={item.netMinor} />)}
      <Metric label={t('payrollPendingApprovals')}
        value={dashboard.currencies.reduce((sum, item) => sum + item.pendingApprovals, 0)} />
    </div>}

    {can('payroll.structures.manage') && <section className="panel">
      <h2>{t('payrollSalaryStructures')}</h2>
      <form className="form-grid" onSubmit={(event) => void createStructure(event)}>
        <label>{t('payrollStaffId')}<input required value={staffId} onChange={(event) => setStaffId(event.target.value)} /></label>
        <label>{t('currency')}<input required maxLength={3} value={currencyCode}
          onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())} /></label>
        <label>{t('payrollBasicPay')} ({t('minorUnits')})<input type="number" min="0" step="1"
          required value={baseMinor} onChange={(event) => setBaseMinor(event.target.value)} /></label>
        <label>{t('payrollAllowance')}<input value={allowanceName}
          onChange={(event) => setAllowanceName(event.target.value)} /></label>
        <label>{t('payrollAllowance')} ({t('minorUnits')})<input type="number" min="0"
          value={allowanceMinor} onChange={(event) => setAllowanceMinor(event.target.value)} /></label>
        <label>{t('payrollOtherDeductions')}<input value={deductionName}
          onChange={(event) => setDeductionName(event.target.value)} /></label>
        <label>{t('payrollOtherDeductions')} ({t('minorUnits')})<input type="number" min="0"
          value={deductionMinor} onChange={(event) => setDeductionMinor(event.target.value)} /></label>
        <label>{t('payrollOvertimeRate')}<input type="number" min="0" step="1"
          value={overtimeRate} onChange={(event) => setOvertimeRate(event.target.value)} /></label>
        <label>{t('payrollEffectiveFrom')}<input type="date" required value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
        <label>{t('payrollTaxRule')}<select value={taxRuleId}
          onChange={(event) => setTaxRuleId(event.target.value)}>
          <option value="">{t('none')}</option>{rules.filter((item) => item.kind === 'tax')
            .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>{t('payrollPensionRule')}<select value={pensionRuleId}
          onChange={(event) => setPensionRuleId(event.target.value)}>
          <option value="">{t('none')}</option>{rules.filter((item) => item.kind === 'pension')
            .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <button className="button button-primary" disabled={busy}>{t('payrollCreateStructure')}</button>
      </form>
      <ul className="record-list">{structures.map((item) => <li key={item.id}>
        <span>{item.staffId} · {item.basicSalaryMinor} {item.currencyCode} · {item.status}</span>
        {item.status === 'active' && <button className="button button-quiet" disabled={busy}
          onClick={() => void perform(() => api.updatePayrollSalaryStructure(item.id, { status: 'inactive' }))}>
          {t('archive')}
        </button>}
      </li>)}</ul>
    </section>}

    {can('payroll.structures.manage') && <section className="panel">
      <h2>{t('payrollRules')}</h2>
      <form className="form-grid" onSubmit={(event) => void createRule(event)}>
        <label>{t('payrollCode')}<input required value={ruleCode} onChange={(event) => setRuleCode(event.target.value)} /></label>
        <label>{t('payrollName')}<input required value={ruleName} onChange={(event) => setRuleName(event.target.value)} /></label>
        <label>{t('payrollRuleKind')}<select value={ruleKind}
          onChange={(event) => setRuleKind(event.target.value as 'tax' | 'pension')}>
          <option value="tax">{t('payrollTax')}</option><option value="pension">{t('payrollPension')}</option>
        </select></label>
        <label>{t('payrollRuleKind')}<select value={ruleType}
          onChange={(event) => setRuleType(event.target.value as 'flat_rate' | 'brackets')}>
          <option value="flat_rate">{t('payrollRateBps')}</option>
          <option value="brackets">{t('payrollBrackets')}</option>
        </select></label>
        {ruleType === 'flat_rate' ?
          <label>{t('payrollRateBps')}<input type="number" min="0" max="10000" step="1"
            value={ruleRate} onChange={(event) => setRuleRate(event.target.value)} /></label> :
          <label>{t('payrollBracketsHint')}<textarea required rows={3}
            value={ruleBrackets} onChange={(event) => setRuleBrackets(event.target.value)} /></label>}
        <button className="button button-primary" disabled={busy}>{t('add')}</button>
      </form>
      <ul className="record-list">{rules.map((item) => <li key={item.id}>
        {item.name} · {item.kind} · {item.configuration.type === 'flat_rate'
          ? `${item.configuration.rateBps} bps` : t('payrollBrackets')}
      </li>)}</ul>
    </section>}

    {can('payroll.periods.manage') && <section className="panel">
      <h2>{t('payrollPeriods')}</h2>
      <form className="form-grid" onSubmit={(event) => void createPeriod(event)}>
        <label>{t('payrollCode')}<input required value={periodCode} onChange={(event) => setPeriodCode(event.target.value)} /></label>
        <label>{t('dateFrom')}<input type="date" required value={startsOn}
          onChange={(event) => setStartsOn(event.target.value)} /></label>
        <label>{t('dateTo')}<input type="date" required value={endsOn}
          onChange={(event) => setEndsOn(event.target.value)} /></label>
        <button className="button button-primary" disabled={busy}>{t('payrollCreatePeriod')}</button>
      </form>
      <ul className="record-list">{periods.map((period) => <li key={period.id}>
        <div><strong>{period.code}</strong> · {period.startsOn}–{period.endsOn} ·
          {` ${period.currencyCode} · ${period.status}`}
          {period.run && <> · {period.run.status}</>}</div>
        <div className="button-row">
          <button className="button button-quiet" onClick={() => setSelectedPeriodId(period.id)}>
            {t('view')}
          </button>
          {period.status === 'draft' && can('payroll.periods.manage') &&
            <button className="button button-quiet" disabled={busy}
              onClick={() => void perform(() => api.openPayrollPeriod(period.id))}>{t('payrollOpenPeriod')}</button>}
          {period.status === 'open' && can('payroll.inputs.manage') &&
            <button className="button button-quiet" disabled={busy}
              onClick={() => void perform(() => api.loadPayrollInputs(period.id))}>{t('payrollLoadInputs')}</button>}
          {period.status === 'open' && can('payroll.run.calculate') &&
            <button className="button button-quiet" disabled={busy}
              onClick={() => void perform(async () => {
                const next = await api.createPayrollRun(period.id, idempotencyKey());
                setSelectedRunId(next.id);
              })}>{t('payrollCreateRun')}</button>}
          {period.run && <button className="button button-quiet"
            onClick={() => setSelectedRunId(period.run!.id)}>{t('payrollViewRun')}</button>}
        </div>
      </li>)}</ul>
    </section>}

    {selectedPeriodId && <section className="panel">
      <h2>{t('payrollInputs')}</h2>
      <button className="button button-quiet" onClick={() => void loadPeriod()} disabled={busy}>
        {t('refresh')}
      </button>
      <div className="table-scroll"><table><thead><tr>
        <th>{t('payrollStaffId')}</th><th>{t('payrollAttendanceDays')}</th>
        <th>{t('payrollOvertimeMinutes')}</th><th>{t('payrollBonus')}</th>
        <th>{t('payrollAdjustment')}</th><th>{t('payrollUnpaidLeave')}</th><th></th>
      </tr></thead><tbody>{inputs.map((input) => <PayrollInputRow key={input.id}
        input={input} t={t} disabled={!can('payroll.inputs.manage') ||
          selectedPeriod?.status !== 'open' || locked || busy}
        save={(body) => perform(() => api.updatePayrollInput(
          input.periodId, input.staffId, body
        ))} />)}</tbody></table></div>
        {can('payroll.inputs.manage') && periods.find((item) => item.id === selectedPeriodId)?.status === 'open' &&
          <form className="form-grid" onSubmit={(event) => {
            event.preventDefault();
            void perform(() => api.createPayrollAdjustment(selectedPeriodId, {
              staffId: correctionStaffId, sourceLineId: correctionLineId || null,
              idempotencyKey: idempotencyKey(), amountMinor: Number(correctionAmount),
              reason: correctionReason
            }));
          }}>
            <label>{t('payrollStaffId')}<input required value={correctionStaffId}
              onChange={(event) => setCorrectionStaffId(event.target.value)} /></label>
            <label>{t('payrollSourceLine')}<input value={correctionLineId}
              onChange={(event) => setCorrectionLineId(event.target.value)} /></label>
            <label>{t('payrollAdjustment')} ({t('minorUnits')})<input type="number" required
              value={correctionAmount} onChange={(event) => setCorrectionAmount(event.target.value)} /></label>
            <label>{t('reason')}<input required value={correctionReason}
              onChange={(event) => setCorrectionReason(event.target.value)} /></label>
            <button className="button button-quiet" disabled={busy}>{t('payrollAddCorrection')}</button>
          </form>}
    </section>}

    {run && <section className="panel">
      <h2>{t('payrollRun')} · {run.period?.code} · {run.status}</h2>
      <p>{t('payrollGross')}: {run.summary?.grossMinor ?? 0} {run.summary?.currencyCode} ·
        {` ${t('payrollNetPay')}: ${run.summary?.netMinor ?? 0} ${run.summary?.currencyCode}`}</p>
      <div className="button-row">
        {['draft', 'calculated'].includes(run.status) && can('payroll.run.calculate') && <>
          <button className="button button-primary" disabled={busy ||
            selectedPeriod?.status !== 'open'}
            onClick={() => void perform(() => api.calculatePayrollRun(run.id))}>
            {t('payrollCalculate')}</button>
          {can('payroll.net.override') && <label>
            <input type="checkbox" checked={overrideNegativeNet}
              onChange={(event) => setOverrideNegativeNet(event.target.checked)} />
            {t('payrollAllowNegativeNet')}
          </label>}
          {overrideNegativeNet && <label>{t('reason')}<input required value={overrideReason}
            onChange={(event) => setOverrideReason(event.target.value)} /></label>}
          {overrideNegativeNet && <button className="button button-quiet" disabled={busy}
            onClick={() => void perform(() => api.calculatePayrollRun(run.id, {
              allowNegativeNet: true, overrideReason
            }))}>{t('payrollCalculateWithOverride')}</button>}
        </>}
        {run.status === 'calculated' && can('payroll.run.submit') && <button className="button button-primary"
          disabled={busy} onClick={() => void perform(() => api.submitPayrollRun(run.id))}>
          {t('payrollSubmitForApproval')}</button>}
        {run.status === 'pending_approval' && can('payroll.run.approve') && <>
          <button className="button button-primary" disabled={busy}
            onClick={() => void perform(() => api.approvePayrollRun(run.id, decisionReason || t('payrollApproved')))}>
            {t('approve')}</button>
          <button className="button button-quiet" disabled={busy}
            onClick={() => void perform(() => api.rejectPayrollRun(run.id, decisionReason || t('payrollRejected')))}>
            {t('reject')}</button>
          <label>{t('reason')}<input value={decisionReason}
            onChange={(event) => setDecisionReason(event.target.value)} /></label>
        </>}
        {run.status === 'approved' && can('payroll.run.lock') && <button className="button button-primary"
          disabled={busy} onClick={() => void perform(() => api.lockPayrollRun(run.id))}>
          {t('payrollLockRun')}</button>}
        {['locked', 'closed'].includes(run.status) && can('payroll.payslips.generate') &&
          <button className="button button-quiet" disabled={busy}
            onClick={() => void perform(() => api.generatePayrollPayslips(run.id))}>
            {t('payrollGeneratePayslips')}</button>}
        {run.status === 'locked' && can('payroll.run.lock') && <button className="button button-quiet"
          disabled={busy} onClick={() => void perform(() => api.closePayrollRun(run.id))}>
          {t('close')}</button>}
      </div>
      <div className="table-scroll"><table><thead><tr>
        <th>{t('staff')}</th><th>{t('payrollGross')}</th><th>{t('payrollDeductions')}</th>
        <th>{t('payrollNetPay')}</th><th>{t('payrollPaid')}</th>
      </tr></thead><tbody>{lines.map((line) => <tr key={line.id}>
        <td>{line.staffName}</td><td>{line.grossMinor} {line.currencyCode}</td>
        <td>{line.taxMinor + line.pensionMinor + line.otherDeductionsMinor +
          line.unpaidLeaveDeductionMinor} {line.currencyCode}</td>
        <td>{line.netMinor} {line.currencyCode}</td><td>{line.paidMinor} {line.currencyCode}</td>
      </tr>)}</tbody></table></div>
      {run.status === 'locked' && can('payroll.payments.manage') && lines.length > 0 &&
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          if (!paymentLineId) return;
          void perform(() => api.recordPayrollPayment(run.id, {
            lineId: paymentLineId, idempotencyKey: idempotencyKey(),
            reference: paymentReference, amountMinor: Number(paymentAmount),
            paymentDate: today()
          }));
        }}>
          <label>{t('payrollStaffLine')}<select required value={paymentLineId}
            onChange={(event) => {
              const selected = lines.find((line) => line.id === event.target.value);
              setPaymentLineId(event.target.value);
              setPaymentAmount(selected ? String(Math.max(0, selected.netMinor - selected.paidMinor)) : '');
            }}>
            <option value="">{t('select')}</option>{lines.filter((line) => line.netMinor > line.paidMinor)
              .map((line) => <option key={line.id} value={line.id}>{line.staffName}</option>)}
          </select></label>
          <label>{t('payrollPaymentReference')}<input required value={paymentReference}
            onChange={(event) => setPaymentReference(event.target.value)} /></label>
          <label>{t('payrollAmountMinor')}<input type="number" min="1" step="1" required
            value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label>
          <button className="button button-primary" disabled={busy}>{t('recordPayment')}</button>
        </form>}
    </section>}

    {can('payroll.payslips.view') && <section className="panel payroll-print-area">
      <h2>{t('payrollPayslips')}</h2>
      <ul className="record-list">{payslips.map((slip) => <li key={slip.id}>
        <span>{slip.snapshot.staffName} · {slip.snapshot.period?.code} ·
          {` ${slip.snapshot.netMinor} ${slip.snapshot.currencyCode}`}</span>
        <button className="button button-quiet" onClick={() => void printPayslip(slip)}>
          {t('print')}
        </button>
      </li>)}</ul>
    </section>}
  </section>;
}

function PayrollInputRow({ input, t, disabled, save }: {
  input: PayrollInput; t: T; disabled: boolean;
  save: (body: { attendanceDays: number; overtimeMinutes: number;
    bonusMinor: number; adjustmentMinor: number; adjustmentReason: string }) => Promise<void>
}) {
  const [attendance, setAttendance] = useState(String(input.attendanceDays));
  const [overtime, setOvertime] = useState(String(input.overtimeMinutes));
  const [bonus, setBonus] = useState(String(input.bonusMinor));
  const [adjustment, setAdjustment] = useState(String(input.adjustmentMinor));
  const [reason, setReason] = useState(input.adjustmentReason);
  return <tr>
    <td>{input.staffId}</td>
    <td><input aria-label={t('payrollAttendanceDays')} type="number" min="0"
      value={attendance} disabled={disabled} onChange={(event) => setAttendance(event.target.value)} /></td>
    <td><input aria-label={t('payrollOvertimeMinutes')} type="number" min="0"
      value={overtime} disabled={disabled} onChange={(event) => setOvertime(event.target.value)} /></td>
    <td><input aria-label={t('payrollBonus')} type="number" min="0"
      value={bonus} disabled={disabled} onChange={(event) => setBonus(event.target.value)} /></td>
    <td><input aria-label={t('payrollAdjustment')} type="number"
      value={adjustment} disabled={disabled} onChange={(event) => setAdjustment(event.target.value)} />
      <input aria-label={t('reason')} value={reason} disabled={disabled}
        onChange={(event) => setReason(event.target.value)} /></td>
    <td>{input.sourceUnpaidLeaveHalfDays / 2}</td>
    <td><button className="button button-quiet" disabled={disabled}
      onClick={() => void save({
        attendanceDays: Number(attendance), overtimeMinutes: Number(overtime),
        bonusMinor: Number(bonus), adjustmentMinor: Number(adjustment),
        adjustmentReason: reason
      })}>{t('save')}</button></td>
  </tr>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article className="metric-card"><div className="metric-content">
    <span>{label}</span><strong>{value}</strong>
  </div></article>;
}
