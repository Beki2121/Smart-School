import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, AcademicYear, AcademicYearRecord, Admission, AttendanceSession, Dashboard, Department, GradeLevel, LeaveRequest, Mark, pendingOfflineCount, queueOfflineOperation, SchoolProfile, Section, setAccessToken, StaffAttendance, StaffMember, StaffMessage, Student, StudentGuardian, Subject, syncOfflineOperations, TeachingAssignment, Term, User } from './api';
import { Locale, translate } from './i18n';
import { formatEthiopianDate } from './calendar';

type T = (key: string) => string;

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => localStorage.getItem('sims_locale') === 'am' ? 'am' : 'en');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [syncNotice, setSyncNotice] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const t: T = useCallback((key) => translate(locale, key), [locale]);
  const canViewStaff = ['owner_director', 'group_executive', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'].includes(user?.role ?? '');
  const canManageStaff = ['owner_director', 'principal', 'hr_admin', 'system_admin'].includes(user?.role ?? '');
  const canManageAssignments = ['owner_director', 'principal', 'academic_head', 'hr_admin', 'system_admin'].includes(user?.role ?? '');
  const canViewAdmissions = ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'].includes(user?.role ?? '');
  const canManageAdmissions = ['owner_director', 'principal', 'registrar', 'system_admin'].includes(user?.role ?? '');
  const canManageStudentRecords = ['owner_director', 'principal', 'registrar', 'system_admin'].includes(user?.role ?? '');
  const canViewStudentGuardians = canManageStudentRecords;

  useEffect(() => { localStorage.setItem('sims_locale', locale); }, [locale]);
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
  if (!user) return <LoginPage t={t} onLogin={onLogin} />;

  return (
    <div className={`app-shell ${locale === 'am' ? 'locale-am' : ''}`}>
      <aside className="sidebar">
        <Link className="brand" to="/">
          <span className="brand-mark">S</span>
          <span><strong>{t('brand')}</strong><small>{t('subtitle')}</small></span>
        </Link>
        <div className="campus-label"><span className="campus-dot" />{t('campus')}</div>
        <nav className="primary-nav" aria-label={t('subtitle')}>
          <NavLink end to="/"><span className="nav-icon">▦</span>{t('overview')}</NavLink>
          <NavLink to="/students"><span className="nav-icon">♙</span>{t('students')}</NavLink>
          <NavLink to="/attendance"><span className="nav-icon">✓</span>{t('attendance')}</NavLink>
          <NavLink to="/marks"><span className="nav-icon">▤</span>{t('marks')}</NavLink>
          <NavLink to="/school"><span className="nav-icon">⌂</span>{t('schoolSetup')}</NavLink>
          {canViewAdmissions && <NavLink to="/admissions"><span className="nav-icon">▣</span>{t('admissions')}</NavLink>}
          {canViewStaff && <NavLink to="/staff"><span className="nav-icon">♙</span>{t('staff')}</NavLink>}
        </nav>
        <div className="sidebar-bottom">
          <div className={`connection-status ${online ? '' : 'is-offline'}`}>
            <span className="status-dot" />{online ? t('online') : t('offline')}
            {pending > 0 && <small>{pending} {t('pendingSync')}</small>}
          </div>
          <div className="profile-mini">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <span className="profile-name"><strong>{user.name}</strong><small>{t('role')}</small></span>
            <button className="icon-button" onClick={onLogout} title={t('signOut')} aria-label={t('signOut')}>↗</button>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>{t('campus')}</span><span className="crumb-separator">/</span><strong>{routeTitle(location.pathname, t)}</strong></div>
          <div className="topbar-actions">
            <div className="locale-switch" aria-label={t('language')}>
              <button className={locale === 'en' ? 'selected' : ''} onClick={() => setLocale('en')}>EN</button>
              <button className={locale === 'am' ? 'selected' : ''} onClick={() => setLocale('am')}>አማ</button>
            </div>
            <button className="notification-button" aria-label={t('notifications')}>♧<i /></button>
            <span className="avatar avatar-small">{user.name.slice(0, 1)}</span>
          </div>
        </header>
        {!online && <div className="offline-banner">{t('offline')} · {pending} {t('pendingSync')}</div>}
        {syncNotice && <div className="sync-banner">{t('syncComplete')}</div>}
        <section className="page-content">
          <Routes>
            <Route path="/" element={<DashboardPage t={t} user={user} locale={locale} />} />
            <Route path="/students" element={<StudentsPage t={t} canManage={canManageStudentRecords} canViewGuardians={canViewStudentGuardians} />} />
            <Route path="/attendance" element={<AttendancePage t={t} onQueued={setQueued} ownerId={user.id} />} />
            <Route path="/marks" element={<MarksPage t={t} onQueued={setQueued} ownerId={user.id} />} />
            <Route path="/school" element={<SchoolPage t={t} />} />
            <Route path="/admissions" element={canViewAdmissions ? <AdmissionsPage t={t} canManage={canManageAdmissions} /> : <Navigate to="/" replace />} />
            <Route path="/staff" element={canViewStaff ? <StaffPage t={t} canManage={canManageStaff} canManageAssignments={canManageAssignments} user={user} /> : <Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </section>
      </main>
    </div>
  );
}

function routeTitle(path: string, t: T) {
  if (path.startsWith('/staff')) return t('staff');
  if (path.startsWith('/admissions')) return t('admissions');
  if (path.startsWith('/students')) return t('students');
  if (path.startsWith('/attendance')) return t('attendance');
  if (path.startsWith('/marks')) return t('marks');
  if (path.startsWith('/school')) return t('schoolSetup');
  return t('overview');
}

function LoginPage({ t, onLogin }: { t: T; onLogin: (login: string, password: string) => Promise<void> }) {
  const [login, setLogin] = useState('admin@school.local');
  const [password, setPassword] = useState('ChangeMe123!');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try { await onLogin(login, password); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  return (
    <div className="login-page">
      <div className="login-visual">
        <div className="login-brand"><span className="brand-mark">S</span><strong>{t('brand')}</strong></div>
        <div className="login-message"><span className="eyebrow">{t('releaseOne')}</span><h1>{t('welcome')}</h1><p>{t('welcomeNote')}</p><div className="login-orbit">እንኳን ደህና መጡ</div></div>
        <span className="login-foot">{t('campus')} · {t('location')}</span>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>{t('signIn')}</h2><p className="muted">{t('signInHint')}</p>
        <label>{t('email')}<input autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required /></label>
        <label>{t('password')}<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <div className="form-error">{error}</div>}
        <button className="button button-primary full-width" disabled={busy}>{busy ? t('loading') : t('signInAction')}<span>→</span></button>
        <div className="demo-credentials">{t('demoNote')}<br /><small>{t('demoStorage')}</small></div>
      </form>
    </div>
  );
}

function DashboardPage({ t, user, locale }: { t: T; user: User; locale: Locale }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.dashboard().then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (error) return <ErrorState t={t} error={error} retry={load} />;
  if (!data) return <div className="loading-state">{t('loading')}</div>;
  return (
    <>
      <div className="page-heading">
        <div><div className="eyebrow">{t('today')} · {formatEthiopianDate({
          year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate()
        }, locale)}</div><h1>{t('welcome')}, <span>{user.name}</span></h1><p>{t('welcomeNote')}</p></div>
        <span className="release-pill"><i />{t('releaseOne')}</span>
      </div>
      {data.mode === 'memory' && <div className="notice notice-warm">⚠ {t('demoStorage')}</div>}
      <div className="metric-grid">
        <MetricCard icon="♙" tone="blue" label={t('totalStudents')} value={data.studentCount} trend={t('studentCountLabel')} />
        <MetricCard icon="✓" tone="green" label={t('attendanceToday')} value={data.attendanceToday} trend={`${data.attendanceSessions} ${t('attendanceSessions').toLowerCase()}`} />
        <MetricCard icon="▤" tone="purple" label={t('marksRecorded')} value={data.marksRecorded} trend={t('releaseOne')} />
        <MetricCard icon="⌂" tone="orange" label={t('activeCampus')} value="01" trend={t('campus')} />
      </div>
      <div className="dashboard-grid">
        <section className="panel distribution-panel">
          <div className="panel-heading"><div><h2>{t('gradeDistribution')}</h2><p>{t('studentCountLabel')}</p></div><span className="panel-kebab">···</span></div>
          <div className="distribution-total"><strong>{data.studentCount}</strong><span>{t('totalStudents').toLowerCase()}</span></div>
          <div className="bar-chart" aria-label={t('gradeDistribution')}>
            {data.sectionDistribution.slice(0, 6).map((section) => {
              const maxCount = Math.max(...data.sectionDistribution.map((item) => item.count), 1);
              return <div className="bar-column" key={section.sectionName}><span title={`${section.sectionName}: ${section.count}`} style={{ height: `${Math.max(10, (section.count / maxCount) * 88)}%` }} /><small>{section.sectionName}</small></div>;
            })}
            {!data.sectionDistribution.length && <div className="chart-empty">{t('noSectionData')}</div>}
          </div>
          <div className="chart-legend"><span><i className="legend-blue" />{t('femaleCount')}: {data.genderTotals.female}</span><span><i className="legend-mint" />{t('maleCount')}: {data.genderTotals.male}</span></div>
        </section>
        <section className="panel quick-panel">
          <div className="panel-heading"><div><h2>{t('shortcuts')}</h2><p>{t('everydayTasks')}</p></div></div>
          <div className="quick-actions">
            <Link to="/students"><span className="quick-icon blue-icon">＋</span><span><strong>{t('addLearner')}</strong><small>{t('studentRecords')}</small></span><b>→</b></Link>
            <Link to="/attendance"><span className="quick-icon green-icon">✓</span><span><strong>{t('takeAttendance')}</strong><small>{t('attendanceTitle')}</small></span><b>→</b></Link>
            <Link to="/marks"><span className="quick-icon purple-icon">▤</span><span><strong>{t('enterMarks')}</strong><small>{t('marksTitle')}</small></span><b>→</b></Link>
          </div>
        </section>
        <section className="panel recent-panel">
          <div className="panel-heading"><div><h2>{t('recentStudents')}</h2><p>{t('studentRecords')}</p></div><Link to="/students" className="text-link">{t('viewAll')} →</Link></div>
          {data.recentStudents.length ? <StudentTable students={data.recentStudents} t={t} /> : <div className="empty-state">{t('emptyStudents')}</div>}
        </section>
        <section className="panel attendance-summary">
          <div className="panel-heading"><div><h2>{t('attendanceTitle')}</h2><p>{t('sectionGrade')}</p></div><Link to="/attendance" className="text-link">{t('viewAll')} →</Link></div>
          <div className="attendance-ring"><div><strong>{data.studentCount ? '—' : '0%'}</strong><small>{t('attendanceToday')}</small></div></div>
          <div className="attendance-foot"><span><i className="legend-green" />{t('present')}</span><span><i className="legend-red" />{t('absent')}</span></div>
        </section>
      </div>
    </>
  );
}

function MetricCard({ icon, tone, label, value, trend }: { icon: string; tone: string; label: string; value: number | string; trend: string }) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}>{icon}</span><div className="metric-content"><span>{label}</span><strong>{value}</strong><small>{trend}</small></div><span className="metric-more">···</span></article>;
}

