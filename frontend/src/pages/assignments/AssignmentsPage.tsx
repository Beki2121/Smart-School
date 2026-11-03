import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  api, AcademicYearRecord, AssignmentRecord, AssignmentSubmission, GradeLevel, Section, Subject, Term
} from '../../api';
import type { Locale } from '../../i18n';

type T = (key: string) => string;
type Draft = {
  academicYearId: string; termId: string; gradeLevelId: string;
  sectionId: string; subjectId: string; title: string; instructions: string; dueAt: string
};
const emptyDraft: Draft = {
  academicYearId: '', termId: '', gradeLevelId: '', sectionId: '',
  subjectId: '', title: '', instructions: '', dueAt: ''
};

export default function AssignmentsPage({ t, locale }: { t: T; locale: Locale }) {
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [years, setYears] = useState<AcademicYearRecord[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [grades, setGrades] = useState<GradeLevel[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Record<string, AssignmentSubmission[]>>({});
  const [grading, setGrading] = useState<Record<string, { grade: string; feedback: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [rows, year, termRows, gradeRows, sectionRows, subjectRows] = await Promise.all([
      api.assignments(), api.academicYear(), api.terms(), api.grades(), api.sections(), api.subjects()
    ]);
    setAssignments(rows);
    setYears(year ? [year] : []);
    setTerms(termRows);
    setGrades(gradeRows);
    setSections(sectionRows);
    setSubjects(subjectRows);
    setDraft((current) => ({
      ...current, academicYearId: current.academicYearId || year?.id || '',
      termId: current.termId || termRows.find((item) => item.isCurrent)?.id || termRows[0]?.id || '',
      gradeLevelId: current.gradeLevelId || gradeRows[0]?.id || '',
      sectionId: current.sectionId || sectionRows[0]?.id || '',
      subjectId: current.subjectId || subjectRows[0]?.id || ''
    }));
  }, []);

  useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [load, t]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = { ...draft, dueAt: new Date(draft.dueAt).toISOString() };
      if (editing) await api.updateAssignment(editing, payload);
      else await api.createAssignment(payload);
      setEditing(null);
      setDraft((current) => ({ ...emptyDraft, academicYearId: current.academicYearId,
        termId: current.termId, gradeLevelId: current.gradeLevelId,
        sectionId: current.sectionId, subjectId: current.subjectId }));
      setNotice(t(editing ? 'assignmentDraftSaved' : 'assignmentCreated'));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };

  const edit = (assignment: AssignmentRecord) => {
    setEditing(assignment.id);
    setDraft({
      academicYearId: assignment.academicYearId, termId: assignment.termId,
      gradeLevelId: assignment.gradeLevelId, sectionId: assignment.sectionId,
      subjectId: assignment.subjectId, title: assignment.title,
      instructions: assignment.instructions,
      dueAt: new Date(assignment.dueAt).toISOString().slice(0, 16)
    });
  };

  const transition = async (assignment: AssignmentRecord, status: 'published' | 'closed' | 'archived') => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api.transitionAssignment(assignment.id, status);
      setNotice(t(`assignment_${status}`));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };

  const loadSubmissions = async (assignment: AssignmentRecord) => {
    setError('');
    try {
      const rows = await api.assignmentSubmissions(assignment.id);
      setSubmissions((current) => ({ ...current, [assignment.id]: rows }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  };

  const grade = async (assignment: AssignmentRecord, submission: AssignmentSubmission) => {
    const values = grading[submission.id];
    if (!values || values.grade === '') return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.gradeAssignmentSubmission(assignment.id, submission.id, {
        grade: Number(values.grade), feedback: values.feedback || null
      });
      await loadSubmissions(assignment);
      setNotice(t('assignmentGraded'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };

  const upload = async (assignment: AssignmentRecord, file?: File) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      await api.uploadAssignmentAttachment(assignment.id, file);
      setNotice(t('assignmentAttachmentUploaded'));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };

  const localized = (nameEn: string, nameAm?: string) =>
    locale === 'am' && nameAm ? nameAm : nameEn;

  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">{t('navAcademics')}</div>
      <h1>{t('assignments')}</h1><p>{t('assignmentsDescription')}</p></div></div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    <section className="panel">
      <h2>{t(editing ? 'editAssignment' : 'createAssignment')}</h2>
      <form className="form-grid" onSubmit={(event) => void save(event)}>
        <label>{t('academicYear')}<select required value={draft.academicYearId}
          onChange={(event) => setDraft({ ...draft, academicYearId: event.target.value })}>
          <option value="">{t('selectAcademicYear')}</option>
          {years.map((item) => <option key={item.id} value={item.id}>{item.labelEc}</option>)}
        </select></label>
        <label>{t('term')}<select required value={draft.termId}
          onChange={(event) => setDraft({ ...draft, termId: event.target.value })}>
          <option value="">{t('selectTerm')}</option>
          {terms.filter((item) => item.academicYearId === draft.academicYearId)
            .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>{t('grade')}<select required value={draft.gradeLevelId}
          onChange={(event) => setDraft({ ...draft, gradeLevelId: event.target.value })}>
          <option value="">{t('selectGrade')}</option>
          {grades.map((item) => <option key={item.id} value={item.id}>
            {localized(item.nameEn, item.nameAm)}</option>)}
        </select></label>
        <label>{t('section')}<select required value={draft.sectionId}
          onChange={(event) => setDraft({ ...draft, sectionId: event.target.value })}>
          <option value="">{t('selectSection')}</option>
          {sections.filter((item) => item.gradeLevelId === draft.gradeLevelId)
            .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>{t('subject')}<select required value={draft.subjectId}
          onChange={(event) => setDraft({ ...draft, subjectId: event.target.value })}>
          <option value="">{t('selectSubject')}</option>
          {subjects.map((item) => <option key={item.id} value={item.id}>
            {localized(item.nameEn, item.nameAm)}</option>)}
        </select></label>
        <label>{t('assignmentTitle')}<input required maxLength={180} value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>{t('dueAt')}<input required type="datetime-local" value={draft.dueAt}
          onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label>
        <label className="form-grid-wide">{t('instructions')}<textarea required maxLength={10000}
          value={draft.instructions}
          onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></label>
        <div className="button-row">
          <button className="button button-primary" disabled={busy} type="submit">{t('saveAssignment')}</button>
          {editing && <button className="button button-quiet" type="button" onClick={() => {
            setEditing(null); setDraft(emptyDraft);
          }}>{t('cancel')}</button>}
        </div>
      </form>
    </section>
    {assignments.map((assignment) => <article className="panel" key={assignment.id}>
      <div className="page-heading"><div><h2>{assignment.title}</h2>
        <p>{assignment.sectionName} · {assignment.subjectName} · {t('dueAt')}: {new Date(assignment.dueAt).toLocaleString()}</p>
        <p>{assignment.instructions}</p></div><span className="status-pill">{t(`assignmentStatus_${assignment.status}`)}</span></div>
      {assignment.status === 'draft' && <div className="button-row">
        <button className="button button-quiet" type="button" onClick={() => edit(assignment)}>{t('edit')}</button>
        <label className="button button-quiet">{t('addAttachment')}<input hidden type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.docx"
          onChange={(event) => void upload(assignment, event.target.files?.[0])} /></label>
        <button className="button button-primary" disabled={busy} type="button"
          onClick={() => void transition(assignment, 'published')}>{t('publish')}</button>
      </div>}
      {assignment.status === 'published' && <button className="button button-quiet" disabled={busy}
        type="button" onClick={() => void transition(assignment, 'closed')}>{t('closeAssignment')}</button>}
      {assignment.status === 'closed' && <button className="button button-quiet" disabled={busy}
        type="button" onClick={() => void transition(assignment, 'archived')}>{t('archiveAssignment')}</button>}
      {assignment.attachments.map((attachment) => <small key={attachment.id}>
        {attachment.originalName} · {Math.ceil(attachment.sizeBytes / 1024)} KB
      </small>)}
      {assignment.status !== 'draft' && assignment.status !== 'archived' &&
        <button className="button button-quiet" type="button"
          onClick={() => void loadSubmissions(assignment)}>{t('viewSubmissions')}</button>}
      {(submissions[assignment.id] ?? []).map((submission) => <div className="portal-detail" key={submission.id}>
        <strong>{submission.studentName}</strong>
        <small>{submission.text || t('noSubmissionText')} · {submission.isLate ? t('late') : t('onTime')}</small>
        <label>{t('assignmentGrade')}<input type="number" min="0" max="1000" step="0.01"
          value={grading[submission.id]?.grade ?? submission.grade ?? ''}
          onChange={(event) => setGrading((current) => ({
            ...current, [submission.id]: {
              grade: event.target.value, feedback: current[submission.id]?.feedback ?? submission.feedback ?? ''
            }
          }))} /></label>
        <label>{t('assignmentFeedback')}<textarea value={grading[submission.id]?.feedback ?? submission.feedback ?? ''}
          onChange={(event) => setGrading((current) => ({
            ...current, [submission.id]: {
              grade: current[submission.id]?.grade ?? String(submission.grade ?? ''),
              feedback: event.target.value
            }
          }))} /></label>
        <button className="button button-quiet" disabled={busy} type="button"
          onClick={() => void grade(assignment, submission)}>{t('saveGrade')}</button>
      </div>)}
    </article>)}
    {!assignments.length && <div className="empty-state">{t('noClassAssignments')}</div>}
  </div>;
}
