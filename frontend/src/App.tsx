import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, AcademicYear, AcademicYearRecord, CampusAnnouncement, CampusEvent, CashierShift, CurriculumUnit, Department, FeeExpense, FeeInvoice, FeeItem, FeePayment, FeeReceipt, FeeSummary, GradeCatalogEntry, GradeLevel, GradeSubject, GradingPolicy, LeaveRequest, LessonPlan, Mark, NotificationInbox, OrganizationClosure, OrganizationSettings, pendingOfflineCount, PromotionRule, queueOfflineOperation, ReportCard, Room, SchoolAccount, SchoolCalendarEntry, SchoolProfile, SchoolSubscription, Section, setAccessToken, StaffAttendance, StaffInvitationRole, StaffMember, StaffMessage, Student, SubscriptionPlan, Subject, syncOfflineOperations, TeachingAssignment, TermMarksSummary, TimetablePeriod, Term, User, UserNotification } from './api';
import { Locale, translate } from './i18n';
import { formatEthiopianDate } from './calendar';
import { ForgotPasswordPage, InvitationSetupPage, LoginPage, PasswordChangePage, PasswordResetPage } from './pages/auth/AuthPages';
import { PublicAdmissionPage, PublicTransferPage } from './pages/public/PublicStudentPages';
import AdmissionsPage from './pages/admissions/AdmissionsPage';
import PortalPage from './pages/portal/PortalPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import AttendancePage from './pages/attendance/AttendancePage';
import StudentsPage from './pages/students/StudentsPage';
import PwaInstallButton from './components/PwaInstallButton';
import FormInput from './components/FormInput';
import SidebarNavGroup, { SidebarNavGroupDefinition } from './components/SidebarNavGroup';
import ErrorState from './components/ErrorState';
import InvitationLinkField from './components/InvitationLinkField';
import { dateAfter, localDateInput } from './utils/dates';
import { downloadCsv } from './utils/csv';

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

