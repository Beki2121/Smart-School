import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, AcademicYear, AcademicYearRecord, AttendanceSession, Dashboard, GradeLevel, Mark, pendingOfflineCount, queueOfflineOperation, SchoolProfile, Section, setAccessToken, Student, Subject, syncOfflineOperations, Term, User } from './api';
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
            <Route path="/students" element={<StudentsPage t={t} />} />
            <Route path="/attendance" element={<AttendancePage t={t} onQueued={setQueued} ownerId={user.id} />} />
            <Route path="/marks" element={<MarksPage t={t} onQueued={setQueued} ownerId={user.id} />} />
            <Route path="/school" element={<SchoolPage t={t} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </section>
      </main>
    </div>
  );
}

function routeTitle(path: string, t: T) {
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

function StudentsPage({ t }: { t: T }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [showForm, setShowForm] = useState(false);
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
      <StudentTable students={filtered} t={t} />
    </section>
  </>;
}

function StudentForm({ t, sections, onCancel, onSave }: { t: T; sections: Section[]; onCancel: () => void; onSave: (body: Omit<Student, 'id' | 'campusId' | 'status'>) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    studentNo: '', givenNameAm: '', fatherNameAm: '', grandfatherNameAm: '',
    givenNameEn: '', fatherNameEn: '', grandfatherNameEn: '', gender: 'female' as Student['gender'], sectionName: sections[0]?.name ?? ''
  });
  useEffect(() => {
    if (!form.sectionName && sections.length) {
      setForm((current) => ({ ...current, sectionName: sections[0].name }));
    }
  }, [form.sectionName, sections]);
  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSave(form); } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
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
    </div>
    {error && <div className="form-error">{error}</div>}
    <div className="form-actions"><button type="button" className="button button-quiet" onClick={onCancel}>{t('cancel')}</button><button className="button button-primary" disabled={busy}>{busy ? t('loading') : t('saveStudent')}</button></div>
  </form>;
}

function FormInput({ label, value, onChange, required = false, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string }) {
  return <label>{label}<input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} /></label>;
}

function StudentTable({ students, t }: { students: Student[]; t: T }) {
  if (!students.length) return <div className="empty-state">{t('emptyStudents')}</div>;
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('student')}</th><th>{t('studentNumber')}</th><th>{t('section')}</th><th>{t('gender')}</th><th>{t('state')}</th><th /></tr></thead><tbody>{students.map((student) => <tr key={student.id}>
    <td><div className="student-cell"><span className="student-avatar">{student.givenNameEn.slice(0, 1)}</span><span><strong>{student.givenNameEn} {student.fatherNameEn} {student.grandfatherNameEn}</strong><small>{student.givenNameAm} {student.fatherNameAm} {student.grandfatherNameAm}</small></span></div></td>
    <td><span className="student-number">{student.studentNo}</span></td><td>{student.sectionName || t('sectionGrade')}</td><td>{student.gender === 'female' ? t('female') : student.gender === 'male' ? t('male') : t('other')}</td><td><span className="status-pill">{t('enrolled')}</span></td><td><button className="row-more" aria-label="More options">···</button></td>
  </tr>)}</tbody></table></div>;
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

function ErrorState({ t, error, retry }: { t: T; error: string; retry: () => void }) {
  return <div className="error-state"><span>!</span><h2>{t('errorTitle')}</h2><p>{error}</p><button className="button button-primary" onClick={retry}>{t('retry')}</button></div>;
}
