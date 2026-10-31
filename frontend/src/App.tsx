import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, AcademicYear, AcademicYearRecord, CurriculumUnit, Department, GradeCatalogEntry, GradeLevel, GradeSubject, LeaveRequest, NotificationInbox, OrganizationClosure, OrganizationSettings, pendingOfflineCount, PromotionRule, Room, SchoolAccount, SchoolCalendarEntry, SchoolProfile, SchoolSubscription, Section, setAccessToken, StaffAttendance, StaffInvitationRole, StaffMember, StaffMessage, SubscriptionPlan, Subject, syncOfflineOperations, TeachingAssignment, TimetablePeriod, Term, User, UserNotification } from './api';
import { Locale, translate } from './i18n';
import { formatEthiopianDate } from './calendar';
import { ForgotPasswordPage, InvitationSetupPage, LoginPage, PasswordChangePage, PasswordResetPage } from './pages/auth/AuthPages';
import { PublicAdmissionPage, PublicTransferPage } from './pages/public/PublicStudentPages';
import AdmissionsPage from './pages/admissions/AdmissionsPage';
import PortalPage from './pages/portal/PortalPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import AttendancePage from './pages/attendance/AttendancePage';
import FeesPage from './pages/fees/FeesPage';
import CommunicationsPage from './pages/communications/CommunicationsPage';
import TimetablePage from './pages/timetable/TimetablePage';
import MarksPage from './pages/marks/MarksPage';
import StudentsPage from './pages/students/StudentsPage';
import PwaInstallButton from './components/PwaInstallButton';
import FormInput from './components/FormInput';
import SidebarNavGroup, { SidebarNavGroupDefinition } from './components/SidebarNavGroup';
import ErrorState from './components/ErrorState';
import InvitationLinkField from './components/InvitationLinkField';
import { localDateInput } from './utils/dates';

type T = (key: string) => string;

const staffInvitationRolesByRole: Record<string, StaffInvitationRole[]> = {
  owner_director: [
    'principal', 'registrar', 'system_admin', 'academic_head', 'homeroom_teacher',
    'subject_teacher', 'hr_admin', 'accountant_cashier', 'counsellor'
  ],
  system_admin: ['homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor'],
  principal: ['academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor'],
  registrar: ['homeroom_teacher', 'subject_teacher', 'counsellor'],
  hr_admin: ['homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor']
};