function AdmissionsPage({ t, canManage }: { t: T; canManage: boolean }) {
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [grades, setGrades] = useState<GradeLevel[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [dashboard, setDashboard] = useState<{ total: number; byStatus: Record<string, number> }>({ total: 0, byStatus: {} });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Admission['status'] | ''>('');
  const [showIntake, setShowIntake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    const [rows, totals, gradeRows, sectionRows, studentRows] = await Promise.all([
      api.admissions('', status), api.admissionDashboard(), api.grades(), api.sections(), api.students()
    ]);
    setAdmissions(rows);
    setDashboard(totals);
    setGrades(gradeRows);
    setSections(sectionRows);
    setStudents(studentRows);
  }, [status]);
  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError'))); }, [load, t]);
  const runAction = async (action: () => Promise<unknown>, message: string | null = 'changesSaved'): Promise<boolean> => {
    setBusy(true); setError(''); setNotice('');
    try {
      await action();
      if (message) setNotice(t(message));
      await load();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
      return false;
    } finally { setBusy(false); }
  };
  const filtered = admissions.filter((item) => [
    item.givenNameEn, item.fatherNameEn, item.grandfatherNameEn, item.givenNameAm,
    item.fatherNameAm, item.grandfatherNameAm, item.guardianName, item.guardianPhone, item.studentNo ?? ''
  ].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const saveIntake = async (body: Record<string, unknown>) => {
    if (await runAction(() => api.createAdmission(body), 'admissionSaved')) setShowIntake(false);
  };
  return <>
    <div className="page-heading compact-heading">
      <div><div className="eyebrow">{t('campus')}</div><h1>{t('admissions')}</h1><p>{dashboard.total} {t('records')}</p></div>
      {canManage && <button className="button button-primary" onClick={() => setShowIntake((open) => !open)}>＋ {t('newEnquiry')}</button>}
    </div>
    <div className="admission-metrics">
      {(['enquiry', 'application', 'interview', 'accepted'] as const).map((key) =>
        <div className="admission-metric" key={key}><span>{t(key)}</span><strong>{dashboard.byStatus[key] ?? 0}</strong></div>
      )}
    </div>
    {notice && <div className="notice notice-success">{notice}</div>}
    {error && <div className="notice notice-error">{error}</div>}
    {showIntake && canManage && <section className="panel settings-panel"><div className="panel-heading"><div><h2>{t('newEnquiry')}</h2><p>{t('duplicateHint')}</p></div></div>
      <AdmissionIntakeForm t={t} grades={grades} busy={busy} onCancel={() => setShowIntake(false)} onSave={saveIntake} />
    </section>}
    <section className="panel admissions-panel">
      <div className="table-toolbar">
        <div className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchAdmissions')} /></div>
        <label className="admission-filter">{t('state')}<select value={status} onChange={(event) => setStatus(event.target.value as Admission['status'] | '')}>
          <option value="">{t('allStatuses')}</option>
          {(['enquiry', 'application', 'interview', 'accepted', 'waitlisted', 'rejected', 'enrolled', 'withdrawn', 'transferred_out'] as const).map((item) =>
            <option value={item} key={item}>{t(item)}</option>)}
        </select></label>
        <span className="table-count">{filtered.length} {t('records')}</span>
      </div>
      {filtered.length ? filtered.map((item) =>
        <AdmissionCard key={item.id} item={item} sections={sections} students={students} t={t} canManage={canManage} busy={busy} runAction={runAction} />
      ) : <div className="empty-state">{t('noAdmissions')}</div>}
    </section>
  </>;
}

type AdmissionInput = {
  givenNameAm: string; fatherNameAm: string; grandfatherNameAm: string;
  givenNameEn: string; fatherNameEn: string; grandfatherNameEn: string;
  gender: Student['gender']; dateOfBirth: string; guardianName: string;
  guardianPhone: string; guardianEmail: string; gradeLevelId: string; previousSchool: string
};

function AdmissionIntakeForm({ t, grades, busy, onCancel, onSave }: {
  t: T; grades: GradeLevel[]; busy: boolean; onCancel: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>
}) {
  const [form, setForm] = useState<AdmissionInput>({
    givenNameAm: '', fatherNameAm: '', grandfatherNameAm: '',
    givenNameEn: '', fatherNameEn: '', grandfatherNameEn: '',
    gender: 'female', dateOfBirth: '', guardianName: '', guardianPhone: '',
    guardianEmail: '', gradeLevelId: grades[0]?.id ?? '', previousSchool: ''
  });
  const [duplicates, setDuplicates] = useState<{ id: string; type: 'admission' | 'student'; status: string; name: string; guardianPhone: string }[]>([]);
  const [confirmDuplicates, setConfirmDuplicates] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const fullName = `${form.givenNameEn} ${form.fatherNameEn} ${form.grandfatherNameEn}`.trim();
  const update = (field: keyof AdmissionInput, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setDuplicates([]);
    setConfirmDuplicates(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (!confirmDuplicates) {
      setChecking(true);
      try {
        const matches = await api.admissionDuplicates({
          name: fullName.length >= 2 ? fullName : undefined,
          dateOfBirth: form.dateOfBirth || undefined,
          guardianPhone: form.guardianPhone.length >= 7 ? form.guardianPhone : undefined
        });
        setDuplicates(matches);
        if (matches.length) { setConfirmDuplicates(true); return; }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('apiError'));
        return;
      } finally { setChecking(false); }
    }
    await onSave({
      ...form,
      dateOfBirth: form.dateOfBirth || null,
      guardianEmail: form.guardianEmail || null,
      previousSchool: form.previousSchool || null
    });
  };
  return <form className="student-form" onSubmit={(event) => void submit(event)}>
    <div className="form-grid">
      <FormInput label={t('givenNameEn')} value={form.givenNameEn} onChange={(value) => update('givenNameEn', value)} required />
      <FormInput label={t('fatherNameEn')} value={form.fatherNameEn} onChange={(value) => update('fatherNameEn', value)} required />
      <FormInput label={t('grandfatherNameEn')} value={form.grandfatherNameEn} onChange={(value) => update('grandfatherNameEn', value)} required />
      <FormInput label={t('givenNameAm')} value={form.givenNameAm} onChange={(value) => update('givenNameAm', value)} required />
      <FormInput label={t('fatherNameAm')} value={form.fatherNameAm} onChange={(value) => update('fatherNameAm', value)} required />
      <FormInput label={t('grandfatherNameAm')} value={form.grandfatherNameAm} onChange={(value) => update('grandfatherNameAm', value)} required />
      <label>{t('gender')}<select value={form.gender} onChange={(event) => update('gender', event.target.value)}><option value="female">{t('female')}</option><option value="male">{t('male')}</option><option value="other">{t('other')}</option></select></label>
      <FormInput label={t('dateOfBirth')} type="date" value={form.dateOfBirth} onChange={(value) => update('dateOfBirth', value)} />
      <label>{t('grade')}<select required value={form.gradeLevelId} onChange={(event) => update('gradeLevelId', event.target.value)}><option value="">{t('chooseGrade')}</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.nameEn} · {grade.nameAm}</option>)}</select></label>
      <FormInput label={t('guardianName')} value={form.guardianName} onChange={(value) => update('guardianName', value)} required />
      <FormInput label={t('guardianPhone')} value={form.guardianPhone} onChange={(value) => update('guardianPhone', value)} required />
      <FormInput label={t('guardianEmail')} type="email" value={form.guardianEmail} onChange={(value) => update('guardianEmail', value)} />
      <FormInput label={t('previousSchool')} value={form.previousSchool} onChange={(value) => update('previousSchool', value)} />
    </div>
    {duplicates.length > 0 && <div className="notice notice-warm">{t('duplicateWarning')}
      {duplicates.map((match) => <div key={`${match.type}:${match.id}`}>{match.name} · {t(match.type)} · {t(match.status)} · {match.guardianPhone}</div>)}
    </div>}
    {error && <div className="form-error">{error}</div>}
    <div className="form-actions"><button type="button" className="button button-quiet" onClick={onCancel}>{t('cancel')}</button><button className="button button-primary" disabled={busy || checking || grades.length === 0}>{checking ? t('checkingDuplicates') : confirmDuplicates ? t('createAnyway') : t('saveEnquiry')}</button></div>
    {!grades.length && <div className="form-error">{t('configureGradeFirst')}</div>}
  </form>;
}

