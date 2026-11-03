import { FormEvent, useEffect, useState } from 'react';
import { api, CashierShift, FeeExpense, FeeInvoice, FeeItem, FeePayment, FeeReceipt, FeeSummary, Student } from '../../api';
import { Locale } from '../../i18n';
import FormInput from '../../components/FormInput';
import { localDateInput } from '../../utils/dates';
import FinanceOperationsPanel from './FinanceOperationsPanel';

type T = (key: string) => string;
export default function FeesPage({ t, locale, canManage, canCollect, canApprove = false, canReverse }: {
  t: T; locale: Locale; canManage: boolean; canCollect: boolean; canApprove?: boolean; canReverse: boolean
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [items, setItems] = useState<FeeItem[]>([]);
  const [invoices, setInvoices] = useState<FeeInvoice[]>([]);
  const [activeShift, setActiveShift] = useState<CashierShift | null>(null);
  const [cashierShifts, setCashierShifts] = useState<CashierShift[]>([]);
  const [feeExpenses, setFeeExpenses] = useState<FeeExpense[]>([]);
  const [feeSummary, setFeeSummary] = useState<FeeSummary | null>(null);
  const [studentId, setStudentId] = useState('');
  const [feeItemId, setFeeItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [dueDate, setDueDate] = useState('');
  const [itemForm, setItemForm] = useState({
    code: '', nameEn: '', nameAm: '', amount: '', currencyCode: 'ETB'
  });
  const [paymentForms, setPaymentForms] = useState<Record<string, {
    amount: string; method: FeePayment['method']; reference: string
  }>>({});
  const [paymentKeys, setPaymentKeys] = useState<Record<string, string>>({});
  const [reversalForms, setReversalForms] = useState<Record<string, { amount: string; reason: string }>>({});
  const [voidForm, setVoidForm] = useState({ invoiceId: '', reason: '' });
  const [shiftForm, setShiftForm] = useState({ openingFloat: '0', currencyCode: 'ETB' });
  const [closingCash, setClosingCash] = useState('');
  const [expenseForm, setExpenseForm] = useState({
    category: '', description: '', amount: '', method: 'cash' as FeePayment['method'], reference: ''
  });
  const [reportRange, setReportRange] = useState(() => {
    const today = localDateInput();
    return { from: today, to: today };
  });
  const [receipt, setReceipt] = useState<FeeReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const load = async () => {
    const [feeItems, feeInvoices, roster] = await Promise.all([
      api.feeItems(), api.feeInvoices(), canManage ? api.students() : Promise.resolve([])
    ]);
    setItems(feeItems); setInvoices(feeInvoices); setStudents(roster);
    setFeeItemId((current) => current || feeItems.find((item) => item.isActive)?.id || '');
    setStudentId((current) => current || roster[0]?.id || '');
    if (canCollect) {
      const [shift, shifts, summary, expenses] = await Promise.all([
        api.currentCashierShift(), api.cashierShifts(),
        api.feeSummary(reportRange.from, reportRange.to),
        api.feeExpenses(reportRange.from, reportRange.to)
      ]);
      setActiveShift(shift); setCashierShifts(shifts); setFeeSummary(summary); setFeeExpenses(expenses);
    }
  };
  useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')))
      .finally(() => setLoading(false));
  }, []);
  const saveItem = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api.createFeeItem({
        ...itemForm, amount: Number(itemForm.amount), currencyCode: itemForm.currencyCode.toUpperCase()
      });
      setItemForm({ code: '', nameEn: '', nameAm: '', amount: '', currencyCode: 'ETB' });
      setNotice(t('feeItemSaved')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const toggleItem = async (item: FeeItem) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api.updateFeeItem(item.id, {
        code: item.code, nameEn: item.nameEn, nameAm: item.nameAm,
        amount: item.amount, currencyCode: item.currencyCode, isActive: !item.isActive
      });
      setNotice(t('feeItemUpdated')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const issueInvoice = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api.createFeeInvoice({
        studentId, dueDate: dueDate || null,
        lines: [{ feeItemId, quantity: Number(quantity) }]
      });
      setNotice(t('invoiceIssued')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const voidInvoice = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api.voidFeeInvoice(voidForm.invoiceId, voidForm.reason);
      setVoidForm({ invoiceId: '', reason: '' });
      setNotice(t('invoiceVoided')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const collectPayment = async (invoice: FeeInvoice) => {
    const form = paymentForms[invoice.id] ?? { amount: '', method: 'cash' as const, reference: '' };
    const idempotencyKey = paymentKeys[invoice.id] ?? crypto.randomUUID();
    setPaymentKeys((current) => ({ ...current, [invoice.id]: idempotencyKey }));
    setBusy(true); setError(''); setNotice('');
    try {
      const payment = await api.collectFeePayment(invoice.id, {
        amount: Number(form.amount), method: form.method, reference: form.reference, idempotencyKey
      });
      if (payment.receiptNumber) setReceipt(await api.feeReceipt(payment.receiptNumber));
      setNotice(t('paymentRecorded'));
      await load();
      setPaymentKeys((current) => {
        const next = { ...current };
        delete next[invoice.id];
        return next;
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const reversePayment = async (payment: FeePayment) => {
    const form = reversalForms[payment.id];
    if (!form) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.reverseFeePayment(payment.id, { amount: Number(form.amount), reason: form.reason });
      setNotice(t('paymentReversed')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const openReceipt = async (receiptNumber: string) => {
    setError('');
    try { setReceipt(await api.feeReceipt(receiptNumber)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const openShift = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api.openCashierShift({
        openingFloat: Number(shiftForm.openingFloat),
        currencyCode: shiftForm.currencyCode.trim().toUpperCase()
      });
      setNotice(t('shiftOpened')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const closeShift = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeShift) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const closed = await api.closeCashierShift(activeShift.id, Number(closingCash));
      setNotice(`${t('shiftClosed')} ${t('expectedCash')}: ${formatAmount(closed.expectedCash ?? 0, closed.currencyCode)} · ${t('variance')}: ${formatAmount(closed.variance ?? 0, closed.currencyCode)}`);
      setClosingCash(''); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const recordExpense = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeShift) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.createFeeExpense({
        ...expenseForm, amount: Number(expenseForm.amount), currencyCode: activeShift.currencyCode
      });
      setExpenseForm({ category: '', description: '', amount: '', method: 'cash', reference: '' });
      setNotice(t('expenseRecorded')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const updateReportRange = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const [summary, expenses] = await Promise.all([
        api.feeSummary(reportRange.from, reportRange.to),
        api.feeExpenses(reportRange.from, reportRange.to)
      ]);
      setFeeSummary(summary); setFeeExpenses(expenses);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const formatAmount = (amount: number, currency: string) => `${amount.toFixed(2)} ${currency}`;
  const formatMethod = (method: FeePayment['method']) => t(`paymentMethod_${method}`);
  return <>
    <div className="page-heading compact-heading"><div><div className="eyebrow">{t('releaseOne')}</div><h1>{t('fees')}</h1><p>{t('feesHint')}</p></div><span className="state-tag">{t('manualCollection')}</span></div>
    {notice && <div className="notice notice-success">{notice}</div>}{error && <div className="notice notice-error">{error}</div>}
    <div className="marks-integrity fee-scope-notice">ⓘ {t('writeAuditNotice')} {t('feePrivacyNotice')}</div>
    {loading ? <div className="loading-state">{t('loading')}</div> : <>
      {canCollect && <section className="panel finance-panel">
        <div className="panel-heading"><div><h2>{t('cashierShift')}</h2><p>{t('cashierShiftHint')}</p></div>
          {activeShift && <span className="status-pill fee-status-paid">{t('shiftOpen')}</span>}
        </div>
        {activeShift ? <>
          <div className="finance-summary-row">
            <strong>{activeShift.currencyCode}</strong>
            <span>{t('openingFloat')}: {formatAmount(activeShift.openingFloat, activeShift.currencyCode)}</span>
            <span>{t('openedAt')}: {new Date(activeShift.openedAt).toLocaleString(locale === 'am' ? 'am-ET' : 'en-ET')}</span>
          </div>
          <form className="form-grid payment-entry" onSubmit={(event) => void closeShift(event)}>
            <FormInput label={t('closingCount')} type="number" value={closingCash} onChange={setClosingCash} required />
            <button className="button button-secondary" disabled={busy}>{t('closeShift')}</button>
          </form>
          <form className="form-grid expense-form" onSubmit={(event) => void recordExpense(event)}>
            <FormInput label={t('expenseCategory')} value={expenseForm.category} onChange={(category) => setExpenseForm((current) => ({ ...current, category }))} required />
            <FormInput label={t('expenseDescription')} value={expenseForm.description} onChange={(description) => setExpenseForm((current) => ({ ...current, description }))} required />
            <FormInput label={t('amount')} type="number" value={expenseForm.amount} onChange={(amount) => setExpenseForm((current) => ({ ...current, amount }))} required />
            <label>{t('paymentMethod')}<select value={expenseForm.method} onChange={(event) => setExpenseForm((current) => ({ ...current, method: event.target.value as FeePayment['method'] }))}>
              <option value="cash">{t('paymentMethod_cash')}</option><option value="bank_transfer">{t('paymentMethod_bank_transfer')}</option><option value="mobile_money">{t('paymentMethod_mobile_money')}</option><option value="other">{t('paymentMethod_other')}</option>
            </select></label>
            <FormInput label={t('paymentReference')} value={expenseForm.reference} onChange={(reference) => setExpenseForm((current) => ({ ...current, reference }))} required={expenseForm.method === 'bank_transfer' || expenseForm.method === 'mobile_money'} />
            <button className="button button-secondary" disabled={busy}>{t('recordExpense')}</button>
          </form>
        </> : <form className="form-grid payment-entry" onSubmit={(event) => void openShift(event)}>
          <FormInput label={t('openingFloat')} type="number" value={shiftForm.openingFloat} onChange={(openingFloat) => setShiftForm((current) => ({ ...current, openingFloat }))} required />
          <FormInput label={t('currency')} value={shiftForm.currencyCode} onChange={(currencyCode) => setShiftForm((current) => ({ ...current, currencyCode }))} required />
          <button className="button button-primary" disabled={busy}>{t('openShift')}</button>
        </form>}
        {!!cashierShifts.filter((shift) => shift.status === 'closed').length && <div className="fee-item-list">
          {cashierShifts.filter((shift) => shift.status === 'closed').slice(0, 5).map((shift) =>
            <div className="setting-row" key={shift.id}><span><strong>{shift.recordedOn} · {shift.currencyCode}</strong>
              <small>{t('expectedCash')}: {formatAmount(shift.expectedCash ?? 0, shift.currencyCode)} · {t('closingCount')}: {formatAmount(shift.closingCash ?? 0, shift.currencyCode)}</small>
            </span><span className="score-pill">{t('variance')}: {formatAmount(shift.variance ?? 0, shift.currencyCode)}</span></div>)}
        </div>}
      </section>}
      {canCollect && <section className="panel finance-panel">
        <div className="panel-heading"><div><h2>{t('financeSummary')}</h2><p>{t('financeSummaryHint')}</p></div></div>
        <form className="form-grid invoice-form" onSubmit={(event) => void updateReportRange(event)}>
          <FormInput label={t('fromDate')} type="date" value={reportRange.from} onChange={(from) => setReportRange((current) => ({ ...current, from }))} required />
          <FormInput label={t('toDate')} type="date" value={reportRange.to} onChange={(to) => setReportRange((current) => ({ ...current, to }))} required />
          <button className="button button-secondary" disabled={busy}>{t('runReport')}</button>
        </form>
        {feeSummary?.totals.length ? <div className="table-scroll"><table className="data-table fee-table">
          <thead><tr><th>{t('currency')}</th><th>{t('payments')}</th><th>{t('reversals')}</th><th>{t('income')}</th><th>{t('expenses')}</th><th>{t('net')}</th></tr></thead>
          <tbody>{feeSummary.totals.map((row) => <tr key={row.currencyCode}>
            <td>{row.currencyCode}</td><td>{formatAmount(row.payments, row.currencyCode)}</td>
            <td>{formatAmount(row.reversals, row.currencyCode)}</td><td>{formatAmount(row.income, row.currencyCode)}</td>
            <td>{formatAmount(row.expenses, row.currencyCode)}</td><td>{formatAmount(row.net, row.currencyCode)}</td>
          </tr>)}</tbody>
        </table></div> : <div className="empty-state">{t('noFinanceActivity')}</div>}
        {feeExpenses.length > 0 && <div className="fee-item-list">{feeExpenses.slice(0, 8).map((expense) =>
          <div className="setting-row" key={expense.id}><span><strong>{expense.category} · {expense.description}</strong>
            <small>{expense.recordedOn} · {formatMethod(expense.method)}{expense.reference ? ` · ${expense.reference}` : ''}</small>
          </span><span className="score-pill">{formatAmount(expense.amount, expense.currencyCode)}</span></div>)}</div>}
      </section>}
      {canManage && <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>{t('feeItems')}</h2><p>{t('feeItemHint')}</p></div></div>
        <form className="setup-form" onSubmit={(event) => void saveItem(event)}>
          <div className="form-grid">
            <FormInput label={t('feeCode')} value={itemForm.code} onChange={(code) => setItemForm((current) => ({ ...current, code }))} required />
            <FormInput label={t('feeNameEn')} value={itemForm.nameEn} onChange={(nameEn) => setItemForm((current) => ({ ...current, nameEn }))} required />
            <FormInput label={t('feeNameAm')} value={itemForm.nameAm} onChange={(nameAm) => setItemForm((current) => ({ ...current, nameAm }))} required />
            <FormInput label={t('amount')} type="number" value={itemForm.amount} onChange={(amount) => setItemForm((current) => ({ ...current, amount }))} required />
            <FormInput label={t('currency')} value={itemForm.currencyCode} onChange={(currencyCode) => setItemForm((current) => ({ ...current, currencyCode }))} required />
          </div><div className="form-actions"><button className="button button-primary" disabled={busy}>{t('saveFeeItem')}</button></div>
        </form>
        <div className="fee-item-list">{items.map((item) => <div className="setting-row" key={item.id}>
          <span><strong>{locale === 'am' ? item.nameAm : item.nameEn} · {item.code}</strong><small>{formatAmount(item.amount, item.currencyCode)} · {item.isActive ? t('active') : t('inactive')}</small></span>
          <button className="button button-secondary" disabled={busy} onClick={() => void toggleItem(item)}>{item.isActive ? t('deactivate') : t('activate')}</button>
        </div>)}</div>
      </section>}
      {canManage && <section className="panel">
        <div className="panel-heading"><div><h2>{t('issueInvoice')}</h2><p>{t('invoiceIssueHint')}</p></div></div>
        <form className="form-grid invoice-form" onSubmit={(event) => void issueInvoice(event)}>
          <label>{t('student')}<select required value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="">{t('chooseStudent')}</option>{students.map((student) => <option key={student.id} value={student.id}>{student.givenNameEn} {student.fatherNameEn} · {student.studentNo}</option>)}</select></label>
          <label>{t('feeItem')}<select required value={feeItemId} onChange={(event) => setFeeItemId(event.target.value)}><option value="">{t('chooseFeeItem')}</option>{items.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{locale === 'am' ? item.nameAm : item.nameEn} · {formatAmount(item.amount, item.currencyCode)}</option>)}</select></label>
          <FormInput label={t('quantity')} type="number" value={quantity} onChange={setQuantity} required />
          <FormInput label={t('dueDate')} type="date" value={dueDate} onChange={setDueDate} />
          <div className="form-actions invoice-actions"><button className="button button-primary" disabled={busy || !students.length || !items.some((item) => item.isActive)}>{t('issueInvoice')}</button></div>
        </form>
      </section>}
      <section className="panel history-panel fee-invoices-panel">
        <div className="panel-heading"><div><h2>{t('invoices')}</h2><p>{invoices.length} {t('records')}</p></div></div>
        {invoices.length ? <div className="table-scroll"><table className="data-table fee-table">
          <thead><tr><th>{t('invoice')}</th><th>{t('student')}</th><th>{t('total')}</th><th>{t('paid')}</th><th>{t('balance')}</th><th>{t('state')}</th></tr></thead>
          <tbody>{invoices.map((invoice) => <tr key={invoice.id}>
            <td><strong>{invoice.invoiceNumber}</strong><small className="table-subtext">{invoice.lines.map((line) => `${locale === 'am' ? line.descriptionAm : line.descriptionEn} × ${line.quantity}`).join(', ')}</small><small className="table-subtext">{invoice.dueDate ? `${t('dueDate')}: ${invoice.dueDate}` : ''}</small></td>
            <td>{invoice.studentName ?? students.find((student) => student.id === invoice.studentId)?.givenNameEn ?? t('student')}<small className="table-subtext">{invoice.studentNo ?? ''}</small></td>
            <td>{formatAmount(invoice.totalAmount, invoice.currencyCode)}</td>
            <td>{formatAmount(invoice.paidAmount, invoice.currencyCode)}</td>
            <td>{formatAmount(invoice.balanceDue, invoice.currencyCode)}</td>
            <td><span className={`status-pill fee-status-${invoice.status}`}>{t(`invoice_${invoice.status}`)}</span></td>
          </tr>)}</tbody>
        </table></div> : <div className="empty-state">{t('noInvoices')}</div>}
        {canManage && invoices.some((invoice) => invoice.status === 'issued' && invoice.payments.length === 0) &&
          <form className="form-grid void-invoice-form" onSubmit={(event) => void voidInvoice(event)}>
            <label>{t('voidInvoice')}<select required value={voidForm.invoiceId} onChange={(event) => setVoidForm((current) => ({ ...current, invoiceId: event.target.value }))}>
              <option value="">{t('chooseInvoice')}</option>{invoices.filter((invoice) => invoice.status === 'issued' && invoice.payments.length === 0).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {invoice.studentName ?? invoice.studentNo}</option>)}
            </select></label>
            <FormInput label={t('voidReason')} value={voidForm.reason} onChange={(reason) => setVoidForm((current) => ({ ...current, reason }))} required />
            <button className="button button-secondary" disabled={busy}>{t('voidInvoice')}</button>
          </form>}
      </section>
      {canCollect && invoices.filter((invoice) => invoice.balanceDue > 0 && invoice.status !== 'void').map((invoice) => <section className="panel fee-payment-panel" key={invoice.id}>
        <div className="panel-heading"><div><h2>{t('collectPayment')} · {invoice.invoiceNumber}</h2><p>{invoice.studentName ?? t('student')} · {t('balance')}: {formatAmount(invoice.balanceDue, invoice.currencyCode)} · {!activeShift ? t('openShiftFirst') : activeShift.currencyCode !== invoice.currencyCode ? t('shiftCurrencyMismatch') : t('shiftReady')}</p></div></div>
        <div className="form-grid payment-entry">
          <FormInput label={t('amount')} type="number" value={paymentForms[invoice.id]?.amount ?? String(invoice.balanceDue)} onChange={(amount) => {
            setPaymentKeys((current) => { const next = { ...current }; delete next[invoice.id]; return next; });
            setPaymentForms((current) => ({
              ...current, [invoice.id]: { amount, method: current[invoice.id]?.method ?? 'cash', reference: current[invoice.id]?.reference ?? '' }
            }));
          }} required />
          <label>{t('paymentMethod')}<select value={paymentForms[invoice.id]?.method ?? 'cash'} onChange={(event) => {
            setPaymentKeys((current) => { const next = { ...current }; delete next[invoice.id]; return next; });
            setPaymentForms((current) => ({
              ...current, [invoice.id]: { amount: current[invoice.id]?.amount ?? String(invoice.balanceDue), method: event.target.value as FeePayment['method'], reference: current[invoice.id]?.reference ?? '' }
            }));
          }}><option value="cash">{t('paymentMethod_cash')}</option><option value="bank_transfer">{t('paymentMethod_bank_transfer')}</option><option value="mobile_money">{t('paymentMethod_mobile_money')}</option><option value="other">{t('paymentMethod_other')}</option></select></label>
          <FormInput label={t('paymentReference')} value={paymentForms[invoice.id]?.reference ?? ''} onChange={(reference) => {
            setPaymentKeys((current) => { const next = { ...current }; delete next[invoice.id]; return next; });
            setPaymentForms((current) => ({
              ...current, [invoice.id]: { amount: current[invoice.id]?.amount ?? String(invoice.balanceDue), method: current[invoice.id]?.method ?? 'cash', reference }
            }));
          }} required={paymentForms[invoice.id]?.method === 'bank_transfer' || paymentForms[invoice.id]?.method === 'mobile_money'} />
          <button className="button button-primary" disabled={busy || !activeShift || activeShift.currencyCode !== invoice.currencyCode} onClick={() => void collectPayment(invoice)}>{t('recordPayment')}</button>
        </div>
        {canReverse && invoice.payments.filter((payment) => payment.entryType === 'payment').map((payment) => {
          const reversedAmount = invoice.payments.filter((entry) => entry.entryType === 'reversal' && entry.reversesPaymentId === payment.id)
            .reduce((sum, entry) => sum + entry.amount, 0);
          const remaining = Math.max(0, payment.amount - reversedAmount);
          if (!remaining) return null;
          return <div className="reversal-row" key={payment.id}>
            <span>{formatAmount(remaining, invoice.currencyCode)} {t('unreversedPayment')}{payment.receiptNumber ? ` · ${payment.receiptNumber}` : ''}</span>
            <FormInput label={t('amount')} type="number" value={reversalForms[payment.id]?.amount ?? String(remaining)} onChange={(amount) => setReversalForms((current) => ({
              ...current, [payment.id]: { amount, reason: current[payment.id]?.reason ?? '' }
            }))} required />
            <FormInput label={t('reversalReason')} value={reversalForms[payment.id]?.reason ?? ''} onChange={(reason) => setReversalForms((current) => ({
              ...current, [payment.id]: { amount: current[payment.id]?.amount ?? String(remaining), reason }
            }))} required />
            <button className="button button-secondary" disabled={busy || !reversalForms[payment.id]?.reason || !activeShift || activeShift.currencyCode !== invoice.currencyCode} onClick={() => void reversePayment(payment)}>{t('reversePayment')}</button>
          </div>;
        })}
      </section>)}
      {receipt && <section className="panel fee-receipt" id="fee-receipt">
        <div className="panel-heading"><div><h2>{t('receipt')}</h2><p>{receipt.receiptNumber}</p></div><button className="button button-secondary" onClick={() => window.print()}>{t('printReceipt')}</button></div>
        <div className="receipt-details"><strong>{receipt.studentName} · {receipt.studentNo}</strong><span>{receipt.invoiceNumber}</span><span>{t('paid')}: {formatAmount(receipt.amount, receipt.currencyCode ?? 'ETB')}</span><span>{formatMethod(receipt.method)} · {receipt.recordedAt?.slice(0, 16)}</span>{receipt.reference && <span>{t('paymentReference')}: {receipt.reference}</span>}</div>
      </section>}
      {invoices.some((invoice) => invoice.payments.some((payment) => payment.entryType === 'payment' && payment.receiptNumber)) &&
        <section className="panel history-panel"><div className="panel-heading"><div><h2>{t('receipts')}</h2></div></div>
          {invoices.flatMap((invoice) => invoice.payments.filter((payment) => payment.entryType === 'payment' && payment.receiptNumber)
            .map((payment) => <div className="history-row" key={payment.id}><span className="history-icon">✓</span><span><strong>{payment.receiptNumber}</strong><small>{invoice.invoiceNumber} · {formatMethod(payment.method)}</small></span><span className="score-pill">{formatAmount(payment.amount, invoice.currencyCode)}</span><button className="button button-secondary" onClick={() => payment.receiptNumber && void openReceipt(payment.receiptNumber)}>{t('viewReceipt')}</button></div>))}
        </section>}
      {(canManage || canCollect) && <FinanceOperationsPanel
        t={t} locale={locale} canManage={canManage} canCollect={canCollect} canApprove={canApprove} />}
    </>}
  </>;
}
