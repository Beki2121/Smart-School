import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  api, Department, HrApplicant, HrContract, HrDocument, HrInterview, HrLeaveBalance,
  HrLeaveType, HrPerformanceCycle, HrPerformanceEvaluation, HrPerformanceGoal,
  HrTrainingCourse, HrTrainingEnrollment, HrVacancy, StaffMember
} from '../../api';

type T = (key: string) => string;
type Section = 'staff' | 'contracts' | 'leave' | 'recruitment' | 'performance' | 'training';
type Access = {
  staffView: boolean; staffEdit: boolean; staffArchive: boolean; staffImport: boolean;
  documentView: boolean; documentManage: boolean; contractView: boolean; contractManage: boolean;
  leaveView: boolean; leaveConfigure: boolean; balanceManage: boolean;
  recruitmentView: boolean; recruitmentManage: boolean;
  performanceView: boolean; performanceManage: boolean;
  trainingView: boolean; trainingManage: boolean
};

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};

function exportCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const content = [columns, ...rows.map((row) => columns.map((column) => row[column]))]
    .map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Field({ label, value, onChange, type = 'text', required = false }: {
  label: string; value: string; onChange: (value: string) => void;
  type?: string; required?: boolean
}) {
  return <label>{label}<input type={type} required={required} value={value}
    onChange={(event) => onChange(event.target.value)} /></label>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel"><div className="panel-heading"><h2>{title}</h2></div>{children}</section>;
}