function AdmissionCard({ item, sections, students, t, canManage, busy, runAction }: {
  item: Admission; sections: Section[]; students: Student[]; t: T; canManage: boolean; busy: boolean;
  runAction: (action: () => Promise<unknown>, message?: string | null) => Promise<boolean>
}) {
  const [interviewAt, setInterviewAt] = useState('');
  const [interviewResult, setInterviewResult] = useState('pending');
  const [sectionId, setSectionId] = useState('');
  const [siblingStudentId, setSiblingStudentId] = useState('');
  const [reason, setReason] = useState('');
  const applicantName = `${item.givenNameEn} ${item.fatherNameEn} ${item.grandfatherNameEn}`;
  const applicantNameAm = `${item.givenNameAm} ${item.fatherNameAm} ${item.grandfatherNameAm}`;
  const gradeSections = sections.filter((section) => section.gradeLevelId === item.gradeLevelId);
  const enrolledStudents = students.filter((student) => student.status === 'enrolled' && student.id !== item.studentId);
  const docsComplete = item.documentChecklist.every((document) => document.complete);
  const downloadHtml = async (title: string, getHtml: () => Promise<string>) => {
    await runAction(async () => {
      const html = await getHtml();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      link.download = `${title}-${item.studentNo ?? item.id}.html`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }, null);
  };
  const downloadDocument = async (documentId: string, name: string) => {
    await runAction(async () => {
      const blob = await api.downloadAdmissionDocument(item.id, documentId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, null);
  };
  const changeStudentStatus = (next: 'withdrawn' | 'transferred_out') => {
    const note = reason.trim();
    if (note.length < 3 || !item.studentId) return;
    void runAction(() => next === 'withdrawn'
      ? api.withdrawStudent(item.studentId!, note)
      : api.transferStudentOut(item.studentId!, note));
  };
  return <article className="admission-card">
    <div className="admission-card-heading">
      <div className="student-cell"><span className="student-avatar">{item.givenNameEn.slice(0, 1)}</span><span><strong>{applicantName}</strong><small>{applicantNameAm} · {item.gradeName}</small></span></div>
      <span className="status-pill">{t(item.status)}</span>
    </div>
    <div className="admission-details"><span>{t('guardianName')}: {item.guardianName}</span><span>{t('guardianPhone')}: {item.guardianPhone}</span><span>{t('dateOfBirth')}: {item.dateOfBirth ?? '—'}</span>{item.studentNo && <span>{t('studentNumber')}: {item.studentNo}</span>}</div>
    <div className="admission-checklist"><strong>{t('requiredDocuments')}</strong>{item.documentChecklist.map((document) => {
      const uploaded = item.documents.find((entry) => entry.documentType === document.type);
      return <div className="checklist-row" key={document.type}>
        <span className={document.complete ? 'check-complete' : 'check-missing'}>{document.complete ? '✓' : '○'}</span>
        <span>{t(document.type)}</span>
        {uploaded && <button className="text-link" disabled={busy} onClick={() => void downloadDocument(uploaded.id, uploaded.originalName)}>{t('download')}</button>}
        {canManage && !document.complete && <label className="upload-control">{t('upload')}<input type="file" accept=".pdf,image/jpeg,image/png,application/pdf" disabled={busy} onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void runAction(() => api.uploadAdmissionDocument(item.id, document.type, file));
          event.currentTarget.value = '';
        }} /></label>}
      </div>;
    })}</div>
    {canManage && <div className="admission-actions">
      {item.status === 'enquiry' && <button className="button button-quiet" disabled={busy} onClick={() => void runAction(() => api.updateAdmissionStatus(item.id, { status: 'application' }))}>{t('moveToApplication')}</button>}
      {['application', 'interview'].includes(item.status) && <>
        <form className="inline-action" onSubmit={(event) => {
          event.preventDefault();
          if (interviewAt) void runAction(() => api.scheduleAdmissionInterview(item.id, { interviewAt: new Date(interviewAt).toISOString(), interviewResult }));
        }}><FormInput label={t('interviewAt')} type="datetime-local" value={interviewAt} onChange={setInterviewAt} required /><label>{t('interviewResult')}<select value={interviewResult} onChange={(event) => setInterviewResult(event.target.value)}><option value="pending">{t('pending')}</option><option value="passed">{t('passed')}</option><option value="failed">{t('failed')}</option></select></label><button className="button button-quiet" disabled={busy}>{t('scheduleInterview')}</button></form>
      </>}
      {['application', 'interview', 'waitlisted'].includes(item.status) && <>
        <button className="button button-quiet" disabled={busy} onClick={() => void runAction(() => api.updateAdmissionStatus(item.id, { status: 'accepted' }))}>{t('accept')}</button>
        {item.status !== 'waitlisted' && <button className="button button-quiet" disabled={busy} onClick={() => void runAction(() => api.updateAdmissionStatus(item.id, { status: 'waitlisted' }))}>{t('waitlist')}</button>}
        <button className="button button-quiet" disabled={busy} onClick={() => void runAction(() => api.updateAdmissionStatus(item.id, { status: 'rejected' }))}>{t('reject')}</button>
      </>}
      {item.status === 'accepted' && <button className="button button-quiet" disabled={busy} onClick={() => void downloadHtml('offer-letter', () => api.offerLetter(item.id))}>{t('offerLetter')}</button>}
      {item.status === 'accepted' && <form className="inline-action" onSubmit={(event) => {
        event.preventDefault();
        if (sectionId) void runAction(() => api.enrolAdmission(item.id, { sectionId, siblingStudentId: siblingStudentId || null }), 'enrolmentSaved');
      }}>
        <label>{t('section')}<select required value={sectionId} onChange={(event) => setSectionId(event.target.value)}><option value="">{t('selectSection')}</option>{gradeSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
        <label>{t('sibling')}<select value={siblingStudentId} onChange={(event) => setSiblingStudentId(event.target.value)}><option value="">{t('none')}</option>{enrolledStudents.map((student) => <option key={student.id} value={student.id}>{student.givenNameEn} {student.fatherNameEn} · {student.studentNo}</option>)}</select></label>
        <button className="button button-primary" disabled={busy || !docsComplete || !sectionId || !gradeSections.length}>{t('enrol')}</button>
      </form>}
      {item.status === 'enrolled' && <div className="inline-action"><FormInput label={t('statusReason')} value={reason} onChange={setReason} required /><button className="button button-quiet" disabled={busy || reason.trim().length < 3} onClick={() => changeStudentStatus('withdrawn')}>{t('withdraw')}</button><button className="button button-quiet" disabled={busy || reason.trim().length < 3} onClick={() => changeStudentStatus('transferred_out')}>{t('transferOut')}</button></div>}
      {item.status === 'withdrawn' && item.studentId && <form className="inline-action" onSubmit={(event) => {
        event.preventDefault();
        if (sectionId && reason.trim().length >= 3) void runAction(() => api.readmitStudent(item.studentId!, sectionId, reason), 'readmissionSaved');
      }}><label>{t('section')}<select required value={sectionId} onChange={(event) => setSectionId(event.target.value)}><option value="">{t('selectSection')}</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.gradeName ? `${section.gradeName} · ` : ''}{section.name}</option>)}</select></label><FormInput label={t('statusReason')} value={reason} onChange={setReason} required /><button className="button button-primary" disabled={busy || !sectionId || reason.trim().length < 3}>{t('readmit')}</button></form>}
      {item.status === 'transferred_out' && item.studentId && <button className="button button-quiet" disabled={busy} onClick={() => void downloadHtml('transfer-certificate', () => api.transferCertificate(item.studentId!))}>{t('transferCertificate')}</button>}
    </div>}
    {!canManage && item.status === 'transferred_out' && item.studentId && <button className="button button-quiet" disabled={busy} onClick={() => void downloadHtml('transfer-certificate', () => api.transferCertificate(item.studentId!))}>{t('transferCertificate')}</button>}
  </article>;
}