const academicDateLabel = (date: string, locale: Locale) => {
  const [year, month, day] = date.split('-').map(Number);
  return `${date} · ${formatEthiopianDate({ year, month, day }, locale)}`;
};

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => localStorage.getItem('sims_locale') === 'am' ? 'am' : 'en');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncNotice, setSyncNotice] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const t: T = useCallback((key) => translate(locale, key), [locale]);
  const invitationToken = /^\/invite\/([^/]+)\/?$/.exec(location.pathname)?.[1] ?? '';
  const resetPasswordToken = /^\/reset-password\/([^/]+)\/?$/.exec(location.pathname)?.[1] ?? '';
  const publicAdmissionToken = /^\/apply\/([a-f0-9]{64})\/?$/.exec(location.pathname)?.[1] ?? '';
  const publicTransferToken = /^\/transfer\/([A-Za-z0-9_-]{43})\/?$/.exec(location.pathname)?.[1] ?? '';
  const canViewStaff = ['owner_director', 'group_executive', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'].includes(user?.role ?? '');
  const canManageStaff = ['owner_director', 'principal', 'hr_admin', 'system_admin'].includes(user?.role ?? '');
  const canManageAccounts = ['owner_director', 'principal', 'registrar', 'hr_admin', 'system_admin'].includes(user?.role ?? '');
  const canManageAssignments = ['owner_director', 'principal', 'academic_head', 'hr_admin', 'system_admin'].includes(user?.role ?? '');
  const canViewAdmissions = ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'].includes(user?.role ?? '');
  const canManageAdmissions = ['owner_director', 'principal', 'registrar', 'system_admin'].includes(user?.role ?? '');
  const canManageStudentRecords = ['owner_director', 'principal', 'registrar', 'system_admin'].includes(user?.role ?? '');
  const canViewAlumni = canManageStudentRecords;
  const canViewStudentSensitiveData = ['owner_director', 'principal', 'registrar', 'counsellor', 'system_admin'].includes(user?.role ?? '');
  const canManageStudentSensitiveData = ['owner_director', 'principal', 'registrar', 'system_admin'].includes(user?.role ?? '');
  const canViewStudentDiscipline = ['owner_director', 'principal', 'registrar', 'counsellor', 'system_admin'].includes(user?.role ?? '');
  const canManageStudentDiscipline = ['owner_director', 'principal', 'counsellor', 'system_admin'].includes(user?.role ?? '');
  const canApproveStudentTransfers = ['owner_director', 'principal', 'system_admin'].includes(user?.role ?? '');
  const canViewStudentGuardians = canManageStudentRecords;
  const canViewStudentCommendations = ['owner_director', 'principal', 'counsellor', 'system_admin'].includes(user?.role ?? '');
  const canManageStudentCommendations = canViewStudentCommendations;
  const canManageGrading = ['owner_director', 'principal', 'system_admin'].includes(user?.role ?? '');
  const canSubmitMarks = ['owner_director', 'principal', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'].includes(user?.role ?? '');
  const canApproveMarks = ['owner_director', 'principal', 'academic_head', 'system_admin'].includes(user?.role ?? '');
  const canPublishMarks = canManageGrading;
  const canAmendMarks = canManageGrading;
  const canEditAttendance = ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'].includes(user?.role ?? '');
  const canReviewAttendanceCorrections = ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'].includes(user?.role ?? '');
  const canViewFees = ['owner_director', 'principal', 'registrar', 'accountant_cashier', 'system_admin'].includes(user?.role ?? '');
  const canManageFees = ['owner_director', 'principal', 'system_admin'].includes(user?.role ?? '');
  const canCollectFees = ['owner_director', 'principal', 'accountant_cashier', 'system_admin'].includes(user?.role ?? '');
  const canReverseFees = ['owner_director', 'principal', 'system_admin'].includes(user?.role ?? '');
  const canViewCommunications = ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin'].includes(user?.role ?? '');
  const canManageCommunications = ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'system_admin'].includes(user?.role ?? '');
  const canViewDashboard = ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin'].includes(user?.role ?? '');
  const canViewStudents = ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'counsellor', 'system_admin'].includes(user?.role ?? '');
  const canViewAttendance = ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'].includes(user?.role ?? '');
  const canViewMarks = ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'].includes(user?.role ?? '');
  const canViewSchoolSetup = ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'].includes(user?.role ?? '');

  useEffect(() => { localStorage.setItem('sims_locale', locale); }, [locale]);
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);
  useEffect(() => {
    let active = true;
    api.me().then((me) => { if (active) setUser(me); })
      .catch(() => setAccessToken(null))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const handleNetwork = async () => {
      setOnline(navigator.onLine);
      if (navigator.onLine && user) {
        const sent = await syncOfflineOperations(user.id);
        setPending(await pendingOfflineCount(user.id));
        if (sent) { setSyncNotice(true); window.setTimeout(() => setSyncNotice(false), 4000); }
      }
    };
    window.addEventListener('online', handleNetwork);
    window.addEventListener('offline', handleNetwork);
    pendingOfflineCount(user?.id).then(setPending);
    if (navigator.onLine && user) void handleNetwork();
    return () => {
      window.removeEventListener('online', handleNetwork);
      window.removeEventListener('offline', handleNetwork);
    };
  }, [user]);

  const onLogin = async (login: string, password: string) => {
    const loggedInUser = await api.login(login, password);
    setUser(loggedInUser);
    navigate('/');
  };
  const onLogout = async () => {
    await api.logout();
    setUser(null);
    navigate('/login');
  };
  const setQueued = async () => {
    const activeUser = user;
    if (activeUser) setPending(await pendingOfflineCount(activeUser.id));
  };

  if (loading) return <div className="boot-screen">{t('loading')}</div>;
  if (invitationToken) return <InvitationSetupPage
    t={t} token={invitationToken}
    onAccepted={(acceptedUser) => { setUser(acceptedUser); navigate('/'); }}
  />;
  if (location.pathname === '/forgot-password') return <ForgotPasswordPage t={t} />;
  if (resetPasswordToken) return <PasswordResetPage t={t} token={resetPasswordToken}
    onReset={() => { setAccessToken(null); setUser(null); }} />;
  if (publicAdmissionToken) return <PublicAdmissionPage
    t={t} locale={locale} token={publicAdmissionToken}
  />;
  if (publicTransferToken) return <PublicTransferPage t={t} token={publicTransferToken} />;
  if (!user) return <LoginPage t={t} onLogin={onLogin} />;
  if (user.mustChangePassword) return <PasswordChangePage
    t={t} user={user} onChanged={(updatedUser) => setUser(updatedUser)}
  />;
  if (user.role === 'super_admin') return <PlatformAdminPage t={t} user={user} onLogout={onLogout} />;
  if (['parent_guardian', 'student'].includes(user.role)) {
    return <PortalPage user={user} locale={locale} t={t} onLogout={onLogout} />;
  }

  const schoolNavGroups: SidebarNavGroupDefinition[] = [
    { label: t('navStudents'), icon: '♙', items: [
      ...(canViewStudents ? [{ label: t('students'), to: '/students', icon: '♙' }] : []),
      ...(canViewAdmissions ? [{ label: t('admissions'), to: '/admissions', icon: '▣' }] : [])
    ] },
    { label: t('navAcademics'), icon: '▤', items: [
      ...(canViewAttendance ? [{ label: t('attendance'), to: '/attendance', icon: '✓' }] : []),
      ...(canViewMarks ? [{ label: t('marks'), to: '/marks', icon: '▤' }] : []),
      ...(canViewStaff ? [{ label: t('timetable'), to: '/timetable', icon: '▦' }] : []),
      ...(canViewSchoolSetup ? [{ label: t('schoolSetup'), to: '/school', icon: '⌂' }] : [])
    ] },
    { label: t('navSchoolServices'), icon: '✉', items: [
      ...(canViewFees ? [{ label: t('fees'), to: '/fees', icon: '¤' }] : []),
      ...(canViewCommunications ? [{ label: t('communications'), to: '/communications', icon: '✉' }] : [])
    ] },
    { label: t('navAdministration'), icon: '⚙', items: [
      ...(canViewStaff ? [{ label: t('staff'), to: '/staff', icon: '♙' }] : []),
      ...(canManageAccounts ? [{ label: t('accounts'), to: '/accounts', icon: '⚙' }] : []),
      ...(user.role === 'owner_director' ? [{ label: t('subscription'), to: '/subscription', icon: '◇' }] : [])
    ] }
  ].filter((group) => group.items.length > 0);

  return (
    <div className={`app-shell ${locale === 'am' ? 'locale-am' : ''}`}>
      {mobileNavOpen && <button className="sidebar-backdrop" type="button"
        aria-label={t('closeMenu')} onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar ${mobileNavOpen ? 'is-open' : ''}`}>
        <Link className="brand" to="/">
          <span className="brand-mark">S</span>
          <span><strong>{t('brand')}</strong><small>{t('subtitle')}</small></span>
        </Link>
        <button className="sidebar-close" type="button" aria-label={t('closeMenu')}
          onClick={() => setMobileNavOpen(false)}>×</button>
        <div className="campus-label"><span className="campus-dot" />{t('campus')}</div>
        <nav className="primary-nav" aria-label={t('subtitle')}>
          {canViewDashboard && <NavLink end to="/" onClick={() => setMobileNavOpen(false)}>
            <span className="nav-icon">▦</span>{t('overview')}
          </NavLink>}
          {schoolNavGroups.map((group, index) => <SidebarNavGroup key={group.label} group={group}
            defaultOpen={index === 0} activePath={location.pathname}
            onNavigate={() => setMobileNavOpen(false)} />)}
        </nav>
        <div className="sidebar-bottom">
          <div className={`connection-status ${online ? '' : 'is-offline'}`}>
            <span className="status-dot" />{online ? t('online') : t('offline')}
            {pending > 0 && <small>{pending} {t('pendingSync')}</small>}
          </div>
          <div className="profile-mini">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <span className="profile-name"><strong>{user.name}</strong><small>{t(`role_${user.role}`)}</small></span>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-leading">
            <button className="mobile-menu-toggle" type="button" aria-label={t('openMenu')}
              aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}>☰</button>
            <div className="breadcrumbs"><span>{t('campus')}</span><span className="crumb-separator">/</span><strong>{routeTitle(location.pathname, t)}</strong></div>
          </div>
          <div className="topbar-actions">
            <PwaInstallButton t={t} />
            <div className="locale-switch" aria-label={t('language')}>
              <button className={locale === 'en' ? 'selected' : ''} onClick={() => setLocale('en')}>EN</button>
              <button className={locale === 'am' ? 'selected' : ''} onClick={() => setLocale('am')}>አማ</button>
            </div>
            {canViewCommunications && <NotificationMenu t={t} locale={locale} />}
            <span className="avatar avatar-small">{user.name.slice(0, 1)}</span>
            <button className="signout-button" onClick={onLogout} title={t('signOut')} aria-label={t('signOut')}>
              <span aria-hidden="true">↗</span><span>{t('signOut')}</span>
            </button>
          </div>
        </header>
        {!online && <div className="offline-banner">{t('offline')} · {pending} {t('pendingSync')}</div>}
        {syncNotice && <div className="sync-banner">{t('syncComplete')}</div>}
        <section className="page-content">
          <Routes>
            <Route path="/" element={canViewDashboard
              ? <DashboardPage t={t} user={user} locale={locale} />
              : <div className="empty-state">{t('noDashboardPermission')}</div>} />
            <Route path="/students" element={canViewStudents ? <StudentsPage t={t} locale={locale} canManage={canManageStudentRecords} canViewAlumni={canViewAlumni} canManageAdmissions={canManageAdmissions} canOverrideProgression={['owner_director', 'principal', 'system_admin'].includes(user.role)} canViewSensitiveData={canViewStudentSensitiveData} canManageSensitiveData={canManageStudentSensitiveData} canViewEmergencyContacts={canViewStudentSensitiveData} canManageEmergencyContacts={canManageStudentSensitiveData} canViewGuardians={canViewStudentGuardians} canViewCommendations={canViewStudentCommendations} canManageCommendations={canManageStudentCommendations} canViewDiscipline={canViewStudentDiscipline} canManageDiscipline={canManageStudentDiscipline} canApproveTransfers={canApproveStudentTransfers} /> : <Navigate to="/" replace />} />
            <Route path="/attendance" element={canViewAttendance ? <AttendancePage t={t} onQueued={setQueued} ownerId={user.id} canEditAttendance={canEditAttendance} canReviewCorrections={canReviewAttendanceCorrections} /> : <Navigate to="/" replace />} />
            <Route path="/marks" element={canViewMarks ? <MarksPage t={t} onQueued={setQueued} ownerId={user.id} canManageGrading={canManageGrading} canSubmitMarks={canSubmitMarks} canApproveMarks={canApproveMarks} canPublishMarks={canPublishMarks} canAmendMarks={canAmendMarks} locale={locale} /> : <Navigate to="/" replace />} />
            <Route path="/fees" element={canViewFees ? <FeesPage t={t} locale={locale} canManage={canManageFees} canCollect={canCollectFees} canReverse={canReverseFees} /> : <Navigate to="/" replace />} />
            <Route path="/communications" element={canViewCommunications ? <CommunicationsPage t={t} locale={locale} canManage={canManageCommunications} /> : <Navigate to="/" replace />} />
            <Route path="/timetable" element={canViewStaff ? <TimetablePage t={t} canManage={canManageAssignments} canManageLessons={['owner_director', 'principal', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'].includes(user.role)} /> : <Navigate to="/" replace />} />
            <Route path="/school" element={canViewSchoolSetup ? <SchoolPage t={t} locale={locale} /> : <Navigate to="/" replace />} />
            <Route path="/subscription" element={user.role === 'owner_director'
              ? <SchoolSubscriptionPage t={t} />
              : <Navigate to="/" replace />} />
            <Route path="/admissions" element={canViewAdmissions ? <AdmissionsPage t={t} canManage={canManageAdmissions} /> : <Navigate to="/" replace />} />
            <Route path="/staff" element={canViewStaff ? <StaffPage t={t} canManage={canManageStaff} canInviteStaff={canManageAccounts} canManageAssignments={canManageAssignments} user={user} /> : <Navigate to="/" replace />} />
            <Route path="/accounts" element={canManageAccounts ? <SchoolAccountsPage t={t} user={user} /> : <Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </section>
      </main>
    </div>
  );
}

function NotificationMenu({ t, locale }: { t: T; locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState<NotificationInbox | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setInbox(await api.notifications()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setLoading(false); }
  }, [t]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  };
  const markRead = async (notification: UserNotification) => {
    if (notification.readAt) return;
    try {
      const saved = await api.markNotificationRead(notification.id);
      setInbox((current) => current ? {
        ...current,
        items: current.items.map((item) => item.id === saved.id ? saved : item),
        unreadCount: Math.max(0, current.unreadCount - 1)
      } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const localized = (en: string, am: string) => locale === 'am' ? am : en;
  return <div className="notification-wrap">
    <button className="notification-button" aria-label={t('notifications')} aria-expanded={open} onClick={toggle}>
      ♧{Boolean(inbox?.unreadCount) && <i />}
      {Boolean(inbox?.unreadCount) && <span className="notification-count">{inbox?.unreadCount}</span>}
    </button>
    {open && <section className="notification-panel" role="dialog" aria-label={t('notifications')}>
      <div className="notification-panel-heading">
        <strong>{t('notifications')}</strong>
        <button className="button button-secondary" onClick={() => void load()} disabled={loading}>{t('refresh')}</button>
      </div>
      {error && <div className="notice notice-error">{error}</div>}
      {loading ? <div className="empty-state">{t('loading')}</div> :
        !inbox?.items.length ? <div className="empty-state">{t('noNotifications')}</div> :
          <div className="notification-list">{inbox.items.map((notification) =>
            <button
              className={`notification-row ${notification.readAt ? '' : 'is-unread'}`}
              key={notification.id}
              onClick={() => void markRead(notification)}
            >
              <span className="notification-row-title">{localized(notification.titleEn, notification.titleAm)}</span>
              {(notification.bodyEn || notification.bodyAm) &&
                <span className="notification-row-body">{localized(notification.bodyEn, notification.bodyAm)}</span>}
              <time>{new Date(notification.createdAt).toLocaleString(locale === 'am' ? 'am-ET' : 'en-ET')}</time>
            </button>)}</div>}
    </section>}
  </div>;
}

function routeTitle(path: string, t: T) {
  if (path.startsWith('/timetable')) return t('timetable');
  if (path.startsWith('/staff')) return t('staff');
  if (path.startsWith('/admissions')) return t('admissions');
  if (path.startsWith('/students')) return t('students');
  if (path.startsWith('/attendance')) return t('attendance');
  if (path.startsWith('/marks')) return t('marks');
  if (path.startsWith('/fees')) return t('fees');
  if (path.startsWith('/communications')) return t('communications');
  if (path.startsWith('/school')) return t('schoolSetup');
  return t('overview');
}

function PlatformAdminPage({ t, user, onLogout }: {
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
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [planDraft, setPlanDraft] = useState({
    code: '', name: '', description: '', monthlyPrice: '0', currencyCode: 'ETB',
    trialDays: '30', studentLimit: '100', staffLimit: '20', siteLimit: '1',
    modules: 'academic_setup, attendance, marks, fees', isActive: true
  });
  useEffect(() => { setMobileNavOpen(false); }, [location.hash]);
  const platformNavGroups: SidebarNavGroupDefinition[] = [
    { label: t('navPlatformSchools'), icon: '▣', items: [
      { label: t('schools'), to: '#platform-schools', icon: '▣' }
    ] },
    { label: t('navPlatformSubscriptions'), icon: '◇', items: [
      { label: t('planConfiguration'), to: '#platform-plans', icon: '◇' },
      { label: t('manualBilling'), to: '#platform-billing', icon: '¤' }
    ] },
    { label: t('navPlatformGovernance'), icon: '⚖', items: [
      { label: t('closureRequests'), to: '#platform-closures', icon: '⚖' }
    ] }
  ];
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

function SchoolSubscriptionPage({ t }: { t: T }) {
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [subscription, setSubscription] = useState<SchoolSubscription | null>(null);
  const [closureReason, setClosureReason] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [school, plan] = await Promise.all([api.schoolSettings(), api.schoolSubscription()]);
      setSettings(school); setSubscription(plan); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  const updateSetting = <K extends keyof OrganizationSettings>(
    key: K, value: OrganizationSettings[K]
  ) => settings && setSettings({ ...settings, [key]: value });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const updated = await api.updateSchoolSettings({
        preferredLocale: settings.preferredLocale, currencyCode: settings.currencyCode,
        branding: settings.branding
      });
      setSettings(updated); setMessage(t('settingsSaved'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const downloadExport = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const blob = await api.exportSchoolData();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `${settings?.name ?? 'school'}-data-export.json`;
      link.click(); URL.revokeObjectURL(url);
      setMessage(t('exportDownloaded')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const requestClosure = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      await api.requestSchoolClosure(closureReason);
      setClosureReason(''); setMessage(t('closureRequested')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  if (!settings) return error ? <ErrorState t={t} error={error} retry={load} /> : <div className="loading-state">{t('loading')}</div>;
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">{t('subscription')}</div><h1>{settings.name}</h1><p>{t('schoolSettingsHint')}</p></div></div>
    {error && <div className="form-error">{error}</div>}
    {message && <div className="notice notice-success">{message}</div>}
    <section className="panel">
      <div className="panel-heading"><div><h2>{t('schoolSettings')}</h2><p>{t('brandingAndLocale')}</p></div></div>
      <form className="settings-form" onSubmit={(event) => void save(event)}>
        <div className="form-grid">
          <label>{t('schoolName')}<input value={settings.name} readOnly /></label>
          <label>{t('language')}<select value={settings.preferredLocale} onChange={(e) => updateSetting('preferredLocale', e.target.value as Locale)}>
            <option value="en">{t('english')}</option><option value="am">{t('amharic')}</option>
          </select></label>
          <label>{t('currency')}<select value={settings.currencyCode} onChange={(e) => updateSetting('currencyCode', e.target.value)}>
            <option value="ETB">ETB</option><option value="USD">USD</option>
          </select></label>
          <label>{t('logoUrl')}<input type="url" value={settings.branding.logoUrl}
            onChange={(e) => updateSetting('branding', { ...settings.branding, logoUrl: e.target.value })} /></label>
          <label>{t('primaryColor')}<input type="color" value={settings.branding.primaryColor}
            onChange={(e) => updateSetting('branding', { ...settings.branding, primaryColor: e.target.value })} /></label>
        </div>
        <button className="button button-primary" disabled={busy}>{t('saveSettings')}</button>
      </form>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>{t('subscription')}</h2><p>{t('schoolSubscriptionHint')}</p></div></div>
      {subscription ? <>
        <div className="subscription-summary">
          <strong>{subscription.plan.name}</strong>
          <span>{t(`subscriptionStatus_${subscription.status}`)}</span>
          <span>{subscription.plan.monthlyPrice} {subscription.plan.currencyCode} / {t('month')}</span>
          <span>{subscription.trialEndsAt ? `${t('trialEnds')}: ${subscription.trialEndsAt.slice(0, 10)}` : ''}</span>
          <span>{t('studentLimit')}: {subscription.plan.studentLimit ?? t('unlimited')}</span>
        </div>
        <div className="invoice-list">{subscription.invoices.map((invoice) => <article className="invoice-row" key={invoice.id}>
          <div><strong>{invoice.invoiceNumber}</strong><small>{invoice.amount} {invoice.currencyCode} · {t(`invoice_${invoice.status}`)}</small></div>
          <span>{invoice.dueOn ? `${t('dueDate')}: ${invoice.dueOn}` : ''}</span>
        </article>)}</div>
      </> : <div className="empty-state">{t('noSubscription')}</div>}
    </section>
    <section className="panel closure-panel">
      <div className="panel-heading"><div><h2>{t('schoolClosure')}</h2><p>{t('closureRetentionHint')}</p></div></div>
      <button className="button button-secondary" disabled={busy} onClick={() => void downloadExport()}>{t('downloadSchoolExport')}</button>
      <form className="settings-form" onSubmit={(event) => void requestClosure(event)}>
        <label>{t('closureReason')}<textarea minLength={10} maxLength={1000} value={closureReason}
          onChange={(e) => setClosureReason(e.target.value)} required /></label>
        <button className="button button-danger" disabled={busy}>{t('requestSchoolClosure')}</button>
      </form>
    </section>
  </div>;
}

function SchoolPage({ t, locale }: { t: T; locale: Locale }) {
  const [campus, setCampus] = useState<SchoolProfile | null>(null);
  const [academicYear, setAcademicYear] = useState<AcademicYear>(null);
  const [academicYears, setAcademicYears] = useState<AcademicYearRecord[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [grades, setGrades] = useState<GradeLevel[]>([]);
  const [gradeCatalog, setGradeCatalog] = useState<GradeCatalogEntry[]>([]);
  const [curriculumGradeId, setCurriculumGradeId] = useState('');
  const [gradeSubjects, setGradeSubjects] = useState<GradeSubject[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionCapacityValues, setSectionCapacityValues] = useState<Record<string, string>>({});
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [calendarEntries, setCalendarEntries] = useState<SchoolCalendarEntry[]>([]);
  const [calendarEditId, setCalendarEditId] = useState('');
  const [curriculumUnits, setCurriculumUnits] = useState<CurriculumUnit[]>([]);
  const [curriculumUnitEditId, setCurriculumUnitEditId] = useState('');
  const [curriculumUnitAcademicYearId, setCurriculumUnitAcademicYearId] = useState('');
  const [promotionRules, setPromotionRules] = useState<PromotionRule[]>([]);
  const [form, setForm] = useState({ name: '', address: '', phone: '' });
  const [yearForm, setYearForm] = useState({ labelEc: '', startDate: '', endDate: '' });
  const [termForm, setTermForm] = useState({ name: '', periodType: 'term' as Term['periodType'], startDate: '', endDate: '' });
  const [gradeForm, setGradeForm] = useState({ code: '', nameEn: '', nameAm: '', band: 'primary', sortOrder: 1 });
  const [sectionForm, setSectionForm] = useState({
    gradeLevelId: '', name: '', capacity: '', shift: 'morning' as NonNullable<Section['shift']>,
    stream: 'natural_science' as NonNullable<Section['stream']>
  });
  const [subjectForm, setSubjectForm] = useState({ code: '', nameEn: '', nameAm: '', category: 'core' as Subject['category'] });
  const [calendarForm, setCalendarForm] = useState({
    academicYearId: null as string | null,
    entryType: 'holiday' as SchoolCalendarEntry['entryType'], titleEn: '', titleAm: '',
    startDate: '', endDate: '', isNonInstructionalDay: true, notesEn: '', notesAm: ''
  });
  const [unitForm, setUnitForm] = useState({
    subjectId: '', stream: 'all' as CurriculumUnit['stream'], unitNumber: '1',
    titleEn: '', titleAm: '', learningOutcomesEn: '', learningOutcomesAm: '',
    plannedStart: '', plannedEnd: ''
  });
  const [promotionForm, setPromotionForm] = useState({
    gradeLevelId: '', minimumAnnualPercent: '50', maximumFailedRequiredSubjects: '0'
  });
  const [gradeSubjectForm, setGradeSubjectForm] = useState({
    subjectId: '', stream: 'all' as GradeSubject['stream'], weeklyPeriods: '1'
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => Promise.all([
    api.school(), api.academicYear(), api.academicYears(), api.terms(),
    api.grades(), api.curriculumGrades(), api.sections(), api.subjects(),
    api.schoolCalendar(), api.curriculumUnits(), api.promotionRules()
  ]).then(([profile, year, years, termRows, gradeRows, catalogRows, sectionRows, subjectRows, calendarRows, unitRows, ruleRows]) => {
      setCampus(profile);
      setAcademicYear(year);
      setForm({ name: profile.name, address: profile.address, phone: profile.phone });
      setAcademicYears(years); setTerms(termRows); setGrades(gradeRows); setGradeCatalog(catalogRows);
      setSections(sectionRows); setSubjects(subjectRows);
      setSectionCapacityValues(Object.fromEntries(sectionRows.map((section) => [section.id, section.capacity == null ? '' : String(section.capacity)])));
      setCalendarEntries(calendarRows); setCurriculumUnits(unitRows); setPromotionRules(ruleRows);
      setSectionForm((current) => ({ ...current, gradeLevelId: current.gradeLevelId || gradeRows[0]?.id || '' }));
      setCurriculumGradeId((current) => current || gradeRows[0]?.id || '');
      setPromotionForm((current) => ({ ...current, gradeLevelId: current.gradeLevelId || gradeRows[0]?.id || '' }));
      setUnitForm((current) => ({ ...current, subjectId: current.subjectId || subjectRows[0]?.id || '' }));
      setGradeForm((current) => {
        const selected = catalogRows.find((item) =>
          item.code === current.code && !gradeRows.some((grade) => grade.code === item.code)) ??
          catalogRows.find((item) => !gradeRows.some((grade) => grade.code === item.code));
        return selected ? { ...selected } : current;
      });
      setGradeSubjectForm((current) => ({ ...current, subjectId: current.subjectId || subjectRows[0]?.id || '' }));
    }), []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
  useEffect(() => {
    if (!curriculumGradeId) { setGradeSubjects([]); return; }
    api.gradeSubjects(curriculumGradeId).then(setGradeSubjects)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load grade subjects.'));
  }, [curriculumGradeId]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      const updated = await api.updateSchool(form);
      setCampus(updated);
      setNotice(t('schoolSaved'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const runSetup = async (action: () => Promise<unknown>) => {
    setError(''); setNotice(''); setBusy(true);
    try {
      await action();
      await load();
      setNotice(t('setupSaved'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const saveSetup = (event: FormEvent, action: () => Promise<unknown>) => {
    event.preventDefault();
    return runSetup(action);
  };
  const selectedSectionGrade = grades.find((grade) => grade.id === sectionForm.gradeLevelId);
  const selectedCurriculumGrade = grades.find((grade) => grade.id === curriculumGradeId);
  const selectedPromotionRule = promotionRules.find((rule) => rule.gradeLevelId === promotionForm.gradeLevelId);
  const availableGradeCatalog = gradeCatalog.filter((item) => !grades.some((grade) => grade.code === item.code));
  const saveGradeSubjects = async (next: GradeSubject[]) => {
    if (!curriculumGradeId) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      const saved = await api.replaceGradeSubjects(curriculumGradeId, next.map((item) => ({
        subjectId: item.subjectId, stream: item.stream,
        weeklyPeriods: item.weeklyPeriods, isRequired: item.isRequired
      })));
      setGradeSubjects(saved);
      setNotice(t('setupSaved'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  return <>
    <div className="page-heading compact-heading"><div><div className="eyebrow">{t('activeCampus')}</div><h1>{t('schoolSetup')}</h1><p>{t('schoolProfile')}</p></div></div>
    {error && <div className="notice notice-error">{error}</div>}{notice && <div className="notice notice-success">{notice}</div>}
    <form className="panel school-profile-form" onSubmit={save}>
      <div className="school-profile">
        <div className="school-monogram">S</div><div className="school-info"><span className="eyebrow">{t('profileEdit')}</span><h2>{campus?.name ?? t('loading')}</h2><p>{campus?.timezone ?? 'Africa/Addis_Ababa'} · {t('campus')}</p><span className="status-pill">{t('activeCampus')}</span></div>
      </div>
      <div className="form-grid school-form-grid">
        <FormInput label={t('schoolProfile')} value={form.name} onChange={(name) => setForm((current) => ({ ...current, name }))} required />
        <FormInput label={t('address')} value={form.address} onChange={(address) => setForm((current) => ({ ...current, address }))} />
        <FormInput label={t('phone')} value={form.phone} onChange={(phone) => setForm((current) => ({ ...current, phone }))} />
      </div>
      <div className="form-actions"><button className="button button-primary" disabled={busy || !campus}>{busy ? t('loading') : t('saveChanges')}</button></div>
    </form>
    <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('setupAcademic')}</h2><p>{t('schoolCalendarDefaults')}</p></div></div>
      <div className="setting-row"><span><strong>{t('campusTimezone')}</strong><small>{campus?.timezone ?? 'Africa/Addis_Ababa'}</small></span><span className="setting-value">Africa/Addis_Ababa</span></div>
      <div className="setting-row"><span><strong>{t('calendar')}</strong><small>{t('ethiopian')}</small></span><span className="setting-value">{t('ethiopian')}</span></div>
      <div className="notice notice-warm">{t('academicRulesNotice')}</div>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, () => api.createAcademicYear(yearForm))}>
        <h3>{t('addAcademicYear')}</h3><div className="form-grid">
          <FormInput label={t('yearLabel')} value={yearForm.labelEc} onChange={(labelEc) => setYearForm((value) => ({ ...value, labelEc }))} required />
          <FormInput label={t('startDate')} type="date" value={yearForm.startDate} onChange={(startDate) => setYearForm((value) => ({ ...value, startDate }))} required />
          <FormInput label={t('endDate')} type="date" value={yearForm.endDate} onChange={(endDate) => setYearForm((value) => ({ ...value, endDate }))} required />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addAcademicYear')}</button></div>
      </form>
      <div className="setup-list">{academicYears.length ? academicYears.map((year) => <div className="setting-row" key={year.id}><span><strong>{year.labelEc}</strong><small>{academicDateLabel(year.startDate, locale)} – {academicDateLabel(year.endDate, locale)}</small></span>{year.status === 'active' ? <span className="status-pill">{t('current')}</span> : <button className="button button-quiet" disabled={busy} onClick={() => void runSetup(() => api.activateAcademicYear(year.id))}>{t('activateYear')}</button>}</div>) : <p className="muted">{t('noAcademicYears')}</p>}</div>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, () => api.createTerm(termForm))}>
        <h3>{t('addTerm')}</h3><div className="form-grid">
          <FormInput label={t('termName')} value={termForm.name} onChange={(name) => setTermForm((value) => ({ ...value, name }))} required />
          <label>{t('periodType')}<select value={termForm.periodType} onChange={(event) => setTermForm((value) => ({ ...value, periodType: event.target.value as Term['periodType'] }))}><option value="term">{t('term')}</option><option value="semester">{t('semester')}</option></select></label>
          <FormInput label={t('startDate')} type="date" value={termForm.startDate} onChange={(startDate) => setTermForm((value) => ({ ...value, startDate }))} required />
          <FormInput label={t('endDate')} type="date" value={termForm.endDate} onChange={(endDate) => setTermForm((value) => ({ ...value, endDate }))} required />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !academicYear}>{t('addTerm')}</button></div>
      </form>
      <div className="setup-list">{terms.length ? terms.map((term) => <div className="setting-row" key={term.id}><span><strong>{term.name}</strong><small>{academicDateLabel(term.startDate, locale)} – {academicDateLabel(term.endDate, locale)}</small></span>{term.isCurrent ? <span className="status-pill">{t('current')}</span> : term.academicYearId === academicYear?.id && <button className="button button-quiet" disabled={busy} onClick={() => void runSetup(() => api.setCurrentTerm(term.id))}>{t('setCurrentTerm')}</button>}</div>) : <p className="muted">{t('noTerms')}</p>}</div>
      <form className="setup-form" onSubmit={(event) => {
        event.preventDefault();
        void runSetup(async () => {
          const entry = {
            ...calendarForm,
            academicYearId: calendarEditId ? calendarForm.academicYearId : academicYear?.id ?? null
          };
          if (calendarEditId) await api.updateCalendarEntry(calendarEditId, entry);
          else await api.createCalendarEntry(entry);
          setCalendarEditId('');
          setCalendarForm({
            academicYearId: null, entryType: 'holiday', titleEn: '', titleAm: '', startDate: '', endDate: '',
            isNonInstructionalDay: true, notesEn: '', notesAm: ''
          });
        });
      }}>
        <h3>{calendarEditId ? t('editCalendarEntry') : t('addCalendarEntry')}</h3><div className="form-grid">
          <label>{t('calendarEntryType')}<select value={calendarForm.entryType} onChange={(event) => setCalendarForm((value) => ({ ...value, entryType: event.target.value as SchoolCalendarEntry['entryType'] }))}>
            <option value="holiday">{t('holiday')}</option><option value="event">{t('event')}</option>
            <option value="exam">{t('exam')}</option><option value="closure">{t('closure')}</option>
          </select></label>
          <FormInput label={t('titleEnglish')} value={calendarForm.titleEn} onChange={(titleEn) => setCalendarForm((value) => ({ ...value, titleEn }))} required />
          <FormInput label={t('titleAmharic')} value={calendarForm.titleAm} onChange={(titleAm) => setCalendarForm((value) => ({ ...value, titleAm }))} required />
          <FormInput label={t('startDate')} type="date" value={calendarForm.startDate} onChange={(startDate) => setCalendarForm((value) => ({ ...value, startDate }))} required />
          <FormInput label={t('endDate')} type="date" value={calendarForm.endDate} onChange={(endDate) => setCalendarForm((value) => ({ ...value, endDate }))} required />
          <label><span>{t('nonInstructionalDay')}</span><input type="checkbox" checked={calendarForm.isNonInstructionalDay} onChange={(event) => setCalendarForm((value) => ({ ...value, isNonInstructionalDay: event.target.checked }))} /></label>
          <FormInput label={t('notesEnglish')} value={calendarForm.notesEn} onChange={(notesEn) => setCalendarForm((value) => ({ ...value, notesEn }))} />
          <FormInput label={t('notesAmharic')} value={calendarForm.notesAm} onChange={(notesAm) => setCalendarForm((value) => ({ ...value, notesAm }))} />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy}>{calendarEditId ? t('saveChanges') : t('addCalendarEntry')}</button>{calendarEditId && <button type="button" className="button button-quiet" onClick={() => {
          setCalendarEditId('');
          setCalendarForm({
            academicYearId: null, entryType: 'holiday', titleEn: '', titleAm: '', startDate: '', endDate: '',
            isNonInstructionalDay: true, notesEn: '', notesAm: ''
          });
        }}>{t('cancel')}</button>}</div>
      </form>
      <div className="setup-list">{calendarEntries.length ? calendarEntries.map((entry) => <div className="setting-row" key={entry.id}>
        <span><strong>{entry.titleEn} · {entry.titleAm}</strong><small>{t(entry.entryType)} · {academicDateLabel(entry.startDate, locale)} – {academicDateLabel(entry.endDate, locale)}</small></span>
        <div className="form-actions">
          <button type="button" className="button button-quiet" disabled={busy} onClick={() => {
            setCalendarEditId(entry.id);
            setCalendarForm({
              academicYearId: entry.academicYearId, entryType: entry.entryType,
              titleEn: entry.titleEn, titleAm: entry.titleAm,
              startDate: entry.startDate, endDate: entry.endDate,
              isNonInstructionalDay: entry.isNonInstructionalDay,
              notesEn: entry.notesEn, notesAm: entry.notesAm
            });
          }}>{t('editEntry')}</button>
          <button type="button" className="button button-quiet" disabled={busy} onClick={() => void runSetup(() => api.deleteCalendarEntry(entry.id))}>{t('remove')}</button>
        </div>
      </div>) : <p className="muted">{t('noCalendarEntries')}</p>}</div>
      <div className="notice notice-warm">{t('editableCurriculumNotice')}</div>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, async () => {
        const created = await api.createGrade({ code: gradeForm.code });
        setCurriculumGradeId(created.id);
      })}>
        <h3>{t('addGrade')}</h3><div className="form-grid">
          <label>{t('gradeCode')}<select required value={gradeForm.code} onChange={(event) => {
            const next = gradeCatalog.find((item) => item.code === event.target.value);
            if (next) setGradeForm(next);
          }}>
            {availableGradeCatalog.map((item) => <option key={item.code} value={item.code}>{item.nameEn} · {item.nameAm}</option>)}
          </select></label>
          {gradeForm.code && <p className="muted">{gradeForm.nameEn} · {gradeForm.nameAm} · {gradeForm.band}</p>}
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !availableGradeCatalog.length}>{t('addGrade')}</button></div>
      </form>
      <div className="setup-list">{grades.length ? grades.map((grade) => <div className="setting-row" key={grade.id}><span><strong>{grade.nameEn} · {grade.nameAm}</strong><small>{grade.code} · {grade.band}</small></span></div>) : <p className="muted">{t('noGrades')}</p>}</div>
      <section className="setup-form">
        <h3>{t('gradeSubjects')}</h3><p className="muted">{t('gradeSubjectsHint')}</p>
        <div className="form-grid">
          <label>{t('grades')}<select value={curriculumGradeId} onChange={(event) => setCurriculumGradeId(event.target.value)}><option value="">{t('chooseGrade')}</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.nameEn}</option>)}</select></label>
          {selectedCurriculumGrade && (selectedCurriculumGrade.code === 'G11' || selectedCurriculumGrade.code === 'G12') &&
            <label>{t('stream')}<select value={gradeSubjectForm.stream === 'all' ? 'natural_science' : gradeSubjectForm.stream}
              onChange={(event) => setGradeSubjectForm((current) => ({ ...current, stream: event.target.value as GradeSubject['stream'] }))}>
              <option value="natural_science">{t('naturalScience')}</option><option value="social_science">{t('socialScience')}</option>
            </select></label>}
        </div>
        {gradeSubjects.length > 0 && <div className="setup-list">{gradeSubjects.map((item) => <div className="setting-row" key={item.id}>
          <span><strong>{item.nameEn} · {item.nameAm}</strong><small>{item.code} · {item.stream === 'all' ? t('allStreams') : t(item.stream === 'natural_science' ? 'naturalScience' : 'socialScience')}</small></span>
          <div className="form-actions">
            <label>{t('weeklyPeriods')}<input aria-label={`${item.nameEn} ${t('weeklyPeriods')}`} type="number" min="1" max="60"
              value={item.weeklyPeriods} onChange={(event) => setGradeSubjects((current) => current.map((row) =>
                row.id === item.id ? { ...row, weeklyPeriods: Number(event.target.value) } : row))} /></label>
            <button type="button" className="button button-quiet" disabled={busy} onClick={() =>
              void saveGradeSubjects(gradeSubjects.filter((row) => row.id !== item.id))}>{t('remove')}</button>
          </div>
        </div>)}</div>}
        {selectedCurriculumGrade && <form className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          const subject = subjects.find((item) => item.id === gradeSubjectForm.subjectId);
          if (!subject) return;
          const next: GradeSubject = {
            ...subject, id: `${subject.id}-${gradeSubjectForm.stream}`, gradeLevelId: curriculumGradeId,
            subjectId: subject.id, stream: gradeSubjectForm.stream,
            weeklyPeriods: Number(gradeSubjectForm.weeklyPeriods), isRequired: true
          };
          void saveGradeSubjects([...gradeSubjects, next]);
        }}>
          <label>{t('addSubject')}<select required value={gradeSubjectForm.subjectId} onChange={(event) =>
            setGradeSubjectForm((current) => ({ ...current, subjectId: event.target.value }))}>
            <option value="">{t('chooseSubject')}</option>{subjects.filter((subject) =>
              !gradeSubjects.some((item) => item.subjectId === subject.id && item.stream === gradeSubjectForm.stream))
              .map((subject) => <option key={subject.id} value={subject.id}>{subject.nameEn}</option>)}
          </select></label>
          <FormInput label={t('weeklyPeriods')} type="number" value={gradeSubjectForm.weeklyPeriods}
            onChange={(weeklyPeriods) => setGradeSubjectForm((current) => ({ ...current, weeklyPeriods }))} required />
          <button className="button button-secondary" disabled={busy || !gradeSubjectForm.subjectId}>{t('addSubject')}</button>
          <button type="button" className="button button-primary" disabled={busy || !gradeSubjects.length}
            onClick={() => void saveGradeSubjects(gradeSubjects)}>{t('saveChanges')}</button>
        </form>}
      </section>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, () => {
        const academicYearId = curriculumUnitEditId
          ? curriculumUnitAcademicYearId
          : academicYear?.id ?? '';
        if (!academicYearId || !curriculumGradeId) throw new Error(t('activeYearRequired'));
        const unit = {
          academicYearId, gradeLevelId: curriculumGradeId,
          subjectId: unitForm.subjectId, stream: unitForm.stream,
          unitNumber: Number(unitForm.unitNumber), titleEn: unitForm.titleEn, titleAm: unitForm.titleAm,
          learningOutcomesEn: unitForm.learningOutcomesEn, learningOutcomesAm: unitForm.learningOutcomesAm,
          plannedStart: unitForm.plannedStart || null, plannedEnd: unitForm.plannedEnd || null
        };
        return (curriculumUnitEditId
          ? api.updateCurriculumUnit(curriculumUnitEditId, unit)
          : api.createCurriculumUnit(unit)).then((result) => {
          setCurriculumUnitEditId('');
          setCurriculumUnitAcademicYearId('');
          setUnitForm({
            subjectId: subjects[0]?.id ?? '', stream: 'all', unitNumber: '1',
            titleEn: '', titleAm: '', learningOutcomesEn: '', learningOutcomesAm: '',
            plannedStart: '', plannedEnd: ''
          });
          return result;
        });
      })}>
        <h3>{curriculumUnitEditId ? t('editCurriculumUnit') : t('curriculumSyllabus')}</h3><div className="form-grid">
          <label>{t('grades')}<select required value={curriculumGradeId} onChange={(event) => setCurriculumGradeId(event.target.value)}><option value="">{t('chooseGrade')}</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.nameEn} · {grade.nameAm}</option>)}</select></label>
          <label>{t('subject')}<select required value={unitForm.subjectId} onChange={(event) => setUnitForm((value) => ({ ...value, subjectId: event.target.value }))}><option value="">{t('chooseSubject')}</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.nameEn} · {subject.nameAm}</option>)}</select></label>
          <label>{t('stream')}<select value={unitForm.stream} onChange={(event) => setUnitForm((value) => ({ ...value, stream: event.target.value as CurriculumUnit['stream'] }))}><option value="all">{t('allStreams')}</option><option value="natural_science">{t('naturalScience')}</option><option value="social_science">{t('socialScience')}</option></select></label>
          <FormInput label={t('unitNumber')} type="number" value={unitForm.unitNumber} onChange={(unitNumber) => setUnitForm((value) => ({ ...value, unitNumber }))} required />
          <FormInput label={t('titleEnglish')} value={unitForm.titleEn} onChange={(titleEn) => setUnitForm((value) => ({ ...value, titleEn }))} required />
          <FormInput label={t('titleAmharic')} value={unitForm.titleAm} onChange={(titleAm) => setUnitForm((value) => ({ ...value, titleAm }))} required />
          <FormInput label={t('learningOutcomesEnglish')} value={unitForm.learningOutcomesEn} onChange={(learningOutcomesEn) => setUnitForm((value) => ({ ...value, learningOutcomesEn }))} />
          <FormInput label={t('learningOutcomesAmharic')} value={unitForm.learningOutcomesAm} onChange={(learningOutcomesAm) => setUnitForm((value) => ({ ...value, learningOutcomesAm }))} />
          <FormInput label={t('plannedStart')} type="date" value={unitForm.plannedStart} onChange={(plannedStart) => setUnitForm((value) => ({ ...value, plannedStart }))} />
          <FormInput label={t('plannedEnd')} type="date" value={unitForm.plannedEnd} onChange={(plannedEnd) => setUnitForm((value) => ({ ...value, plannedEnd }))} />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || (!academicYear && !curriculumUnitEditId) || !curriculumGradeId || !unitForm.subjectId}>{curriculumUnitEditId ? t('saveChanges') : t('addCurriculumUnit')}</button>{curriculumUnitEditId && <button type="button" className="button button-quiet" onClick={() => {
          setCurriculumUnitEditId('');
          setCurriculumUnitAcademicYearId('');
          setUnitForm({
            subjectId: subjects[0]?.id ?? '', stream: 'all', unitNumber: '1',
            titleEn: '', titleAm: '', learningOutcomesEn: '', learningOutcomesAm: '',
            plannedStart: '', plannedEnd: ''
          });
        }}>{t('cancel')}</button>}</div>
      </form>
      <div className="setup-list">{curriculumUnits.filter((unit) => unit.gradeLevelId === curriculumGradeId).map((unit) => <div className="setting-row" key={unit.id}>
        <span><strong>{unit.unitNumber}. {unit.titleEn} · {unit.titleAm}</strong><small>{unit.subjectName} · {unit.plannedStart ?? ''}{unit.plannedEnd ? ` – ${unit.plannedEnd}` : ''}</small></span>
        <div className="form-actions">
          <button type="button" className="button button-quiet" disabled={busy} onClick={() => {
            setCurriculumUnitEditId(unit.id);
            setCurriculumUnitAcademicYearId(unit.academicYearId);
            setCurriculumGradeId(unit.gradeLevelId);
            setUnitForm({
              subjectId: unit.subjectId, stream: unit.stream, unitNumber: String(unit.unitNumber),
              titleEn: unit.titleEn, titleAm: unit.titleAm,
              learningOutcomesEn: unit.learningOutcomesEn, learningOutcomesAm: unit.learningOutcomesAm,
              plannedStart: unit.plannedStart ?? '', plannedEnd: unit.plannedEnd ?? ''
            });
          }}>{t('editEntry')}</button>
          <button type="button" className="button button-quiet" disabled={busy} onClick={() => void runSetup(() => api.deleteCurriculumUnit(unit.id))}>{t('remove')}</button>
        </div>
      </div>)}</div>
      <form className="setup-form" onSubmit={(event) => {
        event.preventDefault();
        if (!promotionForm.gradeLevelId) return;
        void runSetup(() => api.savePromotionRule(promotionForm.gradeLevelId, {
          minimumAnnualPercent: Number(promotionForm.minimumAnnualPercent),
          maximumFailedRequiredSubjects: Number(promotionForm.maximumFailedRequiredSubjects)
        }));
      }}>
        <h3>{t('promotionRules')}</h3><p className="muted">{t('promotionRuleNotice')}</p><div className="form-grid">
          <label>{t('grades')}<select required value={promotionForm.gradeLevelId} onChange={(event) => {
            const gradeLevelId = event.target.value;
            const existing = promotionRules.find((rule) => rule.gradeLevelId === gradeLevelId);
            setPromotionForm({ gradeLevelId, minimumAnnualPercent: String(existing?.minimumAnnualPercent ?? 50), maximumFailedRequiredSubjects: String(existing?.maximumFailedRequiredSubjects ?? 0) });
          }}><option value="">{t('chooseGrade')}</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.nameEn} · {grade.nameAm}</option>)}</select></label>
          <FormInput label={t('minimumAnnualPercent')} type="number" value={promotionForm.minimumAnnualPercent} onChange={(minimumAnnualPercent) => setPromotionForm((value) => ({ ...value, minimumAnnualPercent }))} required />
          <FormInput label={t('maximumFailedSubjects')} type="number" value={promotionForm.maximumFailedRequiredSubjects} onChange={(maximumFailedRequiredSubjects) => setPromotionForm((value) => ({ ...value, maximumFailedRequiredSubjects }))} required />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !academicYear || !promotionForm.gradeLevelId}>{t(selectedPromotionRule ? 'saveChanges' : 'savePromotionRule')}</button></div>
      </form>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, () => api.createSection({
        ...sectionForm, capacity: sectionForm.capacity ? Number(sectionForm.capacity) : null,
        stream: selectedSectionGrade?.code === 'G11' || selectedSectionGrade?.code === 'G12' ? sectionForm.stream : undefined
      }))}>
        <h3>{t('addSection')}</h3><div className="form-grid">
          <label>{t('grades')}<select required value={sectionForm.gradeLevelId} onChange={(event) => setSectionForm((value) => ({ ...value, gradeLevelId: event.target.value }))}>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.nameEn}</option>)}</select></label>
          {selectedSectionGrade && (selectedSectionGrade.code === 'G11' || selectedSectionGrade.code === 'G12') &&
            <label>{t('stream')}<select value={sectionForm.stream} onChange={(event) => setSectionForm((value) => ({ ...value, stream: event.target.value as NonNullable<Section['stream']> }))}>
              <option value="natural_science">{t('naturalScience')}</option><option value="social_science">{t('socialScience')}</option>
            </select></label>}
          <FormInput label={t('sectionName')} value={sectionForm.name} onChange={(name) => setSectionForm((value) => ({ ...value, name }))} required />
          <FormInput label={t('capacity')} type="number" value={sectionForm.capacity} onChange={(capacity) => setSectionForm((value) => ({ ...value, capacity }))} />
          <label>{t('shift')}<select value={sectionForm.shift} onChange={(event) => setSectionForm((value) => ({ ...value, shift: event.target.value as NonNullable<Section['shift']> }))}><option value="morning">{t('morning')}</option><option value="afternoon">{t('afternoon')}</option><option value="evening">{t('evening')}</option></select></label>
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !academicYear || !grades.length}>{t('addSection')}</button></div>
      </form>
      <div className="setup-list">{sections.length ? sections.map((section) => <form className="setting-row" key={section.id} onSubmit={(event) => {
        event.preventDefault();
        const value = sectionCapacityValues[section.id] ?? '';
        void runSetup(() => api.updateSectionCapacity(section.id, value ? Number(value) : null));
      }}><span><strong>{section.gradeName} · {section.name}</strong><small>{t(section.shift ?? 'morning')}{section.stream ? ` · ${t(section.stream === 'natural_science' ? 'naturalScience' : 'socialScience')}` : ''}</small></span>
        <div className="form-actions"><label>{t('capacity')}<input type="number" min="1" max="1000" value={sectionCapacityValues[section.id] ?? ''} onChange={(event) => setSectionCapacityValues((value) => ({ ...value, [section.id]: event.target.value }))} /></label>
          <button className="button button-quiet" disabled={busy}>{t('saveChanges')}</button></div>
      </form>) : <p className="muted">{t('noSections')}</p>}</div>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, () => api.createSubject(subjectForm))}>
        <h3>{t('addSubject')}</h3><div className="form-grid">
          <FormInput label={t('subjectCode')} value={subjectForm.code} onChange={(code) => setSubjectForm((value) => ({ ...value, code }))} required />
          <FormInput label={t('subjectNameEn')} value={subjectForm.nameEn} onChange={(nameEn) => setSubjectForm((value) => ({ ...value, nameEn }))} required />
          <FormInput label={t('subjectNameAm')} value={subjectForm.nameAm} onChange={(nameAm) => setSubjectForm((value) => ({ ...value, nameAm }))} required />
          <label>{t('subjectCategory')}<select value={subjectForm.category} onChange={(event) => setSubjectForm((value) => ({ ...value, category: event.target.value as Subject['category'] }))}>
            {['core', 'language', 'mathematics', 'science', 'social_science', 'arts', 'health', 'technology', 'other'].map((category) => <option key={category} value={category}>{t(`subjectCategory_${category}`)}</option>)}
          </select></label>
        </div><div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addSubject')}</button></div>
      </form>
      <div className="setup-list">{subjects.length ? subjects.map((subject) => <div className="setting-row" key={subject.id}><span><strong>{subject.nameEn} · {subject.nameAm}</strong><small>{subject.code}</small></span></div>) : <p className="muted">{t('noSubjects')}</p>}</div>
    </section>
  </>;
}

function StaffInvitationForm({ t, user }: { t: T; user: User }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffId, setStaffId] = useState('');
  const [email, setEmail] = useState('');
  const [invitationRole, setInvitationRole] = useState<StaffInvitationRole>(
    staffInvitationRolesByRole[user.role]?.includes('subject_teacher')
      ? 'subject_teacher' : staffInvitationRolesByRole[user.role]?.[0] ?? 'subject_teacher'
  );
  const [invitationUrl, setInvitationUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const allowedRoles = staffInvitationRolesByRole[user.role] ?? [];
  const eligibleStaff = staff.filter((item) =>
    !item.userId && item.employmentStatus !== 'terminated');
  useEffect(() => {
    let active = true;
    api.staff().then((rows) => { if (active) setStaff(rows); })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : t('apiError'));
      })
      .finally(() => { if (active) setStaffLoading(false); });
    return () => { active = false; };
  }, [t]);
  useEffect(() => {
    if (allowedRoles.length && !allowedRoles.includes(invitationRole)) {
      setInvitationRole(allowedRoles[0]);
    }
  }, [allowedRoles, invitationRole]);
  const createInvitation = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setNotice(''); setInvitationUrl(''); setBusy(true);
    try {
      const invitation = await api.createAccountInvitation({
        targetType: 'staff', targetId: staffId, email, role: invitationRole
      });
      setInvitationUrl(invitation.invitationUrl);
      setNotice(t('inviteCreated'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  return <section className="panel settings-panel">
    <div className="panel-heading"><div><h2>{t('staffAccount')}</h2><p>{t('invitationLinkHint')}</p></div></div>
    <form onSubmit={(event) => void createInvitation(event)}>
      <div className="form-grid">
        <label>{t('selectStaffAccount')}<select required value={staffId}
          disabled={staffLoading || busy || !eligibleStaff.length}
          onChange={(event) => setStaffId(event.target.value)}>
          <option value="">{t('selectStaffAccount')}</option>
          {eligibleStaff.map((item) =>
            <option key={item.id} value={item.id}>{item.name} · {item.jobTitle}</option>)}
        </select></label>
        <label>{t('accountRole')}<select value={invitationRole}
          disabled={busy || !allowedRoles.length}
          onChange={(event) => setInvitationRole(event.target.value as StaffInvitationRole)}>
          {allowedRoles.map((role) =>
            <option key={role} value={role}>{t(`role_${role}`)}</option>)}
        </select></label>
        <FormInput label={t('invitationEmail')} type="email" value={email}
          onChange={setEmail} required />
      </div>
      {notice && <div className="notice notice-success" role="status">{notice}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="form-actions"><button className="button button-primary"
        disabled={busy || staffLoading || !staffId || !allowedRoles.length}>
        {busy ? t('loading') : t('createAccount')}
      </button></div>
    </form>
    {invitationUrl && <InvitationLinkField value={invitationUrl} t={t} />}
  </section>;
}

function SchoolAccountsPage({ t, user }: { t: T; user: User }) {
  const [accounts, setAccounts] = useState<SchoolAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setError('');
      setAccounts(await api.accounts());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (account: SchoolAccount) => {
    if (account.isActive && !window.confirm(t('confirmDeactivateAccount'))) return;
    setBusyId(account.id);
    setError('');
    try {
      const updated = await api.setAccountActive(account.id, !account.isActive);
      setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusyId(''); }
  };
  return <section className="page-section">
    <header className="section-heading"><div><span className="eyebrow">{t('schoolSetup')}</span>
      <h1>{t('accounts')}</h1><p className="muted">{t('accountManagementHint')}</p></div>
      <button className="button button-quiet" onClick={() => void load()}>{t('refresh')}</button>
    </header>
    {error && <div className="form-error" role="alert">{error}</div>}
    <StaffInvitationForm t={t} user={user} />
    {loading ? <div className="loading-state">{t('loading')}</div> :
      <div className="account-list">{accounts.map((account) => <article className="account-row" key={account.id}>
        <div><strong>{account.name}</strong><span>{account.email || t('noEmail')}</span></div>
        <div><span className="account-role">{account.role.replaceAll('_', ' ')}</span>
          <span className={`status-pill ${account.isActive ? '' : 'status-inactive'}`}>
            {account.isActive ? t('active') : t('inactive')}
          </span></div>
        <button className={account.isActive ? 'button button-quiet' : 'button button-primary'}
          disabled={busyId === account.id || account.id === user.id}
          onClick={() => void toggle(account)}>
          {busyId === account.id ? t('loading') : account.isActive ? t('deactivateAccount') : t('activateAccount')}
        </button>
      </article>)}
      {!accounts.length && <p className="muted">{t('noAccounts')}</p>}</div>}
  </section>;
}

function StaffPage({ t, canManage, canInviteStaff, canManageAssignments, user }: {
  t: T; canManage: boolean; canInviteStaff: boolean; canManageAssignments: boolean; user: User
}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [assignmentSubjects, setAssignmentSubjects] = useState<Subject[]>([]);
  const [periods, setPeriods] = useState<TimetablePeriod[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [attendance, setAttendance] = useState<StaffAttendance[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [messages, setMessages] = useState<StaffMessage[]>([]);
  const [departmentName, setDepartmentName] = useState('');
  const [departmentDescription, setDepartmentDescription] = useState('');
  const [staffForm, setStaffForm] = useState({
    departmentId: '', givenNameEn: '', fatherNameEn: '', grandfatherNameEn: '',
    givenNameAm: '', fatherNameAm: '', grandfatherNameAm: '', jobTitle: '',
    qualification: '', employmentStatus: 'active', hiredOn: ''
  });
  const [assignmentForm, setAssignmentForm] = useState({
    staffId: '', sectionId: '', subjectId: '', dayOfWeek: '', periodNumber: '', roomId: ''
  });
  const [homeroomForm, setHomeroomForm] = useState({ sectionId: '', staffId: '' });
  const [attendanceForm, setAttendanceForm] = useState({ staffId: '', date: new Date().toISOString().slice(0, 10), status: 'present', clockIn: '', clockOut: '' });
  const [leaveForm, setLeaveForm] = useState({ staffId: '', startDate: '', endDate: '', reason: '' });
  const [messageForm, setMessageForm] = useState({ departmentId: '', type: 'announcement' as 'handover' | 'announcement', title: '', body: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => Promise.all([
    api.departments(), api.staff(), api.sections(), api.subjects(), api.timetablePeriods(), api.rooms(),
    api.teachingAssignments(), api.staffAttendance(), api.leaveRequests(), api.staffMessages()
  ]).then(([departmentRows, staffRows, sectionRows, subjectRows, periodRows, roomRows, assignmentRows, attendanceRows, leaveRows, messageRows]) => {
    setDepartments(departmentRows); setStaff(staffRows); setSections(sectionRows); setSubjects(subjectRows);
    setPeriods(periodRows); setRooms(roomRows);
    setAssignments(assignmentRows); setAttendance(attendanceRows); setLeaveRequests(leaveRows); setMessages(messageRows);
    setStaffForm((current) => ({ ...current, departmentId: current.departmentId || departmentRows[0]?.id || '' }));
    setAssignmentForm((current) => ({
      ...current, staffId: current.staffId || staffRows[0]?.id || '',
      sectionId: current.sectionId || sectionRows[0]?.id || '',
      subjectId: current.subjectId || subjectRows[0]?.id || ''
    }));
    setHomeroomForm((current) => ({
      ...current, staffId: current.staffId || staffRows[0]?.id || '',
      sectionId: current.sectionId || sectionRows[0]?.id || ''
    }));
    setAttendanceForm((current) => ({ ...current, staffId: current.staffId || staffRows[0]?.id || '' }));
    setLeaveForm((current) => ({ ...current, staffId: current.staffId || staffRows[0]?.id || '' }));
    setMessageForm((current) => ({ ...current, departmentId: current.departmentId || departmentRows[0]?.id || '' }));
  }), []);
  useEffect(() => { load().catch((reason) => setError(reason.message)); }, [load]);
  useEffect(() => {
    const section = sections.find((item) => item.id === assignmentForm.sectionId);
    const request: Promise<Subject[]> = section?.gradeLevelId
      ? api.gradeSubjects(section.gradeLevelId, section.stream).then((rows) => rows.map((item) => ({
        id: item.subjectId, campusId: item.campusId, code: item.code,
        nameEn: item.nameEn, nameAm: item.nameAm, category: item.category
      })))
      : Promise.resolve(subjects);
    request.then((rows) => {
      setAssignmentSubjects(rows);
      setAssignmentForm((current) => ({
        ...current,
        subjectId: rows.some((item) => item.id === current.subjectId)
          ? current.subjectId : rows[0]?.id ?? ''
      }));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load grade subjects.'));
  }, [sections, subjects, assignmentForm.sectionId]);
  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setError(''); setNotice(''); setBusy(true);
    try { await action(); await load(); setNotice(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent, action: () => Promise<unknown>, success: string) => {
    event.preventDefault();
    return runAction(action, success);
  };
  const downloadCsv = async () => {
    setError('');
    try {
      const blob = await api.downloadStaffAttendanceCsv();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'staff-attendance.csv'; link.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const statusLabel = (status: string) => ({
    active: t('activeEmployment'), on_leave: t('onLeave'), terminated: t('terminated'),
    pending: t('pending'), approved: t('approved'), rejected: t('rejected')
  }[status] ?? status);
  const formatStaff = (item: StaffMember) => `${item.name} · ${item.jobTitle}`;
  const managePerson = canManage && staff.length > 0;
  const selfStaff = staff.find((item) => item.userId === user.id);
  const assignmentShift = sections.find((item) => item.id === assignmentForm.sectionId)?.shift ?? 'morning';
  const assignmentPeriods = periods.filter((item) => item.shift === assignmentShift);
  return <>
    <div className="page-heading compact-heading"><div><div className="eyebrow">{t('staff')}</div><h1>{t('staffManagement')}</h1><p>{t('staffProfile')}</p></div></div>
    {notice && <div className="notice notice-success">{notice}</div>}{error && <div className="notice notice-error">{error}</div>}
    {canManage && <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('addDepartment')}</h2></div></div>
      <form className="form-grid" onSubmit={(event) => void submit(event, () =>
        api.createDepartment({ name: departmentName, description: departmentDescription }), t('setupSaved'))}>
        <FormInput label={t('departmentName')} value={departmentName} onChange={setDepartmentName} required />
        <FormInput label={t('qualification')} value={departmentDescription} onChange={setDepartmentDescription} />
        <div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addDepartment')}</button></div>
      </form>
      <div className="setup-list">{departments.map((department) => <div className="setting-row" key={department.id}><strong>{department.name}</strong><small>{department.description}</small></div>)}</div>
    </section>}
    {canManage && <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('addStaff')}</h2><p>{t('staffProfile')}</p></div></div>
      <form onSubmit={(event) => void submit(event, () => api.createStaff({
        ...staffForm, departmentId: staffForm.departmentId || null, userId: null,
        hiredOn: staffForm.hiredOn || null
      }), t('staffSaved'))}>
        <div className="form-grid">
          <FormInput label={t('givenNameStaffEn')} value={staffForm.givenNameEn} onChange={(givenNameEn) => setStaffForm((current) => ({ ...current, givenNameEn }))} required />
          <FormInput label={t('fatherNameStaffEn')} value={staffForm.fatherNameEn} onChange={(fatherNameEn) => setStaffForm((current) => ({ ...current, fatherNameEn }))} required />
          <FormInput label={t('grandfatherNameStaffEn')} value={staffForm.grandfatherNameEn} onChange={(grandfatherNameEn) => setStaffForm((current) => ({ ...current, grandfatherNameEn }))} required />
          <FormInput label={t('givenNameStaffAm')} value={staffForm.givenNameAm} onChange={(givenNameAm) => setStaffForm((current) => ({ ...current, givenNameAm }))} required />
          <FormInput label={t('fatherNameStaffAm')} value={staffForm.fatherNameAm} onChange={(fatherNameAm) => setStaffForm((current) => ({ ...current, fatherNameAm }))} required />
          <FormInput label={t('grandfatherNameStaffAm')} value={staffForm.grandfatherNameAm} onChange={(grandfatherNameAm) => setStaffForm((current) => ({ ...current, grandfatherNameAm }))} required />
          <FormInput label={t('jobTitle')} value={staffForm.jobTitle} onChange={(jobTitle) => setStaffForm((current) => ({ ...current, jobTitle }))} required />
          <FormInput label={t('qualification')} value={staffForm.qualification} onChange={(qualification) => setStaffForm((current) => ({ ...current, qualification }))} />
          <label>{t('department')}<select value={staffForm.departmentId} onChange={(event) => setStaffForm((current) => ({ ...current, departmentId: event.target.value }))}><option value="">{t('noDepartment')}</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label>{t('employmentStatus')}<select value={staffForm.employmentStatus} onChange={(event) => setStaffForm((current) => ({ ...current, employmentStatus: event.target.value }))}><option value="active">{t('activeEmployment')}</option><option value="on_leave">{t('onLeave')}</option><option value="terminated">{t('terminated')}</option></select></label>
          <FormInput label={t('hiredOn')} type="date" value={staffForm.hiredOn} onChange={(hiredOn) => setStaffForm((current) => ({ ...current, hiredOn }))} />
        </div>
        <div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addStaff')}</button></div>
      </form>
    </section>}
    {canInviteStaff && <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('staffAccount')}</h2><p>{t('invitationLinkHint')}</p></div></div>
      <StaffInvitationForm t={t} user={user} />
    </section>}
    <section className="panel history-panel">
      <div className="panel-heading"><div><h2>{t('staff')}</h2><p>{staff.length} {t('records')}</p></div></div>
      {staff.length ? staff.map((item) => <div className="history-row" key={item.id}><span className="history-icon">♙</span><span><strong>{formatStaff(item)}</strong><small>{item.departmentName || t('noDepartment')} · {item.qualification || '—'}</small></span><span className="status-pill">{statusLabel(item.employmentStatus)} · {item.teachingAssignmentCount} {t('workload')}</span></div>) : <div className="empty-state">{t('noStaff')}</div>}
    </section>
    {canManageAssignments && <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('teacherAssignments')}</h2></div></div>
      <form onSubmit={(event) => void submit(event, () => api.createTeachingAssignment({
        ...assignmentForm, dayOfWeek: assignmentForm.dayOfWeek ? Number(assignmentForm.dayOfWeek) : null,
        periodNumber: assignmentForm.periodNumber ? Number(assignmentForm.periodNumber) : null,
        roomId: assignmentForm.roomId || null
      }), t('assignmentSaved'))}>
        <div className="form-grid">
          <label>{t('teacher')}<select required value={assignmentForm.staffId} onChange={(event) => setAssignmentForm((current) => ({ ...current, staffId: event.target.value }))}>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>{t('sections')}<select required value={assignmentForm.sectionId} onChange={(event) => setAssignmentForm((current) => ({ ...current, sectionId: event.target.value, periodNumber: '' }))}>{sections.map((item) => <option key={item.id} value={item.id}>{item.gradeName} · {item.name}</option>)}</select></label>
          <label>{t('subject')}<select required value={assignmentForm.subjectId} onChange={(event) => setAssignmentForm((current) => ({ ...current, subjectId: event.target.value }))}>{assignmentSubjects.map((item) => <option key={item.id} value={item.id}>{item.nameEn}</option>)}</select></label>
          <label>{t('timetableDay')}<select value={assignmentForm.dayOfWeek} onChange={(event) => setAssignmentForm((current) => ({ ...current, dayOfWeek: event.target.value, periodNumber: '' }))}><option value="">{t('unscheduled')}</option>{[1, 2, 3, 4, 5, 6, 7].map((day) => <option key={day} value={day}>{t(['', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][day])}</option>)}</select></label>
          <label>{t('periodNumber')}<select required={Boolean(assignmentForm.dayOfWeek)} value={assignmentForm.periodNumber} onChange={(event) => setAssignmentForm((current) => ({ ...current, periodNumber: event.target.value }))}><option value="">{assignmentForm.dayOfWeek ? t('choosePeriod') : t('unscheduled')}</option>{assignmentPeriods.map((period) => <option key={period.id} value={period.periodNumber}>{period.periodNumber} · {period.startsAt}–{period.endsAt}</option>)}</select></label>
          <label>{t('room')}<select value={assignmentForm.roomId} onChange={(event) => setAssignmentForm((current) => ({ ...current, roomId: event.target.value }))}><option value="">{t('noRoom')}</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !staff.length || !sections.length || !subjects.length}>{t('addAssignment')}</button></div>
      </form>
      <div className="setup-list">{assignments.length ? assignments.map((item) => <div className="setting-row" key={item.id}><span><strong>{item.staffName}</strong><small>{item.sectionName} · {item.subjectName}</small></span><span className="setting-value">{item.dayOfWeek ? `${item.dayOfWeek} · ${t('periodNumber')} ${item.periodNumber}` : ''}</span></div>) : <p className="muted">{t('noAssignments')}</p>}</div>
      <form className="setup-form" onSubmit={(event) => void submit(event, () =>
        api.assignHomeroom(homeroomForm.sectionId, homeroomForm.staffId), t('assignmentSaved'))}>
        <h3>{t('homeroom')}</h3><div className="form-grid">
          <label>{t('sections')}<select required value={homeroomForm.sectionId} onChange={(event) => setHomeroomForm((current) => ({ ...current, sectionId: event.target.value }))}>{sections.map((item) => <option key={item.id} value={item.id}>{item.gradeName} · {item.name}</option>)}</select></label>
          <label>{t('teacher')}<select required value={homeroomForm.staffId} onChange={(event) => setHomeroomForm((current) => ({ ...current, staffId: event.target.value }))}>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !staff.length || !sections.length}>{t('assignHomeroom')}</button></div>
      </form>
    </section>}
    <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('attendanceStaff')}</h2></div>{canManage && <button className="button button-quiet" onClick={() => void downloadCsv()}>{t('exportAttendance')}</button>}</div>
      <form onSubmit={(event) => void submit(event, () => api.recordStaffAttendance({
        staffId: managePerson ? attendanceForm.staffId : selfStaff?.id,
        date: attendanceForm.date, status: attendanceForm.status,
        clockIn: attendanceForm.clockIn || undefined, clockOut: attendanceForm.clockOut || undefined
      }), t('attendanceSavedStaff'))}>
        <div className="form-grid">
          {managePerson && <label>{t('teacher')}<select required value={attendanceForm.staffId} onChange={(event) => setAttendanceForm((current) => ({ ...current, staffId: event.target.value }))}>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <FormInput label={t('date')} type="date" value={attendanceForm.date} onChange={(date) => setAttendanceForm((current) => ({ ...current, date }))} required />
          <label>{t('employmentStatus')}<select value={attendanceForm.status} onChange={(event) => setAttendanceForm((current) => ({ ...current, status: event.target.value }))}><option value="present">{t('present')}</option><option value="absent">{t('absent')}</option><option value="late">{t('late')}</option><option value="excused">{t('excused')}</option></select></label>
          <FormInput label={t('clockIn')} value={attendanceForm.clockIn} onChange={(clockIn) => setAttendanceForm((current) => ({ ...current, clockIn }))} />
          <FormInput label={t('clockOut')} value={attendanceForm.clockOut} onChange={(clockOut) => setAttendanceForm((current) => ({ ...current, clockOut }))} />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || (canManage && !staff.length)}>{t('recordStaffAttendance')}</button></div>
      </form>
      {attendance.length ? attendance.slice(0, 12).map((record) => <div className="history-row" key={record.id}><span className="history-icon">✓</span><span><strong>{record.name ?? staff.find((item) => item.id === record.staffId)?.name}</strong><small>{record.date} · {record.department}</small></span><span className="status-pill">{record.status} {record.clockIn ? `· ${record.clockIn}` : ''}</span></div>) : <div className="empty-state">{t('noStaffAttendance')}</div>}
    </section>
    <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('leaveRequests')}</h2></div></div>
      <form onSubmit={(event) => void submit(event, () => api.createLeaveRequest({
        ...(managePerson ? { staffId: leaveForm.staffId } : {}),
        startDate: leaveForm.startDate, endDate: leaveForm.endDate, reason: leaveForm.reason
      }), t('leaveSaved'))}>
        <div className="form-grid">
          {managePerson && <label>{t('teacher')}<select required value={leaveForm.staffId} onChange={(event) => setLeaveForm((current) => ({ ...current, staffId: event.target.value }))}>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <FormInput label={t('startDate')} type="date" value={leaveForm.startDate} onChange={(startDate) => setLeaveForm((current) => ({ ...current, startDate }))} required />
          <FormInput label={t('endDate')} type="date" value={leaveForm.endDate} onChange={(endDate) => setLeaveForm((current) => ({ ...current, endDate }))} required />
          <FormInput label={t('leaveReason')} value={leaveForm.reason} onChange={(reason) => setLeaveForm((current) => ({ ...current, reason }))} required />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || (canManage && !staff.length)}>{t('requestLeave')}</button></div>
      </form>
      {leaveRequests.length ? leaveRequests.map((item) => <div className="history-row" key={item.id}><span className="history-icon">◷</span><span><strong>{item.staffName} · {item.startDate} – {item.endDate}</strong><small>{item.reason}{item.reviewNote ? ` · ${item.reviewNote}` : ''}</small></span><span className="status-pill">{statusLabel(item.status)}</span>{canManage && item.status === 'pending' && <div className="form-actions"><button className="button button-quiet" disabled={busy} onClick={() => void runAction(() => api.reviewLeaveRequest(item.id, 'approved'), t('setupSaved'))}>{t('approve')}</button><button className="button button-quiet" disabled={busy} onClick={() => void runAction(() => api.reviewLeaveRequest(item.id, 'rejected'), t('setupSaved'))}>{t('reject')}</button></div>}</div>) : <div className="empty-state">{t('noLeave')}</div>}
    </section>
    <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('internalMessages')}</h2></div></div>
      {canManage && <form onSubmit={(event) => void submit(event, () => api.createStaffMessage({
        departmentId: messageForm.departmentId || null, type: messageForm.type,
        title: messageForm.title, body: messageForm.body
      }), t('messageSaved'))}>
        <div className="form-grid">
          <label>{t('announcement')}<select value={messageForm.type} onChange={(event) => setMessageForm((current) => ({ ...current, type: event.target.value as 'handover' | 'announcement' }))}><option value="announcement">{t('announcement')}</option><option value="handover">{t('handover')}</option></select></label>
          <label>{t('department')}<select value={messageForm.departmentId} onChange={(event) => setMessageForm((current) => ({ ...current, departmentId: event.target.value }))}><option value="">{t('noDepartment')}</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <FormInput label={t('messageTitle')} value={messageForm.title} onChange={(title) => setMessageForm((current) => ({ ...current, title }))} required />
        </div>
        <label>{t('messageBody')}<textarea rows={3} value={messageForm.body} onChange={(event) => setMessageForm((current) => ({ ...current, body: event.target.value }))} required /></label>
        <div className="form-actions"><button className="button button-primary" disabled={busy}>{t('publish')}</button></div>
      </form>}
      {messages.length ? messages.map((item) => <div className="history-row" key={item.id}><span className="history-icon">✉</span><span><strong>{item.title} · {t(item.type)}</strong><small>{item.body}</small></span></div>) : <div className="empty-state">{t('noMessages')}</div>}
    </section>
  </>;
}
