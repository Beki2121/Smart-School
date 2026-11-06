import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, OrganizationBranch, pendingOfflineCount, setAccessToken, syncOfflineOperations, User } from './api';
import { Locale, translate } from './i18n';
import { ForgotPasswordPage, InvitationSetupPage, LoginPage, PasswordChangePage, PasswordResetPage } from './pages/auth/AuthPages';
import { PublicAdmissionPage, PublicTransferPage } from './pages/public/PublicStudentPages';
import LandingPage from './pages/public/LandingPage';
import AdmissionsPage from './pages/admissions/AdmissionsPage';
import PortalPage from './pages/portal/PortalPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import ReportsPage from './pages/reports/ReportsPage';
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
import ExamsPage from './pages/exams/ExamsPage';
import AssignmentsPage from './pages/assignments/AssignmentsPage';
import HrDashboardPage from './pages/hr/HrDashboardPage';
import HrManagementPage from './pages/hr/HrManagementPage';
import PayrollPage from './pages/payroll/PayrollPage';
import LibraryPage from './pages/library/LibraryPage';
import InventoryPage from './pages/inventory/InventoryPage';
import FrontDeskPage from './pages/front-desk/FrontDeskPage';
import SupportPage from './pages/support/SupportPage';
import StudentsPage from './pages/students/StudentsPage';
import AuditLogPage from './pages/audit/AuditLogPage';
import RolesPermissionsPage from './pages/accounts/RolesPermissionsPage';
import PwaInstallButton from './components/PwaInstallButton';
import NotificationMenu from './components/NotificationMenu';
import SidebarNavGroup from './components/SidebarNavGroup';
import routeTitle from './utils/routeTitle';
import { getSchoolNavigation } from './navigation';

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
  const hasPermission = (permission: string, legacyRoles: string[]) =>
    user?.permissions ? user.permissions.includes(permission) : legacyRoles.includes(user?.role ?? '');
  const canViewStaff = hasPermission('staff.view', ['owner_director', 'group_executive', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin']);
  const canManageStaff = hasPermission('staff.manage', ['owner_director', 'principal', 'hr_admin', 'system_admin']);
  const canManageAccounts = hasPermission('accounts.manage', ['owner_director', 'principal', 'registrar', 'hr_admin', 'system_admin']);
  const canManageAssignments = hasPermission('assignments.manage', ['owner_director', 'principal', 'academic_head', 'hr_admin', 'system_admin']);
  const canViewAdmissions = hasPermission('admissions.view', ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin']);
  const canManageAdmissions = hasPermission('admissions.manage', ['owner_director', 'principal', 'registrar', 'system_admin']);
  const canManageStudentRecords = hasPermission('students.edit', ['owner_director', 'principal', 'registrar', 'system_admin']);
  const canViewAlumni = hasPermission('students.alumni.view', ['owner_director', 'principal', 'registrar', 'system_admin']);
  const canViewStudentSensitiveData = hasPermission('students.sensitive.view', ['owner_director', 'principal', 'registrar', 'counsellor', 'system_admin']);
  const canManageStudentSensitiveData = hasPermission('students.sensitive.manage', ['owner_director', 'principal', 'registrar', 'system_admin']);
  const canViewStudentDiscipline = hasPermission('students.discipline.view', ['owner_director', 'principal', 'registrar', 'counsellor', 'system_admin']);
  const canManageStudentDiscipline = hasPermission('students.discipline.manage', ['owner_director', 'principal', 'counsellor', 'system_admin']);
  const canApproveStudentTransfers = hasPermission('students.transfer.approve', ['owner_director', 'principal', 'system_admin']);
  const canViewStudentGuardians = hasPermission('students.guardians.view', ['owner_director', 'principal', 'registrar', 'system_admin']);
  const canViewStudentCommendations = hasPermission('students.commendations.view', ['owner_director', 'principal', 'counsellor', 'system_admin']);
  const canManageStudentCommendations = hasPermission('students.commendations.manage', ['owner_director', 'principal', 'counsellor', 'system_admin']);
  const canManageGrading = hasPermission('school.edit', ['owner_director', 'principal', 'system_admin']);
  const canSubmitMarks = hasPermission('marks.enter', ['owner_director', 'principal', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin']);
  const canApproveMarks = hasPermission('marks.approve', ['owner_director', 'principal', 'academic_head', 'system_admin']);
  const canPublishMarks = canManageGrading;
  const canAmendMarks = canManageGrading;
  const canEditAttendance = hasPermission('attendance.edit', ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin']);
  const canReviewAttendanceCorrections = hasPermission('attendance.corrections.review', ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin']);
  const canViewFees = hasPermission('fees.view', ['owner_director', 'principal', 'registrar', 'accountant_cashier', 'system_admin']);
  const canViewPayroll = hasPermission('payroll.run.view',
    ['payroll_officer', 'owner_director', 'principal', 'system_admin']);
  const canViewLibrary = hasPermission('library.catalog.view',
    ['library_librarian', 'owner_director', 'principal', 'system_admin']) ||
    hasPermission('library.portal.view', ['student', 'parent_guardian', 'homeroom_teacher', 'subject_teacher']);
  const canViewInventory = hasPermission('inventory.items.view',
    ['store_keeper', 'owner_director', 'principal', 'system_admin']) ||
    hasPermission('inventory.assets.self.view', ['homeroom_teacher', 'subject_teacher', 'hr_admin']);
  const canViewFrontDesk = [
    'frontdesk.visitors.view', 'frontdesk.appointments.view', 'frontdesk.appointments.self.view',
    'frontdesk.messages.view', 'frontdesk.messages.self.view', 'frontdesk.pickup.log.view',
    'frontdesk.deliveries.view', 'frontdesk.lost-found.view'
  ].some((permission) => hasPermission(permission, []));
  const canViewSupport = [
    'support.tickets.view', 'support.internal.view', 'support.platform.view',
    'integrations.email.view'
  ].some((permission) => hasPermission(permission, []));
  const canManageFees = hasPermission('fees.manage', ['owner_director', 'principal', 'system_admin']);
  const canCollectFees = hasPermission('fees.collect', ['owner_director', 'principal', 'accountant_cashier', 'system_admin']);
  const canApproveFeeRequests = hasPermission('fees.discount.approve', ['principal']);
  const canReverseFees = hasPermission('fees.reverse', ['owner_director', 'principal', 'system_admin']);
  const canViewCommunications = hasPermission('communications.view', ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin']);
  const canManageCommunications = hasPermission('communications.manage', ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'system_admin']);
  const canViewDashboard = hasPermission('dashboard.view', ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin']);
  const canViewReports = [
    'reports.students.view', 'reports.admissions.view', 'reports.attendance.view',
    'reports.academics.view', 'reports.finance.view', 'reports.hr.view',
    'reports.operations.view', 'payroll.reports.view', 'frontdesk.reports.view'
  ].some((permission) => hasPermission(permission, [
    'owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher',
    'subject_teacher', 'accountant_cashier', 'hr_admin', 'payroll_officer', 'system_admin'
  ]));
  const canViewAcademicReports = hasPermission('reports.academics.view',
    ['owner_director', 'principal', 'academic_head', 'homeroom_teacher',
      'subject_teacher', 'system_admin']);
  const canViewHrDashboard = hasPermission('hr.dashboard.view',
    ['owner_director', 'principal', 'hr_admin', 'system_admin']);
  const hrAccess = {
    staffView: hasPermission('staff.view', ['owner_director', 'principal', 'hr_admin', 'system_admin']),
    staffEdit: hasPermission('hr.staff.manage', ['owner_director', 'hr_admin', 'system_admin']),
    staffArchive: hasPermission('hr.staff.archive', ['owner_director', 'hr_admin', 'system_admin']),
    staffImport: hasPermission('hr.staff.import', ['owner_director', 'hr_admin', 'system_admin']),
    documentView: hasPermission('hr.documents.view', ['owner_director', 'principal', 'hr_admin', 'system_admin']),
    documentManage: hasPermission('hr.documents.manage', ['owner_director', 'hr_admin', 'system_admin']),
    contractView: hasPermission('hr.contracts.view', ['owner_director', 'principal', 'hr_admin', 'system_admin']),
    contractManage: hasPermission('hr.contracts.manage', ['owner_director', 'hr_admin', 'system_admin']),
    leaveView: hasPermission('hr.leave.view', ['owner_director', 'principal', 'hr_admin', 'system_admin']),
    leaveConfigure: hasPermission('hr.leave.configure', ['owner_director', 'hr_admin', 'system_admin']),
    balanceManage: hasPermission('hr.leave.balance.manage', ['owner_director', 'hr_admin', 'system_admin']),
    recruitmentView: hasPermission('hr.recruitment.view', ['owner_director', 'principal', 'hr_admin', 'system_admin']),
    recruitmentManage: hasPermission('hr.recruitment.manage', ['owner_director', 'hr_admin', 'system_admin']),
    performanceView: hasPermission('hr.performance.view', ['owner_director', 'hr_admin', 'system_admin']),
    performanceManage: hasPermission('hr.performance.manage', ['owner_director', 'hr_admin', 'system_admin']),
    trainingView: hasPermission('hr.training.view', ['owner_director', 'principal', 'hr_admin', 'system_admin']),
    trainingManage: hasPermission('hr.training.manage', ['owner_director', 'hr_admin', 'system_admin'])
  };
  const canAccessHrManagement = Object.values(hrAccess).some(Boolean);
  const canViewStudents = hasPermission('students.view', ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'counsellor', 'system_admin']);
  const canViewAttendance = hasPermission('attendance.view', ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin']);
  const canViewMarks = hasPermission('marks.view', ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin']);
  const canViewExams = hasPermission('exams.view', ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher']);
  const canManageExams = hasPermission('exams.manage', ['owner_director', 'principal', 'academic_head']);
  const canMonitorExams = hasPermission('exams.monitor', ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher']);
  const canManageAssignmentsPage = hasPermission('assignments.manage',
    ['owner_director', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin']);
  const canViewSchoolSetup = hasPermission('school.view', ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin']);

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
  if (!user) return <Routes>
    <Route path="/" element={<LandingPage
      t={t} locale={locale} onLocaleChange={setLocale}
      contact={{
        email: import.meta.env.VITE_CONTACT_EMAIL?.trim() ?? '',
        phone: import.meta.env.VITE_CONTACT_PHONE?.trim() ?? '',
        address: import.meta.env.VITE_CONTACT_ADDRESS?.trim() ?? ''
      }}
    />} />
    <Route path="/login" element={<LoginPage t={t} onLogin={onLogin} />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
  if (user.mustChangePassword) return <PasswordChangePage
    t={t} user={user} onChanged={(updatedUser) => setUser(updatedUser)}
  />;
  if (user.role === 'super_admin') return <PlatformAdminPage t={t} user={user} onLogout={onLogout} />;
  if (['parent_guardian', 'student'].includes(user.role)) {
    return <PortalPage user={user} locale={locale} t={t} onLogout={onLogout} />;
  }

  const schoolNavGroups = getSchoolNavigation(user.permissions ?? user.role, t);

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
            <Route path="/students" element={canViewStudents ? <StudentsPage t={t} locale={locale} canManage={canManageStudentRecords} canViewAlumni={canViewAlumni} canManageAdmissions={canManageAdmissions} canOverrideProgression={hasPermission('students.progression.override', ['owner_director', 'principal', 'system_admin'])} canViewSensitiveData={canViewStudentSensitiveData} canManageSensitiveData={canManageStudentSensitiveData} canViewEmergencyContacts={canViewStudentSensitiveData} canManageEmergencyContacts={canManageStudentSensitiveData} canViewGuardians={canViewStudentGuardians} canViewCommendations={canViewStudentCommendations} canManageCommendations={canManageStudentCommendations} canViewDiscipline={canViewStudentDiscipline} canManageDiscipline={canManageStudentDiscipline} canApproveTransfers={canApproveStudentTransfers} /> : <Navigate to="/" replace />} />
            <Route path="/reports" element={canViewReports ? <ReportsPage t={t} /> : <Navigate to="/" replace />} />
            <Route path="/hr" element={canViewHrDashboard
              ? <HrDashboardPage t={t} /> : <Navigate to="/" replace />} />
            <Route path="/hr-management" element={canAccessHrManagement
              ? <HrManagementPage t={t} access={hrAccess} /> : <Navigate to="/" replace />} />
            <Route path="/payroll" element={canViewPayroll
              ? <PayrollPage t={t} permissions={user.permissions ?? []} />
              : <Navigate to="/" replace />} />
             <Route path="/library" element={canViewLibrary
               ? <LibraryPage t={t} permissions={user.permissions ?? []} />
              : <Navigate to="/" replace />} />
             <Route path="/inventory" element={canViewInventory
               ? <InventoryPage t={t} permissions={user.permissions ?? []} />
               : <Navigate to="/" replace />} />
             <Route path="/front-desk" element={canViewFrontDesk
               ? <FrontDeskPage t={t} permissions={user.permissions ?? []} />
               : <Navigate to="/" replace />} />
             <Route path="/support" element={canViewSupport
               ? <SupportPage t={t} permissions={user.permissions ?? []} userId={user.id} />
               : <Navigate to="/" replace />} />
            <Route path="/my-classes" element={canViewAcademicReports &&
              ['homeroom_teacher', 'subject_teacher'].includes(user.role)
              ? <ReportsPage t={t} initialReportId="my-classes" />
              : <Navigate to="/" replace />} />
            <Route path="/student-progress" element={canViewAcademicReports
              ? <ReportsPage t={t} initialReportId="student-progress" />
              : <Navigate to="/" replace />} />
            <Route path="/attendance" element={canViewAttendance ? <AttendancePage t={t} onQueued={setQueued} ownerId={user.id} canEditAttendance={canEditAttendance} canReviewCorrections={canReviewAttendanceCorrections} /> : <Navigate to="/" replace />} />
            <Route path="/marks" element={canViewMarks ? <MarksPage t={t} onQueued={setQueued} ownerId={user.id} canManageGrading={canManageGrading} canSubmitMarks={canSubmitMarks} canApproveMarks={canApproveMarks} canPublishMarks={canPublishMarks} canAmendMarks={canAmendMarks} locale={locale} /> : <Navigate to="/" replace />} />
            <Route path="/exams" element={canViewExams
              ? <ExamsPage t={t} locale={locale} canManage={canManageExams} canMonitor={canMonitorExams} />
              : <Navigate to="/" replace />} />
            <Route path="/assignments" element={canManageAssignmentsPage
              ? <AssignmentsPage t={t} locale={locale} />
              : <Navigate to="/" replace />} />
            <Route path="/fees" element={canViewFees ? <FeesPage t={t} locale={locale} canManage={canManageFees} canCollect={canCollectFees} canApprove={canApproveFeeRequests} canReverse={canReverseFees} /> : <Navigate to="/" replace />} />
            <Route path="/communications" element={canViewCommunications ? <CommunicationsPage t={t} locale={locale} canManage={canManageCommunications}
              canMessage={hasPermission('portal.messaging.view', ['owner_director', 'principal', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'])}
              canConfigureMessaging={hasPermission('portal.messaging.configure', ['owner_director', 'principal', 'system_admin'])}
              canHandleRequests={hasPermission('portal.requests.manage', ['owner_director', 'principal', 'registrar', 'system_admin'])} /> : <Navigate to="/" replace />} />
            <Route path="/timetable" element={canViewStaff ? <TimetablePage t={t} canManage={canManageAssignments} canManageLessons={hasPermission('lesson_plans.manage', ['owner_director', 'principal', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'])} /> : <Navigate to="/" replace />} />
            <Route path="/school" element={canViewSchoolSetup ? <SchoolPage t={t} locale={locale} /> : <Navigate to="/" replace />} />
            <Route path="/subscription" element={hasPermission('school.branches.manage', ['owner_director'])
              ? <SchoolSubscriptionPage t={t} />
              : <Navigate to="/" replace />} />
            <Route path="/branches" element={hasPermission('school.branches.manage', ['owner_director'])
              ? <BranchesPage t={t} user={user} onUserUpdate={updateCurrentUser} />
              : <Navigate to="/" replace />} />
            <Route path="/admissions" element={canViewAdmissions ? <AdmissionsPage t={t} canManage={canManageAdmissions} /> : <Navigate to="/" replace />} />
            <Route path="/staff" element={canViewStaff ? <StaffPage t={t} canManage={canManageStaff} canInviteStaff={canManageAccounts} canManageAssignments={canManageAssignments} user={user} /> : <Navigate to="/" replace />} />
            <Route path="/accounts" element={canManageAccounts ? <SchoolAccountsPage t={t} user={user} /> : <Navigate to="/" replace />} />
            <Route path="/roles" element={canManageAccounts
              ? <RolesPermissionsPage t={t} /> : <Navigate to="/" replace />} />
            <Route path="/audit" element={hasPermission('audit.view', ['owner_director', 'system_admin'])
              ? <AuditLogPage t={t} currentSessionId={user.sessionId}
                onCurrentSessionRevoked={onLogout} /> : <Navigate to="/" replace />} />
            <Route path="/login-history" element={hasPermission('audit.view', ['owner_director', 'system_admin'])
              ? <AuditLogPage t={t} history currentSessionId={user.sessionId}
                onCurrentSessionRevoked={onLogout} /> : <Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </section>
      </main>
    </div>
  );
}