function StudentsPage({ t, canManage, canViewGuardians }: { t: T; canManage: boolean; canViewGuardians: boolean }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const load = useCallback(() => Promise.all([api.students(), api.sections()])
    .then(([studentRows, sectionRows]) => { setStudents(studentRows); setSections(sectionRows); })
    .catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const filtered = students.filter((student) => [
    student.studentNo, student.givenNameEn, student.fatherNameEn, student.grandfatherNameEn,
    student.givenNameAm, student.fatherNameAm, student.grandfatherNameAm
  ].join(' ').toLowerCase().includes(query.toLowerCase()));
  const add = async (body: Omit<Student, 'id' | 'campusId' | 'status'>) => {
    await api.createStudent(body);
    setShowForm(false);
    setSuccess(true);
    window.setTimeout(() => setSuccess(false), 3500);
    await load();
  };
  return <>
    <div className="page-heading compact-heading"><div><div className="eyebrow">{t('campus')}</div><h1>{t('studentRecords')}</h1><p>{students.length} {t('records')}</p></div><button className="button button-primary" onClick={() => setShowForm((value) => !value)}>＋ {t('addStudent')}</button></div>
    {success && <div className="notice notice-success">{t('saveStudent')} ✓</div>}
    {error && <div className="notice notice-error">{error}</div>}
    <section className="panel table-panel">
      <div className="table-toolbar"><div className="search-field"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')} /></div><span className="table-count">{filtered.length} {t('records')}</span></div>
      {showForm && <StudentForm t={t} sections={sections} onCancel={() => setShowForm(false)} onSave={add} />}
      <StudentTable students={filtered} t={t} onSelect={(student) => setSelectedStudentId(student.id)} />
    </section>
    {selectedStudentId && <StudentProfilePanel
      key={selectedStudentId} studentId={selectedStudentId} t={t}
      canManage={canManage} canViewGuardians={canViewGuardians}
      onClose={() => setSelectedStudentId('')}
    />}
  </>;
}

function StudentForm({ t, sections, onCancel, onSave }: { t: T; sections: Section[]; onCancel: () => void; onSave: (body: Omit<Student, 'id' | 'campusId' | 'status'>) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    studentNo: '', givenNameAm: '', fatherNameAm: '', grandfatherNameAm: '',
    givenNameEn: '', fatherNameEn: '', grandfatherNameEn: '', gender: 'female' as Student['gender'],
    sectionName: sections[0]?.name ?? '', dateOfBirth: '', guardianPhone: '', previousSchool: ''
  });
  useEffect(() => {
    if (!form.sectionName && sections.length) {
      setForm((current) => ({ ...current, sectionName: sections[0].name }));
    }
  }, [form.sectionName, sections]);
  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await onSave({
        ...form, dateOfBirth: form.dateOfBirth || null,
        guardianPhone: form.guardianPhone || null, previousSchool: form.previousSchool || null
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  return <form className="student-form" onSubmit={submit}>
    <div className="form-section-title"><strong>{t('addStudent')}</strong><span>{t('section')}</span></div>
    <div className="form-grid">
      <FormInput label={t('studentNumber')} value={form.studentNo} onChange={(v) => update('studentNo', v)} required />
      <label>{t('section')}<select value={form.sectionName} onChange={(e) => update('sectionName', e.target.value)} required><option value="">{t('selectSection')}</option>{sections.map((section) => <option key={section.id} value={section.name}>{section.gradeName ? `${section.gradeName} · ` : ''}{section.name}</option>)}</select></label>
      <FormInput label={t('givenNameEn')} value={form.givenNameEn} onChange={(v) => update('givenNameEn', v)} required />
      <FormInput label={t('fatherNameEn')} value={form.fatherNameEn} onChange={(v) => update('fatherNameEn', v)} required />
      <FormInput label={t('grandfatherNameEn')} value={form.grandfatherNameEn} onChange={(v) => update('grandfatherNameEn', v)} required />
      <FormInput label={t('givenNameAm')} value={form.givenNameAm} onChange={(v) => update('givenNameAm', v)} required />
      <FormInput label={t('fatherNameAm')} value={form.fatherNameAm} onChange={(v) => update('fatherNameAm', v)} required />
      <FormInput label={t('grandfatherNameAm')} value={form.grandfatherNameAm} onChange={(v) => update('grandfatherNameAm', v)} required />
      <label>{t('gender')}<select value={form.gender} onChange={(e) => update('gender', e.target.value)}><option value="female">{t('female')}</option><option value="male">{t('male')}</option><option value="other">{t('other')}</option></select></label>
      <FormInput label={t('dateOfBirth')} value={form.dateOfBirth} onChange={(v) => update('dateOfBirth', v)} type="date" />
      <FormInput label={t('guardianPhone')} value={form.guardianPhone} onChange={(v) => update('guardianPhone', v)} />
      <FormInput label={t('previousSchool')} value={form.previousSchool} onChange={(v) => update('previousSchool', v)} />
    </div>
    {error && <div className="form-error">{error}</div>}
    <div className="form-actions"><button type="button" className="button button-quiet" onClick={onCancel}>{t('cancel')}</button><button className="button button-primary" disabled={busy}>{busy ? t('loading') : t('saveStudent')}</button></div>
  </form>;
}

function FormInput({ label, value, onChange, required = false, type = 'text', disabled = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string; disabled?: boolean }) {
  return <label>{label}<input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} disabled={disabled} /></label>;
}

function StudentTable({ students, t, onSelect }: { students: Student[]; t: T; onSelect?: (student: Student) => void }) {
  if (!students.length) return <div className="empty-state">{t('emptyStudents')}</div>;
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('student')}</th><th>{t('studentNumber')}</th><th>{t('section')}</th><th>{t('gender')}</th><th>{t('state')}</th><th /></tr></thead><tbody>{students.map((student) => <tr key={student.id}>
    <td><div className="student-cell"><span className="student-avatar">{student.givenNameEn.slice(0, 1)}</span><span><strong>{student.givenNameEn} {student.fatherNameEn} {student.grandfatherNameEn}</strong><small>{student.givenNameAm} {student.fatherNameAm} {student.grandfatherNameAm}</small></span></div></td>
    <td><span className="student-number">{student.studentNo}</span></td><td>{student.sectionName || t('sectionGrade')}</td><td>{student.gender === 'female' ? t('female') : student.gender === 'male' ? t('male') : t('other')}</td><td><span className="status-pill">{t('enrolled')}</span></td><td>{onSelect && <button className="button button-quiet" onClick={() => onSelect(student)}>{t('studentProfile')}</button>}</td>
  </tr>)}</tbody></table></div>;
}

