import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, OrganizationBranch, pendingOfflineCount, setAccessToken, syncOfflineOperations, User } from './api';
import { Locale, translate } from './i18n';
import { ForgotPasswordPage, InvitationSetupPage, LoginPage, PasswordChangePage, PasswordResetPage } from './pages/auth/AuthPages';
import { PublicAdmissionPage, PublicTransferPage } from './pages/public/PublicStudentPages';
import AdmissionsPage from './pages/admissions/AdmissionsPage';
import PortalPage from './pages/portal/PortalPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import AttendancePage from './pages/attendance/AttendancePage';
import FeesPage from './pages/fees/FeesPage';
import CommunicationsPage from './pages/communications/CommunicationsPage';
import TimetablePage from './pages/timetable/TimetablePage';
import { SchoolAccountsPage, StaffPage } from './pages/staff/StaffPages';
import PlatformAdminPage from './pages/platform/PlatformAdminPage';
import SchoolPage from './pages/school/SchoolPage';
import SchoolSubscriptionPage from './pages/school/SchoolSubscriptionPage';
import BranchesPage from './pages/school/BranchesPage';
import MarksPage from './pages/marks/MarksPage';
import StudentsPage from './pages/students/StudentsPage';
import PwaInstallButton from './components/PwaInstallButton';
import NotificationMenu from './components/NotificationMenu';
import SidebarNavGroup, { SidebarNavGroupDefinition } from './components/SidebarNavGroup';
import routeTitle from './utils/routeTitle';

type T = (key: string) => string;

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => localStorage.getItem('sims_locale') === 'am' ? 'am' : 'en');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncNotice, setSyncNotice] = useState(false);
  const [branches, setBranches] = useState<OrganizationBranch[]>([]);
  const [branchSwitchError, setBranchSwitchError] = useState('');
  const [branchSwitchBusy, setBranchSwitchBusy] = useState(false);
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
    if (!user || user.role !== 'owner_director') { setBranches([]); return; }
    let active = true;
    api.schoolBranches().then((items) => {
      if (active) { setBranches(items); setBranchSwitchError(''); }
    }).catch((reason) => {
      if (active) {
        setBranches([]);
        setBranchSwitchError(reason instanceof Error ? reason.message : t('apiError'));
      }
    });
    return () => { active = false; };
  }, [user?.id, user?.role, user?.campusIds.join('|'), t]);
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
  const switchBranch = async (campusId: string) => {
    if (!user || campusId === user.activeCampusId) return;
    setBranchSwitchBusy(true); setBranchSwitchError('');
    try { setUser(await api.switchBranch(campusId)); }
    catch (reason) { setBranchSwitchError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBranchSwitchBusy(false); }
  };
  const updateCurrentUser = (updated: User) => setUser(updated);

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
      ...(user.role === 'owner_director' ? [{ label: t('branches'), to: '/branches', icon: '⌂' }] : []),
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
            {user.role === 'owner_director' && user.campusIds.length > 1 && <label className="branch-switcher">
              <span className="sr-only">{t('switchBranch')}</span>
              <select aria-label={t('switchBranch')} value={user.activeCampusId}
                disabled={branchSwitchBusy}
                onChange={(event) => void switchBranch(event.target.value)}>
                {branches.filter((branch) => branch.isActive && user.campusIds.includes(branch.id))
                  .map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>}
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
        {branchSwitchError && <div className="form-error" role="alert">{branchSwitchError}</div>}
        {!online && <div className="offline-banner">{t('offline')} · {pending} {t('pendingSync')}</div>}
        {syncNotice && <div className="sync-banner">{t('syncComplete')}</div>}
        <section className="page-content">
          <Routes key={user.activeCampusId}>
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
            <Route path="/branches" element={user.role === 'owner_director'
              ? <BranchesPage t={t} user={user} onUserUpdate={updateCurrentUser} />
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
