import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, OrganizationClosure, PlatformSchoolDraft, SchoolSubscription, SubscriptionPlan, User } from '../../api';
import SidebarNavGroup from '../../components/SidebarNavGroup';
import { getPlatformNavigation } from '../../navigation';
import InvitationLinkField from '../../components/InvitationLinkField';
import { localDateInput } from '../../utils/dates';

type T = (key: string) => string;
const emptySchoolDraft = (): PlatformSchoolDraft => ({
  schoolName: '', ownerName: '', ownerEmail: '', schoolPhone: '', address: '',
  locale: 'en', currencyCode: 'ETB', timezone: 'Africa/Addis_Ababa'
});
export default function PlatformAdminPage({ t, user, onLogout }: {
  t: T; user: User; onLogout: () => Promise<void>
}) {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof api.platformDashboard>> | null>(null);
  const [closures, setClosures] = useState<OrganizationClosure[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [subscription, setSubscription] = useState<SchoolSubscription | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const [paymentReferences, setPaymentReferences] = useState<Record<string, string>>({});
  const [closureFinanceDays, setClosureFinanceDays] = useState<Record<string, string>>({});
  const [schoolDraft, setSchoolDraft] = useState<PlatformSchoolDraft>(emptySchoolDraft);
  const [invitationLinks, setInvitationLinks] = useState<Record<string, string>>({});
  const [schoolInvitationLink, setSchoolInvitationLink] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [planDraft, setPlanDraft] = useState({
    code: '', name: '', description: '', monthlyPrice: '0', currencyCode: 'ETB',
    trialDays: '30', studentLimit: '100', staffLimit: '20', siteLimit: '1',
    modules: 'academic_setup, attendance, marks, fees', isActive: true
  });
  useEffect(() => { setMobileNavOpen(false); }, [location.hash]);
  const platformNavGroups = getPlatformNavigation(t);
  const selectedSchool = dashboard?.schools.find((school) => school.id === selectedSchoolId) ?? null;
  const load = useCallback(async () => {
    try {
      const [overview, closureRows] = await Promise.all([
        api.platformDashboard(), api.closureRequests()
      ]);
      setDashboard(overview);
      setClosures(closureRows);
      setSelectedSchoolId((current) => current || overview.schools[0]?.id || '');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selectedSchoolId) { setSubscription(null); return; }
    api.platformSchoolSubscription(selectedSchoolId).then(setSubscription)
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [selectedSchoolId, dashboard, t]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(''); setMessage('');
    try { await action(); await load(); setMessage(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const choosePlan = (plan: SubscriptionPlan) => {
    setSelectedPlan(plan);
    setPlanDraft({
      code: plan.code, name: plan.name, description: plan.description,
      monthlyPrice: String(plan.monthlyPrice), currencyCode: plan.currencyCode,
      trialDays: String(plan.trialDays), studentLimit: plan.studentLimit == null ? '' : String(plan.studentLimit),
      staffLimit: plan.staffLimit == null ? '' : String(plan.staffLimit),
      siteLimit: plan.siteLimit == null ? '' : String(plan.siteLimit),
      modules: plan.modules.join(', '), isActive: plan.isActive
    });
  };
  const savePlan = async (event: FormEvent) => {
    event.preventDefault();
    const plan: SubscriptionPlan = {
      id: selectedPlan?.id ?? '', code: planDraft.code.trim().toLowerCase(),
      name: planDraft.name, description: planDraft.description,
      monthlyPrice: Number(planDraft.monthlyPrice), currencyCode: planDraft.currencyCode,
      trialDays: Number(planDraft.trialDays),
      studentLimit: planDraft.studentLimit === '' ? null : Number(planDraft.studentLimit),
      staffLimit: planDraft.staffLimit === '' ? null : Number(planDraft.staffLimit),
      siteLimit: planDraft.siteLimit === '' ? null : Number(planDraft.siteLimit),
      modules: planDraft.modules.split(',').map((module) => module.trim()).filter(Boolean),
      isActive: planDraft.isActive
    };
    await run(async () => {
      const saved = await api.saveSubscriptionPlan(plan);
      setSelectedPlan(saved);
    }, t('planSaved'));
  };
  const issueInvoice = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSchool || !invoiceAmount) return;
    await run(async () => {
      await api.createSubscriptionInvoice(selectedSchool.id, Number(invoiceAmount), selectedSchool.currencyCode);
      setInvoiceAmount('');
      setSubscription(await api.platformSchoolSubscription(selectedSchool.id));
    }, t('invoiceIssued'));
  };
  const recordPayment = async (invoiceId: string) => {
    if (!subscription) return;
    await run(async () => {
      await api.recordSubscriptionPayment(
        invoiceId, Number(paymentAmounts[invoiceId]),
        localDateInput(), paymentReferences[invoiceId] ?? ''
      );
      setPaymentAmounts((items) => ({ ...items, [invoiceId]: '' }));
      setPaymentReferences((items) => ({ ...items, [invoiceId]: '' }));
      setSubscription(await api.platformSchoolSubscription(subscription
        ? selectedSchoolId : ''));
    }, t('subscriptionPaymentRecorded'));
  };
  const closeSchool = async (closureId: string) => {
    const financialRetentionDays = Number(closureFinanceDays[closureId]);
    if (!Number.isInteger(financialRetentionDays) || financialRetentionDays < 30 ||
        financialRetentionDays > 36500) return;
    await run(() => api.approveClosure(closureId, 90, financialRetentionDays), t('closureApproved'));
  };
  const pseudonymizeSchool = async (closureId: string) => {
    if (!window.confirm(t('closureAnonymizeConfirm'))) return;
    await run(() => api.pseudonymizeClosure(closureId), t('closurePseudonymized'));
  };
  const createSchool = async (event: FormEvent) => {
    event.preventDefault();
    await run(async () => {
      const result = await api.createPlatformSchool(schoolDraft);
      setSchoolInvitationLink(result.invitationUrl);
      setSchoolDraft(emptySchoolDraft());
    }, t('platformSchoolCreated'));
  };
  const regenerateAdminInvitation = async (organizationId: string) => {
    await run(async () => {
      const invitation = await api.regenerateSchoolAdministratorInvitation(organizationId);
      setInvitationLinks((current) => ({ ...current, [organizationId]: invitation.invitationUrl }));
    }, t('adminInviteRegenerated'));
  };

  return <div className="platform-shell">
    {mobileNavOpen && <button className="sidebar-backdrop" type="button"
      aria-label={t('closeMenu')} onClick={() => setMobileNavOpen(false)} />}
    <aside className={`sidebar platform-sidebar ${mobileNavOpen ? 'is-open' : ''}`}>
      <Link className="brand" to="/">
        <span className="brand-mark">S</span>
        <span><strong>{t('brand')}</strong><small>{t('platformConsole')}</small></span>
      </Link>
      <button className="sidebar-close" type="button" aria-label={t('closeMenu')}
        onClick={() => setMobileNavOpen(false)}>×</button>
      <div className="campus-label"><span className="campus-dot" />{t('platformConsole')}</div>
      <nav className="primary-nav" aria-label={t('platformAdmin')}>
        <a href="#platform-overview" onClick={() => setMobileNavOpen(false)}>
          <span className="nav-icon">▦</span>{t('navPortalDashboard')}
        </a>
        {platformNavGroups.map((group, index) => <SidebarNavGroup key={group.label} group={group}
          defaultOpen={index === 0} activePath={location.hash}
          onNavigate={() => setMobileNavOpen(false)} />)}
      </nav>
      <div className="sidebar-bottom"><div className="profile-mini">
        <span className="avatar">{user.name.slice(0, 1)}</span>
        <span className="profile-name"><strong>{user.name}</strong><small>{t('role_super_admin')}</small></span>
      </div></div>
    </aside>
    <main className="platform-page">
    <header className="platform-header">
      <div className="topbar-leading">
        <button className="mobile-menu-toggle" type="button" aria-label={t('openMenu')}
          aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}>☰</button>
        <div><span className="eyebrow">{t('platformConsole')}</span><h1>{t('platformAdmin')}</h1></div>
      </div>
      <button className="button button-secondary" onClick={() => void onLogout()}>{t('signOut')}</button>
    </header>
    {error && <div className="form-error">{error}</div>}
    {message && <div className="notice notice-success">{message}</div>}
    {!dashboard ? <div className="loading-state">{t('loading')}</div> : <>
      <div className="metric-grid platform-metrics" id="platform-overview">
        {([
          [t('schools'), dashboard.totals.schools],
          [t('pendingSchools'), dashboard.totals.pending],
          [t('activeSchools'), dashboard.totals.active],
          [t('totalStudents'), dashboard.totals.students]
        ] as const).map(([label, value]) => <article className="metric-card" key={label}>
          <span>{label}</span><strong>{value}</strong>
        </article>)}
      </div>
      <section className="panel" id="platform-schools">
        <div className="panel-heading"><div><h2>{t('schoolTenants')}</h2><p>{t('onboardingPolicy')}</p></div></div>
        <form className="settings-form" onSubmit={(event) => void createSchool(event)}>
          <div className="panel-heading"><div><h3>{t('provisionSchool')}</h3><p>{t('platformSchoolHint')}</p></div></div>
          <div className="form-grid">
            <label>{t('schoolName')}<input value={schoolDraft.schoolName}
              onChange={(event) => setSchoolDraft({ ...schoolDraft, schoolName: event.target.value })} required /></label>
            <label>{t('ownerName')}<input value={schoolDraft.ownerName}
              onChange={(event) => setSchoolDraft({ ...schoolDraft, ownerName: event.target.value })} required /></label>
            <label>{t('email')}<input type="email" autoComplete="email" value={schoolDraft.ownerEmail}
              onChange={(event) => setSchoolDraft({ ...schoolDraft, ownerEmail: event.target.value })} required /></label>
            <label>{t('schoolPhone')}<input type="tel" value={schoolDraft.schoolPhone}
              onChange={(event) => setSchoolDraft({ ...schoolDraft, schoolPhone: event.target.value })} /></label>
            <label>{t('address')}<input value={schoolDraft.address}
              onChange={(event) => setSchoolDraft({ ...schoolDraft, address: event.target.value })} /></label>
            <label>{t('language')}<select value={schoolDraft.locale}
              onChange={(event) => setSchoolDraft({
                ...schoolDraft, locale: event.target.value as PlatformSchoolDraft['locale']
              })}>
              <option value="en">{t('english')}</option><option value="am">{t('amharic')}</option>
            </select></label>
            <label>{t('currency')}<select value={schoolDraft.currencyCode}
              onChange={(event) => setSchoolDraft({
                ...schoolDraft, currencyCode: event.target.value as PlatformSchoolDraft['currencyCode']
              })}>
              <option value="ETB">ETB</option><option value="USD">USD</option>
            </select></label>
          </div>
          <button className="button button-primary" disabled={busy}>{t('provisionSchool')}</button>
          {schoolInvitationLink && <InvitationLinkField value={schoolInvitationLink} t={t} />}
        </form>
        <div className="table-wrap"><table><thead><tr>
          <th>{t('schoolName')}</th><th>{t('ownerName')}</th><th>{t('status')}</th>
          <th>{t('subscription')}</th><th>{t('students')}</th><th>{t('actions')}</th>
        </tr></thead><tbody>
          {dashboard.schools.map((school) => <tr key={school.id}>
            <td><strong>{school.name}</strong><small>{school.owner?.email ?? ''}</small></td>
            <td>{school.owner?.name ?? '—'}</td>
            <td>{t(`schoolStatus_${school.status}`)}</td>
            <td>{school.subscription?.planName ?? '—'} · {t(`subscriptionStatus_${school.subscription?.status ?? 'none'}`)}</td>
            <td>{school.studentCount}</td>
            <td className="platform-actions">
              <button className="button button-secondary" disabled={busy || school.status === 'active'}
                onClick={() => void run(() => api.updateSchoolStatus(school.id, 'active'), t('schoolActivated'))}>{t('activate')}</button>
              <button className="button button-secondary" disabled={busy || school.status === 'suspended'}
                onClick={() => void run(() => api.updateSchoolStatus(school.id, 'suspended'), t('schoolSuspended'))}>{t('suspend')}</button>
              {!school.owner && school.adminInvitationAvailable && <button className="button button-secondary"
                disabled={busy} onClick={() => void regenerateAdminInvitation(school.id)}>
                {t('regenerateAdminInvitation')}
              </button>}
              {invitationLinks[school.id] && <details>
                <summary>{t('invitationLink')}</summary>
                <InvitationLinkField value={invitationLinks[school.id]} t={t} />
              </details>}
              <label className="compact-field">{t('plan')}
                <select value={dashboard.plans.find((plan) => plan.code === school.subscription?.planCode)?.code ?? ''}
                  onChange={(event) => {
                    if (event.target.value) void run(() =>
                      api.assignSchoolPlan(school.id, event.target.value), t('planAssigned'));
                  }}>
                  <option value="">{t('selectPlan')}</option>
                  {dashboard.plans.filter((plan) => plan.isActive).map((plan) =>
                    <option key={plan.id} value={plan.code}>{plan.name}</option>)}
                </select>
              </label>
            </td>
          </tr>)}
          {!dashboard.schools.length && <tr><td colSpan={6}>{t('noSchools')}</td></tr>}
        </tbody></table></div>
      </section>
      <div className="platform-grid">
        <section className="panel" id="platform-plans">
          <div className="panel-heading"><div><h2>{t('planConfiguration')}</h2><p>{t('planLimitsHint')}</p></div></div>
          <div className="plan-list">{dashboard.plans.map((plan) =>
            <button type="button" className={`plan-chip ${selectedPlan?.id === plan.id ? 'selected' : ''}`}
              key={plan.id} onClick={() => choosePlan(plan)}>
              <strong>{plan.name}</strong><small>{plan.monthlyPrice} {plan.currencyCode} / {t('month')}</small>
            </button>)}</div>
          <form className="settings-form" onSubmit={(event) => void savePlan(event)}>
            <div className="form-grid">
              <label>{t('planCode')}<input value={planDraft.code} onChange={(e) => setPlanDraft({ ...planDraft, code: e.target.value })} required /></label>
              <label>{t('planName')}<input value={planDraft.name} onChange={(e) => setPlanDraft({ ...planDraft, name: e.target.value })} required /></label>
              <label>{t('monthlyPrice')}<input type="number" min="0" step="0.01" value={planDraft.monthlyPrice} onChange={(e) => setPlanDraft({ ...planDraft, monthlyPrice: e.target.value })} required /></label>
              <label>{t('trialDays')}<input type="number" min="0" max="365" value={planDraft.trialDays} onChange={(e) => setPlanDraft({ ...planDraft, trialDays: e.target.value })} required /></label>
              <label>{t('studentLimit')}<input type="number" min="1" value={planDraft.studentLimit} placeholder={t('unlimited')} onChange={(e) => setPlanDraft({ ...planDraft, studentLimit: e.target.value })} /></label>
              <label>{t('staffLimit')}<input type="number" min="1" value={planDraft.staffLimit} placeholder={t('unlimited')} onChange={(e) => setPlanDraft({ ...planDraft, staffLimit: e.target.value })} /></label>
              <label>{t('siteLimit')}<input type="number" min="1" value={planDraft.siteLimit} placeholder={t('unlimited')} onChange={(e) => setPlanDraft({ ...planDraft, siteLimit: e.target.value })} /></label>
              <label>{t('currency')}<input maxLength={3} value={planDraft.currencyCode} onChange={(e) => setPlanDraft({ ...planDraft, currencyCode: e.target.value.toUpperCase() })} required /></label>
            </div>
            <label>{t('planModules')}<input value={planDraft.modules} onChange={(e) => setPlanDraft({ ...planDraft, modules: e.target.value })} /></label>
            <label className="checkbox-field"><input type="checkbox" checked={planDraft.isActive} onChange={(e) => setPlanDraft({ ...planDraft, isActive: e.target.checked })} />{t('planIsActive')}</label>
            <button className="button button-primary" disabled={busy}>{t('savePlan')}</button>
          </form>
        </section>
        <section className="panel" id="platform-billing">
          <div className="panel-heading"><div><h2>{t('manualBilling')}</h2><p>{t('manualBillingHint')}</p></div></div>
          <label>{t('schoolName')}<select value={selectedSchoolId} onChange={(e) => setSelectedSchoolId(e.target.value)}>
            {dashboard.schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
          </select></label>
          {selectedSchool && <>
            <form className="inline-form" onSubmit={(event) => void issueInvoice(event)}>
              <label>{t('invoiceAmount')}<input type="number" min="0.01" step="0.01" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} required /></label>
              <button className="button button-primary" disabled={busy}>{t('issueInvoice')}</button>
            </form>
            <div className="invoice-list">{subscription?.invoices.map((invoice) => <article className="invoice-row" key={invoice.id}>
              <div><strong>{invoice.invoiceNumber}</strong><small>{invoice.amount} {invoice.currencyCode} · {t(`invoice_${invoice.status}`)}</small></div>
              {invoice.status !== 'paid' && <div className="inline-form">
                <input aria-label={t('paymentAmount')} type="number" min="0.01" step="0.01"
                  placeholder={t('paymentAmount')} value={paymentAmounts[invoice.id] ?? ''}
                  onChange={(e) => setPaymentAmounts({ ...paymentAmounts, [invoice.id]: e.target.value })} />
                <input aria-label={t('paymentReference')} placeholder={t('paymentReference')}
                  value={paymentReferences[invoice.id] ?? ''}
                  onChange={(e) => setPaymentReferences({ ...paymentReferences, [invoice.id]: e.target.value })} />
                <button className="button button-secondary" disabled={busy || !paymentAmounts[invoice.id]}
                  onClick={() => void recordPayment(invoice.id)}>{t('recordPayment')}</button>
              </div>}
            </article>)}</div>
          </>}
        </section>
      </div>
      <section className="panel" id="platform-closures">
        <div className="panel-heading"><div><h2>{t('closureRequests')}</h2><p>{t('closureRetentionHint')}</p></div></div>
        <div className="table-wrap"><table><thead><tr>
          <th>{t('schoolName')}</th><th>{t('reason')}</th><th>{t('status')}</th>
          <th>{t('retentionUntil')}</th><th>{t('financialRetentionUntil')}</th><th>{t('actions')}</th>
        </tr></thead><tbody>{closures.map((closure) => <tr key={closure.id}>
          <td>{closure.schoolName}</td><td>{closure.reason}</td><td>{t(`closure_${closure.status}`)}</td>
          <td>{closure.retentionUntil?.slice(0, 10) ?? '—'}</td>
          <td>{closure.financialRetentionUntil?.slice(0, 10) ?? '—'}</td>
          <td className="platform-actions">
            {closure.status === 'exported' && <>
              <label className="compact-field">{t('financialRetentionDays')}
                <input type="number" min="30" max="36500" step="1"
                  value={closureFinanceDays[closure.id] ?? ''}
                  onChange={(event) => setClosureFinanceDays({
                    ...closureFinanceDays, [closure.id]: event.target.value
                  })} />
              </label>
              <button className="button button-secondary"
                disabled={busy || !closureFinanceDays[closure.id] ||
                  !Number.isInteger(Number(closureFinanceDays[closure.id])) ||
                  Number(closureFinanceDays[closure.id]) < 30 ||
                  Number(closureFinanceDays[closure.id]) > 36500}
                onClick={() => void closeSchool(closure.id)}>{t('approveClosure')}</button>
            </>}
            {closure.status === 'retention' && closure.retentionUntil &&
              Date.parse(closure.retentionUntil) <= Date.now() &&
              <button className="button button-secondary" disabled={busy}
                onClick={() => void pseudonymizeSchool(closure.id)}>{t('pseudonymizeClosure')}</button>}
          </td>
        </tr>)}{!closures.length && <tr><td colSpan={6}>{t('noClosureRequests')}</td></tr>}</tbody></table></div>
      </section>
    </>}
    </main>
  </div>;
}