export default function HrManagementPage({ t, access }: { t: T; access: Access }) {
  const [section, setSection] = useState<Section>('staff');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [contracts, setContracts] = useState<HrContract[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<HrLeaveType[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<HrLeaveBalance[]>([]);
  const [vacancies, setVacancies] = useState<HrVacancy[]>([]);
  const [applicants, setApplicants] = useState<HrApplicant[]>([]);
  const [interviews, setInterviews] = useState<Record<string, HrInterview[]>>({});
  const [cycles, setCycles] = useState<HrPerformanceCycle[]>([]);
  const [goals, setGoals] = useState<HrPerformanceGoal[]>([]);
  const [evaluations, setEvaluations] = useState<HrPerformanceEvaluation[]>([]);
  const [courses, setCourses] = useState<HrTrainingCourse[]>([]);
  const [enrollments, setEnrollments] = useState<HrTrainingEnrollment[]>([]);
  const [documents, setDocuments] = useState<HrDocument[]>([]);
  const [applicantDocuments, setApplicantDocuments] = useState<HrDocument[]>([]);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [selectedApplicant, setSelectedApplicant] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState(String(new Date().getFullYear()));
  const [staffDraft, setStaffDraft] = useState<Partial<StaffMember> | null>(null);
  const [importCsv, setImportCsv] = useState('');
  const [importPreview, setImportPreview] = useState<{ totalRows: number; eligibleCount: number;
    invalidCount: number; rows: { rowNumber: number; eligible: boolean;
      errors: { field: string; message: string }[] }[] } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [staffRows, departmentRows, contractRows, typeRows, balanceRows, vacancyRows,
      applicantRows, cycleRows, goalRows, evaluationRows, courseRows] = await Promise.all([
      access.staffView ? api.staff() : Promise.resolve([]),
      access.staffView ? api.departments() : Promise.resolve([]),
      access.contractView ? api.hrContracts() : Promise.resolve([]),
      access.leaveView ? api.hrLeaveTypes() : Promise.resolve([]),
      access.leaveView ? api.hrLeaveBalances({ year: Number(yearFilter) }) : Promise.resolve([]),
      access.recruitmentView ? api.hrVacancies() : Promise.resolve([]),
      access.recruitmentView ? api.hrApplicants() : Promise.resolve([]),
      access.performanceView ? api.hrPerformanceCycles() : Promise.resolve([]),
      access.performanceView ? api.hrPerformanceGoals() : Promise.resolve([]),
      access.performanceView ? api.hrPerformanceEvaluations() : Promise.resolve([]),
      access.trainingView ? api.hrTrainingCourses() : Promise.resolve([])
    ]);
    setStaff(staffRows);
    setDepartments(departmentRows);
    setContracts(contractRows);
    setLeaveTypes(typeRows);
    setLeaveBalances(balanceRows);
    setVacancies(vacancyRows);
    setApplicants(applicantRows);
    setCycles(cycleRows);
    setGoals(goalRows);
    setEvaluations(evaluationRows);
    setCourses(courseRows);
    if (!selectedStaff && staffRows[0]) setSelectedStaff(staffRows[0].id);
  }, [access.staffView, access.contractView, access.leaveView, access.recruitmentView,
    access.performanceView, access.trainingView, yearFilter, selectedStaff]);

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [load, t]);

  useEffect(() => {
    if (!selectedStaff || !access.documentView) return;
    let active = true;
    api.hrStaffDocuments(selectedStaff).then((rows) => { if (active) setDocuments(rows); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : t('apiError')); });
    return () => { active = false; };
  }, [selectedStaff, access.documentView, t]);

  const visibleStaff = useMemo(() => staff.filter((item) =>
    `${item.name} ${item.jobTitle} ${item.departmentName} ${item.employmentStatus}`
      .toLocaleLowerCase().includes(search.toLocaleLowerCase())), [staff, search]);
  const visibleContracts = useMemo(() => contracts.filter((item) => {
    const owner = staff.find((member) => member.id === item.staffId);
    return `${owner?.name ?? item.staffId} ${item.contractType} ${item.status}`
      .toLocaleLowerCase().includes(search.toLocaleLowerCase());
  }), [contracts, staff, search]);
  const visibleApplicants = useMemo(() => applicants.filter((item) =>
    `${item.givenName} ${item.fatherName} ${item.grandfatherName} ${item.email} ${item.status}`
      .toLocaleLowerCase().includes(search.toLocaleLowerCase())), [applicants, search]);
  const visibleCourses = useMemo(() => courses.filter((item) =>
    `${item.title} ${item.description} ${item.status}`
      .toLocaleLowerCase().includes(search.toLocaleLowerCase())), [courses, search]);

  const perform = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await load(); setNotice(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const print = () => window.print();

  const selectStaff = (id: string) => {
    setSelectedStaff(id);
    const member = staff.find((item) => item.id === id);
    setStaffDraft(member ? { ...member } : null);
    if (id && access.documentView) {
      api.hrStaffDocuments(id).then(setDocuments)
        .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
    } else setDocuments([]);
  };

  const saveStaff = async (event: FormEvent) => {
    event.preventDefault();
    if (!staffDraft || !selectedStaff) return;
    await perform(async () => {
      await api.updateHrStaff(selectedStaff, {
        departmentId: staffDraft.departmentId ?? null,
        givenNameEn: staffDraft.givenNameEn, fatherNameEn: staffDraft.fatherNameEn,
        grandfatherNameEn: staffDraft.grandfatherNameEn, givenNameAm: staffDraft.givenNameAm,
        fatherNameAm: staffDraft.fatherNameAm, grandfatherNameAm: staffDraft.grandfatherNameAm,
        jobTitle: staffDraft.jobTitle, qualification: staffDraft.qualification,
        employmentStatus: staffDraft.employmentStatus, hiredOn: staffDraft.hiredOn
      });
    }, t('hrStaffSaved'));
  };

  const sectionOptions: { id: Section; label: string; enabled: boolean }[] = [
    { id: 'staff', label: t('hrStaff'), enabled: access.staffView || access.staffImport },
    { id: 'contracts', label: t('hrContracts'), enabled: access.contractView || access.contractManage },
    { id: 'leave', label: t('hrLeave'), enabled: access.leaveView || access.leaveConfigure || access.balanceManage },
    { id: 'recruitment', label: t('hrRecruitment'), enabled: access.recruitmentView || access.recruitmentManage },
    { id: 'performance', label: t('hrPerformance'), enabled: access.performanceView || access.performanceManage },
    { id: 'training', label: t('hrTraining'), enabled: access.trainingView || access.trainingManage }
  ];
  const selectedSections = sectionOptions.filter((item) => item.enabled);

  return <div className="page-stack">
    <header className="page-heading"><div><div className="eyebrow">{t('navAdministration')}</div>
      <h1>{t('hrManagement')}</h1><p>{t('hrManagementHint')}</p></div>
      <div className="form-actions"><button className="button button-quiet" onClick={print}>{t('print')}</button>
        <button className="button button-quiet" onClick={() => void load()} disabled={busy}>{t('refresh')}</button></div>
    </header>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {notice && <div className="notice notice-success" role="status">{notice}</div>}
    <nav className="filter-row" aria-label={t('hrManagement')}>
      {selectedSections.map((item) => <button key={item.id}
        className={`button ${section === item.id ? 'button-primary' : 'button-quiet'}`}
        onClick={() => { setSection(item.id); setSearch(''); }}>{item.label}</button>)}
    </nav>
    <label className="search-field">{t('search')}<input value={search}
      onChange={(event) => setSearch(event.target.value)} /></label>

    {section === 'staff' && <div className="page-stack">
      {access.staffView && <Panel title={t('hrStaff')}>
        <div className="form-grid">
          <label>{t('hrSelectStaff')}<select value={selectedStaff}
            onChange={(event) => selectStaff(event.target.value)}>
            <option value="">{t('hrSelectStaff')}</option>
            {visibleStaff.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.jobTitle}</option>)}
          </select></label>
        </div>
        <div className="table-scroll"><table><thead><tr><th>{t('staff')}</th><th>{t('jobTitle')}</th>
          <th>{t('department')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead>
          <tbody>{visibleStaff.map((item) => <tr key={item.id}><td>{item.name}</td>
            <td>{item.jobTitle}</td><td>{item.departmentName}</td><td>{item.employmentStatus}</td>
            <td><button className="button button-quiet" onClick={() => selectStaff(item.id)}>{t('view')}</button>
              {access.staffEdit && <button className="button button-quiet"
                onClick={() => { setSelectedStaff(item.id); setStaffDraft({ ...item }); }}>{t('edit')}</button>}
              {access.staffArchive && <button className="button button-quiet" disabled={busy}
                onClick={() => window.confirm(t('hrConfirmArchive')) && void perform(
                  () => api.archiveHrStaff(item.id), t('hrStaffArchived'))}>{t('archive')}</button>}</td>
          </tr>)}</tbody></table></div>
        <div className="form-actions"><button className="button button-quiet"
          onClick={() => exportCsv('hr-staff', visibleStaff.map(({ id, name, jobTitle, departmentName, employmentStatus, hiredOn }) =>
            ({ id, name, jobTitle, department: departmentName, employmentStatus, hiredOn })))}>{t('exportCsv')}</button></div>
        {staffDraft && selectedStaff && access.staffEdit && <form className="form-grid" onSubmit={(event) => void saveStaff(event)}>
          <h3>{t('hrEditProfile')}</h3>
          {(['givenNameEn', 'fatherNameEn', 'grandfatherNameEn', 'givenNameAm',
            'fatherNameAm', 'grandfatherNameAm', 'jobTitle', 'qualification', 'hiredOn'] as const)
            .map((key) => <Field key={key} label={t(key)} value={String(staffDraft[key] ?? '')}
              type={key === 'hiredOn' ? 'date' : 'text'}
              onChange={(value) => setStaffDraft({ ...staffDraft, [key]: value })} />)}
          <label>{t('department')}<select value={staffDraft.departmentId ?? ''}
            onChange={(event) => setStaffDraft({ ...staffDraft, departmentId: event.target.value || null })}>
            <option value="">{t('none')}</option>
            {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>{t('status')}<select value={String(staffDraft.employmentStatus ?? 'active')}
            onChange={(event) => setStaffDraft({ ...staffDraft, employmentStatus: event.target.value })}>
            {['active', 'on_leave', 'terminated'].map((value) => <option key={value}>{value}</option>)}
          </select></label>
          <button className="button button-primary" disabled={busy}>{t('save')}</button>
        </form>}
        {selectedStaff && access.documentView && <div className="panel-subsection">
          <h3>{t('hrStaffDocuments')}</h3>
          {access.documentManage && <label>{t('uploadDocument')}<input type="file"
            accept="application/pdf,image/jpeg,image/png" onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void perform(async () => {
                await api.uploadHrStaffDocument(selectedStaff, file, 'other');
                setDocuments(await api.hrStaffDocuments(selectedStaff));
              }, t('hrDocumentUploaded'));
            }} /></label>}
          <ul>{documents.map((document) => <li key={document.id}>{document.originalName} · {document.category}
            <button className="button button-quiet" onClick={() => void api.downloadHrStaffDocument(
              selectedStaff, document.id).then((blob) => downloadBlob(blob, document.originalName))
              .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')))}>
              {t('download')}</button></li>)}</ul>
        </div>}
      </Panel>}
      {access.staffImport && <Panel title={t('hrStaffImport')}>
        <p>{t('hrImportColumns')}</p>
        <input aria-label={t('hrChooseCsv')} type="file" accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void file.text().then(setImportCsv)
              .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
          }} />
        <div className="form-actions">
          <button className="button button-quiet" disabled={!importCsv || busy}
            onClick={() => void perform(async () => setImportPreview(await api.previewHrStaffImport(importCsv)),
              t('hrImportPreviewReady'))}>{t('preview')}</button>
          <button className="button button-primary" disabled={!importCsv || !importPreview?.eligibleCount || busy}
            onClick={() => void perform(async () => {
              const result = await api.commitHrStaffImport(importCsv);
              setImportPreview({
                totalRows: result.totalRows, eligibleCount: result.createdCount,
                invalidCount: result.skippedCount, rows: result.rows
              });
            }, t('hrImportCommitted'))}>{t('commitImport')}</button>
        </div>
        {importPreview && <div role="status">{importPreview.totalRows} · {importPreview.eligibleCount} · {importPreview.invalidCount}
          <ul>{importPreview.rows.map((row) => <li key={row.rowNumber}>{row.rowNumber}: {row.eligible ? t('eligible') :
            row.errors.map((item) => item.message).join('; ')}</li>)}</ul></div>}
      </Panel>}
    </div>}

    {section === 'contracts' && <div className="page-stack">
      {access.contractManage && <Panel title={t('hrCreateContract')}>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void perform(() => api.createHrContract(String(form.get('staffId')), {
            contractType: String(form.get('contractType')), startsOn: String(form.get('startsOn')),
            endsOn: String(form.get('endsOn')) || null, renewalDueOn: String(form.get('renewalDueOn')) || null,
            notes: String(form.get('notes') ?? '')
          }), t('hrContractCreated'));
          event.currentTarget.reset();
        }}>
          <label>{t('staff')}<select required name="staffId">{staff.map((item) =>
            <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label>{t('hrContractType')}<select name="contractType">{['permanent', 'fixed_term', 'probation', 'temporary', 'consultant']
            .map((value) => <option key={value}>{value}</option>)}</select></label>
          <input required name="startsOn" aria-label={t('hrStartsOn')} type="date" />
          <input name="endsOn" aria-label={t('hrEndsOn')} type="date" />
          <input name="renewalDueOn" aria-label={t('hrRenewalDue')} type="date" />
          <textarea name="notes" aria-label={t('notes')} />
          <button className="button button-primary" disabled={busy}>{t('add')}</button>
        </form>
      </Panel>}
      <Panel title={t('hrContracts')}>
        <div className="table-scroll"><table><thead><tr><th>{t('staff')}</th><th>{t('hrContractType')}</th>
          <th>{t('hrStartsOn')}</th><th>{t('hrEndsOn')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead>
          <tbody>{visibleContracts.map((item) => <tr key={item.id}><td>{staff.find((row) => row.id === item.staffId)?.name ?? item.staffId}</td>
            <td>{item.contractType}</td><td>{item.startsOn}</td><td>{item.endsOn ?? '—'}</td><td>{item.status}</td>
            <td>{access.contractManage && item.status === 'active' && <form onSubmit={(event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get('newEndDate');
              if (value) void perform(() => api.renewHrContract(item.id, String(value)), t('hrContractRenewed'));
            }}><input name="newEndDate" type="date" required aria-label={t('hrNewEndDate')} />
              <button className="button button-quiet">{t('renew')}</button></form>}</td></tr>)}</tbody></table></div>
        <div className="form-actions"><button className="button button-quiet"
          onClick={() => exportCsv('hr-contracts', visibleContracts)}>{t('exportCsv')}</button></div>
      </Panel>
    </div>}

    {section === 'leave' && <div className="page-stack">
      {access.leaveConfigure && <Panel title={t('hrLeaveTypes')}>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void perform(() => api.createHrLeaveType({
            name: String(form.get('name')), kind: String(form.get('kind')) as HrLeaveType['kind'],
            annualEntitlementHalfDays: Number(form.get('entitlement')),
            carryOverLimitHalfDays: Number(form.get('carryOverLimit')), isActive: true
          }), t('hrLeaveTypeCreated'));
          event.currentTarget.reset();
        }}>
          <input name="name" required aria-label={t('name')} placeholder={t('name')} />
          <select name="kind" aria-label={t('kind')}>{['annual', 'sick', 'unpaid'].map((value) =>
            <option key={value}>{value}</option>)}</select>
          <input name="entitlement" type="number" min="0" required aria-label={t('hrAnnualEntitlementHalfDays')} placeholder={t('hrAnnualEntitlementHalfDays')} />
          <input name="carryOverLimit" type="number" min="0" required aria-label={t('hrCarryOverLimit')} placeholder={t('hrCarryOverLimit')} />
          <button className="button button-primary" disabled={busy}>{t('add')}</button>
        </form>
        <ul>{leaveTypes.map((item) => <li key={item.id}>{item.name} · {item.kind} · {item.annualEntitlementHalfDays / 2} {t('days')}</li>)}</ul>
      </Panel>}
      {access.balanceManage && <Panel title={t('hrSetLeaveBalance')}>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          const entitled = String(form.get('entitledHalfDays'));
          void perform(() => api.setHrLeaveBalance({
            staffId: String(form.get('staffId')), leaveTypeId: String(form.get('leaveTypeId')),
            year: Number(form.get('year')), entitledHalfDays: entitled ? Number(entitled) : undefined,
            carryOverHalfDays: Number(form.get('carryOverHalfDays'))
          }), t('hrBalanceSaved'));
        }}>
          <label>{t('staff')}<select name="staffId">{staff.map((item) =>
            <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label>{t('hrLeaveTypes')}<select name="leaveTypeId">{leaveTypes.map((item) =>
            <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <input name="year" type="number" min="2000" max="2200" required value={yearFilter}
            onChange={(event) => setYearFilter(event.target.value)} aria-label={t('year')} />
          <input name="entitledHalfDays" type="number" min="0" aria-label={t('hrEntitledHalfDays')} placeholder={t('hrEntitledHalfDays')} />
          <input name="carryOverHalfDays" type="number" min="0" required defaultValue="0"
            aria-label={t('hrCarryOverHalfDays')} placeholder={t('hrCarryOverHalfDays')} />
          <button className="button button-primary" disabled={busy}>{t('save')}</button>
        </form>
      </Panel>}
      {access.leaveView && <Panel title={t('hrLeaveBalances')}>
        <label>{t('year')}<input type="number" value={yearFilter}
          onChange={(event) => setYearFilter(event.target.value)} /></label>
        <div className="table-scroll"><table><thead><tr><th>{t('staff')}</th><th>{t('hrLeaveTypes')}</th>
          <th>{t('year')}</th><th>{t('hrEntitledHalfDays')}</th><th>{t('hrCarryOverHalfDays')}</th>
          <th>{t('hrUsedHalfDays')}</th><th>{t('hrRemainingHalfDays')}</th></tr></thead><tbody>
          {leaveBalances.filter((item) => {
            const name = staff.find((row) => row.id === item.staffId)?.name ?? item.staffId;
            return `${name} ${item.leaveType ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
          }).map((item) => <tr key={item.id}><td>{staff.find((row) => row.id === item.staffId)?.name ?? item.staffId}</td>
            <td>{item.leaveType}</td><td>{item.year}</td><td>{item.entitledHalfDays}</td><td>{item.carryOverHalfDays}</td>
            <td>{item.usedHalfDays}</td><td>{item.remainingHalfDays}</td></tr>)}</tbody></table></div>
        <div className="form-actions"><button className="button button-quiet" onClick={() =>
          exportCsv('hr-leave-balances', leaveBalances)}>{t('exportCsv')}</button></div>
      </Panel>}
    </div>}

    {section === 'recruitment' && <div className="page-stack">
      {access.recruitmentManage && <Panel title={t('hrVacancies')}>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void perform(() => api.createHrVacancy({
            title: String(form.get('title')), description: String(form.get('description')),
            departmentId: String(form.get('departmentId')) || null
          }), t('hrVacancyCreated'));
          event.currentTarget.reset();
        }}>
          <input name="title" required aria-label={t('title')} placeholder={t('title')} />
          <label>{t('department')}<select name="departmentId"><option value="">{t('none')}</option>
            {departments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <textarea name="description" aria-label={t('description')} placeholder={t('description')} />
          <button className="button button-primary" disabled={busy}>{t('add')}</button>
        </form>
      </Panel>}
      {access.recruitmentView && <Panel title={t('hrApplicants')}>
        {access.recruitmentManage && <form className="form-grid" onSubmit={(event) => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          const vacancyId = String(form.get('vacancyId'));
          void perform(() => api.createHrApplicant(vacancyId, {
            givenName: String(form.get('givenName')), fatherName: String(form.get('fatherName')),
            grandfatherName: String(form.get('grandfatherName')), email: String(form.get('email')),
            phone: String(form.get('phone'))
          }), t('hrApplicantCreated'));
          event.currentTarget.reset();
        }}>
          <label>{t('hrVacancies')}<select name="vacancyId">{vacancies.filter((item) => item.status === 'open')
            .map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
          {(['givenName', 'fatherName', 'grandfatherName', 'email', 'phone'] as const).map((field) =>
            <input key={field} name={field} required type={field === 'email' ? 'email' : 'text'}
              aria-label={t(field)} placeholder={t(field)} />)}
          <button className="button button-primary" disabled={busy}>{t('add')}</button>
        </form>}
        <div className="table-scroll"><table><thead><tr><th>{t('name')}</th><th>{t('email')}</th>
          <th>{t('hrVacancies')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead><tbody>
          {visibleApplicants.map((item) => <tr key={item.id}><td>{item.givenName} {item.fatherName} {item.grandfatherName}</td>
            <td>{item.email}</td><td>{vacancies.find((row) => row.id === item.vacancyId)?.title}</td><td>{item.status}</td>
            <td><button className="button button-quiet" onClick={() => {
              setSelectedApplicant(item.id);
              void api.hrInterviews(item.id).then((rows) => setInterviews((current) => ({ ...current, [item.id]: rows })))
                .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
              if (access.recruitmentView) void api.hrApplicantDocuments(item.id).then(setApplicantDocuments)
                .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
            }}>{t('view')}</button>
              {access.recruitmentManage && ['received', 'shortlisted'].includes(item.status) &&
                (['shortlisted', 'hired', 'rejected'] as const).map((decision) =>
                  <button className="button button-quiet" key={decision} disabled={busy}
                    onClick={() => void perform(() => api.decideHrApplicant(item.id, {
                      decision, reason: window.prompt(t('hrDecisionReason')) || t('hrDecisionReason')
                    }), t(`hrApplicant_${decision}`))}>{decision}</button>)}</td></tr>)}</tbody></table></div>
        {selectedApplicant && <div className="panel-subsection">
          <h3>{t('hrInterviews')}</h3><ul>{(interviews[selectedApplicant] ?? []).map((item) =>
            <li key={item.id}>{item.scheduledAt} · {item.status} · {item.notes}</li>)}</ul>
          <h3>{t('hrApplicantDocuments')}</h3>
          {access.recruitmentManage && <label>{t('uploadDocument')}<input type="file"
            accept="application/pdf,image/jpeg,image/png" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void perform(async () => {
                await api.uploadHrApplicantDocument(selectedApplicant, file, 'resume');
                setApplicantDocuments(await api.hrApplicantDocuments(selectedApplicant));
              }, t('hrDocumentUploaded'));
            }} /></label>}
          <ul>{applicantDocuments.map((document) => <li key={document.id}>{document.originalName}
            <button className="button button-quiet" onClick={() =>
              void api.downloadHrApplicantDocument(selectedApplicant, document.id)
                .then((blob) => downloadBlob(blob, document.originalName))
                .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')))}>
              {t('download')}</button></li>)}</ul>
          {access.recruitmentManage && <form className="form-grid" onSubmit={(event) => {
            event.preventDefault(); const form = new FormData(event.currentTarget);
            void perform(() => api.scheduleHrInterview(selectedApplicant, {
              scheduledAt: new Date(String(form.get('scheduledAt'))).toISOString(),
              notes: String(form.get('notes') ?? '')
            }), t('hrInterviewScheduled'));
            event.currentTarget.reset();
          }}><input name="scheduledAt" required type="datetime-local" aria-label={t('hrInterviewAt')} />
            <input name="notes" aria-label={t('notes')} placeholder={t('notes')} />
            <button className="button button-primary">{t('schedule')}</button></form>}
        </div>}
        <div className="form-actions"><button className="button button-quiet"
          onClick={() => exportCsv('hr-applicants', visibleApplicants)}>{t('exportCsv')}</button></div>
      </Panel>}
    </div>}

    {section === 'performance' && <div className="page-stack">
      {access.performanceManage && <Panel title={t('hrPerformanceCycles')}>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void perform(() => api.createHrPerformanceCycle({
            name: String(form.get('name')), startsOn: String(form.get('startsOn')),
            endsOn: String(form.get('endsOn'))
          }), t('hrCycleCreated'));
          event.currentTarget.reset();
        }}><input name="name" required aria-label={t('name')} placeholder={t('name')} />
          <input name="startsOn" required type="date" aria-label={t('hrStartsOn')} />
          <input name="endsOn" required type="date" aria-label={t('hrEndsOn')} />
          <button className="button button-primary">{t('add')}</button></form>
      </Panel>}
      {access.performanceView && <Panel title={t('hrPerformance')}>
        {access.performanceManage && <>
          <form className="form-grid" onSubmit={(event) => {
            event.preventDefault(); const form = new FormData(event.currentTarget);
            void perform(() => api.createHrPerformanceGoal({
              staffId: String(form.get('staffId')), cycleId: String(form.get('cycleId')),
              title: String(form.get('title')), details: String(form.get('details'))
            }), t('hrGoalCreated'));
            event.currentTarget.reset();
          }}><label>{t('staff')}<select name="staffId">{staff.map((item) =>
            <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>{t('hrPerformanceCycles')}<select name="cycleId">{cycles.map((item) =>
              <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <input name="title" required aria-label={t('title')} placeholder={t('title')} />
            <input name="details" aria-label={t('details')} placeholder={t('details')} />
            <button className="button button-primary">{t('hrAddGoal')}</button></form>
          <form className="form-grid" onSubmit={(event) => {
            event.preventDefault(); const form = new FormData(event.currentTarget);
            void perform(() => api.createHrPerformanceEvaluation({
              staffId: String(form.get('staffId')), cycleId: String(form.get('cycleId')),
              rating: Number(form.get('rating')), feedback: String(form.get('feedback'))
            }), t('hrEvaluationSaved'));
            event.currentTarget.reset();
          }}><label>{t('staff')}<select name="staffId">{staff.map((item) =>
            <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>{t('hrPerformanceCycles')}<select name="cycleId">{cycles.map((item) =>
              <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <input name="rating" required type="number" min="1" max="5" aria-label={t('rating')} />
            <textarea name="feedback" required aria-label={t('feedback')} />
            <button className="button button-primary">{t('hrSaveEvaluation')}</button></form>
        </>}
        <h3>{t('hrPerformanceCycles')}</h3><ul>{cycles.map((item) =>
          <li key={item.id}>{item.name} · {item.startsOn}–{item.endsOn} · {item.status}</li>)}</ul>
        <h3>{t('hrGoals')}</h3><ul>{goals.filter((item) =>
          `${item.title} ${item.details}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
          .map((item) => <li key={item.id}>{staff.find((row) => row.id === item.staffId)?.name}: {item.title} · {item.status}</li>)}</ul>
        <h3>{t('hrEvaluations')}</h3><ul>{evaluations.map((item) =>
          <li key={item.id}>{staff.find((row) => row.id === item.staffId)?.name} · {t('rating')}: {item.rating} · {item.feedback}</li>)}</ul>
        <button className="button button-quiet" onClick={() => exportCsv('hr-performance', [
          ...goals.map((item) => ({ type: 'goal', staffId: item.staffId, cycleId: item.cycleId, title: item.title, status: item.status })),
          ...evaluations.map((item) => ({ type: 'evaluation', staffId: item.staffId, cycleId: item.cycleId, rating: item.rating, feedback: item.feedback }))
        ])}>{t('exportCsv')}</button>
      </Panel>}
    </div>}

    {section === 'training' && <div className="page-stack">
      {access.trainingManage && <Panel title={t('hrTrainingCourses')}>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void perform(() => api.createHrTrainingCourse({
            title: String(form.get('title')), description: String(form.get('description')),
            startsOn: String(form.get('startsOn')), endsOn: String(form.get('endsOn'))
          }), t('hrTrainingCreated'));
          event.currentTarget.reset();
        }}><input name="title" required aria-label={t('title')} placeholder={t('title')} />
          <input name="description" aria-label={t('description')} placeholder={t('description')} />
          <input name="startsOn" required type="date" aria-label={t('hrStartsOn')} />
          <input name="endsOn" required type="date" aria-label={t('hrEndsOn')} />
          <button className="button button-primary">{t('add')}</button></form>
      </Panel>}
      {access.trainingView && <Panel title={t('hrTraining')}>
        <div className="table-scroll"><table><thead><tr><th>{t('title')}</th><th>{t('hrStartsOn')}</th>
          <th>{t('hrEndsOn')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead><tbody>
          {visibleCourses.map((item) => <tr key={item.id}><td>{item.title}</td><td>{item.startsOn}</td>
            <td>{item.endsOn}</td><td>{item.status}</td><td><button className="button button-quiet"
              onClick={() => {
                setSelectedCourse(item.id);
                void api.hrTrainingEnrollments(item.id).then(setEnrollments)
                  .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
              }}>{t('view')}</button></td></tr>)}</tbody></table></div>
        {selectedCourse && <div className="panel-subsection">
          <h3>{t('hrTrainingEnrollments')}</h3>
          {access.trainingManage && <form className="form-grid" onSubmit={(event) => {
            event.preventDefault(); const form = new FormData(event.currentTarget);
            void perform(async () => {
              await api.enrollHrTraining(selectedCourse, String(form.get('staffId')));
              setEnrollments(await api.hrTrainingEnrollments(selectedCourse));
            }, t('hrTrainingEnrolled'));
          }}><label>{t('staff')}<select name="staffId">{staff.map((member) =>
            <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
            <button className="button button-primary">{t('hrEnroll')}</button></form>}
          <ul>{enrollments.map((item: HrTrainingEnrollment) => <li key={item.id}>
            {staff.find((member) => member.id === item.staffId)?.name ?? item.staffId} · {item.status}
            {access.trainingManage && <select aria-label={t('status')} value={item.status}
              onChange={(event) => void perform(async () => {
                await api.updateHrTrainingAttendance(item.id, event.target.value as 'enrolled' | 'attended' | 'absent');
                setEnrollments(await api.hrTrainingEnrollments(selectedCourse));
              }, t('hrAttendanceUpdated'))}>
              {['enrolled', 'attended', 'absent'].map((value) => <option key={value}>{value}</option>)}</select>}
            {access.trainingManage && <input aria-label={t('uploadCertificate')} type="file"
              accept="application/pdf,image/jpeg,image/png" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void perform(async () => {
                  await api.uploadHrTrainingCertificate(item.id, file);
                  setEnrollments(await api.hrTrainingEnrollments(selectedCourse));
                }, t('hrCertificateUploaded'));
              }} />}
            {item.certificateName && <button className="button button-quiet" onClick={() =>
              void api.downloadHrTrainingCertificate(item.id)
                .then((blob) => downloadBlob(blob, item.certificateName ?? 'certificate'))
                .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')))}>
              {t('download')} {item.certificateName}</button>}
          </li>)}</ul>
        </div>}
        <div className="form-actions"><button className="button button-quiet"
          onClick={() => exportCsv('hr-training', visibleCourses)}>{t('exportCsv')}</button></div>
      </Panel>}
    </div>}
  </div>;
}
