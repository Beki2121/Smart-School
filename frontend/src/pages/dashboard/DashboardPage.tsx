import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdmissionDashboard, api, AuditEvent, Dashboard, User } from '../../api';
import { Locale } from '../../i18n';
import { formatEthiopianDate } from '../../calendar';
import ErrorState from '../../components/ErrorState';
import StudentTable from '../../components/StudentTable';

type T = (key: string) => string;

export default function DashboardPage({ t, user, locale }: { t: T; user: User; locale: Locale }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [roleError, setRoleError] = useState('');
  const [admissions, setAdmissions] = useState<AdmissionDashboard | null>(null);
  const [securityAlerts, setSecurityAlerts] = useState<AuditEvent[]>([]);
  const load = useCallback(() => api.dashboard().then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let active = true;
    setRoleError('');
    if (user.role === 'registrar') {
      api.admissionDashboard().then((result) => {
        if (active) setAdmissions(result);
      }).catch((reason) => {
        if (active) setRoleError(reason instanceof Error ? reason.message : t('dashboardLoadFailed'));
      });
    } else {
      setAdmissions(null);
    }
    if (user.role === 'system_admin') {
      api.auditLog({ page: 1, pageSize: 5, action: 'auth.login_failed' })
        .then((result) => {
          if (active) setSecurityAlerts(result.events);
        }).catch((reason) => {
          if (active) setRoleError(reason instanceof Error ? reason.message : t('dashboardLoadFailed'));
        });
    } else {
      setSecurityAlerts([]);
    }
    return () => { active = false; };
  }, [t, user.role]);
  if (error) return <ErrorState t={t} error={error} retry={load} />;
  if (!data) return <div className="loading-state">{t('loading')}</div>;
  const quickLinks = dashboardLinks(user.role);
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
      <section className="panel dashboard-role-panel">
        <div className="panel-heading"><div><h2>{t(dashboardTitle(user.role))}</h2>
          <p>{t('dashboardRoleHint')}</p></div></div>
        <div className="quick-actions">
          {quickLinks.map((item) => <Link key={item.to} to={item.to}>
            <span className={`quick-icon ${item.tone}`}>{item.icon}</span>
            <span><strong>{t(item.label)}</strong><small>{t(item.description)}</small></span><b>→</b>
          </Link>)}
        </div>
        {user.role === 'registrar' && <div className="dashboard-role-detail">
          <h3>{t('admissionOverview')}</h3>
          {roleError ? <p className="form-error" role="alert">{roleError}</p> : admissions ? <>
            <strong>{admissions.total} {t('admissionsTotal')}</strong>
            <div className="dashboard-status-list">{Object.entries(admissions.byStatus).map(([status, count]) =>
            <span key={status}>{t(status)}: {count}</span>)}</div>
          </> : <p>{t('loading')}</p>}
        </div>}
        {user.role === 'system_admin' && <div className="dashboard-role-detail">
          <h3>{t('securityAlerts')}</h3>
          {roleError ? <p className="form-error" role="alert">{roleError}</p> : securityAlerts.length
            ? <ul className="dashboard-alert-list">{securityAlerts.map((event) =>
              <li key={event.id}><strong>{t('failedLoginAlert')}</strong>
                <span>{event.ipAddress || t('unknownIp')} · {new Date(event.createdAt).toLocaleString()}</span></li>)}</ul>
            : <p>{t('noSecurityAlerts')}</p>}
        </div>}
      </section>
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
          <div className="quick-actions">{quickLinks.slice(0, 3).map((item) => <Link key={item.to} to={item.to}>
            <span className={`quick-icon ${item.tone}`}>{item.icon}</span>
            <span><strong>{t(item.label)}</strong><small>{t(item.description)}</small></span><b>→</b>
          </Link>)}</div>
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

function dashboardTitle(role: string) {
  const titles: Record<string, string> = {
    owner_director: 'schoolAdministratorDashboard',
    principal: 'principalDashboard',
    academic_head: 'academicDirectorDashboard',
    homeroom_teacher: 'teacherDashboard',
    subject_teacher: 'teacherDashboard',
    registrar: 'registrarDashboard',
    system_admin: 'schoolItDashboard'
  };
  return titles[role] ?? 'schoolOverviewDashboard';
}

