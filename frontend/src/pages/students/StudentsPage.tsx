import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ProgressionEligibility, Section, Student, StudentCommendation, StudentCredentials, StudentDisciplineRecord, StudentDocument, StudentEmergencyContact, StudentEnrollment, StudentGuardian, StudentImportPreview, StudentImportResult, StudentSensitiveData, StudentTransferPackage } from '../../api';
import { Locale } from '../../i18n';
import FormInput from '../../components/FormInput';
import StudentCredentialSlip from '../../components/StudentCredentialSlip';
import StudentTable from '../../components/StudentTable';
import InvitationLinkField from '../../components/InvitationLinkField';
import { localDateInput } from '../../utils/dates';
import { downloadCsv } from '../../utils/csv';

type T = (key: string) => string;
export default function StudentsPage({ t, locale, canManage, canViewAlumni, canManageAdmissions, canOverrideProgression, canViewSensitiveData, canManageSensitiveData, canViewEmergencyContacts, canManageEmergencyContacts, canViewGuardians, canViewCommendations, canManageCommendations, canViewDiscipline, canManageDiscipline, canApproveTransfers }: {
  t: T; locale: Locale; canManage: boolean; canViewAlumni: boolean; canManageAdmissions: boolean; canOverrideProgression: boolean; canViewSensitiveData: boolean;
  canManageSensitiveData: boolean; canViewEmergencyContacts: boolean;
  canManageEmergencyContacts: boolean; canViewGuardians: boolean;
  canViewCommendations: boolean; canManageCommendations: boolean;
  canViewDiscipline: boolean; canManageDiscipline: boolean; canApproveTransfers: boolean
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [alumni, setAlumni] = useState<Student[]>([]);
  const [showingAlumni, setShowingAlumni] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [credentials, setCredentials] = useState<StudentCredentials | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importCsv, setImportCsv] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importReport, setImportReport] = useState<StudentImportPreview | StudentImportResult | null>(null);
  const [importError, setImportError] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importCredentials, setImportCredentials] = useState<StudentImportResult['credentials']>([]);
  const [credentialsDownloaded, setCredentialsDownloaded] = useState(false);
  const load = useCallback(() => Promise.all([api.students(), api.sections()])
    .then(([studentRows, sectionRows]) => { setStudents(studentRows); setSections(sectionRows); })
    .catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const visibleStudents = showingAlumni ? alumni : students;
  const filtered = visibleStudents.filter((student) => [
    student.studentNo, student.givenNameEn, student.fatherNameEn, student.grandfatherNameEn,
    student.givenNameAm, student.fatherNameAm, student.grandfatherNameAm
  ].join(' ').toLowerCase().includes(query.toLowerCase()));
  const add = async (body: Omit<Student, 'id' | 'campusId' | 'status'>) => {
    const result = await api.createStudent(body);
    setCredentials(result.credentials);
    setShowForm(false);
    setSuccess(t('saveStudent'));
    window.setTimeout(() => setSuccess(''), 3500);
    await load();
  };
  const readStudentCsv = async (file: File | undefined) => {
    if (!file) return;
    setImportError('');
    setImportReport(null);
    if (file.size > 1_000_000) {
      setImportCsv('');
      setImportFileName('');
      setImportError(t('studentImportFileTooLarge'));
      return;
    }
    try {
      setImportCsv(await file.text());
      setImportFileName(file.name);
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : t('apiError'));
    }
  };
  const previewImport = async () => {
    setImportBusy(true);
    setImportError('');
    try { setImportReport(await api.previewStudentImport(importCsv)); }
    catch (reason) { setImportError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setImportBusy(false); }
  };
  const commitImport = async () => {
    setImportBusy(true);
    setImportError('');
    try {
      const result = await api.commitStudentImport(importCsv);
      setImportReport(result);
      setImportCredentials(result.credentials);
      setCredentialsDownloaded(false);
      setImportCsv('');
      setSuccess(t('studentImportCompleted'));
      await load();
    } catch (reason) { setImportError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setImportBusy(false); }
  };
  const reportEligibleCount = importReport
    ? 'eligibleCount' in importReport ? importReport.eligibleCount : importReport.createdCount : 0;
  const reportInvalidCount = importReport
    ? importReport.rows.filter((row) => !row.eligible).length : 0;
  const reportWarningCount = importReport
    ? importReport.rows.filter((row) => row.warnings.length > 0).length : 0;
  return <>
    <div className="page-heading compact-heading"><div><div className="eyebrow">{t('campus')}</div><h1>{showingAlumni ? t('alumniRecords') : t('studentRecords')}</h1><p>{visibleStudents.length} {t('records')}</p></div><div className="student-page-actions">
      {canViewAlumni && <button className="button button-secondary" onClick={() => {
        if (!showingAlumni && !alumni.length) void api.alumni().then(setAlumni).catch((reason) => setError(reason.message));
        setShowingAlumni((value) => !value);
      }}>{showingAlumni ? t('studentRecords') : t('alumniRecords')}</button>}
      <button className="button button-secondary" onClick={() => downloadCsv(showingAlumni ? 'school-alumni.csv' : 'student-list.csv', [
        ['studentNo', 'givenNameEn', 'fatherNameEn', 'grandfatherNameEn', 'sectionName', 'status'],
        ...filtered.map((student) => [student.studentNo, student.givenNameEn, student.fatherNameEn,
          student.grandfatherNameEn, student.sectionName, student.status])
      ])}>{t('exportStudents')}</button>
      {canManage && <button className="button button-secondary" onClick={() => setImportOpen((value) => !value)}>{t('importStudents')}</button>}
      {canManage && <button className="button button-primary" onClick={() => setShowForm((value) => !value)}>＋ {t('addStudent')}</button>}
    </div></div>
    {success && <div className="notice notice-success">{success} ✓</div>}
    {credentials && <StudentCredentialSlip credentials={credentials} t={t} onDismiss={() => setCredentials(null)} />}
    {error && <div className="notice notice-error">{error}</div>}
    {importOpen && canManage && <section className="panel student-import-panel">
      <div className="panel-heading"><div><h2>{t('importStudents')}</h2><p>{t('studentImportHint')}</p></div></div>
      <div className="student-import-actions">
        <button className="button button-secondary" onClick={() => downloadCsv('student-import-template.csv', [[
          'studentNo', 'givenNameAm', 'fatherNameAm', 'grandfatherNameAm',
          'givenNameEn', 'fatherNameEn', 'grandfatherNameEn', 'gender',
          'dateOfBirth', 'guardianPhone', 'previousSchool', 'sectionName'
        ]])}>{t('downloadStudentTemplate')}</button>
        <label className="upload-control">{t('chooseStudentCsv')}<input type="file" accept=".csv,text/csv" disabled={importBusy} onChange={(event) => {
          void readStudentCsv(event.target.files?.[0]);
          event.currentTarget.value = '';
        }} /></label>
        {importFileName && <span className="muted">{importFileName}</span>}
        <button className="button button-primary" disabled={!importCsv || importBusy} onClick={() => void previewImport()}>{importBusy ? t('loading') : t('previewStudentImport')}</button>
      </div>
      {importError && <div className="notice notice-error">{importError}</div>}
      {importReport && <>
        <div className="student-import-summary">
          <span>{reportEligibleCount} {t('studentImportReady')}</span>
          <span>{reportInvalidCount} {t('studentImportInvalid')}</span>
          <span>{reportWarningCount} {t('studentImportWarnings')}</span>
        </div>
        <div className="student-import-rows">
          {importReport.rows.filter((row) => !row.eligible || row.warnings.length).slice(0, 100).map((row) =>
            <div className={`student-import-row ${row.errors.length ? 'has-import-error' : 'has-import-warning'}`} key={row.rowNumber}>
              <strong>{t('row')} {row.rowNumber}</strong>
              {[...row.errors, ...row.warnings].map((issue, index) =>
                <span className={row.errors.includes(issue) ? 'import-row-error' : 'import-row-warning'} key={`${issue.field}-${index}`}>
                  {issue.field ? `${issue.field}: ` : ''}{issue.message}
                </span>)}
            </div>)}
          {importReport.rows.filter((row) => !row.eligible || row.warnings.length).length > 100 &&
            <div className="muted">{t('studentImportMoreIssues')}</div>}
        </div>
        {importReport.rows.some((row) => row.eligible) && importCsv &&
          <button className="button button-primary" disabled={importBusy} onClick={() => void commitImport()}>
            {importBusy ? t('loading') : t('commitStudentImport')}
          </button>}
        {'createdCount' in importReport && <div className="notice notice-success">
          {t('studentImportCompleted')} {importReport.createdCount} / {importReport.totalRows}
        </div>}
      </>}
      {importCredentials.length > 0 && <div className="student-import-credentials">
        <p>{t('studentImportCredentialsNotice')}</p>
        <button className="button button-secondary" onClick={() => {
          downloadCsv('student-import-credentials.csv', [
            ['studentNo', 'studentName', 'username', 'temporaryPassword'],
            ...importCredentials.map((entry) => [entry.studentNo, entry.studentName, entry.username, entry.temporaryPassword])
          ]);
          setCredentialsDownloaded(true);
        }}>{t('downloadCredentials')}</button>
        <button className="button button-quiet" disabled={!credentialsDownloaded} onClick={() => {
          setImportCredentials([]);
          setCredentialsDownloaded(false);
        }}>{t('studentImportRecorded')}</button>
      </div>}
    </section>}
    <section className="panel table-panel">
      <div className="table-toolbar"><div className="search-field"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')} /></div><span className="table-count">{filtered.length} {t('records')}</span></div>
      {showForm && <StudentForm t={t} sections={sections} onCancel={() => setShowForm(false)} onSave={add} />}
      <StudentTable students={filtered} t={t} onSelect={(student) => setSelectedStudentId(student.id)} />
    </section>
    {selectedStudentId && <StudentProfilePanel
      key={selectedStudentId} studentId={selectedStudentId} t={t} locale={locale}
      canManage={canManage} canManageAdmissions={canManageAdmissions} canViewSensitiveData={canViewSensitiveData}
      canManageSensitiveData={canManageSensitiveData}
      canViewEmergencyContacts={canViewEmergencyContacts}
      canManageEmergencyContacts={canManageEmergencyContacts}
      canViewGuardians={canViewGuardians}
      canViewCommendations={canViewCommendations} canManageCommendations={canManageCommendations}
      canViewDiscipline={canViewDiscipline} canManageDiscipline={canManageDiscipline}
      canOverrideProgression={canOverrideProgression}
      canApproveTransfers={canApproveTransfers}
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

function printStudentIdCard(student: Student) {
  const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character] ?? character);
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  const studentName = `${student.givenNameEn} ${student.fatherNameEn} ${student.grandfatherNameEn}`;
  printWindow.document.write(`<!doctype html><html><head><title>Student ID Card</title><style>
    body{font-family:Arial,sans-serif;margin:24px}.card{width:330px;min-height:190px;border:2px solid #0f766e;
    border-radius:14px;padding:18px;display:grid;grid-template-columns:82px 1fr;gap:12px;align-items:center}
    .photo{width:78px;height:96px;border-radius:8px;background:#e6f4f1;display:grid;place-items:center;
    color:#0f766e;font-size:30px;font-weight:bold}.school{grid-column:1/-1;color:#0f766e;font-weight:bold}
    .name{font-size:16px;font-weight:bold}.meta{font-size:12px;margin-top:8px;color:#444}
    @media print{body{margin:0}.card{break-inside:avoid}}</style></head><body>
    <article class="card"><div class="school">SmartSchool · Student ID</div><div class="photo">${escape(studentName.slice(0, 1))}</div>
    <div><div class="name">${escape(studentName)}</div><div class="meta">ID: ${escape(student.studentNo)}</div>
    <div class="meta">Grade/Section: ${escape(student.sectionName || '—')}</div></div></article>
    <script>window.onload=()=>window.print()</script></body></html>`);
  printWindow.document.close();
}

