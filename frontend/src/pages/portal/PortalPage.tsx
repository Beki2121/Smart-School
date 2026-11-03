import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, ExamRecord, User } from '../../api';
import type { Locale } from '../../i18n';
import SidebarNavGroup from '../../components/SidebarNavGroup';
import { getPortalNavigation } from '../../navigation';

type T = (key: string) => string;

export default function PortalPage({ user, locale, t, onLogout }: {
  user: User; locale: Locale; t: T; onLogout: () => Promise<void>
}) {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [portal, setPortal] = useState<Awaited<ReturnType<typeof api.portalHome>> | null>(null);
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [error, setError] = useState('');
  const [examError, setExamError] = useState('');
  useEffect(() => { setMobileNavOpen(false); }, [location.hash]);
  useEffect(() => {
    api.portalHome().then(setPortal)
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
    api.exams().then(setExams)
      .catch((reason) => setExamError(reason instanceof Error ? reason.message : t('apiError')));
  }, [t]);
  const hasResults = portal?.students.some((student) => student.canViewResults) ?? false;
  const hasFees = portal?.students.some((student) => student.canViewFees) ?? false;
  const firstResultsIndex = portal?.students.findIndex((student) => student.canViewResults) ?? -1;
  const firstFeesIndex = portal?.students.findIndex((student) => student.canViewFees) ?? -1;
  const hasExams = exams.some((exam) => exam.scheduleEntries.length > 0);
  const portalNavGroups = getPortalNavigation(t, hasResults, hasFees, hasExams);
  return <div className="portal-shell">
    {mobileNavOpen && <button className="sidebar-backdrop" type="button"
      aria-label={t('closeMenu')} onClick={() => setMobileNavOpen(false)} />}
    <aside className={`sidebar portal-sidebar ${mobileNavOpen ? 'is-open' : ''}`}>
      <Link className="brand" to="/">
        <span className="brand-mark">S</span>
        <span><strong>{t('brand')}</strong><small>{t('subtitle')}</small></span>
      </Link>
      <button className="sidebar-close" type="button" aria-label={t('closeMenu')}
        onClick={() => setMobileNavOpen(false)}>×</button>
      <div className="campus-label"><span className="campus-dot" />{t('portal')}</div>
      <nav className="primary-nav" aria-label={t('portal')}>
        <a href="#portal-overview" onClick={() => setMobileNavOpen(false)}>
          <span className="nav-icon">▦</span>{t('navPortalDashboard')}
        </a>
        {portalNavGroups.map((group, index) => <SidebarNavGroup key={group.label} group={group}
          defaultOpen={index === 0} activePath={location.hash}
          onNavigate={() => setMobileNavOpen(false)} />)}
      </nav>
      <div className="sidebar-bottom"><div className="profile-mini">
        <span className="avatar">{user.name.slice(0, 1)}</span>
        <span className="profile-name"><strong>{user.name}</strong><small>{t(`role_${user.role}`)}</small></span>
      </div></div>
    </aside>
    <main className="portal-main">
      <header className="portal-header">
        <div className="topbar-leading">
          <button className="mobile-menu-toggle" type="button" aria-label={t('openMenu')}
            aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}>☰</button>
          <div className="breadcrumbs"><span>{t('portal')}</span></div>
        </div>
        <div className="topbar-actions"><span>{user.name}</span><button className="signout-button" onClick={() => void onLogout()}><span aria-hidden="true">↗</span><span>{t('signOut')}</span></button></div>
      </header>
      <section className="portal-content" id="portal-overview">
        <div className="eyebrow">{t('portal')}</div>
        <h1>{user.role === 'student' ? t('studentPortal') : t('familyPortal')}</h1>
        <p>{t('portalSummary')}</p>
        {error && <div className="notice notice-error">{error}</div>}
        {!portal && !error && <div className="loading-state">{t('loading')}</div>}
        {portal && (portal.students.length ? <div className="portal-students" id="portal-children">
        {portal.students.map(({ student, canViewResults, canViewFees, results, reports, attendance, fees }, index) =>
          <article className="panel portal-student-card" key={student.id}>
            <span className="student-avatar">{student.name.slice(0, 1)}</span>
            <div><h2>{locale === 'am' ? student.nameAm : student.name}</h2>
              <p>{t('studentNumber')}: {student.studentNo} · {t('section')}: {student.sectionName || '—'}</p>
              {canViewResults && <div className="portal-detail" id={index === firstResultsIndex ? 'portal-results' : undefined}>
                <strong>{t('results')}</strong>
                {results.length ? results.map((result, index) =>
                  <small key={`${result.assessmentName}-${index}`}>{result.assessmentName}: {result.value} / {result.maxValue}</small>
                ) : <small>{t('noPortalResults')}</small>}
              </div>}
              {canViewResults && <div className="portal-detail">
                <strong>{t('officialReports')}</strong>
                {reports.length ? reports.map(({ revision, snapshot }) =>
                  <div className="portal-report" key={`${snapshot.termId}-${revision}`}>
                    <strong>{snapshot.termName} · {t('reportRevision')} {revision}</strong>
                    {snapshot.subjects.map((subject) =>
                      <small key={subject.subjectId}>
                        {locale === 'am' ? subject.subjectNameAm : subject.subjectNameEn}: {subject.value}/{subject.maxValue} · {subject.percent.toFixed(2)}%
                        {subject.band ? ` · ${locale === 'am' ? subject.band.nameAm : subject.band.nameEn}` : ''}
                      </small>)}
                    <small><b>{t('overallResult')}:</b> {snapshot.totalValue}/{snapshot.totalMaxValue} · {snapshot.overallPercent.toFixed(2)}%
                      {snapshot.overallBand ? ` · ${locale === 'am' ? snapshot.overallBand.nameAm : snapshot.overallBand.nameEn}` : ''}
                    </small>
                  </div>
                ) : <small>{t('noOfficialReports')}</small>}
              </div>}
              <div className="portal-detail" id={index === 0 ? 'portal-exams' : undefined}>
                <strong>{t('examSchedule')}</strong>
                {examError && <small className="notice-error">{examError}</small>}
                {exams.flatMap((exam) => exam.scheduleEntries
                  .filter((entry) => entry.sectionName === student.sectionName)
                  .map((entry) => ({ exam, entry }))).length ? exams.flatMap((exam) =>
                  exam.scheduleEntries.filter((entry) => entry.sectionName === student.sectionName)
                    .map((entry) => <small key={entry.id}>
                      {entry.examDate} · {entry.startsAt.slice(0, 5)}–{entry.endsAt.slice(0, 5)} ·
                      {' '}{locale === 'am' ? entry.examTitle : entry.examTitle} · {entry.roomName ?? t('noRoom')}
                    </small>))
                  : <small>{t('noExamSchedule')}</small>}
              </div>
              <div className="portal-detail" id={index === 0 ? 'portal-attendance' : undefined}>
                <strong>{t('attendance')}</strong>
                {attendance.length ? attendance.slice(0, 10).map((record, index) =>
                  <small key={`${record.date}-${index}`}>{record.date}: {t(record.status)}</small>
                ) : <small>{t('noPortalAttendance')}</small>}
              </div>
              {canViewFees && <div className="portal-detail" id={index === firstFeesIndex ? 'portal-fees' : undefined}>
                <strong>{t('fees')}</strong>
                {fees.length ? fees.map((fee) =>
                  <small key={fee.invoiceNumber}>{fee.invoiceNumber}: {fee.totalAmount} {fee.currencyCode} · {t(`invoice_${fee.status}`)}</small>
                ) : <small>{t('noPortalFees')}</small>}
              </div>}
            </div>
          </article>
        )}
      </div> : <div className="empty-state">{t('portalNoLinkedStudents')}</div>)}
      </section>
    </main>
  </div>;
}
