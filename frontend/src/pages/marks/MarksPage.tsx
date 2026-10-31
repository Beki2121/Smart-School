import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, GradingPolicy, Mark, queueOfflineOperation, ReportCard, Student, Subject, Term, TermMarksSummary } from '../../api';
import { Locale } from '../../i18n';
import FormInput from '../../components/FormInput';
import { downloadCsv } from '../../utils/csv';

type T = (key: string) => string;
export default function MarksPage({ t, onQueued, ownerId, canManageGrading, canSubmitMarks, canApproveMarks, canPublishMarks, canAmendMarks, locale }: {
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
