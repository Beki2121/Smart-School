import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, OrganizationClosure, PlatformOutstandingReport, PlatformSchoolDraft, PlatformSettings, PlatformUser, SchoolSubscription, SubscriptionPlan, User } from '../../api';
import SidebarNavGroup from '../../components/SidebarNavGroup';
import { getPlatformNavigation } from '../../navigation';
import InvitationLinkField from '../../components/InvitationLinkField';
import { localDateInput } from '../../utils/dates';
import AuditLogPage from '../audit/AuditLogPage';

type T = (key: string) => string;
const emptySchoolDraft = (): PlatformSchoolDraft => ({
  schoolName: '', ownerName: '', ownerEmail: '', schoolPhone: '', address: '',
  locale: 'en', currencyCode: 'ETB', timezone: 'Africa/Addis_Ababa',
  academicConfiguration: { calendarType: 'ethiopian', dateFormat: 'dd/MM/yyyy', defaultLocale: 'en' }
});
const formatBytes = (value: number) => value < 1024 * 1024
  ? `${(value / 1024).toFixed(0)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
export default function PlatformAdminPage({ t, user, onLogout }: {
  t: T; user: User; onLogout: () => Promise<void>
}) {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof api.platformDashboard>> | null>(null);
  const [closures, setClosures] = useState<OrganizationClosure[]>([]);
  const [platformUsers, setPlatformUsers] = useState<PlatformUser[]>([]);
  const [platformUserDraft, setPlatformUserDraft] = useState({ name: '', email: '' });
  const [platformUserInvite, setPlatformUserInvite] = useState('');
  const [platformUserDrafts, setPlatformUserDrafts] = useState<Record<string, { name: string; email: string }>>({});
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [subscription, setSubscription] = useState<SchoolSubscription | null>(null);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null);
  const [smtpPassword, setSmtpPassword] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const [paymentReferences, setPaymentReferences] = useState<Record<string, string>>({});
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>({});
  const [refundReasons, setRefundReasons] = useState<Record<string, string>>({});
  const [outstandingReport, setOutstandingReport] = useState<PlatformOutstandingReport | null>(null);
  const [outstandingFrom, setOutstandingFrom] = useState('');
  const [outstandingTo, setOutstandingTo] = useState('');
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
    billingCycle: 'monthly' as SubscriptionPlan['billingCycle'],
    maxUsers: '50', storageLimitBytes: String(1024 * 1024 * 1024),
    modules: 'academic_setup, attendance, marks, fees', isActive: true
  });
  useEffect(() => { setMobileNavOpen(false); }, [location.hash]);
  useEffect(() => {
    if (location.hash !== '#platform-users') return;
    api.platformUsers().then((users) => {
      setPlatformUsers(users);
      setPlatformUserDrafts(Object.fromEntries(users.map((item) => [item.id, {
        name: item.name, email: item.email ?? ''
      }])));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [location.hash, t]);
  useEffect(() => {
    if (location.hash !== '#platform-settings') return;
    api.platformSettings().then(setPlatformSettings)
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [location.hash, t]);
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
      billingCycle: plan.billingCycle, maxUsers: plan.maxUsers == null ? '' : String(plan.maxUsers),
      storageLimitBytes: plan.storageLimitBytes == null ? '' : String(plan.storageLimitBytes),
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
      billingCycle: planDraft.billingCycle,
      maxUsers: planDraft.maxUsers === '' ? null : Number(planDraft.maxUsers),
      storageLimitBytes: planDraft.storageLimitBytes === '' ? null : Number(planDraft.storageLimitBytes),
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
  const recordRefund = async (paymentId: string) => {
    if (!subscription) return;
    await run(async () => {
      await api.refundSubscriptionPayment(
        paymentId, Number(refundAmounts[paymentId]), refundReasons[paymentId] ?? ''
      );
      setRefundAmounts((current) => ({ ...current, [paymentId]: '' }));
      setRefundReasons((current) => ({ ...current, [paymentId]: '' }));
      setSubscription(await api.platformSchoolSubscription(selectedSchoolId));
    }, t('refundRecorded'));
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
  const uploadLogo = async (schoolId: string, file?: File) => {
    if (!file) return;
    await run(() => api.uploadSchoolLogo(schoolId, file), t('schoolLogoSaved'));
  };
  const saveGlobalSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!platformSettings) return;
    await run(async () => {
      setPlatformSettings(await api.updatePlatformSettings({
        ...platformSettings, smtpPassword: smtpPassword || undefined
      }));
      setSmtpPassword('');
    }, t('platformSettingsSaved'));
  };
  const downloadRevenue = async () => {
    try {
      const blob = await api.exportSubscriptionRevenue();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'subscription-revenue.csv'; link.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const runOutstandingReport = async () => {
    setBusy(true); setError('');
    try {
      setOutstandingReport(await api.platformOutstandingReport({
        from: outstandingFrom || undefined, to: outstandingTo || undefined
      }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const downloadOutstanding = async () => {
    try {
      const blob = await api.exportSubscriptionOutstanding({
        from: outstandingFrom || undefined, to: outstandingTo || undefined
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'subscription-outstanding-balances.csv'; link.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const regenerateAdminInvitation = async (organizationId: string) => {
    await run(async () => {
      const invitation = await api.regenerateSchoolAdministratorInvitation(organizationId);
      setInvitationLinks((current) => ({ ...current, [organizationId]: invitation.invitationUrl }));
    }, t('adminInviteRegenerated'));
  };
  const invitePlatformUser = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const invitation = await api.invitePlatformUser(
        platformUserDraft.name, platformUserDraft.email
      );
      setPlatformUserInvite(invitation.invitationUrl);
      setPlatformUserDraft({ name: '', email: '' });
      setMessage(t('platformUserInvited'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };
  const savePlatformUser = async (user: PlatformUser) => {
    const draft = platformUserDrafts[user.id];
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const updated = await api.updatePlatformUser(user.id, draft);
      setPlatformUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(t('platformUserUpdated'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };
  const setPlatformUserActive = async (user: PlatformUser) => {
    const isActive = !user.isActive;
    if (!isActive && !window.confirm(t('confirmDeactivateAccount'))) return;
    setBusy(true); setError('');
    try {
      const updated = await api.setPlatformUserActive(user.id, isActive);
      setPlatformUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(isActive ? t('active') : t('platformUserDeactivated'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };
  const assignPlatformRole = async (user: PlatformUser) => {
    setBusy(true); setError('');
    try {
      const updated = await api.assignPlatformRole(user.id, 'super_admin');
      setPlatformUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(t('platformRole'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
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
          [t('totalStudents'), dashboard.totals.students],
          [t('staff'), dashboard.totals.staff],
          [t('activeSubscriptions'), dashboard.totals.activeSubscriptions],
          [t('revenueCollected'), dashboard.totals.revenueCollected.toLocaleString()],
          [t('outstanding'), dashboard.totals.outstanding.toLocaleString()],
          [t('refunds'), dashboard.totals.refunds.toLocaleString()],
          [t('storageUsed'), formatBytes(dashboard.totals.storageUsedBytes)]
        ] as const).map(([label, value]) => <article className="metric-card" key={label}>
          <span>{label}</span><strong>{value}</strong>
        </article>)}
      </div>
      <p className={dashboard.database.reachable ? 'notice notice-success' : 'form-error'}>
        {t('databaseStatus')}: {dashboard.database.reachable ? t('connected') : t('unavailable')}
        {' · '}{t('expiringSubscriptions')}: {dashboard.totals.expiringSubscriptions}
      </p>
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
            <label>{t('calendarType')}<select value={schoolDraft.academicConfiguration.calendarType}
              onChange={(event) => setSchoolDraft({ ...schoolDraft, academicConfiguration: {
                ...schoolDraft.academicConfiguration,
                calendarType: event.target.value as PlatformSchoolDraft['academicConfiguration']['calendarType']
              } })}>
              <option value="ethiopian">{t('ethiopianCalendar')}</option>
              <option value="gregorian">{t('gregorianCalendar')}</option>
            </select></label>
            <label>{t('dateFormat')}<select value={schoolDraft.academicConfiguration.dateFormat}
              onChange={(event) => setSchoolDraft({ ...schoolDraft, academicConfiguration: {
                ...schoolDraft.academicConfiguration,
                dateFormat: event.target.value as PlatformSchoolDraft['academicConfiguration']['dateFormat']
              } })}>
              <option value="dd/MM/yyyy">dd/MM/yyyy</option>
              <option value="MM/dd/yyyy">MM/dd/yyyy</option>
              <option value="yyyy-MM-dd">yyyy-MM-dd</option>
            </select></label>
          </div>
          <button className="button button-primary" disabled={busy}>{t('provisionSchool')}</button>
          {schoolInvitationLink && <InvitationLinkField value={schoolInvitationLink} t={t} />}
        </form>
        <div className="table-wrap"><table><thead><tr>
          <th>{t('schoolName')}</th><th>{t('schoolCode')}</th><th>{t('status')}</th>
          <th>{t('subscription')}</th><th>{t('students')} / {t('storageUsed')}</th><th>{t('actions')}</th>
        </tr></thead><tbody>
          {dashboard.schools.map((school) => <tr key={school.id}>
            <td><strong>{school.name}</strong><small>{school.owner?.email ?? ''}</small></td>
            <td><code>{school.schoolCode}</code></td>
            <td>{t(`schoolStatus_${school.status}`)}</td>
            <td>{school.subscription?.planName ?? '—'} · {t(`subscriptionStatus_${school.subscription?.status ?? 'none'}`)}
              {school.subscription?.expiryWarning && <small>{t('expiresOn')}: {school.subscription.expiryWarning.slice(0, 10)}</small>}
            </td>
            <td>{t('students')}: {school.studentCount}
              <small>{t('accounts')}: {school.userCount}/{dashboard.plans.find((plan) =>
                plan.code === school.subscription?.planCode)?.maxUsers ?? t('unlimited')}</small>
              <small>{t('storageUsed')}: {formatBytes(dashboard.storageBySchool
                .find((item) => item.organizationId === school.id)?.usedBytes ?? 0)}/
                {(() => {
                  const limit = dashboard.storageBySchool
                    .find((item) => item.organizationId === school.id)?.limitBytes;
                  return limit == null ? t('unlimited') : formatBytes(limit);
                })()}
              </small>
            </td>
            <td className="platform-actions">
              <label className="compact-field">{t('uploadSchoolLogo')}
                <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
                  onChange={(event) => void uploadLogo(school.id, event.target.files?.[0])} />
              </label>
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
              <label>{t('billingCycle')}<select value={planDraft.billingCycle}
                onChange={(e) => setPlanDraft({ ...planDraft,
                  billingCycle: e.target.value as SubscriptionPlan['billingCycle']
                })}>
                <option value="monthly">{t('monthly')}</option>
                <option value="termly">{t('termly')}</option>
                <option value="yearly">{t('yearly')}</option>
              </select></label>
              <label>{t('maxUsers')}<input type="number" min="1" value={planDraft.maxUsers}
                placeholder={t('unlimited')} onChange={(e) =>
                  setPlanDraft({ ...planDraft, maxUsers: e.target.value })} /></label>
              <label>{t('storageLimitBytes')}<input type="number" min="1" value={planDraft.storageLimitBytes}
                placeholder={t('unlimited')} onChange={(e) =>
                  setPlanDraft({ ...planDraft, storageLimitBytes: e.target.value })} /></label>
              <label>{t('currency')}<input maxLength={3} value={planDraft.currencyCode} onChange={(e) => setPlanDraft({ ...planDraft, currencyCode: e.target.value.toUpperCase() })} required /></label>
            </div>
            <label>{t('planModules')}<input value={planDraft.modules} onChange={(e) => setPlanDraft({ ...planDraft, modules: e.target.value })} /></label>
            <label className="checkbox-field"><input type="checkbox" checked={planDraft.isActive} onChange={(e) => setPlanDraft({ ...planDraft, isActive: e.target.checked })} />{t('planIsActive')}</label>
            <button className="button button-primary" disabled={busy}>{t('savePlan')}</button>
          </form>
        </section>
        <section className="panel" id="platform-billing">
          <div className="panel-heading"><div><h2>{t('manualBilling')}</h2><p>{t('manualBillingHint')}</p></div>
            <button type="button" className="button button-secondary" onClick={() => void downloadRevenue()}>
              {t('exportRevenue')}
            </button>
          </div>
          <div className="notice">{t('revenueCollected')}: {dashboard.totals.revenueCollected.toLocaleString()}
            {' · '}{t('outstanding')}: {dashboard.totals.outstanding.toLocaleString()}
            {' · '}{t('netRevenue')}: {dashboard.totals.netRevenue.toLocaleString()}
          </div>
          <div className="inline-form">
            <label>{t('fromDate')}<input type="date" value={outstandingFrom}
              onChange={(event) => setOutstandingFrom(event.target.value)} /></label>
            <label>{t('toDate')}<input type="date" value={outstandingTo}
              onChange={(event) => setOutstandingTo(event.target.value)} /></label>
            <button type="button" className="button button-secondary" disabled={busy ||
              Boolean(outstandingFrom && outstandingTo && outstandingFrom > outstandingTo)}
              onClick={() => void runOutstandingReport()}>{t('showOutstanding')}</button>
            <button type="button" className="button button-secondary" disabled={busy ||
              Boolean(outstandingFrom && outstandingTo && outstandingFrom > outstandingTo)}
              onClick={() => void downloadOutstanding()}>{t('exportOutstanding')}</button>
          </div>
          {outstandingReport && <div className="notice" role="status">
            {outstandingReport.totals.length ? outstandingReport.totals.map((total) =>
              <span key={total.currencyCode}>
                {total.currencyCode}: {total.outstandingAmount.toLocaleString()} ({total.invoiceCount})
              </span>
            ) : t('noOutstandingBalances')}
          </div>}
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
              {invoice.payments?.map((payment) => <div className="inline-form" key={payment.id}>
                <span>{t('paymentAmount')}: {payment.amount} · {t('refunded')}: {payment.refundedAmount}</span>
                {payment.refundedAmount < payment.amount && <>
                  <input aria-label={t('refundAmount')} type="number" min="0.01" step="0.01"
                    max={payment.amount - payment.refundedAmount}
                    value={refundAmounts[payment.id] ?? ''}
                    onChange={(event) => setRefundAmounts({
                      ...refundAmounts, [payment.id]: event.target.value
                    })} />
                  <input aria-label={t('refundReason')} maxLength={500}
                    value={refundReasons[payment.id] ?? ''}
                    onChange={(event) => setRefundReasons({
                      ...refundReasons, [payment.id]: event.target.value
                    })} />
                  <button className="button button-secondary" disabled={busy ||
                    !refundAmounts[payment.id] || !refundReasons[payment.id]?.trim()}
                  onClick={() => void recordRefund(payment.id)}>{t('recordRefund')}</button>
                </>}
              </div>)}
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
      <section className="panel" id="platform-settings">
        <div className="panel-heading"><div><h2>{t('globalSettings')}</h2>
          <p>{t('globalSettingsHint')}</p></div></div>
        {!platformSettings ? <p>{t('openSettingsToLoad')}</p> : <form className="settings-form"
          onSubmit={(event) => void saveGlobalSettings(event)}>
          <div className="form-grid">
            <label>{t('defaultLanguage')}<select value={platformSettings.defaultLocale}
              onChange={(event) => setPlatformSettings({ ...platformSettings,
                defaultLocale: event.target.value as PlatformSettings['defaultLocale']
              })}>
              <option value="en">{t('english')}</option><option value="am">{t('amharic')}</option>
            </select></label>
            <label>{t('currency')}<input maxLength={3} value={platformSettings.currencyCode}
              onChange={(event) => setPlatformSettings({ ...platformSettings,
                currencyCode: event.target.value.toUpperCase()
              })} /></label>
            <label>{t('dateFormat')}<select value={platformSettings.dateFormat}
              onChange={(event) => setPlatformSettings({ ...platformSettings,
                dateFormat: event.target.value as PlatformSettings['dateFormat']
              })}>
              <option value="dd/MM/yyyy">dd/MM/yyyy</option>
              <option value="MM/dd/yyyy">MM/dd/yyyy</option>
              <option value="yyyy-MM-dd">yyyy-MM-dd</option>
            </select></label>
            <label>{t('calendarType')}<select value={platformSettings.calendarType}
              onChange={(event) => setPlatformSettings({ ...platformSettings,
                calendarType: event.target.value as PlatformSettings['calendarType']
              })}>
              <option value="ethiopian">{t('ethiopianCalendar')}</option>
              <option value="gregorian">{t('gregorianCalendar')}</option>
            </select></label>
            <label>{t('smtpHost')}<input value={platformSettings.smtpHost}
              onChange={(event) => setPlatformSettings({ ...platformSettings, smtpHost: event.target.value })} /></label>
            <label>{t('smtpPort')}<input type="number" min="1" max="65535"
              value={platformSettings.smtpPort} onChange={(event) => setPlatformSettings({
                ...platformSettings, smtpPort: Number(event.target.value)
              })} /></label>
            <label>{t('smtpUser')}<input value={platformSettings.smtpUser}
              onChange={(event) => setPlatformSettings({ ...platformSettings, smtpUser: event.target.value })} /></label>
            <label>{t('smtpFrom')}<input type="email" value={platformSettings.smtpFrom}
              onChange={(event) => setPlatformSettings({ ...platformSettings, smtpFrom: event.target.value })} /></label>
            <label>{t('smtpPassword')}<input type="password" autoComplete="new-password"
              value={smtpPassword} placeholder={platformSettings.smtpPasswordConfigured
                ? t('smtpPasswordAlreadySet') : ''}
              onChange={(event) => setSmtpPassword(event.target.value)} /></label>
            <label className="checkbox-field"><input type="checkbox" checked={platformSettings.smtpSecure}
              onChange={(event) => setPlatformSettings({ ...platformSettings, smtpSecure: event.target.checked })} />
              {t('smtpSecure')}</label>
          </div>
          <p>{t('smtpStatus')}: {platformSettings.smtpConfigured ? t('configured') : t('notConfigured')}</p>
          <button className="button button-primary" disabled={busy}>{t('saveSettings')}</button>
        </form>}
      </section>
      <section className="panel" id="platform-users">
        <div className="panel-heading"><div><h2>{t('platformUsers')}</h2>
          <p>{t('platformUsersHint')} {t('platformRoleNotice')}</p></div></div>
        <form className="settings-form" onSubmit={(event) => void invitePlatformUser(event)}>
          <div className="form-grid">
            <label>{t('name')}<input value={platformUserDraft.name}
              onChange={(event) => setPlatformUserDraft({
                ...platformUserDraft, name: event.target.value
              })} required /></label>
            <label>{t('platformUserEmail')}<input type="email" autoComplete="email"
              value={platformUserDraft.email}
              onChange={(event) => setPlatformUserDraft({
                ...platformUserDraft, email: event.target.value
              })} required /></label>
          </div>
          <button className="button button-primary" disabled={busy}>
            {t('invitePlatformUser')}
          </button>
          {platformUserInvite && <InvitationLinkField value={platformUserInvite} t={t} />}
        </form>
        <div className="table-wrap"><table><thead><tr>
          <th>{t('name')}</th><th>{t('email')}</th><th>{t('platformRole')}</th>
          <th>{t('status')}</th><th>{t('actions')}</th>
        </tr></thead><tbody>{platformUsers.map((platformUser) => <tr key={platformUser.id}>
          <td><input aria-label={`${t('name')} ${platformUser.email ?? platformUser.id}`}
            value={platformUserDrafts[platformUser.id]?.name ?? platformUser.name}
            onChange={(event) => setPlatformUserDrafts((current) => ({
              ...current, [platformUser.id]: {
                ...current[platformUser.id], name: event.target.value
              }
            }))} /></td>
          <td><input aria-label={`${t('email')} ${platformUser.name}`}
            value={platformUserDrafts[platformUser.id]?.email ?? platformUser.email ?? ''}
            onChange={(event) => setPlatformUserDrafts((current) => ({
              ...current, [platformUser.id]: {
                ...current[platformUser.id], email: event.target.value
              }
            }))} /></td>
          <td>{t(`role_${platformUser.role}`)}</td>
          <td>{platformUser.isActive ? t('active') : t('inactive')}</td>
          <td className="platform-actions">
            <button className="button button-quiet" disabled={busy}
              onClick={() => void assignPlatformRole(platformUser)}>{t('assignRole')}</button>
            <button className="button button-secondary" disabled={busy}
              onClick={() => void savePlatformUser(platformUser)}>{t('updatePlatformUser')}</button>
            <button className="button button-quiet" disabled={busy}
              onClick={() => void setPlatformUserActive(platformUser)}>
              {platformUser.isActive ? t('deactivatePlatformUser') : t('activatePlatformUser')}
            </button>
          </td>
        </tr>)}
          {!platformUsers.length && <tr><td colSpan={5}>{t('noAccounts')}</td></tr>}
        </tbody></table></div>
      </section>
      <AuditLogPage t={t} platform currentSessionId={user.sessionId}
        onCurrentSessionRevoked={onLogout} />
      <AuditLogPage t={t} platform history currentSessionId={user.sessionId}
        onCurrentSessionRevoked={onLogout} />
    </>}
    </main>
  </div>;
}