function MarksPage({ t, onQueued, ownerId, canManageGrading, canSubmitMarks, canApproveMarks, canPublishMarks, canAmendMarks, locale }: {
  t: T; onQueued: () => Promise<void>; ownerId: string; canManageGrading: boolean;
  canSubmitMarks: boolean; canApproveMarks: boolean; canPublishMarks: boolean;
  canAmendMarks: boolean; locale: Locale
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [entrySubjects, setEntrySubjects] = useState<Subject[]>([]);
  const [bandForm, setBandForm] = useState<{ code: string; nameEn: string; nameAm: string; minPercent: string }[]>([]);
  const [gradingScaleDirty, setGradingScaleDirty] = useState(false);
  const [gradingPolicy, setGradingPolicy] = useState<GradingPolicy | null>(null);
  const [scoringMethod, setScoringMethod] = useState<GradingPolicy['scoringMethod']>('points_weighted');
  const [studentId, setStudentId] = useState('');
  const [termId, setTermId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [assessmentName, setAssessmentName] = useState('Mathematics · Quiz 1');
  const [value, setValue] = useState('0');
  const [maxValue, setMaxValue] = useState('20');
  const [reportStudentId, setReportStudentId] = useState('');
  const [reportTermId, setReportTermId] = useState('');
  const [reportAmendmentReason, setReportAmendmentReason] = useState('');
  const [report, setReport] = useState<ReportCard | null>(null);
  const [termSummary, setTermSummary] = useState<TermMarksSummary | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [transitioningMarkId, setTransitioningMarkId] = useState('');
  const [amendingMark, setAmendingMark] = useState<{
    id: string; value: string; maxValue: string; reason: string
  } | null>(null);
  const load = useCallback(async () => {
    const [s, m, context, bands, policy] = await Promise.all([
      api.students(), api.marks(), api.marksContext(), api.gradingBands(), api.gradingPolicy()
    ]);
    const { terms: termList, subjects: subjectList } = context;
    setStudents(s); setMarks(m); setTerms(termList); setSubjects(subjectList);
    setBandForm(bands.length ? bands.map((band) => ({
      code: band.code, nameEn: band.nameEn, nameAm: band.nameAm, minPercent: String(band.minPercent)
    })) : [{ code: '', nameEn: '', nameAm: '', minPercent: '0' }]);
    setGradingScaleDirty(false);
    setGradingPolicy(policy);
    setScoringMethod(policy.scoringMethod);
    if (s.length) {
      setStudentId((current) => current || s[0].id);
      setReportStudentId((current) => current || s[0].id);
    }
    if (termList.length) {
      const currentTermId = termList.find((term) => term.isCurrent)?.id ?? termList[0].id;
      setTermId((current) => current || currentTermId);
      setReportTermId((current) => current || currentTermId);
    }
    if (subjectList.length) setSubjectId((current) => current || subjectList[0].id);
  }, []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
  useEffect(() => {
    const student = students.find((item) => item.id === studentId);
    const request: Promise<Subject[]> = student?.gradeLevelId
      ? api.gradeSubjects(student.gradeLevelId, student.stream).then((rows) => rows.map((item) => ({
        id: item.subjectId, campusId: item.campusId, code: item.code,
        nameEn: item.nameEn, nameAm: item.nameAm, category: item.category
      })))
      : Promise.resolve(subjects);
    request.then((rows) => {
      setEntrySubjects(rows);
      setSubjectId((current) => rows.some((item) => item.id === current) ? current : rows[0]?.id ?? '');
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load grade subjects.'));
  }, [studentId, students, subjects]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const body = {
      clientUuid: crypto.randomUUID(), studentId, assessmentName,
      termId, subjectId, value: Number(value), maxValue: Number(maxValue)
    };
    try {
      if (!navigator.onLine) {
        await queueOfflineOperation('/api/marks', body, ownerId);
        await onQueued();
        setNotice(t('pendingSync'));
      } else {
        await api.submitMark(body);
        setNotice(t('markSaved'));
        await load();
      }
    } catch (reason) {
      if (reason instanceof TypeError) {
        await queueOfflineOperation('/api/marks', body, ownerId);
        await onQueued();
        setNotice(t('pendingSync'));
      } else setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };
  const loadReport = async () => {
    if (!reportStudentId || !reportTermId) return;
    setBusy(true); setError(''); setReport(null);
    try { setReport(await api.reportCard(reportStudentId, reportTermId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const loadTermSummary = async () => {
    if (!reportTermId) return;
    setBusy(true); setError(''); setTermSummary(null);
    try { setTermSummary(await api.termMarksSummary(reportTermId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const transitionMark = async (mark: Mark, action: 'submit' | 'approve' | 'publish') => {
    setTransitioningMarkId(mark.id); setError(''); setNotice('');
    try {
      await api.transitionMark(mark.id, action);
      setNotice(t(action === 'submit' ? 'markSubmitted' : action === 'approve' ? 'markApproved' : 'markPublished'));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setTransitioningMarkId(''); }
  };
  const amendMark = async (event: FormEvent) => {
    event.preventDefault();
    if (!amendingMark) return;
    setTransitioningMarkId(amendingMark.id); setError(''); setNotice('');
    try {
      await api.amendMark(amendingMark.id, {
        value: Number(amendingMark.value), maxValue: Number(amendingMark.maxValue),
        reason: amendingMark.reason
      });
      setAmendingMark(null);
      setNotice(t('markAmended'));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setTransitioningMarkId(''); }
  };
  const exportTermSummary = () => {
    if (!termSummary) return;
    const rows: (string | number)[][] = [
      [t('termResultsSummary'), termSummary.termName],
      [t('provisional')],
      [],
      [t('students'), termSummary.totals.students, t('assessments'), termSummary.totals.assessmentCount],
      [t('overallResult'), termSummary.totals.earnedPoints, t('outOf'), termSummary.totals.possiblePoints,
        termSummary.totals.percent == null ? '—' : `${termSummary.totals.percent}%`],
      [],
      [t('subject'), t('students'), t('assessments'), t('total'), t('outOf'), t('scorePercent')],
      ...termSummary.bySubject.map((row) => [
        locale === 'am' ? row.subjectNameAm : row.subjectNameEn,
        row.students, row.assessmentCount, row.earnedPoints, row.possiblePoints,
        row.percent == null ? '—' : `${row.percent}%`
      ])
    ];
    downloadCsv(`term-results-${termSummary.termId}.csv`, rows);
  };
  const saveBands = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const saved = await api.replaceGradingBands(bandForm.map((band) => ({
        code: band.code, nameEn: band.nameEn, nameAm: band.nameAm,
        minPercent: Number(band.minPercent)
      })));
      setBandForm(saved.map((band) => ({
        code: band.code, nameEn: band.nameEn, nameAm: band.nameAm, minPercent: String(band.minPercent)
      })));
      setGradingScaleDirty(false);
      const policy = await api.gradingPolicy();
      setGradingPolicy(policy);
      setNotice(t('gradingSaved'));
      if (report && reportStudentId && reportTermId) {
        setReport(await api.reportCard(reportStudentId, reportTermId));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const confirmGradingPolicy = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const policy = await api.confirmGradingPolicy(scoringMethod);
      setGradingPolicy(policy);
      setNotice(t('gradingPolicyConfirmed'));
      if (report && reportStudentId && reportTermId) {
        setReport(await api.reportCard(reportStudentId, reportTermId));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const createTermReportDraft = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const amendmentReason = report?.workflow?.status === 'published'
        ? reportAmendmentReason.trim() : undefined;
      await api.createTermReportDraft(reportStudentId, reportTermId, amendmentReason);
      setReportAmendmentReason('');
      setNotice(t('reportDraftCreated'));
      await loadReport();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const transitionTermReport = async (action: 'submit' | 'approve' | 'publish') => {
    if (!report?.workflow) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.transitionTermReport(report.workflow.id, action);
      setNotice(t(action === 'submit' ? 'reportSubmitted' : action === 'approve' ? 'reportApproved' : 'reportPublished'));
      await loadReport();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const displayedReport = report?.workflow?.status === 'published'
    ? report.workflow.snapshot : report;
  const reportPolicyConfirmed = report?.workflow?.status === 'published'
    ? report.workflow.snapshot.gradingPolicyConfirmed
    : Boolean(report?.gradingPolicyConfirmed &&
      (!report.workflow || report.workflow.gradingPolicyConfirmedAt === report.gradingPolicyConfirmedAt));
  return <>
    <div className="page-heading compact-heading"><div><div className="eyebrow">{t('sectionGrade')}</div><h1>{t('marksTitle')}</h1><p>{t('marksHint')}</p></div><span className="state-tag">{t('draft')}</span></div>
    {notice && <div className="notice notice-success">{notice}</div>}{error && <div className="notice notice-error">{error}</div>}
    <section className="panel marks-entry-panel">
      <div className="panel-heading"><div><h2>{t('assessment')}</h2><p>{t('releaseOne')}</p></div><span className="draft-step">01 <i /> {t('draftEntry')}</span></div>
      <form className="marks-form" onSubmit={submit}>
        <label>{t('student')}<select required value={studentId} onChange={(e) => setStudentId(e.target.value)}><option value="">{t('chooseStudent')}</option>{students.map((student) => <option key={student.id} value={student.id}>{student.givenNameEn} {student.fatherNameEn} · {student.studentNo}</option>)}</select></label>
        <label>{t('term')}<select required value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">{t('chooseTerm')}</option>{terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label>
        <label>{t('subject')}<select required value={subjectId} onChange={(e) => setSubjectId(e.target.value)}><option value="">{t('chooseSubject')}</option>{entrySubjects.map((subject) => <option key={subject.id} value={subject.id}>{locale === 'am' ? subject.nameAm : subject.nameEn}</option>)}</select></label>
        <FormInput label={t('assessment')} value={assessmentName} onChange={setAssessmentName} required />
        <div className="score-inputs"><FormInput label={t('score')} type="number" value={value} onChange={setValue} required /><span>/</span><FormInput label={t('maxMark')} type="number" value={maxValue} onChange={setMaxValue} required /></div>
        <div className="marks-integrity">ⓘ {t('writeAuditNotice')} {t('invalidScore')}</div>
        <div className="form-actions"><button className="button button-primary" disabled={busy || !students.length || !terms.length || !subjects.length}>{busy ? t('loading') : t('saveMark')} →</button></div>
      </form>
    </section>
    {canManageGrading && <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('gradingScale')}</h2><p>{t('gradingScaleHint')}</p></div></div>
      <form className="setup-form" onSubmit={(event) => void saveBands(event)}>
        {bandForm.map((band, index) => <div className="form-grid grading-band-row" key={index}>
          <FormInput label={t('bandCode')} value={band.code} onChange={(code) => { setGradingScaleDirty(true); setBandForm((current) => current.map((item, i) => i === index ? { ...item, code } : item)); }} required />
          <FormInput label={t('bandNameEn')} value={band.nameEn} onChange={(nameEn) => { setGradingScaleDirty(true); setBandForm((current) => current.map((item, i) => i === index ? { ...item, nameEn } : item)); }} required />
          <FormInput label={t('bandNameAm')} value={band.nameAm} onChange={(nameAm) => { setGradingScaleDirty(true); setBandForm((current) => current.map((item, i) => i === index ? { ...item, nameAm } : item)); }} required />
          <FormInput label={t('minPercent')} type="number" value={band.minPercent} onChange={(minPercent) => { setGradingScaleDirty(true); setBandForm((current) => current.map((item, i) => i === index ? { ...item, minPercent } : item)); }} required />
        </div>)}
        <div className="form-actions">
          <button type="button" className="button button-secondary" onClick={() => { setGradingScaleDirty(true); setBandForm((current) => [...current, { code: '', nameEn: '', nameAm: '', minPercent: '' }]); }}>{t('addBand')}</button>
          <button className="button button-primary" disabled={busy}>{t('saveGradingScale')}</button>
        </div>
      </form>
      <div className="grading-policy-controls">
        <p>{gradingPolicy?.confirmedAt && gradingPolicy.scoringMethod === scoringMethod && !gradingScaleDirty
          ? t('gradingPolicyApproved') : t('gradingPolicyUnconfirmed')}</p>
        <label>{t('scoringMethod')}
          <select value={scoringMethod} onChange={(event) =>
            setScoringMethod(event.target.value as GradingPolicy['scoringMethod'])}>
            <option value="points_weighted">{t('pointsWeighted')}</option>
            <option value="equal_subject_weighted">{t('equalSubjectWeighted')}</option>
          </select>
        </label>
        <button type="button" className="button button-secondary" disabled={busy || !bandForm.length || gradingScaleDirty ||
          !bandForm.some((band) => band.minPercent.trim() !== '' && Number(band.minPercent) === 0)}
          onClick={() => void confirmGradingPolicy()}>{t('confirmGradingPolicy')}</button>
      </div>
    </section>}
    <section className="panel report-card-panel">
      <div className="panel-heading"><div><h2>{t('reportCard')}</h2><p>{t('provisional')}</p></div></div>
      <div className="report-card-controls">
        <label>{t('student')}<select value={reportStudentId} onChange={(event) => setReportStudentId(event.target.value)}><option value="">{t('chooseStudent')}</option>{students.map((student) => <option key={student.id} value={student.id}>{student.givenNameEn} {student.fatherNameEn} · {student.studentNo}</option>)}</select></label>
        <label>{t('term')}<select value={reportTermId} onChange={(event) => setReportTermId(event.target.value)}><option value="">{t('chooseTerm')}</option>{terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label>
        <button className="button button-primary" onClick={() => void loadReport()} disabled={busy || !reportStudentId || !reportTermId}>{t('viewReport')}</button>
      </div>
      {report && <div className="report-card">
        <div className="report-card-heading"><h3>{students.find((student) => student.id === report.studentId)?.givenNameEn} {students.find((student) => student.id === report.studentId)?.fatherNameEn}</h3><span>{report.termName} · {report.workflow?.status === 'published' ? t('reportPublishedState') : t('provisional')}</span></div>
        <p className="grading-policy-status">{t(displayedReport?.scoringMethod === 'points_weighted' ? 'pointsWeighted' : 'equalSubjectWeighted')} · {t(reportPolicyConfirmed ? 'gradingPolicyApproved' : 'gradingPolicyUnconfirmed')}</p>
        {displayedReport?.subjects.length ? <>
          <div className="table-scroll"><table className="data-table">
            <thead><tr><th>{t('subject')}</th><th>{t('total')}</th><th>{t('scorePercent')}</th><th>{t('gradeBand')}</th></tr></thead>
            <tbody>{displayedReport.subjects.map((result) => <tr key={result.subjectId}>
              <td>{locale === 'am' ? result.subjectNameAm : result.subjectNameEn}</td>
              <td>{result.value}/{result.maxValue}</td><td>{result.percent.toFixed(2)}%</td>
              <td>{result.band ? (locale === 'am' ? result.band.nameAm : result.band.nameEn) : t('noGradingScale')}</td>
            </tr>)}</tbody>
          </table></div>
          <div className="report-card-total"><strong>{t('overallResult')}</strong><span>{displayedReport.totalValue}/{displayedReport.totalMaxValue} · {displayedReport.overallPercent.toFixed(2)}%</span><b>{displayedReport.overallBand ? (locale === 'am' ? displayedReport.overallBand.nameAm : displayedReport.overallBand.nameEn) : t('noGradingScale')}</b></div>
          <div className="report-workflow-controls">
            {report.workflow && <p>{t('reportRevision')} {report.workflow.revision} · {t(`reportState_${report.workflow.status}`)}</p>}
            {!report.workflow && canApproveMarks && report.gradingPolicyConfirmed &&
              <button className="button button-secondary" disabled={busy || marks.some((mark) =>
                mark.studentId === reportStudentId && mark.termId === reportTermId &&
                Boolean(mark.subjectId) && mark.state !== 'locked') ||
                !marks.some((mark) => mark.studentId === reportStudentId && mark.termId === reportTermId &&
                  Boolean(mark.subjectId))}
                onClick={() => void createTermReportDraft()}>{t('createReportDraft')}</button>}
            {report.workflow && (
              report.workflow.gradingPolicyConfirmedAt !== report.gradingPolicyConfirmedAt ||
              report.workflow.snapshot.sourceMarkFingerprint !== report.sourceMarkFingerprint
            ) && canApproveMarks && report.gradingPolicyConfirmed &&
              <>
                {report.workflow.status === 'published' && <label className="report-amendment-reason">
                  {t('amendmentReason')}
                  <textarea value={reportAmendmentReason} maxLength={500} required
                    onChange={(event) => setReportAmendmentReason(event.target.value)} />
                </label>}
                <button className="button button-secondary"
                  disabled={busy || (report.workflow.status === 'published' && reportAmendmentReason.trim().length < 5)}
                  onClick={() => void createTermReportDraft()}>{t('refreshReportDraft')}</button>
              </>}
            {report.workflow?.status === 'draft' &&
              report.workflow.gradingPolicyConfirmedAt === report.gradingPolicyConfirmedAt &&
              report.workflow.snapshot.sourceMarkFingerprint === report.sourceMarkFingerprint && canApproveMarks &&
              <button className="button button-secondary" disabled={busy} onClick={() => void transitionTermReport('submit')}>{t('submitReport')}</button>}
            {report.workflow?.status === 'submitted' &&
              report.workflow.gradingPolicyConfirmedAt === report.gradingPolicyConfirmedAt &&
              report.workflow.snapshot.sourceMarkFingerprint === report.sourceMarkFingerprint && canApproveMarks &&
              <button className="button button-secondary" disabled={busy} onClick={() => void transitionTermReport('approve')}>{t('approveReport')}</button>}
            {report.workflow?.status === 'approved' &&
              report.workflow.gradingPolicyConfirmedAt === report.gradingPolicyConfirmedAt &&
              report.workflow.snapshot.sourceMarkFingerprint === report.sourceMarkFingerprint && canPublishMarks &&
              <button className="button button-primary" disabled={busy} onClick={() => void transitionTermReport('publish')}>{t('publishReport')}</button>}
          </div>
          <button className="button button-secondary report-print-button" onClick={() => window.print()}>{t('printReport')}</button>
        </> : <div className="empty-state">{t('noReportMarks')}</div>}
      </div>}
    </section>
    <section className="panel report-card-panel">
      <div className="panel-heading"><div><h2>{t('termResultsSummary')}</h2><p>{t('provisionalMarksNotice')}</p></div><span className="state-tag">{t('provisional')}</span></div>
      <div className="report-card-controls">
        <label>{t('term')}<select value={reportTermId} onChange={(event) => { setReportTermId(event.target.value); setTermSummary(null); }}><option value="">{t('chooseTerm')}</option>{terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label>
        <button className="button button-primary" onClick={() => void loadTermSummary()} disabled={busy || !reportTermId}>{t('viewReport')}</button>
      </div>
      {termSummary && <>
        <div className="form-actions"><button className="button button-secondary" onClick={exportTermSummary}>{t('exportCsv')}</button></div>
        <div className="report-card-total"><strong>{t('overallResult')}</strong>
          <span>{termSummary.totals.earnedPoints}/{termSummary.totals.possiblePoints} · {termSummary.totals.percent == null ? '—' : `${termSummary.totals.percent.toFixed(2)}%`}</span>
          <small>{termSummary.totals.students} {t('students')} · {termSummary.totals.assessmentCount} {t('assessments')}</small>
        </div>
        {termSummary.bySubject.length ? <div className="table-scroll"><table className="data-table">
          <thead><tr><th>{t('subject')}</th><th>{t('students')}</th><th>{t('assessments')}</th><th>{t('total')}</th><th>{t('scorePercent')}</th></tr></thead>
          <tbody>{termSummary.bySubject.map((result) => <tr key={result.subjectId}>
            <td>{locale === 'am' ? result.subjectNameAm : result.subjectNameEn}</td>
            <td>{result.students}</td><td>{result.assessmentCount}</td>
            <td>{result.earnedPoints}/{result.possiblePoints}</td>
            <td>{result.percent == null ? '—' : `${result.percent.toFixed(2)}%`}</td>
          </tr>)}</tbody>
        </table></div> : <div className="empty-state">{t('noTermMarks')}</div>}
      </>}
    </section>
    <section className="panel history-panel"><div className="panel-heading"><div><h2>{t('marks')}</h2><p>{marks.length} {t('records')}</p></div></div>{marks.length ? marks.slice(0, 8).map((mark) => {
      const student = students.find((s) => s.id === mark.studentId);
      const action = mark.state === 'draft' && canSubmitMarks ? 'submit'
        : mark.state === 'submitted' && canApproveMarks ? 'approve'
          : mark.state === 'approved' && canPublishMarks ? 'publish' : null;
      return <div className="history-row mark-history-row" key={mark.id}>
        <span className="history-icon purple-icon">▤</span>
        <span><strong>{student ? `${student.givenNameEn} ${student.fatherNameEn}` : t('student')} · {mark.assessmentName}</strong>
          <small>{subjects.find((subject) => subject.id === mark.subjectId)?.nameEn ?? ''} · {terms.find((term) => term.id === mark.termId)?.name ?? ''} · {t(mark.state)}</small>
        </span>
        <span className="score-pill">{mark.value}/{mark.maxValue}</span>
        {action && <button className="button button-secondary mark-transition-action" disabled={transitioningMarkId === mark.id}
          onClick={() => void transitionMark(mark, action)}>
          {transitioningMarkId === mark.id ? t('loading') : t(action === 'submit' ? 'submitForReview' : action === 'approve' ? 'approveMark' : 'publishMark')}
        </button>}
        {mark.state === 'locked' && canAmendMarks && <button className="button button-secondary mark-transition-action"
          disabled={transitioningMarkId === mark.id} onClick={() => setAmendingMark({
            id: mark.id, value: String(mark.value), maxValue: String(mark.maxValue), reason: ''
          })}>{t('amendPublishedMark')}</button>}
        {amendingMark?.id === mark.id && <form className="mark-amendment-form" onSubmit={(event) => void amendMark(event)}>
          <FormInput label={t('score')} type="number" value={amendingMark.value}
            onChange={(value) => setAmendingMark((current) => current ? { ...current, value } : current)} required />
          <FormInput label={t('maxMark')} type="number" value={amendingMark.maxValue}
            onChange={(maxValue) => setAmendingMark((current) => current ? { ...current, maxValue } : current)} required />
          <label>{t('correctionReason')}<textarea minLength={5} maxLength={500} required value={amendingMark.reason}
            onChange={(event) => setAmendingMark((current) => current ? { ...current, reason: event.target.value } : current)} /></label>
          <button className="button button-primary" disabled={transitioningMarkId === mark.id}>
            {transitioningMarkId === mark.id ? t('loading') : t('saveCorrection')}
          </button>
          <button type="button" className="button button-secondary" onClick={() => setAmendingMark(null)}>{t('cancel')}</button>
        </form>}
      </div>;
    }) : <div className="empty-state">{t('noMarks')}</div>}</section>
  </>;
}

function FeesPage({ t, locale, canManage, canCollect, canReverse }: {
  t: T; locale: Locale; canManage: boolean; canCollect: boolean; canReverse: boolean
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
    setBusy(true); setError(''); setNotice('');
    try {
      const payment = await api.collectFeePayment(invoice.id, {
        amount: Number(form.amount), method: form.method, reference: form.reference
      });
      if (payment.receiptNumber) setReceipt(await api.feeReceipt(payment.receiptNumber));
      setNotice(t('paymentRecorded')); await load();
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
          <FormInput label={t('amount')} type="number" value={paymentForms[invoice.id]?.amount ?? String(invoice.balanceDue)} onChange={(amount) => setPaymentForms((current) => ({
            ...current, [invoice.id]: { amount, method: current[invoice.id]?.method ?? 'cash', reference: current[invoice.id]?.reference ?? '' }
          }))} required />
          <label>{t('paymentMethod')}<select value={paymentForms[invoice.id]?.method ?? 'cash'} onChange={(event) => setPaymentForms((current) => ({
            ...current, [invoice.id]: { amount: current[invoice.id]?.amount ?? String(invoice.balanceDue), method: event.target.value as FeePayment['method'], reference: current[invoice.id]?.reference ?? '' }
          }))}><option value="cash">{t('paymentMethod_cash')}</option><option value="bank_transfer">{t('paymentMethod_bank_transfer')}</option><option value="mobile_money">{t('paymentMethod_mobile_money')}</option><option value="other">{t('paymentMethod_other')}</option></select></label>
          <FormInput label={t('paymentReference')} value={paymentForms[invoice.id]?.reference ?? ''} onChange={(reference) => setPaymentForms((current) => ({
            ...current, [invoice.id]: { amount: current[invoice.id]?.amount ?? String(invoice.balanceDue), method: current[invoice.id]?.method ?? 'cash', reference }
          }))} required={paymentForms[invoice.id]?.method === 'bank_transfer' || paymentForms[invoice.id]?.method === 'mobile_money'} />
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
    </>}
  </>;
}

function CommunicationsPage({ t, locale, canManage }: {
  t: T; locale: Locale; canManage: boolean
}) {
  const today = localDateInput();
  const [announcements, setAnnouncements] = useState<CampusAnnouncement[]>([]);
  const [events, setEvents] = useState<CampusEvent[]>([]);
  const [announcementForm, setAnnouncementForm] = useState({
    titleEn: '', titleAm: '', bodyEn: '', bodyAm: ''
  });
  const [eventForm, setEventForm] = useState({
    titleEn: '', titleAm: '', descriptionEn: '', descriptionAm: '',
    startsOn: today, endsOn: today, startsAt: '', endsAt: '', location: ''
  });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [announcementRows, eventRows] = await Promise.all([
      api.campusAnnouncements(), api.campusEvents(today, dateAfter(today, 365))
    ]);
    setAnnouncements(announcementRows);
    setEvents(eventRows);
  }, [today]);
  useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')))
      .finally(() => setLoading(false));
  }, [load, t]);
  const publishAnnouncement = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api.createCampusAnnouncement(announcementForm);
      setAnnouncementForm({ titleEn: '', titleAm: '', bodyEn: '', bodyAm: '' });
      setNotice(t('announcementPublished')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const createEvent = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api.createCampusEvent({
        ...eventForm, startsAt: eventForm.startsAt || null, endsAt: eventForm.endsAt || null
      });
      setEventForm({
        titleEn: '', titleAm: '', descriptionEn: '', descriptionAm: '',
        startsOn: today, endsOn: today, startsAt: '', endsAt: '', location: ''
      });
      setNotice(t('eventCreated')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const localized = (en: string, am: string) => locale === 'am' ? am : en;
  const dateLabel = (start: string, end: string) => start === end ? start : `${start} – ${end}`;

  return <>
    <div className="page-heading compact-heading"><div><div className="eyebrow">{t('releaseOne')}</div><h1>{t('communications')}</h1><p>{t('communicationsHint')}</p></div><span className="state-tag">{t('inAppOnly')}</span></div>
    {notice && <div className="notice notice-success">{notice}</div>}
    {error && <div className="notice notice-error">{error}</div>}
    <div className="marks-integrity fee-scope-notice">ⓘ {t('communicationsDeliveryNotice')}</div>
    {loading ? <div className="loading-state">{t('loading')}</div> : <>
      {canManage && <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>{t('publishAnnouncement')}</h2><p>{t('announcementHint')}</p></div></div>
        <form className="setup-form communication-form" onSubmit={(event) => void publishAnnouncement(event)}>
          <div className="form-grid">
            <FormInput label={t('announcementTitleEn')} value={announcementForm.titleEn} onChange={(titleEn) => setAnnouncementForm((current) => ({ ...current, titleEn }))} required />
            <FormInput label={t('announcementTitleAm')} value={announcementForm.titleAm} onChange={(titleAm) => setAnnouncementForm((current) => ({ ...current, titleAm }))} required />
          </div>
          <div className="form-grid">
            <label>{t('announcementBodyEn')}<textarea rows={4} value={announcementForm.bodyEn} onChange={(event) => setAnnouncementForm((current) => ({ ...current, bodyEn: event.target.value }))} required /></label>
            <label>{t('announcementBodyAm')}<textarea rows={4} value={announcementForm.bodyAm} onChange={(event) => setAnnouncementForm((current) => ({ ...current, bodyAm: event.target.value }))} required /></label>
          </div>
          <div className="form-actions"><button className="button button-primary" disabled={busy}>{t('publishAnnouncement')}</button></div>
        </form>
      </section>}
      <section className="panel history-panel">
        <div className="panel-heading"><div><h2>{t('announcements')}</h2><p>{announcements.length} {t('records')}</p></div></div>
        {announcements.length ? announcements.map((item) => <article className="communication-item" key={item.id}>
          <div className="communication-date">{new Date(item.publishedAt).toLocaleDateString(locale === 'am' ? 'am-ET' : 'en-ET')}</div>
          <div><h3>{localized(item.titleEn, item.titleAm)}</h3><p>{localized(item.bodyEn, item.bodyAm)}</p></div>
        </article>) : <div className="empty-state">{t('noAnnouncements')}</div>}
      </section>
      {canManage && <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>{t('addSchoolEvent')}</h2><p>{t('eventHint')}</p></div></div>
        <form className="setup-form communication-form" onSubmit={(event) => void createEvent(event)}>
          <div className="form-grid">
            <FormInput label={t('eventTitleEn')} value={eventForm.titleEn} onChange={(titleEn) => setEventForm((current) => ({ ...current, titleEn }))} required />
            <FormInput label={t('eventTitleAm')} value={eventForm.titleAm} onChange={(titleAm) => setEventForm((current) => ({ ...current, titleAm }))} required />
            <FormInput label={t('startDate')} type="date" value={eventForm.startsOn} onChange={(startsOn) => setEventForm((current) => ({ ...current, startsOn, endsOn: current.endsOn < startsOn ? startsOn : current.endsOn }))} required />
            <FormInput label={t('endDate')} type="date" value={eventForm.endsOn} onChange={(endsOn) => setEventForm((current) => ({ ...current, endsOn }))} required />
            <FormInput label={t('startsAt')} type="time" value={eventForm.startsAt} onChange={(startsAt) => setEventForm((current) => ({ ...current, startsAt }))} />
            <FormInput label={t('endsAt')} type="time" value={eventForm.endsAt} onChange={(endsAt) => setEventForm((current) => ({ ...current, endsAt }))} />
            <FormInput label={t('eventLocation')} value={eventForm.location} onChange={(location) => setEventForm((current) => ({ ...current, location }))} />
          </div>
          <div className="form-grid">
            <label>{t('eventDescriptionEn')}<textarea rows={3} value={eventForm.descriptionEn} onChange={(event) => setEventForm((current) => ({ ...current, descriptionEn: event.target.value }))} /></label>
            <label>{t('eventDescriptionAm')}<textarea rows={3} value={eventForm.descriptionAm} onChange={(event) => setEventForm((current) => ({ ...current, descriptionAm: event.target.value }))} /></label>
          </div>
          <div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addSchoolEvent')}</button></div>
        </form>
      </section>}
      <section className="panel history-panel">
        <div className="panel-heading"><div><h2>{t('schoolEvents')}</h2><p>{events.length} {t('records')}</p></div></div>
        {events.length ? events.map((item) => <article className="communication-item" key={item.id}>
          <div className="communication-date">{dateLabel(item.startsOn, item.endsOn)}{item.startsAt && <small>{item.startsAt}{item.endsAt ? ` – ${item.endsAt}` : ''}</small>}</div>
          <div><h3>{localized(item.titleEn, item.titleAm)}</h3>{item.location && <small>{item.location}</small>}
            {(item.descriptionEn || item.descriptionAm) && <p>{localized(item.descriptionEn, item.descriptionAm)}</p>}</div>
        </article>) : <div className="empty-state">{t('noEvents')}</div>}
      </section>
    </>}
  </>;
}

function TimetablePage({ t, canManage, canManageLessons }: { t: T; canManage: boolean; canManageLessons: boolean }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [periods, setPeriods] = useState<TimetablePeriod[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [weekAssignments, setWeekAssignments] = useState<TeachingAssignment[]>([]);
  const [lessonPlans, setLessonPlans] = useState<LessonPlan[]>([]);
  const [curriculumUnits, setCurriculumUnits] = useState<CurriculumUnit[]>([]);
  const [sectionId, setSectionId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  });
  const [periodForm, setPeriodForm] = useState({
    shift: 'morning' as TimetablePeriod['shift'], periodNumber: '1', startsAt: '08:00', endsAt: '08:40'
  });
  const [roomForm, setRoomForm] = useState({ name: '', capacity: '' });
  const [substitutionForm, setSubstitutionForm] = useState({
    assignmentId: '', substituteStaffId: '', leaveRequestId: '', reason: ''
  });
  const [lessonForm, setLessonForm] = useState({
    teachingAssignmentId: '', curriculumUnitId: '', plannedOn: localDateInput(),
    titleEn: '', titleAm: '', objectivesEn: '', objectivesAm: '',
    activitiesEn: '', activitiesAm: '', resources: ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadSetup = useCallback(async () => {
    const [sectionRows, staffRows, periodRows, roomRows, leaveRows, unitRows, planRows] = await Promise.all([
      api.sections(), api.staff(), api.timetablePeriods(), api.rooms(), api.leaveRequests(),
      canManageLessons ? api.curriculumUnits() : Promise.resolve([]),
      canManageLessons ? api.lessonPlans({ from: date, to: dateAfter(date, 6) }) : Promise.resolve([])
    ]);
    setSections(sectionRows);
    setStaff(staffRows);
    setPeriods(periodRows);
    setRooms(roomRows);
    setLeaveRequests(leaveRows);
    setCurriculumUnits(unitRows);
    setLessonPlans(planRows);
  }, [canManageLessons, date]);
  const loadSchedule = useCallback(async () => {
    const [weekly, selectedDate] = await Promise.all([
      api.timetable(), api.timetable({ date })
    ]);
    const weekday = (new Date(`${date}T00:00:00`).getDay() + 6) % 7 + 1;
    setWeekAssignments(weekly);
    setAssignments([
      ...weekly.filter((item) => item.dayOfWeek !== weekday),
      ...selectedDate
    ]);
  }, [date]);
  useEffect(() => {
    Promise.all([loadSetup(), loadSchedule()]).catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [loadSchedule, loadSetup, t]);

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setError(''); setNotice(''); setBusy(true);
    try {
      await action();
      await Promise.all([loadSetup(), loadSchedule()]);
      setNotice(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };
  const submit = (event: FormEvent, action: () => Promise<unknown>, success: string) => {
    event.preventDefault();
    return runAction(action, success);
  };
  const lessonAssignment = weekAssignments.find((item) => item.id === lessonForm.teachingAssignmentId);
  const lessonSection = sections.find((item) => item.id === lessonAssignment?.sectionId);
  const availableLessonUnits = curriculumUnits.filter((unit) =>
    unit.gradeLevelId === lessonSection?.gradeLevelId && unit.subjectId === lessonAssignment?.subjectId);
  const selectedAssignment = weekAssignments.find((item) => item.id === substitutionForm.assignmentId);
  const eligibleLeaves = leaveRequests.filter((leave) =>
    leave.status === 'approved' && leave.staffId === selectedAssignment?.staffId &&
    leave.startDate <= date && leave.endDate >= date);
  const visibleAssignments = assignments
    .filter((item) => !sectionId || item.sectionId === sectionId)
    .filter((item) => !staffId || (item.effectiveStaffId ?? item.staffId) === staffId);
  const periodsInView = periods
    .filter((period) => {
      if (sectionId) return period.shift === (sections.find((section) => section.id === sectionId)?.shift ?? 'morning');
      return true;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.periodNumber - b.periodNumber);
  const days = [
    { number: 1, label: t('monday') }, { number: 2, label: t('tuesday') },
    { number: 3, label: t('wednesday') }, { number: 4, label: t('thursday') },
    { number: 5, label: t('friday') }, { number: 6, label: t('saturday') },
    { number: 7, label: t('sunday') }
  ];
  return <>
    <div className="page-heading compact-heading timetable-heading">
      <div><div className="eyebrow">{t('staff')}</div><h1>{t('timetable')}</h1><p>{t('timetableHint')}</p></div>
      <button className="button button-quiet print-button" onClick={() => window.print()}>{t('printTimetable')}</button>
    </div>
    {notice && <div className="notice notice-success">{notice}</div>}
    {error && <div className="notice notice-error">{error}</div>}
    {canManage && <section className="panel settings-panel timetable-setup">
      <div className="panel-heading"><div><h2>{t('timetableSetup')}</h2><p>{t('timetableSetupHint')}</p></div></div>
      <div className="timetable-setup-grid">
        <form className="setup-form" onSubmit={(event) => void submit(event, () => api.createTimetablePeriod({
          ...periodForm, periodNumber: Number(periodForm.periodNumber)
        }), t('periodSaved'))}>
          <h3>{t('addPeriod')}</h3><div className="form-grid">
            <label>{t('shift')}<select value={periodForm.shift} onChange={(event) => setPeriodForm((current) => ({ ...current, shift: event.target.value as TimetablePeriod['shift'] }))}>
              <option value="morning">{t('morning')}</option><option value="afternoon">{t('afternoon')}</option><option value="evening">{t('evening')}</option>
            </select></label>
            <FormInput label={t('periodNumber')} type="number" value={periodForm.periodNumber} onChange={(periodNumber) => setPeriodForm((current) => ({ ...current, periodNumber }))} required />
            <FormInput label={t('startsAt')} type="time" value={periodForm.startsAt} onChange={(startsAt) => setPeriodForm((current) => ({ ...current, startsAt }))} required />
            <FormInput label={t('endsAt')} type="time" value={periodForm.endsAt} onChange={(endsAt) => setPeriodForm((current) => ({ ...current, endsAt }))} required />
          </div><div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addPeriod')}</button></div>
          <div className="setup-list">{periods.map((period) => <div className="setting-row" key={period.id}><span><strong>{t(period.shift)} · {t('periodNumber')} {period.periodNumber}</strong><small>{period.startsAt}–{period.endsAt}</small></span></div>)}</div>
        </form>
        <form className="setup-form" onSubmit={(event) => void submit(event, () => api.createRoom({
          name: roomForm.name, capacity: roomForm.capacity ? Number(roomForm.capacity) : null
        }), t('roomSaved'))}>
          <h3>{t('addRoom')}</h3><div className="form-grid">
            <FormInput label={t('roomName')} value={roomForm.name} onChange={(name) => setRoomForm((current) => ({ ...current, name }))} required />
            <FormInput label={t('capacity')} type="number" value={roomForm.capacity} onChange={(capacity) => setRoomForm((current) => ({ ...current, capacity }))} />
          </div><div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addRoom')}</button></div>
          <div className="setup-list">{rooms.map((room) => <div className="setting-row" key={room.id}><span><strong>{room.name}</strong><small>{room.capacity ? `${t('capacity')}: ${room.capacity}` : ''}</small></span></div>)}</div>
        </form>
      </div>
    </section>}
    <section className="panel timetable-panel">
      <div className="panel-heading"><div><h2>{t('weeklyTimetable')}</h2><p>{t('substituteDateHint')}</p></div>
        <div className="timetable-filters">
          <label>{t('sections')}<select value={sectionId} onChange={(event) => setSectionId(event.target.value)}><option value="">{t('allSections')}</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.gradeName ? `${section.gradeName} · ` : ''}{section.name}</option>)}</select></label>
          <label>{t('teacher')}<select value={staffId} onChange={(event) => setStaffId(event.target.value)}><option value="">{t('allTeachers')}</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label className="date-picker">{t('date')}<input type="date" value={date} onChange={(event) => {
            setDate(event.target.value);
            setSubstitutionForm((current) => ({ ...current, assignmentId: '', leaveRequestId: '' }));
          }} /></label>
        </div>
      </div>
      {periodsInView.length ? <div className="timetable-scroll"><table className="timetable-grid">
        <thead><tr><th>{t('period')}</th>{days.map((day) => <th key={day.number}>{day.label}</th>)}</tr></thead>
        <tbody>{periodsInView.map((period) => <tr key={period.id}>
          <th><strong>{t(period.shift)} · {t('periodNumber')} {period.periodNumber}</strong><small>{period.startsAt}–{period.endsAt}</small></th>
          {days.map((day) => {
            const entries = visibleAssignments.filter((item) =>
              item.dayOfWeek === day.number && item.periodNumber === period.periodNumber && item.shift === period.shift);
            return <td key={day.number}>{entries.map((item) => <article className={`timetable-entry ${item.isSubstitute ? 'is-substitute' : ''}`} key={item.id}>
              <strong>{item.subjectName}</strong><span>{item.sectionName}</span>
              <small>{item.effectiveStaffName ?? item.staffName}{item.roomName ? ` · ${item.roomName}` : ''}</small>
              {item.isSubstitute && <em>{t('substitute')}</em>}
            </article>)}</td>;
          })}
        </tr>)}</tbody>
      </table></div> : <div className="empty-state">{t('configurePeriods')}</div>}
      {!visibleAssignments.length && periodsInView.length > 0 && <div className="empty-state">{t('noAssignments')}</div>}
    </section>
    {canManageLessons && <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('lessonPlanning')}</h2><p>{t('lessonPlanningNotice')}</p></div></div>
      <form className="setup-form" onSubmit={(event) => void submit(event, async () => {
        if (!lessonForm.teachingAssignmentId) return;
        await api.createLessonPlan({
          teachingAssignmentId: lessonForm.teachingAssignmentId,
          curriculumUnitId: lessonForm.curriculumUnitId || null,
          plannedOn: lessonForm.plannedOn,
          titleEn: lessonForm.titleEn, titleAm: lessonForm.titleAm,
          objectivesEn: lessonForm.objectivesEn, objectivesAm: lessonForm.objectivesAm,
          activitiesEn: lessonForm.activitiesEn, activitiesAm: lessonForm.activitiesAm,
          resources: lessonForm.resources
        });
        setLessonForm((current) => ({ ...current, titleEn: '', titleAm: '', objectivesEn: '', objectivesAm: '', activitiesEn: '', activitiesAm: '', resources: '' }));
      }, t('lessonPlanSaved'))}>
        <div className="form-grid">
          <label>{t('teachingAssignment')}<select required value={lessonForm.teachingAssignmentId} onChange={(event) => setLessonForm((value) => ({ ...value, teachingAssignmentId: event.target.value, curriculumUnitId: '' }))}>
            <option value="">{t('chooseAssignment')}</option>{weekAssignments.map((item) => <option key={item.id} value={item.id}>{item.sectionName} · {item.subjectName} · {item.staffName}</option>)}
          </select></label>
          <label>{t('curriculumUnit')}<select value={lessonForm.curriculumUnitId} onChange={(event) => setLessonForm((value) => ({ ...value, curriculumUnitId: event.target.value }))}>
            <option value="">{t('noCurriculumUnit')}</option>{availableLessonUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.unitNumber}. {unit.titleEn}</option>)}
          </select></label>
          <FormInput label={t('plannedDate')} type="date" value={lessonForm.plannedOn} onChange={(plannedOn) => setLessonForm((value) => ({ ...value, plannedOn }))} required />
          <FormInput label={t('titleEnglish')} value={lessonForm.titleEn} onChange={(titleEn) => setLessonForm((value) => ({ ...value, titleEn }))} required />
          <FormInput label={t('titleAmharic')} value={lessonForm.titleAm} onChange={(titleAm) => setLessonForm((value) => ({ ...value, titleAm }))} required />
          <FormInput label={t('objectivesEnglish')} value={lessonForm.objectivesEn} onChange={(objectivesEn) => setLessonForm((value) => ({ ...value, objectivesEn }))} />
          <FormInput label={t('objectivesAmharic')} value={lessonForm.objectivesAm} onChange={(objectivesAm) => setLessonForm((value) => ({ ...value, objectivesAm }))} />
          <FormInput label={t('activitiesEnglish')} value={lessonForm.activitiesEn} onChange={(activitiesEn) => setLessonForm((value) => ({ ...value, activitiesEn }))} />
          <FormInput label={t('activitiesAmharic')} value={lessonForm.activitiesAm} onChange={(activitiesAm) => setLessonForm((value) => ({ ...value, activitiesAm }))} />
          <FormInput label={t('learningResources')} value={lessonForm.resources} onChange={(resources) => setLessonForm((value) => ({ ...value, resources }))} />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !lessonForm.teachingAssignmentId}>{t('saveLessonPlan')}</button></div>
      </form>
      <div className="setup-list">{lessonPlans.length ? lessonPlans.map((plan) => <div className="setting-row" key={plan.id}>
        <span><strong>{plan.plannedOn} · {plan.titleEn} · {plan.titleAm}</strong><small>{plan.sectionName} · {plan.subjectName} · {plan.teacherName} · {t(plan.status)}</small></span>
        {plan.status === 'planned' && <button type="button" className="button button-quiet" disabled={busy} onClick={() => void runAction(() => api.updateLessonPlan(plan.id, { status: 'completed' }), t('lessonPlanCompleted'))}>{t('markCompleted')}</button>}
      </div>) : <p className="muted">{t('noLessonPlans')}</p>}</div>
    </section>}
    {canManage && <section className="panel settings-panel substitution-panel">
      <div className="panel-heading"><div><h2>{t('assignSubstitute')}</h2><p>{t('substituteLeaveRule')}</p></div></div>
      <form onSubmit={(event) => void submit(event, async () => {
        await api.assignTimetableSubstitute(substitutionForm.assignmentId, {
          substituteStaffId: substitutionForm.substituteStaffId, date,
          leaveRequestId: substitutionForm.leaveRequestId, reason: substitutionForm.reason
        });
        setSubstitutionForm({ assignmentId: '', substituteStaffId: '', leaveRequestId: '', reason: '' });
      }, t('substituteSaved'))}>
        <div className="form-grid">
          <label>{t('assignment')}<select required value={substitutionForm.assignmentId} onChange={(event) => setSubstitutionForm((current) => ({
            ...current, assignmentId: event.target.value, leaveRequestId: ''
          }))}><option value="">{t('chooseAssignment')}</option>{weekAssignments.filter((item) => item.dayOfWeek === ((new Date(`${date}T00:00:00`).getDay() + 6) % 7 + 1)).map((item) =>
            <option key={item.id} value={item.id}>{item.sectionName} · {item.subjectName} · {item.staffName}</option>)}</select></label>
          <label>{t('substituteTeacher')}<select required value={substitutionForm.substituteStaffId} onChange={(event) => setSubstitutionForm((current) => ({ ...current, substituteStaffId: event.target.value }))}><option value="">{t('chooseTeacher')}</option>{staff.filter((person) => person.id !== selectedAssignment?.staffId && person.employmentStatus === 'active').map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label>{t('approvedLeave')}<select required value={substitutionForm.leaveRequestId} onChange={(event) => setSubstitutionForm((current) => ({ ...current, leaveRequestId: event.target.value }))}><option value="">{t('chooseApprovedLeave')}</option>{eligibleLeaves.map((leave) => <option key={leave.id} value={leave.id}>{leave.startDate} – {leave.endDate} · {leave.reason}</option>)}</select></label>
          <FormInput label={t('leaveReason')} value={substitutionForm.reason} onChange={(reason) => setSubstitutionForm((current) => ({ ...current, reason }))} required />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !eligibleLeaves.length || !substitutionForm.assignmentId}>{t('assignSubstitute')}</button></div>
        {substitutionForm.assignmentId && !eligibleLeaves.length && <p className="muted">{t('noApprovedLeaveForDate')}</p>}
      </form>
    </section>}
  </>;
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