function StudentProfilePanel({ studentId, t, canManage, canViewGuardians, onClose }: {
  studentId: string; t: T; canManage: boolean; canViewGuardians: boolean; onClose: () => void
}) {
  const [student, setStudent] = useState<Student | null>(null);
  const [guardians, setGuardians] = useState<StudentGuardian[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [guardianForm, setGuardianForm] = useState({
    givenNameAm: '', fatherNameAm: '', grandfatherNameAm: '',
    givenNameEn: '', fatherNameEn: '', grandfatherNameEn: '',
    phone: '', email: '', relationship: '', isPrimary: false
  });
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [studentRecord, guardianRecords] = await Promise.all([
        api.student(studentId),
        canViewGuardians ? api.studentGuardians(studentId) : Promise.resolve([])
      ]);
      setStudent(studentRecord);
      setGuardians(guardianRecords);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally {
      setLoading(false);
    }
  }, [studentId, canViewGuardians, t]);
  useEffect(() => { void load(); }, [load]);
  const updateProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!student) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await api.updateStudentProfile(student.id, {
        givenNameAm: student.givenNameAm, fatherNameAm: student.fatherNameAm,
        grandfatherNameAm: student.grandfatherNameAm, givenNameEn: student.givenNameEn,
        fatherNameEn: student.fatherNameEn, grandfatherNameEn: student.grandfatherNameEn,
        gender: student.gender, dateOfBirth: student.dateOfBirth || null,
        guardianPhone: student.guardianPhone || null, previousSchool: student.previousSchool || null
      });
      setStudent(updated);
      setNotice(t('profileSaved'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally {
      setBusy(false);
    }
  };
  const addGuardian = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.addStudentGuardian(studentId, { ...guardianForm, email: guardianForm.email || null });
      setGuardianForm({
        givenNameAm: '', fatherNameAm: '', grandfatherNameAm: '',
        givenNameEn: '', fatherNameEn: '', grandfatherNameEn: '',
        phone: '', email: '', relationship: '', isPrimary: false
      });
      await load();
      setNotice(t('guardianSaved'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally {
      setBusy(false);
    }
  };
  const unlinkGuardian = async (guardianId: string) => {
    if (!window.confirm(t('unlinkGuardianConfirm'))) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.removeStudentGuardian(studentId, guardianId);
      await load();
      setNotice(t('guardianUnlinked'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally {
      setBusy(false);
    }
  };
  const setStudentField = (field: keyof Student, value: string) => {
    setStudent((current) => current ? { ...current, [field]: value } : current);
  };
  if (loading) return <section className="panel"><div className="empty-state">{t('loading')}</div></section>;
  if (!student) return <section className="panel"><div className="notice notice-error">{error || t('studentNotFound')}</div></section>;
  return <section className="panel student-profile-panel">
    <div className="panel-heading"><div><div className="eyebrow">{student.studentNo}</div><h2>{t('studentProfile')}</h2></div><button className="button button-quiet" onClick={onClose}>{t('close')}</button></div>
    {error && <div className="notice notice-error">{error}</div>}
    {notice && <div className="notice notice-success">{notice}</div>}
    <form className="student-form" onSubmit={updateProfile}>
      <div className="form-grid">
        <FormInput label={t('givenNameEn')} value={student.givenNameEn} onChange={(value) => setStudentField('givenNameEn', value)} required disabled={!canManage} />
        <FormInput label={t('fatherNameEn')} value={student.fatherNameEn} onChange={(value) => setStudentField('fatherNameEn', value)} required disabled={!canManage} />
        <FormInput label={t('grandfatherNameEn')} value={student.grandfatherNameEn} onChange={(value) => setStudentField('grandfatherNameEn', value)} required disabled={!canManage} />
        <FormInput label={t('givenNameAm')} value={student.givenNameAm} onChange={(value) => setStudentField('givenNameAm', value)} required disabled={!canManage} />
        <FormInput label={t('fatherNameAm')} value={student.fatherNameAm} onChange={(value) => setStudentField('fatherNameAm', value)} required disabled={!canManage} />
        <FormInput label={t('grandfatherNameAm')} value={student.grandfatherNameAm} onChange={(value) => setStudentField('grandfatherNameAm', value)} required disabled={!canManage} />
        <label>{t('gender')}<select disabled={!canManage} value={student.gender} onChange={(event) => setStudentField('gender', event.target.value as Student['gender'])}><option value="female">{t('female')}</option><option value="male">{t('male')}</option><option value="other">{t('other')}</option></select></label>
        <FormInput label={t('dateOfBirth')} value={student.dateOfBirth ?? ''} onChange={(value) => setStudentField('dateOfBirth', value)} type="date" disabled={!canManage} />
        {canManage && <>
          <FormInput label={t('guardianPhone')} value={student.guardianPhone ?? ''} onChange={(value) => setStudentField('guardianPhone', value)} />
          <FormInput label={t('previousSchool')} value={student.previousSchool ?? ''} onChange={(value) => setStudentField('previousSchool', value)} />
        </>}
      </div>
      {canManage && <div className="form-actions"><button className="button button-primary" disabled={busy}>{busy ? t('loading') : t('saveChanges')}</button></div>}
    </form>
    {canViewGuardians && <div className="guardian-records">
      <div className="form-section-title"><strong>{t('guardianRecords')}</strong><span>{t('guardianPrivacyNotice')}</span></div>
      {guardians.length === 0 ? <div className="empty-state">{t('noGuardians')}</div> : guardians.map((guardian) =>
        <div className="guardian-row" key={guardian.id}>
          <div><strong>{guardian.givenNameEn} {guardian.fatherNameEn} {guardian.grandfatherNameEn}</strong>
            <small>{guardian.givenNameAm} {guardian.fatherNameAm} {guardian.grandfatherNameAm} · {guardian.relationship} · {guardian.phone}{guardian.email ? ` · ${guardian.email}` : ''}</small>
            <small>{guardian.isPrimary ? t('primaryGuardian') : ''} · {guardian.isVerified ? t('verified') : t('unverified')}</small>
          </div>
          {canManage && <button className="button button-quiet" disabled={busy} onClick={() => void unlinkGuardian(guardian.id)}>{t('unlinkGuardian')}</button>}
        </div>
      )}
      {canManage && <form className="student-form" onSubmit={addGuardian}>
        <div className="form-section-title"><strong>{t('addGuardian')}</strong></div>
        <div className="form-grid">
          <FormInput label={t('givenNameEn')} value={guardianForm.givenNameEn} onChange={(value) => setGuardianForm((current) => ({ ...current, givenNameEn: value }))} required />
          <FormInput label={t('fatherNameEn')} value={guardianForm.fatherNameEn} onChange={(value) => setGuardianForm((current) => ({ ...current, fatherNameEn: value }))} required />
          <FormInput label={t('grandfatherNameEn')} value={guardianForm.grandfatherNameEn} onChange={(value) => setGuardianForm((current) => ({ ...current, grandfatherNameEn: value }))} required />
          <FormInput label={t('givenNameAm')} value={guardianForm.givenNameAm} onChange={(value) => setGuardianForm((current) => ({ ...current, givenNameAm: value }))} required />
          <FormInput label={t('fatherNameAm')} value={guardianForm.fatherNameAm} onChange={(value) => setGuardianForm((current) => ({ ...current, fatherNameAm: value }))} required />
          <FormInput label={t('grandfatherNameAm')} value={guardianForm.grandfatherNameAm} onChange={(value) => setGuardianForm((current) => ({ ...current, grandfatherNameAm: value }))} required />
          <FormInput label={t('phone')} value={guardianForm.phone} onChange={(value) => setGuardianForm((current) => ({ ...current, phone: value }))} required />
          <FormInput label={t('guardianEmail')} value={guardianForm.email} onChange={(value) => setGuardianForm((current) => ({ ...current, email: value }))} type="email" />
          <FormInput label={t('relationship')} value={guardianForm.relationship} onChange={(value) => setGuardianForm((current) => ({ ...current, relationship: value }))} required />
          <label className="checkbox-label"><input type="checkbox" checked={guardianForm.isPrimary} onChange={(event) => setGuardianForm((current) => ({ ...current, isPrimary: event.target.checked }))} />{t('primaryGuardian')}</label>
        </div>
        <div className="form-actions"><button className="button button-primary" disabled={busy}>{busy ? t('loading') : t('saveGuardian')}</button></div>
      </form>}
    </div>}
  </section>;
}

function AttendancePage({ t, onQueued, ownerId }: { t: T; onQueued: () => Promise<void>; ownerId: string }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState('');
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => Promise.all([api.students(), api.attendance(), api.sections()]).then(([s, a, c]) => {
    setStudents(s); setSessions(a); setSections(c);
    setSectionId((current) => current || c[0]?.id || '');
  }), []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
  useEffect(() => {
    setStatuses((current) => {
      const next = { ...current };
      for (const student of students) if (!next[student.id]) next[student.id] = 'present';
      return next;
    });
  }, [students]);
  const submit = async () => {
    setBusy(true); setError(''); setNotice('');
    const body = {
      clientUuid: crypto.randomUUID(), date, sectionId,
      records: students.map((student) => ({ studentId: student.id, status: statuses[student.id] ?? 'present' }))
    };
    try {
      if (!navigator.onLine) {
        await queueOfflineOperation('/api/attendance', body, ownerId);
        await onQueued();
        setNotice(t('pendingSync'));
      } else {
        await api.submitAttendance(body);
        setNotice(t('attendanceSaved'));
        await load();
      }
    } catch (reason) {
      if (reason instanceof TypeError) {
        await queueOfflineOperation('/api/attendance', body, ownerId);
        await onQueued();
        setNotice(t('pendingSync'));
      } else setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };
  return <>
    <div className="page-heading compact-heading"><div><div className="eyebrow">{sections.find((section) => section.id === sectionId)?.name ?? t('sectionGrade')}</div><h1>{t('attendanceTitle')}</h1><p>{t('attendanceHint')}</p></div><label className="date-picker">{t('date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
    {notice && <div className="notice notice-success">{notice}</div>}{error && <div className="notice notice-error">{error}</div>}
    <section className="panel attendance-workflow">
      <div className="panel-heading"><div><h2>{sections.find((section) => section.id === sectionId)?.name ?? t('sectionGrade')}</h2><p>{students.length} {t('records')}</p></div><label>{t('selectSection')}<select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>{sections.map((section) => <option key={section.id} value={section.id}>{section.gradeName ? `${section.gradeName} · ` : ''}{section.name}</option>)}</select></label></div>
      {students.map((student) => <div className="attendance-row" key={student.id}><div className="student-cell"><span className="student-avatar">{student.givenNameEn.slice(0, 1)}</span><span><strong>{student.givenNameEn} {student.fatherNameEn}</strong><small>{student.studentNo}</small></span></div><div className="attendance-options">{(['present', 'absent', 'late', 'excused'] as const).map((status) => <button key={status} className={`attendance-option ${statuses[student.id] === status ? `active ${status}` : ''}`} onClick={() => setStatuses((current) => ({ ...current, [student.id]: status }))}>{t(status)}</button>)}</div></div>)}
      {!students.length && <div className="empty-state">{t('emptyStudents')}</div>}
      <div className="form-actions attendance-actions"><small>✓ {t('writeAuditNotice')}</small><button className="button button-primary" onClick={submit} disabled={busy || !students.length || !sectionId}>{busy ? t('loading') : t('saveAttendance')} →</button></div>
    </section>
    <section className="panel history-panel"><div className="panel-heading"><div><h2>{t('attendanceSessions')}</h2><p>{sessions.length} {t('records')}</p></div></div>{sessions.length ? sessions.slice(0, 5).map((session) => <div className="history-row" key={session.id}><span className="history-icon">✓</span><span><strong>{session.date}</strong><small>{sections.find((section) => section.id === session.sectionId)?.name ?? t('section')}</small></span><span className="status-pill">{t('enrolled')}</span></div>) : <div className="empty-state">{t('noAttendance')}</div>}</section>
  </>;
}

function MarksPage({ t, onQueued, ownerId }: { t: T; onQueued: () => Promise<void>; ownerId: string }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [studentId, setStudentId] = useState('');
  const [assessmentName, setAssessmentName] = useState('Mathematics · Quiz 1');
  const [value, setValue] = useState('0');
  const [maxValue, setMaxValue] = useState('20');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => Promise.all([api.students(), api.marks()]).then(([s, m]) => { setStudents(s); setMarks(m); if (!studentId && s.length) setStudentId(s[0].id); }), [studentId]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const body = { clientUuid: crypto.randomUUID(), studentId, assessmentName, value: Number(value), maxValue: Number(maxValue) };
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
  return <>
    <div className="page-heading compact-heading"><div><div className="eyebrow">{t('sectionGrade')}</div><h1>{t('marksTitle')}</h1><p>{t('marksHint')}</p></div><span className="state-tag">{t('draft')}</span></div>
    {notice && <div className="notice notice-success">{notice}</div>}{error && <div className="notice notice-error">{error}</div>}
    <section className="panel marks-entry-panel">
      <div className="panel-heading"><div><h2>{t('assessment')}</h2><p>{t('releaseOne')}</p></div><span className="draft-step">01 <i /> {t('draftEntry')}</span></div>
      <form className="marks-form" onSubmit={submit}>
        <label>{t('student')}<select required value={studentId} onChange={(e) => setStudentId(e.target.value)}><option value="">{t('chooseStudent')}</option>{students.map((student) => <option key={student.id} value={student.id}>{student.givenNameEn} {student.fatherNameEn} · {student.studentNo}</option>)}</select></label>
        <FormInput label={t('assessment')} value={assessmentName} onChange={setAssessmentName} required />
        <div className="score-inputs"><FormInput label={t('score')} type="number" value={value} onChange={setValue} required /><span>/</span><FormInput label={t('maxMark')} type="number" value={maxValue} onChange={setMaxValue} required /></div>
        <div className="marks-integrity">ⓘ {t('writeAuditNotice')} {t('invalidScore')}</div>
        <div className="form-actions"><button className="button button-primary" disabled={busy || !students.length}>{busy ? t('loading') : t('saveMark')} →</button></div>
      </form>
    </section>
    <section className="panel history-panel"><div className="panel-heading"><div><h2>{t('marks')}</h2><p>{marks.length} {t('records')}</p></div></div>{marks.length ? marks.slice(0, 8).map((mark) => {
      const student = students.find((s) => s.id === mark.studentId);
      return <div className="history-row" key={mark.id}><span className="history-icon purple-icon">▤</span><span><strong>{student ? `${student.givenNameEn} ${student.fatherNameEn}` : t('student')} · {mark.assessmentName}</strong><small>{mark.state}</small></span><span className="score-pill">{mark.value}/{mark.maxValue}</span></div>;
    }) : <div className="empty-state">{t('noMarks')}</div>}</section>
  </>;
}

function SchoolPage({ t }: { t: T }) {
  const [campus, setCampus] = useState<SchoolProfile | null>(null);
  const [academicYear, setAcademicYear] = useState<AcademicYear>(null);
  const [academicYears, setAcademicYears] = useState<AcademicYearRecord[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [grades, setGrades] = useState<GradeLevel[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [form, setForm] = useState({ name: '', address: '', phone: '' });
  const [yearForm, setYearForm] = useState({ labelEc: '', startDate: '', endDate: '' });
  const [termForm, setTermForm] = useState({ name: '', startDate: '', endDate: '' });
  const [gradeForm, setGradeForm] = useState({ code: '', nameEn: '', nameAm: '', band: 'primary', sortOrder: 1 });
  const [sectionForm, setSectionForm] = useState({ gradeLevelId: '', name: '', capacity: '' });
  const [subjectForm, setSubjectForm] = useState({ code: '', nameEn: '', nameAm: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => Promise.all([
    api.school(), api.academicYear(), api.academicYears(), api.terms(),
    api.grades(), api.sections(), api.subjects()
  ]).then(([profile, year, years, termRows, gradeRows, sectionRows, subjectRows]) => {
      setCampus(profile);
      setAcademicYear(year);
      setForm({ name: profile.name, address: profile.address, phone: profile.phone });
      setAcademicYears(years); setTerms(termRows); setGrades(gradeRows);
      setSections(sectionRows); setSubjects(subjectRows);
      setSectionForm((current) => ({ ...current, gradeLevelId: current.gradeLevelId || gradeRows[0]?.id || '' }));
    }), []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
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
      <div className="setup-list">{academicYears.length ? academicYears.map((year) => <div className="setting-row" key={year.id}><span><strong>{year.labelEc}</strong><small>{year.startDate} – {year.endDate}</small></span>{year.status === 'active' ? <span className="status-pill">{t('current')}</span> : <button className="button button-quiet" disabled={busy} onClick={() => void runSetup(() => api.activateAcademicYear(year.id))}>{t('activateYear')}</button>}</div>) : <p className="muted">{t('noAcademicYears')}</p>}</div>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, () => api.createTerm(termForm))}>
        <h3>{t('addTerm')}</h3><div className="form-grid">
          <FormInput label={t('termName')} value={termForm.name} onChange={(name) => setTermForm((value) => ({ ...value, name }))} required />
          <FormInput label={t('startDate')} type="date" value={termForm.startDate} onChange={(startDate) => setTermForm((value) => ({ ...value, startDate }))} required />
          <FormInput label={t('endDate')} type="date" value={termForm.endDate} onChange={(endDate) => setTermForm((value) => ({ ...value, endDate }))} required />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !academicYear}>{t('addTerm')}</button></div>
      </form>
      <div className="setup-list">{terms.length ? terms.map((term) => <div className="setting-row" key={term.id}><span><strong>{term.name}</strong><small>{term.startDate} – {term.endDate}</small></span>{term.isCurrent && <span className="status-pill">{t('current')}</span>}</div>) : <p className="muted">{t('noTerms')}</p>}</div>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, () => api.createGrade({ ...gradeForm, sortOrder: Number(gradeForm.sortOrder) }))}>
        <h3>{t('addGrade')}</h3><div className="form-grid">
          <FormInput label={t('gradeCode')} value={gradeForm.code} onChange={(code) => setGradeForm((value) => ({ ...value, code }))} required />
          <FormInput label={t('gradeNameEn')} value={gradeForm.nameEn} onChange={(nameEn) => setGradeForm((value) => ({ ...value, nameEn }))} required />
          <FormInput label={t('gradeNameAm')} value={gradeForm.nameAm} onChange={(nameAm) => setGradeForm((value) => ({ ...value, nameAm }))} required />
          <FormInput label={t('gradeBand')} value={gradeForm.band} onChange={(band) => setGradeForm((value) => ({ ...value, band }))} required />
          <FormInput label={t('sortOrder')} type="number" value={String(gradeForm.sortOrder)} onChange={(sortOrder) => setGradeForm((value) => ({ ...value, sortOrder: Number(sortOrder) }))} required />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addGrade')}</button></div>
      </form>
      <div className="setup-list">{grades.length ? grades.map((grade) => <div className="setting-row" key={grade.id}><span><strong>{grade.nameEn} · {grade.nameAm}</strong><small>{grade.code} · {grade.band}</small></span></div>) : <p className="muted">{t('noGrades')}</p>}</div>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, () => api.createSection({ ...sectionForm, capacity: sectionForm.capacity ? Number(sectionForm.capacity) : null }))}>
        <h3>{t('addSection')}</h3><div className="form-grid">
          <label>{t('grades')}<select required value={sectionForm.gradeLevelId} onChange={(event) => setSectionForm((value) => ({ ...value, gradeLevelId: event.target.value }))}>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.nameEn}</option>)}</select></label>
          <FormInput label={t('sectionName')} value={sectionForm.name} onChange={(name) => setSectionForm((value) => ({ ...value, name }))} required />
          <FormInput label={t('capacity')} type="number" value={sectionForm.capacity} onChange={(capacity) => setSectionForm((value) => ({ ...value, capacity }))} />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !academicYear || !grades.length}>{t('addSection')}</button></div>
      </form>
      <div className="setup-list">{sections.length ? sections.map((section) => <div className="setting-row" key={section.id}><span><strong>{section.gradeName} · {section.name}</strong><small>{section.capacity ? `${t('capacity')}: ${section.capacity}` : ''}</small></span></div>) : <p className="muted">{t('noSections')}</p>}</div>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, () => api.createSubject(subjectForm))}>
        <h3>{t('addSubject')}</h3><div className="form-grid">
          <FormInput label={t('subjectCode')} value={subjectForm.code} onChange={(code) => setSubjectForm((value) => ({ ...value, code }))} required />
          <FormInput label={t('subjectNameEn')} value={subjectForm.nameEn} onChange={(nameEn) => setSubjectForm((value) => ({ ...value, nameEn }))} required />
          <FormInput label={t('subjectNameAm')} value={subjectForm.nameAm} onChange={(nameAm) => setSubjectForm((value) => ({ ...value, nameAm }))} required />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addSubject')}</button></div>
      </form>
      <div className="setup-list">{subjects.length ? subjects.map((subject) => <div className="setting-row" key={subject.id}><span><strong>{subject.nameEn} · {subject.nameAm}</strong><small>{subject.code}</small></span></div>) : <p className="muted">{t('noSubjects')}</p>}</div>
    </section>
  </>;
}

