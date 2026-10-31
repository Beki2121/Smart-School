import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, Admission, GradeLevel, Section, Student, StudentCredentials } from '../../api';
import FormInput from '../../components/FormInput';
import StudentCredentialSlip from '../../components/StudentCredentialSlip';

type T = (key: string) => string;

export default function AdmissionsPage({ t, canManage }: { t: T; canManage: boolean }) {
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [grades, setGrades] = useState<GradeLevel[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [dashboard, setDashboard] = useState<{ total: number; byStatus: Record<string, number> }>({ total: 0, byStatus: {} });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Admission['status'] | ''>('');
  const [showIntake, setShowIntake] = useState(false);
  const [publicApplicationUrl, setPublicApplicationUrl] = useState('');
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
  const loadPublicLink = async () => {
    setBusy(true); setError('');
    try {
      const { token } = await api.admissionsPublicLink();
      setPublicApplicationUrl(`${window.location.origin}/apply/${token}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  return <>
    <div className="page-heading compact-heading">
      <div><div className="eyebrow">{t('campus')}</div><h1>{t('admissions')}</h1><p>{dashboard.total} {t('records')}</p></div>
      {canManage && <div className="student-page-actions">
        <button className="button button-secondary" disabled={busy} onClick={() => void loadPublicLink()}>{t('publicApplicationLink')}</button>
        <button className="button button-primary" onClick={() => setShowIntake((open) => !open)}>＋ {t('newEnquiry')}</button>
      </div>}
    </div>
    <div className="admission-metrics">
      {(['enquiry', 'application', 'interview', 'accepted'] as const).map((key) =>
        <div className="admission-metric" key={key}><span>{t(key)}</span><strong>{dashboard.byStatus[key] ?? 0}</strong></div>
      )}
    </div>
    {notice && <div className="notice notice-success">{notice}</div>}
    {error && <div className="notice notice-error">{error}</div>}
    {publicApplicationUrl && <section className="panel"><div className="form-grid">
      <label>{t('publicApplicationLink')}<input readOnly value={publicApplicationUrl} /></label>
      <button className="button button-quiet" onClick={() => void navigator.clipboard.writeText(publicApplicationUrl)}>{t('copyLink')}</button>
    </div></section>}
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
  const [credentials, setCredentials] = useState<StudentCredentials | null>(null);
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
        if (sectionId) void runAction(async () => {
          const result = await api.enrolAdmission(item.id, { sectionId, siblingStudentId: siblingStudentId || null });
          setCredentials(result.credentials);
          return result;
        }, 'enrolmentSaved');
      }}>
        <label>{t('section')}<select required value={sectionId} onChange={(event) => setSectionId(event.target.value)}><option value="">{t('selectSection')}</option>{gradeSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
        <label>{t('sibling')}<select value={siblingStudentId} onChange={(event) => setSiblingStudentId(event.target.value)}><option value="">{t('none')}</option>{enrolledStudents.map((student) => <option key={student.id} value={student.id}>{student.givenNameEn} {student.fatherNameEn} · {student.studentNo}</option>)}</select></label>
        <button className="button button-primary" disabled={busy || !docsComplete || !sectionId || !gradeSections.length}>{t('enrol')}</button>
      </form>}
      {credentials && <StudentCredentialSlip credentials={credentials} t={t} onDismiss={() => setCredentials(null)} />}
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
