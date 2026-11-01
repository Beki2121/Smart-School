import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Dashboard, User } from '../../api';
import { Locale } from '../../i18n';
import { formatEthiopianDate } from '../../calendar';
import ErrorState from '../../components/ErrorState';
import StudentTable from '../../components/StudentTable';

type T = (key: string) => string;

export default function DashboardPage({ t, user, locale }: { t: T; user: User; locale: Locale }) {
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

function MetricCard({ icon, tone, label, value, trend }: {
  icon: string; tone: string; label: string; value: number | string; trend: string
}) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}>{icon}</span><div className="metric-content"><span>{label}</span><strong>{value}</strong><small>{trend}</small></div><span className="metric-more">···</span></article>;
}
