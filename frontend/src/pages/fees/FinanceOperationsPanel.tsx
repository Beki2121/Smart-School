import { FormEvent, useEffect, useState } from 'react';
import {
  api, AcademicYearRecord, CashbookAccount, FeeAdjustmentRequest, FeeArrearsRow, FinanceReport,
  FeeDiscountRequest, FeeDiscountType, FeeInvoice, FeeRefundRequest, FeeStructure, GradeLevel
} from '../../api';
import { Locale } from '../../i18n';
import FormInput from '../../components/FormInput';
import { localDateInput } from '../../utils/dates';

type T = (key: string) => string;

function minorUnits(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return 0;
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}

function idempotencyKey() {
  return crypto.randomUUID();
}

export default function FinanceOperationsPanel({ t, locale, canManage, canCollect, canApprove }: {
  t: T; locale: Locale; canManage: boolean; canCollect: boolean; canApprove: boolean
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dashboard, setDashboard] = useState<{ overdueInvoices: number;
    collections: { currencyCode: string; amount: number }[];
    outstandingByCurrency: { currencyCode: string; amount: number }[] } | null>(null);
  const [arrears, setArrears] = useState<FeeArrearsRow[]>([]);
  const [followupForms, setFollowupForms] = useState<Record<string, {
    note: string; nextContactOn: string
  }>>({});
  const [invoices, setInvoices] = useState<FeeInvoice[]>([]);
  const [years, setYears] = useState<AcademicYearRecord[]>([]);
  const [grades, setGrades] = useState<GradeLevel[]>([]);
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [preview, setPreview] = useState<{ structureId: string; studentCount: number } | null>(null);
  const [discounts, setDiscounts] = useState<FeeDiscountRequest[]>([]);
  const [discountTypes, setDiscountTypes] = useState<FeeDiscountType[]>([]);
  const [refunds, setRefunds] = useState<FeeRefundRequest[]>([]);
  const [adjustments, setAdjustments] = useState<FeeAdjustmentRequest[]>([]);
  const [accounts, setAccounts] = useState<CashbookAccount[]>([]);
  const [statement, setStatement] = useState<{ studentNo: string; invoices: FeeInvoice[] } | null>(null);
  const [reportData, setReportData] = useState<FinanceReport | null>(null);
  const [reportRange, setReportRange] = useState(() => {
    const today = localDateInput();
    return { from: today, to: today };
  });
  const [structureForm, setStructureForm] = useState({
    academicYearId: '', gradeLevelId: '', name: '', currencyCode: 'ETB',
    dueDate: '', amount: ''
  });
  const [cashbookForm, setCashbookForm] = useState({
    name: '', accountType: 'cash' as 'cash' | 'bank', currencyCode: 'ETB', openingBalance: '0'
  });
  const [depositForm, setDepositForm] = useState({ accountId: '', amount: '', description: '' });
  const [transferForm, setTransferForm] = useState({
    fromAccountId: '', toAccountId: '', amount: '', description: ''
  });
  const [reconcileDate, setReconcileDate] = useState(localDateInput());
  const [statementBalance, setStatementBalance] = useState('');
  const [discountForm, setDiscountForm] = useState({
    studentId: '', discountTypeId: '', amount: '', periodKey: '', reason: ''
  });
  const [discountTypeForm, setDiscountTypeForm] = useState({
    code: '', name: '', category: 'scholarship' as FeeDiscountType['category'],
    discountKind: 'percentage' as FeeDiscountType['discountKind']
  });
  const [refundForm, setRefundForm] = useState({ paymentId: '', amount: '', reason: '' });
  const [adjustmentForm, setAdjustmentForm] = useState({
    invoiceId: '', adjustmentType: 'credit' as 'credit' | 'debit', amount: '', reason: ''
  });

  const load = async () => {
    const [summary, overdue, invoiceRows, accountRows, structureRows, discountRows,
      discountTypeRows, refundRows, adjustmentRows, yearRows, gradeRows] = await Promise.all([
      api.financeDashboard(), api.feeArrears(), api.feeInvoices(), api.cashbookAccounts(),
      api.feeStructures(), api.feeDiscountRequests(), api.feeDiscountTypes(), api.feeRefundRequests(),
      api.feeAdjustmentRequests(), api.academicYears(), api.grades()
    ]);
    setDashboard(summary);
    setArrears(overdue);
    setInvoices(invoiceRows);
    setAccounts(accountRows);
    setStructures(structureRows);
    setDiscounts(discountRows);
    setDiscountTypes(discountTypeRows);
    setRefunds(refundRows);
    setAdjustments(adjustmentRows);
    setYears(yearRows);
    setGrades(gradeRows);
    setStructureForm((current) => ({
      ...current,
      academicYearId: current.academicYearId || yearRows.find((year) => year.status === 'active')?.id || '',
      gradeLevelId: current.gradeLevelId || gradeRows[0]?.id || '',
      dueDate: current.dueDate || localDateInput()
    }));
    setDiscountForm((current) => ({
      ...current, studentId: current.studentId || invoiceRows[0]?.studentId || '',
      discountTypeId: current.discountTypeId || discountTypeRows[0]?.id || '',
      periodKey: current.periodKey || invoiceRows[0]?.dueDate?.slice(0, 7) || localDateInput().slice(0, 7)
    }));
    setRefundForm((current) => ({
      ...current, paymentId: current.paymentId || invoiceRows.flatMap((invoice) => invoice.payments)
        .find((payment) => payment.entryType === 'payment')?.id || ''
    }));
    setAdjustmentForm((current) => ({ ...current, invoiceId: current.invoiceId || invoiceRows[0]?.id || '' }));
    setDepositForm((current) => ({ ...current, accountId: current.accountId || accountRows[0]?.id || '' }));
    setTransferForm((current) => ({
      ...current, fromAccountId: current.fromAccountId || accountRows[0]?.id || '',
      toAccountId: current.toAccountId || accountRows.find((account) => account.id !== accountRows[0]?.id)?.id || ''
    }));
  };

  useEffect(() => {
    if (!expanded) return;
    setBusy(true);
    setError('');
    load().catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')))
      .finally(() => setBusy(false));
  }, [expanded]);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };

  const saveStructure = async (event: FormEvent) => {
    event.preventDefault();
    const cents = minorUnits(structureForm.amount);
    if (cents <= 0) return setError(t('amountRequired'));
    await run(async () => {
      await api.createFeeStructure({
        academicYearId: structureForm.academicYearId, gradeLevelId: structureForm.gradeLevelId,
        name: structureForm.name, currencyCode: structureForm.currencyCode.toUpperCase(),
        installments: [{ dueDate: structureForm.dueDate, amountMinor: cents }]
      });
    }, t('structureSaved'));
  };

  const createAccount = (event: FormEvent) => {
    event.preventDefault();
    const amount = minorUnits(cashbookForm.openingBalance);
    void run(() => api.createCashbookAccount({
      name: cashbookForm.name, accountType: cashbookForm.accountType,
      currencyCode: cashbookForm.currencyCode.toUpperCase(), openingBalanceMinor: amount,
      idempotencyKey: idempotencyKey()
    }), t('cashbookAccountSaved'));
  };

  const submitDiscount = (event: FormEvent) => {
    event.preventDefault();
    const type = discountTypes.find((item) => item.id === discountForm.discountTypeId);
    if (!type) return setError(t('discountTypeRequired'));
    const [whole, fraction = ''] = discountForm.amount.split('.');
    const basisPoints = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
    void run(() => api.requestFeeDiscount({
      studentId: discountForm.studentId, discountTypeId: type.id,
      periodKey: discountForm.periodKey, reason: discountForm.reason,
      idempotencyKey: idempotencyKey(),
      ...(type.discountKind === 'percentage'
        ? { percentageBasisPoints: basisPoints }
        : { fixedAmountMinor: minorUnits(discountForm.amount) })
    }), t('requestSubmitted'));
  };

  const submitRefund = (event: FormEvent) => {
    event.preventDefault();
    void run(() => api.requestFeeRefund({
      paymentId: refundForm.paymentId, amountMinor: minorUnits(refundForm.amount),
      reason: refundForm.reason, idempotencyKey: idempotencyKey()
    }), t('requestSubmitted'));
  };

  const submitAdjustment = (event: FormEvent) => {
    event.preventDefault();
    void run(() => api.requestFeeAdjustment({
      invoiceId: adjustmentForm.invoiceId, adjustmentType: adjustmentForm.adjustmentType,
      amountMinor: minorUnits(adjustmentForm.amount), reason: adjustmentForm.reason,
      idempotencyKey: idempotencyKey()
    }), t('requestSubmitted'));
  };

  const report = async (type: string) => {
    setError('');
    setBusy(true);
    try {
      const result = await api.financeReport(type, reportRange.from, reportRange.to);
      setReportData(result);
      const blob = await api.downloadFinanceReportCsv(type, reportRange.from, reportRange.to);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `finance-${type}.csv`; link.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };

  const exportArrears = async () => {
    setError('');
    try {
      const blob = await api.downloadFeeArrearsCsv(reportRange.to);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'fee-arrears.csv'; link.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  };

  return <section className="panel finance-panel">
    <div className="panel-heading">
      <div><h2>{t('financeOperations')}</h2><p>{t('financeOperationsHint')}</p></div>
      <button className="button button-secondary" onClick={() => setExpanded((value) => !value)}>
        {expanded ? t('hideFinanceOperations') : t('showFinanceOperations')}
      </button>
    </div>
    {expanded && <div className="finance-operations">
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}
      {busy && <p className="muted">{t('loading')}</p>}
      {dashboard && <div className="finance-kpis">
        <article className="metric-card"><span>{t('overdueInvoices')}</span><strong>{dashboard.overdueInvoices}</strong></article>
        {dashboard.collections.map((row) => <article className="metric-card" key={`collected-${row.currencyCode}`}>
          <span>{t('todayCollections')} · {row.currencyCode}</span>
          <strong>{row.amount.toLocaleString(locale === 'am' ? 'am-ET' : 'en-ET')}</strong>
        </article>)}
        {dashboard.outstandingByCurrency.map((row) => <article className="metric-card" key={row.currencyCode}>
          <span>{t('outstandingTotal')} · {row.currencyCode}</span><strong>{row.amount.toLocaleString(locale === 'am' ? 'am-ET' : 'en-ET')}</strong>
        </article>)}
      </div>}
      <div className="form-grid print-button">
        <FormInput label={t('fromDate')} type="date" value={reportRange.from}
          onChange={(from) => setReportRange((current) => ({ ...current, from }))} required />
        <FormInput label={t('toDate')} type="date" value={reportRange.to}
          onChange={(to) => setReportRange((current) => ({ ...current, to }))} required />
      </div>
      <div className="form-actions">
        <button className="button button-secondary" disabled={busy} onClick={() => void report('daily_collection')}>{t('dailyCollectionReport')}</button>
        <button className="button button-secondary" disabled={busy} onClick={() => void report('collection')}>{t('collectionReport')}</button>
        <button className="button button-secondary" onClick={() => void report('class')}>{t('collectionByClass')}</button>
        <button className="button button-secondary" onClick={() => void report('fee_type')}>{t('collectionByFeeType')}</button>
        <button className="button button-secondary" onClick={() => void report('daily_cash')}>{t('dailyCashReport')}</button>
        <button className="button button-secondary" disabled={busy} onClick={() => void report('expense')}>{t('expenseReport')}</button>
        <button className="button button-secondary" disabled={busy} onClick={() => void report('outstanding')}>{t('outstandingReport')}</button>
        <button className="button button-secondary" onClick={() => void exportArrears()}>{t('exportArrears')}</button>
      </div>
      {reportData && <section className="settings-panel">
        <div className="panel-heading">
          <h3>{t('financeReport')} · {reportData.from} — {reportData.to}</h3>
          <button className="button button-secondary print-button" onClick={() => window.print()}>{t('printReport')}</button>
        </div>
        <div className="table-scroll">
          <table className="data-table fee-table">
            <thead><tr><th>{t('date')}</th><th>{t('invoice')}</th><th>{t('student')}</th>
              <th>{t('section')}</th><th>{t('description')}</th><th>{t('amount')}</th><th>{t('currency')}</th></tr></thead>
            <tbody>{reportData.rows.map((row, index) => <tr key={`${row.invoiceNumber ?? row.description ?? 'row'}-${index}`}>
              <td>{row.date ?? ''}</td><td>{row.invoiceNumber ?? ''}</td><td>{row.studentName ?? ''}</td>
              <td>{row.className ?? ''}</td><td>{row.category ?? row.feeTypes ?? row.description ?? ''}</td>
              <td>{row.amount}</td><td>{row.currencyCode}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="finance-kpis">{reportData.totalsByCurrency.map((total) =>
          <article className="metric-card" key={total.currencyCode}>
            <span>{t('reportTotal')} · {total.currencyCode}</span><strong>{total.amount}</strong>
          </article>)}</div>
      </section>}
      {arrears.length > 0 && <div className="fee-item-list">
        {arrears.slice(0, 10).map((row) => <div className="setting-row" key={row.invoiceId}>
          <div>
            <span><strong>{row.studentName} · {row.studentNo}</strong>
              <small>{row.invoiceNumber} · {row.sectionName} · {row.daysOverdue} {t('daysOverdue')}</small></span>
            {row.followups?.map((followup) => <small key={followup.id}>
              {followup.note}{followup.nextContactOn ? ` · ${t('nextContactDate')}: ${followup.nextContactOn}` : ''}
            </small>)}
            <form className="form-grid" onSubmit={(event) => {
              event.preventDefault();
              const form = followupForms[row.invoiceId] ?? { note: '', nextContactOn: '' };
              void run(async () => {
                await api.createFeeArrearsFollowup(row.invoiceId, {
                  note: form.note, ...(form.nextContactOn ? { nextContactOn: form.nextContactOn } : {})
                });
                setFollowupForms((current) => ({
                  ...current, [row.invoiceId]: { note: '', nextContactOn: '' }
                }));
              }, t('followupSaved'));
            }}>
              <FormInput label={t('followupNote')} value={followupForms[row.invoiceId]?.note ?? ''}
                onChange={(note) => setFollowupForms((current) => ({
                  ...current, [row.invoiceId]: {
                    note, nextContactOn: current[row.invoiceId]?.nextContactOn ?? ''
                  }
                }))} required />
              <FormInput label={t('nextContactDate')} type="date"
                value={followupForms[row.invoiceId]?.nextContactOn ?? ''}
                onChange={(nextContactOn) => setFollowupForms((current) => ({
                  ...current, [row.invoiceId]: {
                    note: current[row.invoiceId]?.note ?? '', nextContactOn
                  }
                }))} />
              <button className="button button-secondary" disabled={busy}>{t('addFollowup')}</button>
            </form>
          </div>
          <span className="score-pill">{row.balanceDue} {row.currencyCode}</span>
          <button className="button button-quiet" onClick={() => {
            api.feeStudentStatement(row.studentId).then(setStatement)
              .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
          }}>{t('studentStatement')}</button>
        </div>)}
      </div>}
      {statement && <div className="panel">
        <div className="panel-heading"><h3>{t('studentStatement')} · {statement.studentNo}</h3>
          <button className="button button-quiet" onClick={() => setStatement(null)}>{t('close')}</button></div>
        {statement.invoices.map((invoice) => <div className="setting-row" key={invoice.id}>
          <span>{invoice.invoiceNumber} · {invoice.status}</span>
          <span>{invoice.balanceDue} {invoice.currencyCode}</span>
        </div>)}
        <button className="button button-secondary" onClick={() => window.print()}>{t('printReport')}</button>
      </div>}
      {(canManage || canCollect) && <div className="finance-subgrid">
        <section className="settings-panel">
          <h3>{t('feeStructures')}</h3>
          <form className="form-grid" onSubmit={(event) => void saveStructure(event)}>
            <label>{t('academicYear')}<select required value={structureForm.academicYearId}
              onChange={(event) => setStructureForm((value) => ({ ...value, academicYearId: event.target.value }))}>
              <option value="">{t('chooseAcademicYear')}</option>
              {years.map((year) => <option key={year.id} value={year.id}>{year.labelEc}</option>)}
            </select></label>
            <label>{t('grade')}<select required value={structureForm.gradeLevelId}
              onChange={(event) => setStructureForm((value) => ({ ...value, gradeLevelId: event.target.value }))}>
              <option value="">{t('chooseGrade')}</option>
              {grades.map((grade) => <option key={grade.id} value={grade.id}>
                {locale === 'am' ? grade.nameAm : grade.nameEn}</option>)}
            </select></label>
            <FormInput label={t('structureName')} value={structureForm.name}
              onChange={(name) => setStructureForm((value) => ({ ...value, name }))} required />
            <FormInput label={t('dueDate')} type="date" value={structureForm.dueDate}
              onChange={(dueDate) => setStructureForm((value) => ({ ...value, dueDate }))} required />
            <FormInput label={`${t('amount')} (${t('minorUnitsHint')})`} value={structureForm.amount}
              onChange={(amount) => setStructureForm((value) => ({ ...value, amount }))} required />
            <button className="button button-primary" disabled={busy || !years.length || !grades.length}>
              {t('saveFeeStructure')}
            </button>
          </form>
          <form className="form-grid" onSubmit={submitDiscount}>
            <h4>{t('requestDiscount')}</h4>
            <label>{t('student')}<select required value={discountForm.studentId}
              onChange={(event) => setDiscountForm((value) => ({ ...value, studentId: event.target.value }))}>
              <option value="">{t('chooseStudent')}</option>
              {[...new Map(invoices.map((invoice) => [invoice.studentId, invoice])).values()]
                .map((invoice) => <option key={invoice.studentId} value={invoice.studentId}>
                  {invoice.studentName || invoice.studentNo || invoice.studentId}</option>)}
            </select></label>
            <label>{t('discountType')}<select required value={discountForm.discountTypeId}
              onChange={(event) => setDiscountForm((value) => ({ ...value, discountTypeId: event.target.value }))}>
              <option value="">{t('chooseDiscountType')}</option>
              {discountTypes.filter((item) => item.isActive).map((item) =>
                <option key={item.id} value={item.id}>{item.name} · {item.discountKind}</option>)}
            </select></label>
            <FormInput label={t('periodKey')} value={discountForm.periodKey}
              onChange={(periodKey) => setDiscountForm((value) => ({ ...value, periodKey }))} required />
            <FormInput label={t('discountValue')} value={discountForm.amount}
              onChange={(amount) => setDiscountForm((value) => ({ ...value, amount }))} required />
            <FormInput label={t('reason')} value={discountForm.reason}
              onChange={(reason) => setDiscountForm((value) => ({ ...value, reason }))} required />
            <button className="button button-secondary" disabled={busy || !discountTypes.length}>
              {t('submitRequest')}
            </button>
          </form>
          {canManage && <form className="form-grid" onSubmit={(event) => {
            event.preventDefault();
            void run(() => api.createFeeDiscountType(discountTypeForm), t('discountTypeSaved'));
          }}>
            <FormInput label={t('discountTypeCode')} value={discountTypeForm.code}
              onChange={(code) => setDiscountTypeForm((value) => ({ ...value, code }))} required />
            <FormInput label={t('discountTypeName')} value={discountTypeForm.name}
              onChange={(name) => setDiscountTypeForm((value) => ({ ...value, name }))} required />
            <label>{t('discountCategory')}<select value={discountTypeForm.category}
              onChange={(event) => setDiscountTypeForm((value) => ({
                ...value, category: event.target.value as FeeDiscountType['category']
              }))}>
              <option value="sibling">{t('sibling')}</option><option value="staff_child">{t('staffChild')}</option>
              <option value="scholarship">{t('scholarship')}</option><option value="other">{t('other')}</option>
            </select></label>
            <label>{t('discountKind')}<select value={discountTypeForm.discountKind}
              onChange={(event) => setDiscountTypeForm((value) => ({
                ...value, discountKind: event.target.value as FeeDiscountType['discountKind']
              }))}>
              <option value="percentage">{t('percentage')}</option><option value="fixed">{t('fixed')}</option>
            </select></label>
            <button className="button button-secondary" disabled={busy}>{t('createDiscountType')}</button>
          </form>}
          {structures.map((structure) => <div className="setting-row" key={structure.id}>
            <span><strong>{structure.name}</strong><small>{structure.currencyCode} · {structure.installments.length} {t('installments')}</small></span>
            <div className="form-actions">
              <button className="button button-secondary" disabled={busy} onClick={() => {
                api.previewFeeStructure(structure.id).then((result) => {
                  const value = result as { studentCount?: number };
                  setPreview({ structureId: structure.id, studentCount: value.studentCount ?? 0 });
                }).catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
              }}>{t('previewInvoices')}</button>
              <button className="button button-primary" disabled={busy || preview?.structureId !== structure.id}
                onClick={() => void run(async () => {
                  await api.generateFeeStructureInvoices(structure.id, { idempotencyKey: idempotencyKey() });
                  setPreview(null);
                }, t('invoicesGenerated'))}>{t('generateInvoices')}</button>
            </div>
          </div>)}
          {preview && <p className="muted">{t('previewEligibleStudents')}: {preview.studentCount}</p>}
        </section>
        <section className="settings-panel">
          <h3>{t('requestRefund')}</h3>
          <form className="form-grid" onSubmit={submitRefund}>
            <label>{t('payment')}<select required value={refundForm.paymentId}
              onChange={(event) => setRefundForm((value) => ({ ...value, paymentId: event.target.value }))}>
              <option value="">{t('choosePayment')}</option>
              {invoices.flatMap((invoice) => invoice.payments.filter((payment) => payment.entryType === 'payment')
                .map((payment) => <option key={payment.id} value={payment.id}>
                  {invoice.invoiceNumber} · {payment.receiptNumber} · {payment.amount} {invoice.currencyCode}
                </option>))}
            </select></label>
            <FormInput label={`${t('amount')} (${t('minorUnitsHint')})`} value={refundForm.amount}
              onChange={(amount) => setRefundForm((value) => ({ ...value, amount }))} required />
            <FormInput label={t('reason')} value={refundForm.reason}
              onChange={(reason) => setRefundForm((value) => ({ ...value, reason }))} required />
            <button className="button button-secondary" disabled={busy}>{t('submitRequest')}</button>
          </form>
          <h3>{t('requestAdjustment')}</h3>
          <form className="form-grid" onSubmit={submitAdjustment}>
            <label>{t('invoice')}<select required value={adjustmentForm.invoiceId}
              onChange={(event) => setAdjustmentForm((value) => ({ ...value, invoiceId: event.target.value }))}>
              <option value="">{t('chooseInvoice')}</option>
              {invoices.filter((invoice) => invoice.status !== 'void').map((invoice) =>
                <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {invoice.studentName}</option>)}
            </select></label>
            <label>{t('adjustmentType')}<select value={adjustmentForm.adjustmentType}
              onChange={(event) => setAdjustmentForm((value) => ({
                ...value, adjustmentType: event.target.value as 'credit' | 'debit'
              }))}>
              <option value="credit">{t('credit')}</option><option value="debit">{t('debit')}</option>
            </select></label>
            <FormInput label={`${t('amount')} (${t('minorUnitsHint')})`} value={adjustmentForm.amount}
              onChange={(amount) => setAdjustmentForm((value) => ({ ...value, amount }))} required />
            <FormInput label={t('reason')} value={adjustmentForm.reason}
              onChange={(reason) => setAdjustmentForm((value) => ({ ...value, reason }))} required />
            <button className="button button-secondary" disabled={busy}>{t('submitRequest')}</button>
          </form>
        </section>
        <section className="settings-panel">
          <h3>{t('discountApprovals')}</h3>
          {discounts.map((item) => <div className="setting-row" key={item.id}>
            <span><strong>{item.reason}</strong><small>{item.periodKey} · {item.status}</small></span>
            {canApprove && item.status === 'pending' && <div className="form-actions">
              <button className="button button-secondary" disabled={busy} onClick={() => void run(
                () => api.transitionFeeDiscount(item.id, 'approved'), t('requestApproved'))}>{t('approve')}</button>
              <button className="button button-quiet" disabled={busy} onClick={() => void run(
                () => api.transitionFeeDiscount(item.id, 'rejected'), t('requestRejected'))}>{t('reject')}</button>
            </div>}
          </div>)}
          <h3>{t('refundApprovals')}</h3>
          {refunds.map((item) => <div className="setting-row" key={item.id}>
            <span><strong>{item.reason}</strong><small>{item.status} · {item.amountMinor} {t('minorUnits')}</small></span>
            {canApprove && item.status === 'pending' && <div className="form-actions">
              <button className="button button-secondary" disabled={busy} onClick={() => void run(
                () => api.transitionFeeRefund(item.id, 'approved'), t('requestApproved'))}>{t('approve')}</button>
              <button className="button button-quiet" disabled={busy} onClick={() => void run(
                () => api.transitionFeeRefund(item.id, 'rejected'), t('requestRejected'))}>{t('reject')}</button>
            </div>}
          </div>)}
          <h3>{t('adjustmentApprovals')}</h3>
          {adjustments.map((item) => <div className="setting-row" key={item.id}>
            <span><strong>{item.reason}</strong><small>{item.adjustmentType} · {item.status}</small></span>
            {canApprove && item.status === 'pending' && <div className="form-actions">
              <button className="button button-secondary" disabled={busy} onClick={() => void run(
                () => api.transitionFeeAdjustment(item.id, 'approved'), t('requestApproved'))}>{t('approve')}</button>
              <button className="button button-quiet" disabled={busy} onClick={() => void run(
                () => api.transitionFeeAdjustment(item.id, 'rejected'), t('requestRejected'))}>{t('reject')}</button>
            </div>}
          </div>)}
        </section>
      </div>}
      {canCollect && <section className="settings-panel">
        <h3>{t('cashbook')}</h3>
        <form className="form-grid" onSubmit={createAccount}>
          <FormInput label={t('accountName')} value={cashbookForm.name}
            onChange={(name) => setCashbookForm((value) => ({ ...value, name }))} required />
          <label>{t('accountType')}<select value={cashbookForm.accountType}
            onChange={(event) => setCashbookForm((value) => ({ ...value, accountType: event.target.value as 'cash' | 'bank' }))}>
            <option value="cash">{t('cash')}</option><option value="bank">{t('bank')}</option>
          </select></label>
          <FormInput label={t('currency')} value={cashbookForm.currencyCode}
            onChange={(currencyCode) => setCashbookForm((value) => ({ ...value, currencyCode }))} required />
          <FormInput label={t('openingBalance')} value={cashbookForm.openingBalance}
            onChange={(openingBalance) => setCashbookForm((value) => ({ ...value, openingBalance }))} required />
          <button className="button button-primary" disabled={busy}>{t('cashbookCreateAccount')}</button>
        </form>
        <div className="fee-item-list">{accounts.map((account) => <div className="setting-row" key={account.id}>
          <span><strong>{account.name} · {account.accountType}</strong><small>{account.currencyCode}</small></span>
          <span className="score-pill">{account.balanceMinor} {t('minorUnits')}</span>
        </div>)}</div>
        {!!accounts.length && <div className="finance-subgrid">
          <form className="form-grid" onSubmit={(event) => {
            event.preventDefault();
            void run(() => api.depositCashbook(depositForm.accountId, {
              amountMinor: minorUnits(depositForm.amount), description: depositForm.description,
              idempotencyKey: idempotencyKey()
            }), t('depositRecorded'));
          }}>
            <label>{t('cashbookAccount')}<select value={depositForm.accountId}
              onChange={(event) => setDepositForm((value) => ({ ...value, accountId: event.target.value }))}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select></label>
            <FormInput label={t('amount')} value={depositForm.amount}
              onChange={(amount) => setDepositForm((value) => ({ ...value, amount }))} required />
            <FormInput label={t('description')} value={depositForm.description}
              onChange={(description) => setDepositForm((value) => ({ ...value, description }))} required />
            <button className="button button-secondary" disabled={busy}>{t('recordDeposit')}</button>
          </form>
          {accounts.length > 1 && <form className="form-grid" onSubmit={(event) => {
            event.preventDefault();
            void run(() => api.transferCashbook({
              fromAccountId: transferForm.fromAccountId, toAccountId: transferForm.toAccountId,
              amountMinor: minorUnits(transferForm.amount), description: transferForm.description,
              idempotencyKey: idempotencyKey()
            }), t('transferRecorded'));
          }}>
            <label>{t('fromAccount')}<select value={transferForm.fromAccountId}
              onChange={(event) => setTransferForm((value) => ({ ...value, fromAccountId: event.target.value }))}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select></label>
            <label>{t('toAccount')}<select value={transferForm.toAccountId}
              onChange={(event) => setTransferForm((value) => ({ ...value, toAccountId: event.target.value }))}>
              {accounts.filter((account) => account.id !== transferForm.fromAccountId).map((account) =>
                <option key={account.id} value={account.id}>{account.name}</option>)}
            </select></label>
            <FormInput label={t('amount')} value={transferForm.amount}
              onChange={(amount) => setTransferForm((value) => ({ ...value, amount }))} required />
            <FormInput label={t('description')} value={transferForm.description}
              onChange={(description) => setTransferForm((value) => ({ ...value, description }))} required />
            <button className="button button-secondary" disabled={busy}>{t('transfer')}</button>
          </form>}
          <form className="form-grid" onSubmit={(event) => {
            event.preventDefault();
            const account = accounts.find((item) => item.id === depositForm.accountId);
            if (!account) return;
            void run(() => api.reconcileCashbook(account.id, {
              statementDate: reconcileDate, statementBalanceMinor: minorUnits(statementBalance)
            }), t('cashbookReconciled'));
          }}>
            <label>{t('cashbookAccount')}<select value={depositForm.accountId}
              onChange={(event) => setDepositForm((value) => ({ ...value, accountId: event.target.value }))}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select></label>
            <FormInput label={t('statementDate')} type="date" value={reconcileDate}
              onChange={setReconcileDate} required />
            <FormInput label={t('statementBalance')} value={statementBalance}
              onChange={setStatementBalance} required />
            <button className="button button-secondary" disabled={busy}>{t('reconcile')}</button>
          </form>
        </div>}
      </section>}
    </div>}
  </section>;
}
