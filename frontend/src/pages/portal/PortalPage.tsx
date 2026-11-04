import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  api, AssignmentRecord, ExamRecord, FeeInvoice, PortalCalendar, PortalLibrary, PortalMessageThread,
  PortalRequest, User, NotificationInbox
} from '../../api';
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
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, string>>({});
  const [assignmentError, setAssignmentError] = useState('');
  const [error, setError] = useState('');
  const [examError, setExamError] = useState('');
  const [feeStatements, setFeeStatements] = useState<Record<string, FeeInvoice[]>>({});
  const [statementError, setStatementError] = useState('');
  const [calendar, setCalendar] = useState<PortalCalendar | null>(null);
  const [portalRequests, setPortalRequests] = useState<PortalRequest[]>([]);
  const [supportRequests, setSupportRequests] = useState<PortalRequest[]>([]);
  const [threads, setThreads] = useState<PortalMessageThread[]>([]);
  const [portalActionError, setPortalActionError] = useState('');
  const [portalNotice, setPortalNotice] = useState('');
  const [requestDraft, setRequestDraft] = useState({ studentId: '', type: 'absence_explanation', subject: '', details: '' });
  const [supportDraft, setSupportDraft] = useState({
    category: 'academic' as 'academic' | 'technical', subject: '', details: '', studentId: ''
  });
  const [messageDraft, setMessageDraft] = useState({ studentId: '', recipientId: '', body: '' });
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [notificationInbox, setNotificationInbox] = useState<NotificationInbox | null>(null);
  const [library, setLibrary] = useState<PortalLibrary | null>(null);
  const [selectedWeekday, setSelectedWeekday] = useState('all');
  useEffect(() => { setMobileNavOpen(false); }, [location.hash]);
  useEffect(() => {
    api.portalHome().then(setPortal)
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
    api.portalCalendar().then(setCalendar)
      .catch((reason) => setPortalActionError(reason instanceof Error ? reason.message : t('apiError')));
    api.portalLibrary().then(setLibrary)
      .catch((reason) => setPortalActionError(reason instanceof Error ? reason.message : t('apiError')));
    api.notifications().then(setNotificationInbox)
      .catch((reason) => setPortalActionError(reason instanceof Error ? reason.message : t('apiError')));
    api.exams().then(setExams)
      .catch((reason) => setExamError(reason instanceof Error ? reason.message : t('apiError')));
    api.portalAssignments().then(setAssignments)
      .catch((reason) => setAssignmentError(reason instanceof Error ? reason.message : t('apiError')));
    api.portalRequests().then(setPortalRequests)
      .catch((reason) => setPortalActionError(reason instanceof Error ? reason.message : t('apiError')));
    if (user.role === 'student') {
      api.portalSupportRequests().then(setSupportRequests)
        .catch((reason) => setPortalActionError(reason instanceof Error ? reason.message : t('apiError')));
    }
    if (user.role === 'parent_guardian') {
      api.portalMessageThreads().then(setThreads)
        .catch((reason) => setPortalActionError(reason instanceof Error ? reason.message : t('apiError')));
    }
  }, [t, user.role]);
  useEffect(() => {
    const ownStudentId = calendar?.students[0]?.id;
    if (user.role === 'student' && ownStudentId) {
      setRequestDraft((current) => ({ ...current, studentId: ownStudentId }));
      setSupportDraft((current) => ({ ...current, studentId: ownStudentId }));
    }
  }, [calendar, user.role]);
  const hasResults = portal?.students.some((student) => student.canViewResults) ?? false;
  const hasFees = portal?.students.some((student) => student.canViewFees) ?? false;
  const firstResultsIndex = portal?.students.findIndex((student) => student.canViewResults) ?? -1;
  const firstFeesIndex = portal?.students.findIndex((student) => student.canViewFees) ?? -1;
  const hasExams = exams.some((exam) => exam.scheduleEntries.length > 0);
  const hasAssignments = assignments.length > 0;
  const loadFeeStatement = async (studentId: string) => {
    setStatementError('');
    try {
      const statement = await api.portalFeeStatement(studentId);
      setFeeStatements((current) => ({ ...current, [studentId]: statement.invoices }));
    } catch (reason) {
      setStatementError(reason instanceof Error ? reason.message : t('apiError'));
    }
  };
  const portalNavGroups = getPortalNavigation(t, hasResults, hasFees, hasExams, hasAssignments,
    user.role, Boolean(library));
  const saveSubmission = async (assignmentId: string) => {
    setAssignmentError('');
    try {
      await api.submitAssignment(assignmentId, assignmentDrafts[assignmentId] ?? '');
      setAssignments(await api.portalAssignments());
    } catch (reason) {
      setAssignmentError(reason instanceof Error ? reason.message : t('apiError'));
    }
  };
  const uploadSubmission = async (assignmentId: string, file?: File) => {
    if (!file) return;
    setAssignmentError('');
    try {
      await api.uploadAssignmentAttachment(assignmentId, file, true);
      setAssignments(await api.portalAssignments());
    } catch (reason) {
      setAssignmentError(reason instanceof Error ? reason.message : t('apiError'));
    }
  };
  const refreshPortalRequests = async () => setPortalRequests(await api.portalRequests());
  const refreshThreads = async () => setThreads(await api.portalMessageThreads());
  const submitPortalRequest = async (event: FormEvent) => {
    event.preventDefault();
    setPortalActionError(''); setPortalNotice('');
    try {
      await api.createPortalRequest(requestDraft);
      setRequestDraft((current) => ({ ...current, subject: '', details: '' }));
      await refreshPortalRequests();
      setPortalNotice(t('portalRequestSent'));
    } catch (reason) { setPortalActionError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const submitSupportRequest = async (event: FormEvent) => {
    event.preventDefault();
    setPortalActionError(''); setPortalNotice('');
    try {
      await api.createPortalSupportRequest(supportDraft);
      setSupportDraft((current) => ({ ...current, subject: '', details: '' }));
      setSupportRequests(await api.portalSupportRequests());
      setPortalNotice(t('supportRequestSent'));
    } catch (reason) { setPortalActionError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const startConversation = async (event: FormEvent) => {
    event.preventDefault();
    setPortalActionError('');
    try {
      await api.createPortalMessageThread(messageDraft);
      setMessageDraft((current) => ({ ...current, body: '' }));
      await refreshThreads();
    } catch (reason) { setPortalActionError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const sendReply = async (threadId: string) => {
    setPortalActionError('');
    try {
      await api.sendPortalThreadMessage(threadId, replyDrafts[threadId] ?? '');
      setReplyDrafts((current) => ({ ...current, [threadId]: '' }));
      await refreshThreads();
    } catch (reason) { setPortalActionError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const markNotificationRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setNotificationInbox((current) => current ? ({
        ...current,
        unreadCount: Math.max(0, current.unreadCount - 1),
        items: current.items.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item)
      }) : current);
    } catch (reason) { setPortalActionError(reason instanceof Error ? reason.message : t('apiError')); }
  };
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
              <div className="portal-detail" id={index === 0 ? 'portal-assignments' : undefined}>
                <strong>{t('assignments')}</strong>
                {assignmentError && <small className="notice-error" role="alert">{assignmentError}</small>}
                {assignments.filter((assignment) => assignment.studentId === student.id).length
                  ? assignments.filter((assignment) => assignment.studentId === student.id).map((assignment) =>
                    <div className="portal-report" key={assignment.id}>
                      <strong>{assignment.title} · {assignment.subjectName}</strong>
                      <small>{t('dueAt')}: {new Date(assignment.dueAt).toLocaleString()}</small>
                      <small>{assignment.instructions}</small>
                      {assignment.attachments.map((attachment) => <button key={attachment.id}
                        className="button button-quiet" type="button" onClick={() => {
                          void api.downloadAssignmentAttachment(attachment.id, true).then((blob) => {
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = url; link.download = attachment.originalName; link.click();
                            URL.revokeObjectURL(url);
                          }).catch((reason: unknown) =>
                            setAssignmentError(reason instanceof Error ? reason.message : t('apiError')));
                        }}>{attachment.originalName}</button>)}
                      {assignment.submission && <>
                        <small>{t('submissionStatus')}: {t(`assignmentStatus_${assignment.submission.status}`)}
                          {assignment.submission.isLate ? ` · ${t('late')}` : ''}</small>
                        {assignment.submission.grade !== null &&
                          <small>{t('grade')}: {assignment.submission.grade} · {assignment.submission.feedback}</small>}
                        {assignment.submission.attachments.map((attachment) => <button key={attachment.id}
                          className="button button-quiet" type="button" onClick={() => {
                            void api.downloadAssignmentAttachment(attachment.id, true).then((blob) => {
                              const url = URL.createObjectURL(blob);
                              const link = document.createElement('a');
                              link.href = url; link.download = attachment.originalName; link.click();
                              URL.revokeObjectURL(url);
                            }).catch((reason: unknown) =>
                              setAssignmentError(reason instanceof Error ? reason.message : t('apiError')));
                          }}>{attachment.originalName}</button>)}
                      </>}
                      {user.role === 'student' && assignment.status === 'published' && <>
                        <textarea aria-label={t('submissionText')}
                          value={assignmentDrafts[assignment.id] ?? assignment.submission?.text ?? ''}
                          onChange={(event) => setAssignmentDrafts((current) => ({
                            ...current, [assignment.id]: event.target.value
                          }))} />
                        <button className="button button-primary" type="button"
                          onClick={() => void saveSubmission(assignment.id)}>
                          {t(assignment.submission ? 'resubmitAssignment' : 'submitAssignment')}
                        </button>
                        <label className="button button-quiet">{t('addAttachment')}<input hidden type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.docx"
                          onChange={(event) => void uploadSubmission(assignment.id, event.target.files?.[0])} /></label>
                      </>}
                    </div>)
                  : <small>{t('noClassAssignments')}</small>}
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
                <button className="button button-quiet" onClick={() => void loadFeeStatement(student.id)}>
                  {t('viewFeeStatement')}
                </button>
                {statementError && <small className="notice-error" role="alert">{statementError}</small>}
                {(feeStatements[student.id] ?? []).map((invoice) => <small key={invoice.id}>
                  {invoice.invoiceNumber}: {t('balanceDue')} {invoice.balanceDue} {invoice.currencyCode}
                  {invoice.dueDate ? ` · ${t('dueDate')}: ${invoice.dueDate}` : ''}
                </small>)}
                {!!feeStatements[student.id]?.length && <button className="button button-quiet"
                  onClick={() => window.print()}>{t('printReport')}</button>}
              </div>}
            </div>
          </article>
        )}
      </div> : <div className="empty-state">{t('portalNoLinkedStudents')}</div>)}
      </section>
      {portalActionError && <div className="notice notice-error" role="alert">{portalActionError}</div>}
      {portalNotice && <div className="notice notice-success" role="status">{portalNotice}</div>}
      <section className="portal-content" id="portal-calendar">
        <div className="panel history-panel">
          <div className="panel-heading"><div><h2>{t('notifications')}</h2>
            <p>{notificationInbox?.unreadCount ?? 0} {t('unread')}</p></div></div>
          {notificationInbox?.items.map((item) => <article className="communication-item" key={item.id}>
            <div><h3>{locale === 'am' ? item.titleAm : item.titleEn}</h3>
              <p>{locale === 'am' ? item.bodyAm : item.bodyEn}</p></div>
            {!item.readAt && <button className="button button-quiet"
              onClick={() => void markNotificationRead(item.id)}>{t('markRead')}</button>}
          </article>)}
        </div>
        <div className="panel history-panel">
          <div className="panel-heading" id="portal-announcements">
            <div><h2>{t('schoolAnnouncements')}</h2></div>
          </div>
          {calendar?.announcements.length ? calendar.announcements.map((announcement) =>
            <article className="communication-item" key={announcement.id}>
              <div><h3>{locale === 'am' ? announcement.titleAm : announcement.titleEn}</h3>
                <p>{locale === 'am' ? announcement.bodyAm : announcement.bodyEn}</p></div>
            </article>) : <div className="empty-state">{t('noAnnouncements')}</div>}
        </div>
        <div className="panel history-panel">
          <div className="panel-heading" id="portal-events">
            <div><h2>{t('schoolEvents')}</h2></div>
          </div>
          {calendar?.events.length ? calendar.events.map((item) =>
            <article className="communication-item" key={item.id}>
              <div className="communication-date">{item.startsOn}{item.startsOn !== item.endsOn ? ` – ${item.endsOn}` : ''}</div>
              <div><h3>{locale === 'am' ? item.titleAm : item.titleEn}</h3>
                <p>{locale === 'am' ? item.descriptionAm : item.descriptionEn}</p>
                {item.location && <small>{item.location}</small>}</div>
            </article>) : <div className="empty-state">{t('noSchoolEvents')}</div>}
        </div>
        <div className="panel history-panel">
          <div className="panel-heading" id="portal-timetable"><div><h2>{t('personalTimetable')}</h2>
            <p>{t('weeklyTimetableHint')}</p></div>
            <label>{t('day')}<select value={selectedWeekday}
              onChange={(event) => setSelectedWeekday(event.target.value)}>
              <option value="all">{t('weekView')}</option>
              {[1, 2, 3, 4, 5, 6, 7].map((day) => <option key={day} value={String(day)}>{t(`weekday_${day}`)}</option>)}
            </select></label>
          </div>
          {calendar?.timetable.filter((item) => selectedWeekday === 'all' ||
            String(item.dayOfWeek) === selectedWeekday).length
            ? calendar.timetable.filter((item) => selectedWeekday === 'all' ||
              String(item.dayOfWeek) === selectedWeekday).map((item) =>
            <article className="communication-item" key={item.id}>
              <div className="communication-date">{t(`weekday_${item.dayOfWeek ?? 0}`)} · {t('period')} {item.periodNumber ?? '—'}</div>
              <div><h3>{item.subjectName}</h3><p>{item.teacherName}{item.sectionName ? ` · ${item.sectionName}` : ''}</p></div>
            </article>) : <div className="empty-state">{t('noTimetableEntries')}</div>}
        </div>
      </section>
      {library && <section className="portal-content" id="portal-library">
        <div className="panel history-panel">
          <div className="panel-heading"><div><h2>{t('navLibrary')}</h2>
            <p>{t('libraryPortalHint')}</p></div></div>
          <div className="portal-detail"><strong>{t('libraryLoans')}</strong>
            {library.loans.length ? library.loans.map((loan) => <small key={loan.id}>
              {loan.book?.title} · {loan.status} · {t('libraryDue')}: {loan.dueOn}
            </small>) : <small>{t('libraryNoLoans')}</small>}
          </div>
          <div className="portal-detail"><strong>{t('libraryReservations')}</strong>
            {library.reservations.length ? library.reservations.map((item) => <small key={item.id}>
              {item.book?.title} · {item.status}{item.readyUntil ? ` · ${item.readyUntil}` : ''}
            </small>) : <small>{t('libraryNoReservations')}</small>}
          </div>
          <div className="portal-detail"><strong>{t('libraryFines')}</strong>
            {library.fines.length ? library.fines.map((fine) => <small key={fine.id}>
              {fine.amountMinor} {fine.currencyCode} · {fine.status}
            </small>) : <small>{t('libraryNoFines')}</small>}
          </div>
        </div>
      </section>}
      <section className="portal-content" id="portal-requests">
        <div className="panel settings-panel">
          <div className="panel-heading"><div><h2>{user.role === 'student' ? t('profileUpdateRequest') : t('schoolRequests')}</h2>
            <p>{t('requestWorkflowHint')}</p></div></div>
          <form className="setup-form" onSubmit={(event) => void submitPortalRequest(event)}>
            {user.role !== 'student' && <label>{t('student')}
              <select value={requestDraft.studentId} onChange={(event) =>
                setRequestDraft((current) => ({ ...current, studentId: event.target.value }))} required>
                <option value="">{t('selectStudent')}</option>
                {calendar?.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
              </select>
            </label>}
            <label>{t('requestType')}
              <select value={user.role === 'student' ? 'profile_update' : requestDraft.type}
                disabled={user.role === 'student'} onChange={(event) =>
                  setRequestDraft((current) => ({ ...current, type: event.target.value }))}>
                <option value="absence_explanation">{t('absenceExplanation')}</option>
                <option value="document_request">{t('documentRequest')}</option>
                <option value="profile_update">{t('profileUpdateRequest')}</option>
              </select>
            </label>
            <label>{t('subject')}<input value={requestDraft.subject} required minLength={2}
              onChange={(event) => setRequestDraft((current) => ({ ...current, subject: event.target.value }))} /></label>
            <label>{t('details')}<textarea value={requestDraft.details} required minLength={5} maxLength={4000}
              onChange={(event) => setRequestDraft((current) => ({ ...current, details: event.target.value }))} /></label>
            <button className="button button-primary">{t('submitRequest')}</button>
          </form>
          {portalRequests.map((item) => <article className="communication-item" key={item.id}>
            <div className="communication-date">{item.status}</div>
            <div><h3>{item.subject}</h3><p>{item.details}</p>{item.response && <small>{item.response}</small>}</div>
          </article>)}
        </div>
      </section>
      {user.role === 'student' && <section className="portal-content" id="portal-support">
        <div className="panel settings-panel">
          <div className="panel-heading"><div><h2>{t('studentSupport')}</h2></div></div>
          <form className="setup-form" onSubmit={(event) => void submitSupportRequest(event)}>
            <label>{t('supportCategory')}<select value={supportDraft.category}
              onChange={(event) => setSupportDraft((current) => ({
                ...current, category: event.target.value as 'academic' | 'technical'
              }))}>
              <option value="academic">{t('academicSupport')}</option>
              <option value="technical">{t('technicalSupport')}</option>
            </select></label>
            <label>{t('subject')}<input value={supportDraft.subject} required minLength={2}
              onChange={(event) => setSupportDraft((current) => ({ ...current, subject: event.target.value }))} /></label>
            <label>{t('details')}<textarea value={supportDraft.details} required minLength={5} maxLength={4000}
              onChange={(event) => setSupportDraft((current) => ({ ...current, details: event.target.value }))} /></label>
            <button className="button button-primary">{t('submitRequest')}</button>
          </form>
          {supportRequests.map((item) => <article className="communication-item" key={item.id}>
            <div className="communication-date">{item.status}</div>
            <div><h3>{item.subject}</h3><p>{item.details}</p>{item.response && <small>{item.response}</small>}</div>
          </article>)}
        </div>
      </section>}
      {user.role === 'parent_guardian' && <section className="portal-content" id="portal-messages">
        <div className="panel history-panel">
          <div className="panel-heading"><div><h2>{t('parentTeacherMessages')}</h2>
            <p>{t('messagingAvailabilityNotice')}</p></div></div>
          <form className="setup-form" onSubmit={(event) => void startConversation(event)}>
            <label>{t('student')}<select value={messageDraft.studentId} required
              onChange={(event) => setMessageDraft((current) => ({ ...current, studentId: event.target.value, recipientId: '' }))}>
              <option value="">{t('selectStudent')}</option>
              {calendar?.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
            </select></label>
            <label>{t('teacher')}<select value={messageDraft.recipientId} required
              onChange={(event) => setMessageDraft((current) => ({ ...current, recipientId: event.target.value }))}>
              <option value="">{t('selectTeacher')}</option>
              {calendar?.timetable.map((item) => <option key={item.id} value={item.teacherUserId}>
                {item.teacherName} · {item.subjectName}
              </option>)}
            </select></label>
            <label>{t('message')}<textarea value={messageDraft.body} required maxLength={4000}
              onChange={(event) => setMessageDraft((current) => ({ ...current, body: event.target.value }))} /></label>
            <button className="button button-primary">{t('sendMessage')}</button>
          </form>
          {threads.map((thread) => <article className="communication-item" key={thread.id}>
            <div><h3>{thread.participants.map((participant) => participant.name).join(', ')}</h3>
              {!!thread.unreadCount && <button className="button button-quiet" onClick={async () => {
                try {
                  await api.markPortalThreadRead(thread.id);
                  await refreshThreads();
                } catch (reason) {
                  setPortalActionError(reason instanceof Error ? reason.message : t('apiError'));
                }
              }}>{t('markRead')} ({thread.unreadCount})</button>}
              {thread.messages.map((message) => <p key={message.id}>{message.body}</p>)}
              <textarea aria-label={t('replyMessage')} value={replyDrafts[thread.id] ?? ''}
                onChange={(event) => setReplyDrafts((current) => ({ ...current, [thread.id]: event.target.value }))} />
              <button className="button button-quiet" onClick={() => void sendReply(thread.id)}>{t('sendMessage')}</button>
            </div>
          </article>)}
        </div>
      </section>}
    </main>
  </div>;
}