function StaffPage({ t, canManage, canManageAssignments, user }: {
  t: T; canManage: boolean; canManageAssignments: boolean; user: User
}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
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
    staffId: '', sectionId: '', subjectId: '', dayOfWeek: '', periodNumber: ''
  });
  const [homeroomForm, setHomeroomForm] = useState({ sectionId: '', staffId: '' });
  const [attendanceForm, setAttendanceForm] = useState({ staffId: '', date: new Date().toISOString().slice(0, 10), status: 'present', clockIn: '', clockOut: '' });
  const [leaveForm, setLeaveForm] = useState({ staffId: '', startDate: '', endDate: '', reason: '' });
  const [messageForm, setMessageForm] = useState({ departmentId: '', type: 'announcement' as 'handover' | 'announcement', title: '', body: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => Promise.all([
    api.departments(), api.staff(), api.sections(), api.subjects(),
    api.teachingAssignments(), api.staffAttendance(), api.leaveRequests(), api.staffMessages()
  ]).then(([departmentRows, staffRows, sectionRows, subjectRows, assignmentRows, attendanceRows, leaveRows, messageRows]) => {
    setDepartments(departmentRows); setStaff(staffRows); setSections(sectionRows); setSubjects(subjectRows);
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
    <section className="panel history-panel">
      <div className="panel-heading"><div><h2>{t('staff')}</h2><p>{staff.length} {t('records')}</p></div></div>
      {staff.length ? staff.map((item) => <div className="history-row" key={item.id}><span className="history-icon">♙</span><span><strong>{formatStaff(item)}</strong><small>{item.departmentName || t('noDepartment')} · {item.qualification || '—'}</small></span><span className="status-pill">{statusLabel(item.employmentStatus)} · {item.teachingAssignmentCount} {t('workload')}</span></div>) : <div className="empty-state">{t('noStaff')}</div>}
    </section>
    {canManageAssignments && <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('teacherAssignments')}</h2></div></div>
      <form onSubmit={(event) => void submit(event, () => api.createTeachingAssignment({
        ...assignmentForm, dayOfWeek: assignmentForm.dayOfWeek ? Number(assignmentForm.dayOfWeek) : null,
        periodNumber: assignmentForm.periodNumber ? Number(assignmentForm.periodNumber) : null
      }), t('assignmentSaved'))}>
        <div className="form-grid">
          <label>{t('teacher')}<select required value={assignmentForm.staffId} onChange={(event) => setAssignmentForm((current) => ({ ...current, staffId: event.target.value }))}>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>{t('sections')}<select required value={assignmentForm.sectionId} onChange={(event) => setAssignmentForm((current) => ({ ...current, sectionId: event.target.value }))}>{sections.map((item) => <option key={item.id} value={item.id}>{item.gradeName} · {item.name}</option>)}</select></label>
          <label>{t('subject')}<select required value={assignmentForm.subjectId} onChange={(event) => setAssignmentForm((current) => ({ ...current, subjectId: event.target.value }))}>{subjects.map((item) => <option key={item.id} value={item.id}>{item.nameEn}</option>)}</select></label>
          <FormInput label={t('timetableDay')} type="number" value={assignmentForm.dayOfWeek} onChange={(dayOfWeek) => setAssignmentForm((current) => ({ ...current, dayOfWeek }))} />
          <FormInput label={t('periodNumber')} type="number" value={assignmentForm.periodNumber} onChange={(periodNumber) => setAssignmentForm((current) => ({ ...current, periodNumber }))} />
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

function ErrorState({ t, error, retry }: { t: T; error: string; retry: () => void }) {
  return <div className="error-state"><span>!</span><h2>{t('errorTitle')}</h2><p>{error}</p><button className="button button-primary" onClick={retry}>{t('retry')}</button></div>;
}