function dashboardLinks(role: string) {
  const byRole: Record<string, { to: string; label: string; description: string; icon: string; tone: string }[]> = {
    owner_director: [
      { to: '/reports', label: 'navReports', description: 'dashboardReportsHint', icon: '▥', tone: 'blue-icon' },
      { to: '/admissions', label: 'admissions', description: 'dashboardAdmissionsHint', icon: '▣', tone: 'green-icon' },
      { to: '/staff', label: 'staff', description: 'dashboardStaffHint', icon: '♙', tone: 'purple-icon' },
      { to: '/students', label: 'addLearner', description: 'studentRecords', icon: '♙', tone: 'blue-icon' }
    ],
    principal: [
      { to: '/reports', label: 'navReports', description: 'dashboardReportsHint', icon: '▥', tone: 'blue-icon' },
      { to: '/admissions', label: 'admissions', description: 'dashboardAdmissionsHint', icon: '▣', tone: 'green-icon' },
      { to: '/fees', label: 'fees', description: 'dashboardFinanceHint', icon: '¤', tone: 'purple-icon' }
    ],
    academic_head: [
      { to: '/reports', label: 'report_syllabus-coverage', description: 'dashboardAcademicsHint', icon: '▤', tone: 'blue-icon' },
      { to: '/marks', label: 'marks', description: 'dashboardProgressHint', icon: '▤', tone: 'purple-icon' },
      { to: '/timetable', label: 'lessonPlanning', description: 'lessonPlanningNotice', icon: '✎', tone: 'green-icon' }
    ],
    homeroom_teacher: [
      { to: '/my-classes', label: 'myClasses', description: 'dashboardClassesHint', icon: '▦', tone: 'blue-icon' },
      { to: '/student-progress', label: 'studentProgressNotes', description: 'dashboardProgressHint', icon: '▤', tone: 'purple-icon' },
      { to: '/timetable', label: 'lessonPlanning', description: 'lessonPlanningNotice', icon: '✎', tone: 'green-icon' }
    ],
    subject_teacher: [
      { to: '/my-classes', label: 'myClasses', description: 'dashboardClassesHint', icon: '▦', tone: 'blue-icon' },
      { to: '/student-progress', label: 'studentProgressNotes', description: 'dashboardProgressHint', icon: '▤', tone: 'purple-icon' },
      { to: '/timetable', label: 'lessonPlanning', description: 'lessonPlanningNotice', icon: '✎', tone: 'green-icon' }
    ],
    registrar: [
      { to: '/admissions', label: 'admissions', description: 'dashboardAdmissionsHint', icon: '▣', tone: 'green-icon' },
      { to: '/students', label: 'students', description: 'studentRecords', icon: '♙', tone: 'blue-icon' },
      { to: '/reports', label: 'navReports', description: 'dashboardReportsHint', icon: '▥', tone: 'purple-icon' }
    ],
    system_admin: [
      { to: '/audit', label: 'auditLog', description: 'dashboardSecurityHint', icon: '⚖', tone: 'orange-icon' },
      { to: '/login-history', label: 'loginHistory', description: 'dashboardSecurityHint', icon: '◷', tone: 'blue-icon' },
      { to: '/roles', label: 'rolesPermissions', description: 'dashboardPermissionsHint', icon: '⚙', tone: 'purple-icon' }
    ]
  };
  return byRole[role] ?? [
    { to: '/reports', label: 'navReports', description: 'dashboardReportsHint', icon: '▥', tone: 'blue-icon' },
    { to: '/attendance', label: 'attendance', description: 'attendanceTitle', icon: '✓', tone: 'green-icon' },
    { to: '/marks', label: 'marks', description: 'marksTitle', icon: '▤', tone: 'purple-icon' }
  ];
}

function MetricCard({ icon, tone, label, value, trend }: {
  icon: string; tone: string; label: string; value: number | string; trend: string
}) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}>{icon}</span><div className="metric-content"><span>{label}</span><strong>{value}</strong><small>{trend}</small></div><span className="metric-more">···</span></article>;
}