function StudentPhotoPreview({ studentId, document }: { studentId: string; document: StudentDocument }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    api.downloadStudentDocument(studentId, document.id).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      if (active) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load photo.');
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [studentId, document.id]);
  return url ? <img className="student-profile-photo" src={url} alt="Student" />
    : <span className="student-avatar" aria-label={error || 'Student photo'}>◉</span>;
}

function StudentProfilePanel({ studentId, t, locale, canManage, canManageAdmissions, canOverrideProgression, canViewSensitiveData, canManageSensitiveData, canViewEmergencyContacts, canManageEmergencyContacts, canViewGuardians, canViewCommendations, canManageCommendations, canViewDiscipline, canManageDiscipline, canApproveTransfers, onClose }: {
  studentId: string; t: T; locale: Locale; canManage: boolean; canManageAdmissions: boolean; canViewSensitiveData: boolean;
  canManageSensitiveData: boolean; canViewEmergencyContacts: boolean;
  canManageEmergencyContacts: boolean; canViewGuardians: boolean;
  canViewCommendations: boolean; canManageCommendations: boolean;
  canViewDiscipline: boolean; canManageDiscipline: boolean; canApproveTransfers: boolean; canOverrideProgression: boolean; onClose: () => void
}) {
  const [student, setStudent] = useState<Student | null>(null);
  const [enrollmentHistory, setEnrollmentHistory] = useState<StudentEnrollment[]>([]);
  const [progressionSections, setProgressionSections] = useState<Section[]>([]);
  const [progressionEligibility, setProgressionEligibility] = useState<ProgressionEligibility | null>(null);
  const [progressionOutcome, setProgressionOutcome] = useState<'promoted' | 'repeated' | 'graduated'>('promoted');
  const [progressionSectionId, setProgressionSectionId] = useState('');
  const [progressionReason, setProgressionReason] = useState('');
  const [progressionOverrideReason, setProgressionOverrideReason] = useState('');
  const [emergencyContacts, setEmergencyContacts] = useState<StudentEmergencyContact[]>([]);
  const [sensitiveData, setSensitiveData] = useState<StudentSensitiveData | null>(null);
  const [guardians, setGuardians] = useState<StudentGuardian[]>([]);
  const [commendations, setCommendations] = useState<StudentCommendation[]>([]);
  const [documents, setDocuments] = useState<StudentDocument[]>([]);
  const [sectionTransfers, setSectionTransfers] = useState<{ id: string; fromSection: string; toSection: string; reason: string; createdAt: string }[]>([]);
  const [disciplineRecords, setDisciplineRecords] = useState<StudentDisciplineRecord[]>([]);
  const [transferPackages, setTransferPackages] = useState<StudentTransferPackage[]>([]);
  const [transferShareUrls, setTransferShareUrls] = useState<Record<string, string>>({});
  const [transferForm, setTransferForm] = useState({
    recipientSchool: '', guardianName: '', guardianRelationship: '', consentRecordedOn: localDateInput()
  });
  const [transferConsentDocumentId, setTransferConsentDocumentId] = useState('');
  const [disciplineForm, setDisciplineForm] = useState({
    recordedOn: localDateInput(), category: '', details: '', actionTaken: ''
  });
  const [sectionTransferTarget, setSectionTransferTarget] = useState('');
  const [sectionTransferReason, setSectionTransferReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [studentInviteEmail, setStudentInviteEmail] = useState('');
  const [studentInviteUrl, setStudentInviteUrl] = useState('');
  const [guardianForm, setGuardianForm] = useState({
    givenNameAm: '', fatherNameAm: '', grandfatherNameAm: '',
    givenNameEn: '', fatherNameEn: '', grandfatherNameEn: '',
    phone: '', email: '', relationship: '', isPrimary: false
  });
  const [commendationForm, setCommendationForm] = useState({
    recordedOn: localDateInput(), titleEn: '', titleAm: '', descriptionEn: '', descriptionAm: ''
  });
  const [emergencyContactForm, setEmergencyContactForm] = useState({
    name: '', phone: '', relationship: '', priority: 1
  });
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [studentRecord, guardianRecords, commendationRecords, emergencyContactRecords, enrollments, sections, documentRecords, transferRecords, disciplineRows, packageRows] = await Promise.all([
        api.student(studentId),
        canViewGuardians ? api.studentGuardians(studentId) : Promise.resolve([]),
        canViewCommendations ? api.studentCommendations(studentId) : Promise.resolve([]),
        canViewEmergencyContacts ? api.studentEmergencyContacts(studentId) : Promise.resolve([]),
        api.studentEnrollmentHistory(studentId),
        canManageAdmissions ? api.sections() : Promise.resolve([]),
        api.studentDocuments(studentId),
        api.studentSectionTransfers(studentId),
        canViewDiscipline ? api.studentDiscipline(studentId) : Promise.resolve([]),
        canManageAdmissions || canApproveTransfers ? api.studentTransferPackages(studentId) : Promise.resolve([])
      ]);
      const needsProgression = canManageAdmissions && enrollments.some((enrollment) => enrollment.status === 'completed') &&
        !enrollments.some((enrollment) => enrollment.status === 'active');
      setProgressionEligibility(needsProgression ? await api.progressionEligibility(studentId) : null);
      setStudent(studentRecord);
      setGuardians(guardianRecords);
      setCommendations(commendationRecords);
      setEmergencyContacts(emergencyContactRecords);
      setEnrollmentHistory(enrollments);
      setProgressionSections(sections);
      setProgressionSectionId((current) => current || sections[0]?.id || '');
      setDocuments(documentRecords);
      setSectionTransfers(transferRecords);
      setDisciplineRecords(disciplineRows);
      setTransferPackages(packageRows);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally {
      setLoading(false);
    }
  }, [studentId, canViewGuardians, canViewCommendations, canViewEmergencyContacts, canManageAdmissions, canViewDiscipline, canApproveTransfers, t]);
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
  const revealSensitiveData = async () => {
    setBusy(true);
    setError('');
    try {
      setSensitiveData(await api.studentSensitiveData(studentId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally {
      setBusy(false);
    }
  };
  const saveSensitiveData = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sensitiveData) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await api.updateStudentSensitiveData(studentId, {
        idNumber: sensitiveData.idNumber || null,
        healthNotes: sensitiveData.healthNotes || null,
        specialNeeds: sensitiveData.specialNeeds || null,
        allergies: sensitiveData.allergies || null
      });
      setSensitiveData(updated);
      setNotice(t('sensitiveDataSaved'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally {
      setBusy(false);
    }
  };
  const addEmergencyContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const contact = await api.addStudentEmergencyContact(studentId, emergencyContactForm);
      setEmergencyContacts((current) => [...current, contact]
        .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt)));
      setEmergencyContactForm({ name: '', phone: '', relationship: '', priority: 1 });
      setNotice(t('emergencyContactSaved'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally {
      setBusy(false);
    }
  };
  const removeEmergencyContact = async (contact: StudentEmergencyContact) => {
    if (!window.confirm(t('removeEmergencyContactConfirm'))) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.removeStudentEmergencyContact(studentId, contact.id);
      setEmergencyContacts((current) => current.filter((item) => item.id !== contact.id));
      setNotice(t('emergencyContactRemoved'));
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
  const createStudentInvitation = async (event: FormEvent) => {
    event.preventDefault();
    if (!student) return;
    setBusy(true); setError(''); setNotice(''); setStudentInviteUrl('');
    try {
      const invitation = await api.createAccountInvitation({
        targetType: 'student', targetId: student.id, email: studentInviteEmail
      });
      setStudentInviteUrl(invitation.invitationUrl);
      setNotice(t('inviteCreated'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const addCommendation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const commendation = await api.createStudentCommendation(studentId, commendationForm);
      setCommendations((current) => [commendation, ...current]
        .sort((a, b) => b.recordedOn.localeCompare(a.recordedOn) || b.createdAt.localeCompare(a.createdAt)));
      setCommendationForm({
        recordedOn: localDateInput(), titleEn: '', titleAm: '', descriptionEn: '', descriptionAm: ''
      });
      setNotice(t('commendationSaved'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally {
      setBusy(false);
    }
  };
  const progressStudent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!student || progressionReason.trim().length < 3) return;
    if (progressionOutcome === 'graduated' && !window.confirm(t('confirmGraduation'))) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await api.advanceStudent(student.id, {
        outcome: progressionOutcome,
        ...(progressionOutcome === 'graduated' ? {} : { sectionId: progressionSectionId }),
        reason: progressionReason.trim(),
        ...(progressionOverrideReason.trim() ? { overrideReason: progressionOverrideReason.trim() } : {})
      });
      setStudent(updated);
      setEnrollmentHistory(await api.studentEnrollmentHistory(student.id));
      setProgressionEligibility(null);
      setProgressionReason('');
      setProgressionOverrideReason('');
      setNotice(t('studentProgressionSaved'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally {
      setBusy(false);
    }
  };
  const uploadStudentFile = async (type: StudentDocument['documentType'], file: File | undefined) => {
    if (!file) return null;
    setBusy(true); setError(''); setNotice('');
    try {
      const document = await api.uploadStudentDocument(studentId, type, file);
      setDocuments((current) => [document, ...current]);
      setNotice(t('studentDocumentSaved'));
      if (type === 'transfer_consent') setTransferConsentDocumentId(document.id);
      return document;
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
    return null;
  };
  const requestTransferPackage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!transferConsentDocumentId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const item = await api.createStudentTransferPackage(studentId, {
        ...transferForm, consentDocumentId: transferConsentDocumentId
      });
      setTransferPackages((current) => [item, ...current]);
      setTransferConsentDocumentId('');
      setTransferForm({ recipientSchool: '', guardianName: '', guardianRelationship: '', consentRecordedOn: localDateInput() });
      setNotice(t('transferPackageRequested'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const issueTransferLink = async (packageId: string) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.approveStudentTransferPackage(studentId, packageId);
      setTransferPackages((current) => current.map((item) => item.id === packageId ? result : item));
      setTransferShareUrls((current) => ({ ...current, [packageId]: result.shareUrl }));
      setNotice(t('transferLinkReady'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const downloadStudentFile = async (document: StudentDocument) => {
    setBusy(true); setError('');
    try {
      const blob = await api.downloadStudentDocument(studentId, document.id);
      const url = URL.createObjectURL(blob);
      const link = document.documentType === 'photo' ? window.open(url, '_blank', 'noopener') : null;
      if (!link) {
        const anchor = window.document.createElement('a');
        anchor.href = url; anchor.download = document.originalName; anchor.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const transferSection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sectionTransferTarget || sectionTransferReason.trim().length < 3) return;
    setBusy(true); setError(''); setNotice('');
    try {
      setStudent(await api.transferStudentSection(studentId, sectionTransferTarget, sectionTransferReason.trim()));
      setSectionTransferReason('');
      setSectionTransfers(await api.studentSectionTransfers(studentId));
      setEnrollmentHistory(await api.studentEnrollmentHistory(studentId));
      setNotice(t('sectionTransferSaved'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const addDisciplineRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const record = await api.createStudentDiscipline(studentId, {
        ...disciplineForm, actionTaken: disciplineForm.actionTaken || null
      });
      setDisciplineRecords((current) => [record, ...current]);
      setDisciplineForm({ recordedOn: localDateInput(), category: '', details: '', actionTaken: '' });
      setNotice(t('disciplineSaved'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const setStudentField = (field: keyof Student, value: string) => {
    setStudent((current) => current ? { ...current, [field]: value } : current);
  };
  if (loading) return <section className="panel"><div className="empty-state">{t('loading')}</div></section>;
  if (!student) return <section className="panel"><div className="notice notice-error">{error || t('studentNotFound')}</div></section>;
  return <section className="panel student-profile-panel">
    <div className="panel-heading"><div className="student-profile-heading">
      {documents.find((item) => item.documentType === 'photo') &&
        <StudentPhotoPreview document={documents.find((item) => item.documentType === 'photo')!} studentId={studentId} />}
      <div><div className="eyebrow">{student.studentNo}</div><h2>{t('studentProfile')}</h2></div>
    </div><div className="student-page-actions">
      <button className="button button-secondary" onClick={() => printStudentIdCard(student)}>{t('printStudentIdCard')}</button>
      <button className="button button-quiet" onClick={onClose}>{t('close')}</button>
    </div></div>
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
    <section className="guardian-records">
      <div className="form-section-title"><strong>{t('studentDocuments')}</strong><span>{t('studentDocumentsPrivacy')}</span></div>
      {canManage && <div className="student-import-actions">
        <label className="upload-control">{t('uploadStudentPhoto')}<input type="file" accept="image/jpeg,image/png" disabled={busy}
          onChange={(event) => { void uploadStudentFile('photo', event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
        <label className="upload-control">{t('uploadStudentDocument')}<input type="file" accept=".pdf,image/jpeg,image/png,application/pdf" disabled={busy}
          onChange={(event) => { void uploadStudentFile('other', event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
      </div>}
      {documents.length > 0 && <div className="invoice-list">{documents.map((document) =>
        <article className="invoice-row" key={document.id}><div><strong>{document.originalName}</strong><small>{t(document.documentType)} · {Math.ceil(document.sizeBytes / 1024)} KB</small></div>
          <button className="text-link" disabled={busy} onClick={() => void downloadStudentFile(document)}>{t('download')}</button>
        </article>)}</div>}
    </section>
    {(canManageAdmissions || canApproveTransfers) && <section className="secure-student-data">
      <div className="form-section-title"><strong>{t('interSchoolTransfer')}</strong><span>{t('transferConsentPolicy')}</span></div>
      {canManageAdmissions && <form className="student-form" onSubmit={(event) => void requestTransferPackage(event)}>
        <div className="form-grid">
          <FormInput label={t('recipientSchool')} value={transferForm.recipientSchool}
            onChange={(value) => setTransferForm((current) => ({ ...current, recipientSchool: value }))} required />
          <FormInput label={t('consentingGuardian')} value={transferForm.guardianName}
            onChange={(value) => setTransferForm((current) => ({ ...current, guardianName: value }))} required />
          <FormInput label={t('relationship')} value={transferForm.guardianRelationship}
            onChange={(value) => setTransferForm((current) => ({ ...current, guardianRelationship: value }))} required />
          <FormInput label={t('consentRecordedOn')} type="date" value={transferForm.consentRecordedOn}
            onChange={(value) => setTransferForm((current) => ({ ...current, consentRecordedOn: value }))} required />
        </div>
        <label className="upload-control">{transferConsentDocumentId ? t('consentDocumentUploaded') : t('uploadSignedConsent')}
          <input type="file" accept=".pdf,image/jpeg,image/png,application/pdf" disabled={busy}
            onChange={(event) => { void uploadStudentFile('transfer_consent', event.target.files?.[0]); event.currentTarget.value = ''; }} />
        </label>
        <button className="button button-primary" disabled={busy || !transferConsentDocumentId}>{t('requestTransferApproval')}</button>
      </form>}
      {transferPackages.map((item) => <article className="invoice-row" key={item.id}>
        <div><strong>{item.recipientSchool} · {t(`transfer_${item.status}`)}</strong>
          <small>{item.guardianName} · {item.guardianRelationship} · {item.consentRecordedOn}
            {item.expiresAt ? ` · ${t('linkExpires')}: ${item.expiresAt.slice(0, 10)}` : ''}</small>
          {transferShareUrls[item.id] && <input readOnly value={transferShareUrls[item.id]} aria-label={t('transferShareLink')} />}
        </div>
        {canApproveTransfers && item.status === 'approved' && <button className="button button-quiet" disabled={busy}
          onClick={() => void issueTransferLink(item.id)}>{t('reissueTransferLink')}</button>}
        {canApproveTransfers && item.status === 'pending' && <button className="button button-primary" disabled={busy}
          onClick={() => void issueTransferLink(item.id)}>{t('approveTransferPackage')}</button>}
        {transferShareUrls[item.id] && <button className="button button-quiet"
          onClick={() => void navigator.clipboard.writeText(transferShareUrls[item.id])}>{t('copyLink')}</button>}
      </article>)}
    </section>}
    <section className="guardian-records student-enrollment-history">
      <div className="form-section-title"><strong>{t('enrollmentHistory')}</strong><span>{t('enrollmentHistoryNotice')}</span></div>
      {enrollmentHistory.length === 0 ? <div className="empty-state">{t('noEnrollmentHistory')}</div> :
        <div className="table-scroll"><table className="data-table"><thead><tr>
          <th>{t('academicYear')}</th><th>{t('gradeLevel')}</th><th>{t('section')}</th>
          <th>{t('enrolledOn')}</th><th>{t('state')}</th>
        </tr></thead><tbody>{enrollmentHistory.map((enrollment) => <tr key={enrollment.id}>
          <td>{enrollment.academicYear}</td>
          <td>{locale === 'am' ? enrollment.gradeNameAm || enrollment.gradeNameEn : enrollment.gradeNameEn}</td>
          <td>{enrollment.sectionName}</td><td>{enrollment.enrolledOn}</td>
          <td>{t(enrollment.outcome || enrollment.status)}</td>
        </tr>)}</tbody></table></div>}
      {canManageAdmissions && student.status === 'enrolled' &&
        <form className="student-form" onSubmit={(event) => void transferSection(event)}>
          <div className="form-section-title"><strong>{t('internalSectionTransfer')}</strong><span>{t('sectionTransferNotice')}</span></div>
          <div className="form-grid">
            <label>{t('destinationSection')}<select required value={sectionTransferTarget}
              onChange={(event) => setSectionTransferTarget(event.target.value)}>
              <option value="">{t('selectSection')}</option>
              {progressionSections.filter((section) => section.id !== student.sectionId).map((section) =>
                <option key={section.id} value={section.id}>{section.gradeName ? `${section.gradeName} · ` : ''}{section.name}</option>)}
            </select></label>
            <FormInput label={t('statusReason')} value={sectionTransferReason}
              onChange={setSectionTransferReason} required />
          </div>
          <div className="form-actions"><button className="button button-primary"
            disabled={busy || !sectionTransferTarget || sectionTransferReason.trim().length < 3}>{t('transferSection')}</button></div>
          {sectionTransfers.length > 0 && <ul className="plain-list">{sectionTransfers.map((transfer) =>
            <li key={transfer.id}>{transfer.fromSection} → {transfer.toSection} · {transfer.createdAt.slice(0, 10)} — {transfer.reason}</li>)}</ul>}
        </form>}
      {canManageAdmissions && student.status === 'enrolled' &&
        enrollmentHistory.some((enrollment) => enrollment.status === 'completed') &&
        !enrollmentHistory.some((enrollment) => enrollment.status === 'active') &&
        <form className="student-form" onSubmit={(event) => void progressStudent(event)}>
          <div className="form-section-title"><strong>{t('recordProgression')}</strong><span>{t('progressionPolicyNotice')}</span></div>
          {progressionEligibility && <div className={progressionEligibility.status === 'eligible' ? 'notice notice-success' : 'notice notice-warm'}>
            <strong>{t(`progression_${progressionEligibility.status}`)}</strong> · {progressionEligibility.reason}
            {progressionEligibility.annualAveragePercent != null && <span> · {t('annualAverage')}: {progressionEligibility.annualAveragePercent.toFixed(1)}%</span>}
            {!!progressionEligibility.failedRequiredSubjects.length && <ul className="plain-list">{progressionEligibility.failedRequiredSubjects.map((subject) =>
              <li key={subject.subjectId}>{subject.subjectName}: {subject.percent.toFixed(1)}%</li>)}</ul>}
          </div>}
          <div className="form-grid">
            <label>{t('progressionOutcome')}<select value={progressionOutcome}
              onChange={(event) => setProgressionOutcome(event.target.value as typeof progressionOutcome)}>
              <option value="promoted" disabled={progressionEligibility?.status !== 'eligible' && !canOverrideProgression}>{t('promoted')}</option>
              <option value="repeated">{t('repeated')}</option>
              <option value="graduated">{t('graduated')}</option>
            </select></label>
            {progressionOutcome !== 'graduated' && <label>{t('destinationSection')}<select required
              value={progressionSectionId} onChange={(event) => setProgressionSectionId(event.target.value)}>
              <option value="">{t('selectSection')}</option>
              {progressionSections.map((section) => <option key={section.id} value={section.id}>
                {section.gradeName ? `${section.gradeName} · ` : ''}{section.name}
              </option>)}
            </select></label>}
            <FormInput label={t('statusReason')} value={progressionReason}
              onChange={setProgressionReason} required />
            {progressionOutcome === 'promoted' && progressionEligibility?.status !== 'eligible' && canOverrideProgression &&
              <FormInput label={t('promotionOverrideReason')} value={progressionOverrideReason}
                onChange={setProgressionOverrideReason} required />}
          </div>
          <div className="form-actions"><button className="button button-primary"
            disabled={busy || progressionReason.trim().length < 3 ||
              (progressionOutcome !== 'graduated' && !progressionSectionId) ||
              (progressionOutcome === 'promoted' && progressionEligibility?.status !== 'eligible' &&
                (!canOverrideProgression || progressionOverrideReason.trim().length < 5))}>
            {busy ? t('loading') : t('recordProgression')}
          </button></div>
        </form>}
    </section>
    {canViewDiscipline && <section className="secure-student-data">
      <div className="form-section-title"><strong>{t('disciplineRecords')}</strong><span>{t('disciplinePrivacyNotice')}</span></div>
      {canManageDiscipline && <form className="student-form" onSubmit={(event) => void addDisciplineRecord(event)}>
        <div className="form-grid">
          <FormInput label={t('recordedOn')} type="date" value={disciplineForm.recordedOn}
            onChange={(value) => setDisciplineForm((current) => ({ ...current, recordedOn: value }))} required />
          <FormInput label={t('disciplineCategory')} value={disciplineForm.category}
            onChange={(value) => setDisciplineForm((current) => ({ ...current, category: value }))} required />
          <label>{t('incidentDetails')}<textarea value={disciplineForm.details} required maxLength={5000}
            onChange={(event) => setDisciplineForm((current) => ({ ...current, details: event.target.value }))} /></label>
          <label>{t('actionTaken')}<textarea value={disciplineForm.actionTaken} maxLength={5000}
            onChange={(event) => setDisciplineForm((current) => ({ ...current, actionTaken: event.target.value }))} /></label>
        </div>
        <button className="button button-primary" disabled={busy}>{t('recordDiscipline')}</button>
      </form>}
      {disciplineRecords.map((record) => <article className="invoice-row" key={record.id}>
        <div><strong>{record.recordedOn} · {record.category}</strong>
          <small>{record.details}{record.actionTaken ? ` · ${t('actionTaken')}: ${record.actionTaken}` : ''}</small>
        </div>
      </article>)}
      {!disciplineRecords.length && <div className="empty-state">{t('noDisciplineRecords')}</div>}
    </section>}
      {canViewSensitiveData && <section className="secure-student-data">
        <div className="form-section-title"><strong>{t('sensitiveStudentData')}</strong><span>{t('sensitiveDataPrivacyNotice')}</span></div>
        {!sensitiveData ? <button type="button" className="button button-quiet" onClick={() => void revealSensitiveData()} disabled={busy}>
          {busy ? t('loading') : t('revealSensitiveData')}
        </button> : <form onSubmit={(event) => void saveSensitiveData(event)}>
          <div className="form-grid">
            <FormInput label={t('studentIdNumber')} value={sensitiveData.idNumber ?? ''}
              onChange={(value) => setSensitiveData((current) => current ? { ...current, idNumber: value } : current)}
              disabled={!canManageSensitiveData} />
            <label>{t('healthNotes')}<textarea rows={3} value={sensitiveData.healthNotes ?? ''}
              onChange={(event) => setSensitiveData((current) => current ? { ...current, healthNotes: event.target.value } : current)}
              disabled={!canManageSensitiveData} /></label>
            <label>{t('specialNeeds')}<textarea rows={3} value={sensitiveData.specialNeeds ?? ''}
              onChange={(event) => setSensitiveData((current) => current ? { ...current, specialNeeds: event.target.value } : current)}
              disabled={!canManageSensitiveData} /></label>
            <label>{t('allergies')}<textarea rows={3} value={sensitiveData.allergies ?? ''}
              onChange={(event) => setSensitiveData((current) => current ? { ...current, allergies: event.target.value } : current)}
              disabled={!canManageSensitiveData} /></label>
          </div>
          <div className="form-actions">
            {canManageSensitiveData && <button className="button button-primary" disabled={busy}>{busy ? t('loading') : t('saveSensitiveData')}</button>}
            <button type="button" className="button button-quiet" onClick={() => setSensitiveData(null)}>{t('hideSensitiveData')}</button>
          </div>
        </form>}
      </section>}
      {canViewEmergencyContacts && <section className="guardian-records emergency-contact-records">
        <div className="form-section-title"><strong>{t('emergencyContacts')}</strong><span>{t('emergencyContactPrivacyNotice')}</span></div>
        {emergencyContacts.length === 0 ? <div className="empty-state">{t('noEmergencyContacts')}</div> :
          emergencyContacts.map((contact) => <div className="guardian-row" key={contact.id}>
            <div><strong>{contact.name}</strong><small>{contact.relationship} · {contact.phone} · {t('contactPriority')} {contact.priority}</small></div>
            {canManageEmergencyContacts && <button type="button" className="button button-quiet" disabled={busy}
              onClick={() => void removeEmergencyContact(contact)}>{t('remove')}</button>}
          </div>)}
        {canManageEmergencyContacts && <form className="student-form" onSubmit={(event) => void addEmergencyContact(event)}>
          <div className="form-section-title"><strong>{t('addEmergencyContact')}</strong></div>
          <div className="form-grid">
            <FormInput label={t('contactName')} value={emergencyContactForm.name}
              onChange={(name) => setEmergencyContactForm((current) => ({ ...current, name }))} required />
            <FormInput label={t('contactPhone')} value={emergencyContactForm.phone}
              onChange={(phone) => setEmergencyContactForm((current) => ({ ...current, phone }))} required />
            <FormInput label={t('relationship')} value={emergencyContactForm.relationship}
              onChange={(relationship) => setEmergencyContactForm((current) => ({ ...current, relationship }))} required />
            <label>{t('contactPriority')}<input type="number" min="1" max="10" value={emergencyContactForm.priority}
              onChange={(event) => setEmergencyContactForm((current) => ({
                ...current, priority: Number(event.target.value)
              }))} required /></label>
          </div>
          <div className="form-actions"><button className="button button-primary" disabled={busy}>
            {busy ? t('loading') : t('saveEmergencyContact')}
          </button></div>
        </form>}
      </section>}
      {canManage && <section className="portal-access-panel">
      <div className="form-section-title"><strong>{t('studentPortalInvite')}</strong><span>{t('invitationLinkHint')}</span></div>
      {student.hasPortalAccount ? <p className="muted">{t('accountAlreadyExists')}</p> : <form onSubmit={(event) => void createStudentInvitation(event)}>
        <div className="form-grid">
          <FormInput label={t('invitationEmail')} type="email" value={studentInviteEmail} onChange={setStudentInviteEmail} required />
        </div>
        <div className="form-actions"><button className="button button-primary" disabled={busy}>{t('studentPortalInvite')}</button></div>
      </form>}
      {studentInviteUrl && <InvitationLinkField value={studentInviteUrl} t={t} />}
    </section>}
    {canViewCommendations && <div className="commendation-records">
      <div className="form-section-title"><strong>{t('commendations')}</strong><span>{t('commendationPrivacyNotice')}</span></div>
      {canManageCommendations && <form className="student-form" onSubmit={(event) => void addCommendation(event)}>
        <div className="form-grid">
          <FormInput label={t('recordedOn')} type="date" value={commendationForm.recordedOn} onChange={(recordedOn) => setCommendationForm((current) => ({ ...current, recordedOn }))} required />
          <FormInput label={t('commendationTitleEn')} value={commendationForm.titleEn} onChange={(titleEn) => setCommendationForm((current) => ({ ...current, titleEn }))} required />
          <FormInput label={t('commendationTitleAm')} value={commendationForm.titleAm} onChange={(titleAm) => setCommendationForm((current) => ({ ...current, titleAm }))} required />
        </div>
        <div className="form-grid">
          <label>{t('commendationDescriptionEn')}<textarea rows={3} value={commendationForm.descriptionEn} onChange={(event) => setCommendationForm((current) => ({ ...current, descriptionEn: event.target.value }))} required /></label>
          <label>{t('commendationDescriptionAm')}<textarea rows={3} value={commendationForm.descriptionAm} onChange={(event) => setCommendationForm((current) => ({ ...current, descriptionAm: event.target.value }))} required /></label>
        </div>
        <div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addCommendation')}</button></div>
      </form>}
      {commendations.length ? commendations.map((item) => <article className="commendation-row" key={item.id}>
        <time>{item.recordedOn}</time>
        <div><strong>{locale === 'am' ? item.titleAm : item.titleEn}</strong>
          <p>{locale === 'am' ? item.descriptionAm : item.descriptionEn}</p></div>
      </article>) : <div className="empty-state">{t('noCommendations')}</div>}
    </div>}
    {canViewGuardians && <div className="guardian-records">
      <div className="form-section-title"><strong>{t('guardianRecords')}</strong><span>{t('guardianPrivacyNotice')}</span></div>
      {guardians.length === 0 ? <div className="empty-state">{t('noGuardians')}</div> : guardians.map((guardian) =>
        <div className="guardian-row" key={guardian.id}>
          <div><strong>{guardian.givenNameEn} {guardian.fatherNameEn} {guardian.grandfatherNameEn}</strong>
            <small>{guardian.givenNameAm} {guardian.fatherNameAm} {guardian.grandfatherNameAm} · {guardian.relationship} · {guardian.phone}{guardian.email ? ` · ${guardian.email}` : ''}</small>
            <small>{guardian.isPrimary ? t('primaryGuardian') : ''} · {guardian.isVerified ? t('verified') : t('unverified')}</small>
            {canManage && <GuardianAccountActions
              studentId={studentId} guardian={guardian} t={t}
              onUpdated={load}
            />}
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

function GuardianAccountActions({ studentId, guardian, t, onUpdated }: {
  studentId: string; guardian: StudentGuardian; t: T; onUpdated: () => Promise<void>
}) {
  const [email, setEmail] = useState(guardian.email ?? '');
  const [isVerified, setIsVerified] = useState(guardian.isVerified);
  const [canViewResults, setCanViewResults] = useState(guardian.canViewResults);
  const [canViewFees, setCanViewFees] = useState(guardian.canViewFees);
  const [inviteUrl, setInviteUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setIsVerified(guardian.isVerified);
    setCanViewResults(guardian.canViewResults);
    setCanViewFees(guardian.canViewFees);
    setEmail(guardian.email ?? '');
  }, [guardian]);
  const saveAccess = async () => {
    setBusy(true); setError(''); setInviteUrl('');
    try {
      await api.verifyStudentGuardian(studentId, guardian.id, {
        isVerified, canViewResults: isVerified && canViewResults, canViewFees: isVerified && canViewFees
      });
      await onUpdated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setInviteUrl('');
    try {
      const result = await api.createAccountInvitation({
        targetType: 'guardian', targetId: guardian.id, email
      });
      setInviteUrl(result.invitationUrl);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  return <div className="guardian-account-actions">
    <label className="checkbox-label"><input type="checkbox" checked={isVerified} onChange={(event) => setIsVerified(event.target.checked)} />{t('verifyGuardian')}</label>
    <label className="checkbox-label"><input type="checkbox" checked={canViewResults} disabled={!isVerified} onChange={(event) => setCanViewResults(event.target.checked)} />{t('allowResults')}</label>
    <label className="checkbox-label"><input type="checkbox" checked={canViewFees} disabled={!isVerified} onChange={(event) => setCanViewFees(event.target.checked)} />{t('allowFees')}</label>
    <button className="button button-quiet" disabled={busy} onClick={() => void saveAccess()}>{t('verifyGuardianAccess')}</button>
    {isVerified && <form className="guardian-invite-form" onSubmit={(event) => void invite(event)}>
      <FormInput label={t('invitationEmail')} type="email" value={email} onChange={setEmail} required />
      <button className="button button-primary" disabled={busy || guardian.hasPortalAccount}>{guardian.hasPortalAccount ? t('accountAlreadyExists') : t('guardianPortalInvite')}</button>
    </form>}
    {inviteUrl && <InvitationLinkField value={inviteUrl} t={t} />}
    {error && <div className="form-error">{error}</div>}
  </div>;
}
