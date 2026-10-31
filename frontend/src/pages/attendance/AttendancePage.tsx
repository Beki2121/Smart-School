import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, AttendanceSession, AttendanceSummary, queueOfflineOperation, Section, Student } from '../../api';
import FormInput from '../../components/FormInput';
import { dateAfter, localDateInput } from '../../utils/dates';
import { downloadCsv } from '../../utils/csv';

type T = (key: string) => string;
export default function AttendancePage({ t, onQueued, ownerId, canEditAttendance, canReviewCorrections }: {
  t: T; onQueued: () => Promise<void>; ownerId: string; canEditAttendance: boolean;
  canReviewCorrections: boolean
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState('');
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const today = localDateInput();
  const [summaryFrom, setSummaryFrom] = useState(dateAfter(today, -29));
  const [summaryTo, setSummaryTo] = useState(today);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [detail, setDetail] = useState<AttendanceSession | null>(null);
  const [correctionStatus, setCorrectionStatus] = useState('present');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [correctionRequests, setCorrectionRequests] = useState<Awaited<ReturnType<typeof api.attendanceCorrectionRequests>>>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const load = useCallback(() => Promise.all([
    api.attendance(), api.sections(),
    canReviewCorrections ? api.attendanceCorrectionRequests() : Promise.resolve([])
  ]).then(([a, c, requests]) => {
    setSessions(a); setSections(c);
    setCorrectionRequests(requests);
    setSectionId((current) => c.some((section) => section.id === current) ? current : c[0]?.id || '');
  }), [canReviewCorrections]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
  useEffect(() => {
    if (!sectionId) { setStudents([]); return; }
    api.attendanceRoster(sectionId)
      .then(setStudents)
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [sectionId, t]);
  const runSummary = async (event?: FormEvent) => {
    event?.preventDefault();
    setSummaryBusy(true);
    setError('');
    try { setSummary(await api.attendanceSummary(summaryFrom, summaryTo)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setSummaryBusy(false); }
  };
  const exportAttendanceSummary = () => {
    if (!summary) return;
    const rows: (string | number)[][] = [
      [t('attendanceSummary')],
      [t('fromDate'), summary.from, t('toDate'), summary.to],
      [],
      [t('attendanceRate'), t('attendanceSessions'), t('attendanceRecords'), t('present'), t('absent'), t('late'), t('excused')],
      [
        summary.totals.attendanceRate == null ? '—' : `${summary.totals.attendanceRate}%`,
        summary.totals.sessions, summary.totals.records, summary.totals.present,
        summary.totals.absent, summary.totals.late, summary.totals.excused
      ],
      [],
      [t('section'), t('attendanceSessions'), t('attendanceRecords'), t('present'), t('absent'), t('late'), t('excused'), t('attendanceRate')],
      ...summary.bySection.map((row) => [
        row.sectionName, row.sessions, row.records, row.present, row.absent,
        row.late, row.excused, row.attendanceRate == null ? '—' : `${row.attendanceRate}%`
      ])
    ];
    downloadCsv(`attendance-summary-${summary.from}-${summary.to}.csv`, rows);
  };
  const openSession = async (sessionId: string) => {
    setError('');
    try { setDetail(await api.attendanceSession(sessionId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const correctRecord = async (studentId: string) => {
    if (!detail) return;
    setCorrectionBusy(true); setError(''); setNotice('');
    try {
      const result = await api.correctAttendance(detail.id, studentId, {
        status: correctionStatus, reason: correctionReason
      });
      setCorrectionReason('');
      if ('approvalRequired' in result) {
        setNotice(t('attendanceCorrectionRequested'));
      } else {
        setDetail(result);
        setNotice(t('attendanceCorrectionSaved'));
      }
      await load();
      await runSummary();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setCorrectionBusy(false); }
  };
  const reviewCorrection = async (requestId: string, decision: 'approved' | 'rejected') => {
    const note = reviewNotes[requestId]?.trim() ?? '';
    if (note.length < 3) return;
    setCorrectionBusy(true); setError(''); setNotice('');
    try {
      const reviewed = await api.reviewAttendanceCorrection(requestId, decision, note);
      setNotice(t(reviewed.status === 'approved' ? 'attendanceCorrectionApproved' : 'attendanceCorrectionRejected'));
      setReviewNotes((current) => ({ ...current, [requestId]: '' }));
      await load();
      if (detail?.id === reviewed.sessionId) setDetail(await api.attendanceSession(reviewed.sessionId));
      await runSummary();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setCorrectionBusy(false); }
  };
  useEffect(() => { void runSummary(); }, []);
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
    {canReviewCorrections && <section className="panel history-panel">
      <div className="panel-heading"><div><h2>{t('attendanceCorrectionQueue')}</h2><p>{correctionRequests.length} {t('pending')}</p></div></div>
      {correctionRequests.length ? correctionRequests.map((item) => <div className="attendance-correction-request" key={item.id}>
        <div><strong>{item.studentName}</strong><small>{item.attendanceDate} · {t(item.originalStatus)} → {t(item.requestedStatus)}</small><small>{item.reason}</small></div>
        <div className="attendance-correction-controls">
          <input aria-label={t('correctionReviewNote')} value={reviewNotes[item.id] ?? ''}
            onChange={(event) => setReviewNotes((current) => ({ ...current, [item.id]: event.target.value }))}
            placeholder={t('correctionReviewNote')} />
          <button className="button button-primary" disabled={correctionBusy || (reviewNotes[item.id] ?? '').trim().length < 3}
            onClick={() => void reviewCorrection(item.id, 'approved')}>{t('approveCorrection')}</button>
          <button className="button button-secondary" disabled={correctionBusy || (reviewNotes[item.id] ?? '').trim().length < 3}
            onClick={() => void reviewCorrection(item.id, 'rejected')}>{t('rejectCorrection')}</button>
        </div>
      </div>) : <div className="empty-state">{t('noAttendanceCorrections')}</div>}
    </section>}
    <section className="panel attendance-workflow">
      <div className="panel-heading"><div><h2>{sections.find((section) => section.id === sectionId)?.name ?? t('sectionGrade')}</h2><p>{students.length} {t('records')}</p></div><label>{t('selectSection')}<select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>{sections.map((section) => <option key={section.id} value={section.id}>{section.gradeName ? `${section.gradeName} · ` : ''}{section.name}</option>)}</select></label></div>
      {students.map((student) => <div className="attendance-row" key={student.id}><div className="student-cell"><span className="student-avatar">{student.givenNameEn.slice(0, 1)}</span><span><strong>{student.givenNameEn} {student.fatherNameEn}</strong><small>{student.studentNo}</small></span></div><div className="attendance-options">{(['present', 'absent', 'late', 'excused'] as const).map((status) => <button key={status} className={`attendance-option ${statuses[student.id] === status ? `active ${status}` : ''}`} onClick={() => setStatuses((current) => ({ ...current, [student.id]: status }))}>{t(status)}</button>)}</div></div>)}
      {!students.length && <div className="empty-state">{t('emptyStudents')}</div>}
      <div className="form-actions attendance-actions"><small>✓ {t('writeAuditNotice')}</small><button className="button button-primary" onClick={submit} disabled={busy || !students.length || !sectionId}>{busy ? t('loading') : t('saveAttendance')} →</button></div>
    </section>
    <section className="panel history-panel"><div className="panel-heading"><div><h2>{t('attendanceSessions')}</h2><p>{sessions.length} {t('records')}</p></div></div>{sessions.length ? sessions.slice(0, 5).map((session) => <div className="history-row" key={session.id}><span className="history-icon">✓</span><span><strong>{session.date}</strong><small>{sections.find((section) => section.id === session.sectionId)?.name ?? t('section')}</small></span><button className="button button-secondary attendance-session-open" onClick={() => void openSession(session.id)}>{t('reviewAttendance')}</button></div>) : <div className="empty-state">{t('noAttendance')}</div>}</section>
    {detail && <section className="panel history-panel attendance-detail-panel">
      <div className="panel-heading"><div><h2>{t('attendanceRecords')} · {detail.date}</h2>
        <p>{sections.find((section) => section.id === detail.sectionId)?.name ?? t('section')}</p></div>
        <button className="button button-quiet" onClick={() => setDetail(null)}>{t('close')}</button>
      </div>
      {detail.records?.map((record) => <div className="attendance-correction-row" key={record.studentId}>
        <div><strong>{record.studentName}</strong><small>{t(record.status)}{record.reason ? ` · ${record.reason}` : ''}</small></div>
        {canEditAttendance && <div className="attendance-correction-controls">
          <select aria-label={t('correctedStatus')} value={correctionStatus} onChange={(event) => setCorrectionStatus(event.target.value)}>
            {(['present', 'absent', 'late', 'excused'] as const).map((status) => <option key={status} value={status}>{t(status)}</option>)}
          </select>
          <input aria-label={t('correctionReason')} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder={t('correctionReason')} />
          <button className="button button-secondary" disabled={correctionBusy || correctionReason.trim().length < 3}
            onClick={() => void correctRecord(record.studentId)}>{correctionBusy ? t('loading') : t('correctAttendance')}</button>
        </div>}
      </div>)}
    </section>}
    <section className="panel history-panel attendance-report">
      <div className="panel-heading"><div><h2>{t('attendanceSummary')}</h2><p>{t('attendanceSummaryHint')}</p></div>{summary && <button className="button button-secondary" onClick={exportAttendanceSummary}>{t('exportCsv')}</button>}</div>
      <form className="attendance-report-filter" onSubmit={(event) => void runSummary(event)}>
        <FormInput label={t('fromDate')} type="date" value={summaryFrom} onChange={setSummaryFrom} required />
        <FormInput label={t('toDate')} type="date" value={summaryTo} onChange={setSummaryTo} required />
        <button className="button button-primary" disabled={summaryBusy}>{summaryBusy ? t('loading') : t('runReport')}</button>
      </form>
      {summary && <>
        <div className="attendance-summary-metrics">
          <div><small>{t('attendanceRate')}</small><strong>{summary.totals.attendanceRate == null ? '—' : `${summary.totals.attendanceRate}%`}</strong></div>
          <div><small>{t('attendanceSessions')}</small><strong>{summary.totals.sessions}</strong></div>
          <div><small>{t('attendanceRecords')}</small><strong>{summary.totals.records}</strong></div>
          <div><small>{t('absent')}</small><strong>{summary.totals.absent}</strong></div>
        </div>
        {summary.bySection.length ? <div className="table-scroll"><table className="data-table">
          <thead><tr><th>{t('section')}</th><th>{t('attendanceSessions')}</th><th>{t('present')}</th><th>{t('absent')}</th><th>{t('late')}</th><th>{t('excused')}</th><th>{t('attendanceRate')}</th></tr></thead>
          <tbody>{summary.bySection.map((row) => <tr key={row.sectionId}>
            <td>{row.sectionName}</td><td>{row.sessions}</td><td>{row.present}</td><td>{row.absent}</td>
            <td>{row.late}</td><td>{row.excused}</td>
            <td>{row.attendanceRate == null ? '—' : `${row.attendanceRate}%`}</td>
          </tr>)}</tbody>
        </table></div> : <div className="empty-state">{t('noAttendanceSummary')}</div>}
      </>}
    </section>
  </>;
}

