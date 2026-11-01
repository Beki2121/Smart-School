import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, Department, LeaveRequest, Room, SchoolAccount, Section, StaffAttendance, StaffInvitationRole, StaffMember, StaffMessage, Subject, TeachingAssignment, TimetablePeriod, User } from '../../api';
import FormInput from '../../components/FormInput';
import InvitationLinkField from '../../components/InvitationLinkField';

type T = (key: string) => string;
const staffInvitationRolesByRole: Record<string, StaffInvitationRole[]> = {
  owner_director: [
    'principal', 'registrar', 'system_admin', 'academic_head', 'homeroom_teacher',
    'subject_teacher', 'hr_admin', 'accountant_cashier', 'counsellor'
  ],
  system_admin: ['homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor'],
  principal: ['academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor'],
  registrar: ['homeroom_teacher', 'subject_teacher', 'counsellor'],
  hr_admin: ['homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor']
};
function StaffInvitationForm({ t, user }: { t: T; user: User }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffId, setStaffId] = useState('');
  const [email, setEmail] = useState('');
  const [invitationRole, setInvitationRole] = useState<StaffInvitationRole>(
    staffInvitationRolesByRole[user.role]?.includes('subject_teacher')
      ? 'subject_teacher' : staffInvitationRolesByRole[user.role]?.[0] ?? 'subject_teacher'
  );
  const [invitationUrl, setInvitationUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const allowedRoles = staffInvitationRolesByRole[user.role] ?? [];
  const eligibleStaff = staff.filter((item) =>
    !item.userId && item.employmentStatus !== 'terminated');
  useEffect(() => {
    let active = true;
    api.staff().then((rows) => { if (active) setStaff(rows); })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : t('apiError'));
      })
      .finally(() => { if (active) setStaffLoading(false); });
    return () => { active = false; };
  }, [t]);
  useEffect(() => {
    if (allowedRoles.length && !allowedRoles.includes(invitationRole)) {
      setInvitationRole(allowedRoles[0]);
    }
  }, [allowedRoles, invitationRole]);
  const createInvitation = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setNotice(''); setInvitationUrl(''); setBusy(true);
    try {
      const invitation = await api.createAccountInvitation({
        targetType: 'staff', targetId: staffId, email, role: invitationRole
      });
      setInvitationUrl(invitation.invitationUrl);
      setNotice(t('inviteCreated'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  return <section className="panel settings-panel">
    <div className="panel-heading"><div><h2>{t('staffAccount')}</h2><p>{t('invitationLinkHint')}</p></div></div>
    <form onSubmit={(event) => void createInvitation(event)}>
      <div className="form-grid">
        <label>{t('selectStaffAccount')}<select required value={staffId}
          disabled={staffLoading || busy || !eligibleStaff.length}
          onChange={(event) => setStaffId(event.target.value)}>
          <option value="">{t('selectStaffAccount')}</option>
          {eligibleStaff.map((item) =>
            <option key={item.id} value={item.id}>{item.name} · {item.jobTitle}</option>)}
        </select></label>
        <label>{t('accountRole')}<select value={invitationRole}
          disabled={busy || !allowedRoles.length}
          onChange={(event) => setInvitationRole(event.target.value as StaffInvitationRole)}>
          {allowedRoles.map((role) =>
            <option key={role} value={role}>{t(`role_${role}`)}</option>)}
        </select></label>
        <FormInput label={t('invitationEmail')} type="email" value={email}
          onChange={setEmail} required />
      </div>
      {notice && <div className="notice notice-success" role="status">{notice}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="form-actions"><button className="button button-primary"
        disabled={busy || staffLoading || !staffId || !allowedRoles.length}>
        {busy ? t('loading') : t('createAccount')}
      </button></div>
    </form>
    {invitationUrl && <InvitationLinkField value={invitationUrl} t={t} />}
  </section>;
}

export function SchoolAccountsPage({ t, user }: { t: T; user: User }) {
  const [accounts, setAccounts] = useState<SchoolAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setError('');
      setAccounts(await api.accounts());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (account: SchoolAccount) => {
    if (account.isActive && !window.confirm(t('confirmDeactivateAccount'))) return;
    setBusyId(account.id);
    setError('');
    try {
      const updated = await api.setAccountActive(account.id, !account.isActive);
      setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusyId(''); }
  };
  return <section className="page-section">
    <header className="section-heading"><div><span className="eyebrow">{t('schoolSetup')}</span>
      <h1>{t('accounts')}</h1><p className="muted">{t('accountManagementHint')}</p></div>
      <button className="button button-quiet" onClick={() => void load()}>{t('refresh')}</button>
    </header>
    {error && <div className="form-error" role="alert">{error}</div>}
    <StaffInvitationForm t={t} user={user} />
    {loading ? <div className="loading-state">{t('loading')}</div> :
      <div className="account-list">{accounts.map((account) => <article className="account-row" key={account.id}>
        <div><strong>{account.name}</strong><span>{account.email || t('noEmail')}</span></div>
        <div><span className="account-role">{account.role.replaceAll('_', ' ')}</span>
          <span className={`status-pill ${account.isActive ? '' : 'status-inactive'}`}>
            {account.isActive ? t('active') : t('inactive')}
          </span></div>
        <button className={account.isActive ? 'button button-quiet' : 'button button-primary'}
          disabled={busyId === account.id || account.id === user.id}
          onClick={() => void toggle(account)}>
          {busyId === account.id ? t('loading') : account.isActive ? t('deactivateAccount') : t('activateAccount')}
        </button>
      </article>)}
      {!accounts.length && <p className="muted">{t('noAccounts')}</p>}</div>}
  </section>;
}

export function StaffPage({ t, canManage, canInviteStaff, canManageAssignments, user }: {
  t: T; canManage: boolean; canInviteStaff: boolean; canManageAssignments: boolean; user: User
}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [assignmentSubjects, setAssignmentSubjects] = useState<Subject[]>([]);
  const [periods, setPeriods] = useState<TimetablePeriod[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [attendance, setAttendance] = useState<StaffAttendance[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [messages, setMessages] = useState<StaffMessage[]>([]);
  const [departmentName, setDepartmentName] = useState('');
  const [departmentDescription, setDepartmentDescription] = useState('');
  const [staffForm, setStaffForm] = useState({
    departmentId: '', givenNameEn: '', fatherNameEn: '', grandfatherNameEn: '',
    givenNameAm: '', fatherNameAm: '', grandfatherNameAm: '', jobTitle: '',
    qualification: '', employmentStatus: 'active', hiredOn: ''
  });
  const [assignmentForm, setAssignmentForm] = useState({
    staffId: '', sectionId: '', subjectId: '', dayOfWeek: '', periodNumber: '', roomId: ''
  });
  const [homeroomForm, setHomeroomForm] = useState({ sectionId: '', staffId: '' });
  const [attendanceForm, setAttendanceForm] = useState({ staffId: '', date: new Date().toISOString().slice(0, 10), status: 'present', clockIn: '', clockOut: '' });
  const [leaveForm, setLeaveForm] = useState({ staffId: '', startDate: '', endDate: '', reason: '' });
  const [messageForm, setMessageForm] = useState({ departmentId: '', type: 'announcement' as 'handover' | 'announcement', title: '', body: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => Promise.all([
    api.departments(), api.staff(), api.sections(), api.subjects(), api.timetablePeriods(), api.rooms(),
    api.teachingAssignments(), api.staffAttendance(), api.leaveRequests(), api.staffMessages()
  ]).then(([departmentRows, staffRows, sectionRows, subjectRows, periodRows, roomRows, assignmentRows, attendanceRows, leaveRows, messageRows]) => {
    setDepartments(departmentRows); setStaff(staffRows); setSections(sectionRows); setSubjects(subjectRows);
    setPeriods(periodRows); setRooms(roomRows);
    setAssignments(assignmentRows); setAttendance(attendanceRows); setLeaveRequests(leaveRows); setMessages(messageRows);
    setStaffForm((current) => ({ ...current, departmentId: current.departmentId || departmentRows[0]?.id || '' }));
    setAssignmentForm((current) => ({
      ...current, staffId: current.staffId || staffRows[0]?.id || '',
      sectionId: current.sectionId || sectionRows[0]?.id || '',
      subjectId: current.subjectId || subjectRows[0]?.id || ''
    }));
    setHomeroomForm((current) => ({
      ...current, staffId: current.staffId || staffRows[0]?.id || '',
      sectionId: current.sectionId || sectionRows[0]?.id || ''
    }));
    setAttendanceForm((current) => ({ ...current, staffId: current.staffId || staffRows[0]?.id || '' }));
    setLeaveForm((current) => ({ ...current, staffId: current.staffId || staffRows[0]?.id || '' }));
    setMessageForm((current) => ({ ...current, departmentId: current.departmentId || departmentRows[0]?.id || '' }));
  }), []);
  useEffect(() => { load().catch((reason) => setError(reason.message)); }, [load]);
  useEffect(() => {
    const section = sections.find((item) => item.id === assignmentForm.sectionId);
    const request: Promise<Subject[]> = section?.gradeLevelId
      ? api.gradeSubjects(section.gradeLevelId, section.stream).then((rows) => rows.map((item) => ({
        id: item.subjectId, campusId: item.campusId, code: item.code,
        nameEn: item.nameEn, nameAm: item.nameAm, category: item.category
      })))
      : Promise.resolve(subjects);
    request.then((rows) => {
      setAssignmentSubjects(rows);
      setAssignmentForm((current) => ({
        ...current,
        subjectId: rows.some((item) => item.id === current.subjectId)
          ? current.subjectId : rows[0]?.id ?? ''
      }));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load grade subjects.'));
  }, [sections, subjects, assignmentForm.sectionId]);
  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setError(''); setNotice(''); setBusy(true);
    try { await action(); await load(); setNotice(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent, action: () => Promise<unknown>, success: string) => {
    event.preventDefault();
    return runAction(action, success);
  };
  const downloadCsv = async () => {
    setError('');
    try {
      const blob = await api.downloadStaffAttendanceCsv();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'staff-attendance.csv'; link.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const statusLabel = (status: string) => ({
    active: t('activeEmployment'), on_leave: t('onLeave'), terminated: t('terminated'),
    pending: t('pending'), approved: t('approved'), rejected: t('rejected')
  }[status] ?? status);
  const formatStaff = (item: StaffMember) => `${item.name} · ${item.jobTitle}`;
  const managePerson = canManage && staff.length > 0;
  const selfStaff = staff.find((item) => item.userId === user.id);
  const assignmentShift = sections.find((item) => item.id === assignmentForm.sectionId)?.shift ?? 'morning';
  const assignmentPeriods = periods.filter((item) => item.shift === assignmentShift);
  return <>
    <div className="page-heading compact-heading"><div><div className="eyebrow">{t('staff')}</div><h1>{t('staffManagement')}</h1><p>{t('staffProfile')}</p></div></div>
    {notice && <div className="notice notice-success">{notice}</div>}{error && <div className="notice notice-error">{error}</div>}
    {canManage && <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('addDepartment')}</h2></div></div>
      <form className="form-grid" onSubmit={(event) => void submit(event, () =>
        api.createDepartment({ name: departmentName, description: departmentDescription }), t('setupSaved'))}>
        <FormInput label={t('departmentName')} value={departmentName} onChange={setDepartmentName} required />
        <FormInput label={t('qualification')} value={departmentDescription} onChange={setDepartmentDescription} />
        <div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addDepartment')}</button></div>
      </form>
      <div className="setup-list">{departments.map((department) => <div className="setting-row" key={department.id}><strong>{department.name}</strong><small>{department.description}</small></div>)}</div>
    </section>}
    {canManage && <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('addStaff')}</h2><p>{t('staffProfile')}</p></div></div>
      <form onSubmit={(event) => void submit(event, () => api.createStaff({
        ...staffForm, departmentId: staffForm.departmentId || null, userId: null,
        hiredOn: staffForm.hiredOn || null
      }), t('staffSaved'))}>
        <div className="form-grid">
          <FormInput label={t('givenNameStaffEn')} value={staffForm.givenNameEn} onChange={(givenNameEn) => setStaffForm((current) => ({ ...current, givenNameEn }))} required />
          <FormInput label={t('fatherNameStaffEn')} value={staffForm.fatherNameEn} onChange={(fatherNameEn) => setStaffForm((current) => ({ ...current, fatherNameEn }))} required />
          <FormInput label={t('grandfatherNameStaffEn')} value={staffForm.grandfatherNameEn} onChange={(grandfatherNameEn) => setStaffForm((current) => ({ ...current, grandfatherNameEn }))} required />
          <FormInput label={t('givenNameStaffAm')} value={staffForm.givenNameAm} onChange={(givenNameAm) => setStaffForm((current) => ({ ...current, givenNameAm }))} required />
          <FormInput label={t('fatherNameStaffAm')} value={staffForm.fatherNameAm} onChange={(fatherNameAm) => setStaffForm((current) => ({ ...current, fatherNameAm }))} required />
          <FormInput label={t('grandfatherNameStaffAm')} value={staffForm.grandfatherNameAm} onChange={(grandfatherNameAm) => setStaffForm((current) => ({ ...current, grandfatherNameAm }))} required />
          <FormInput label={t('jobTitle')} value={staffForm.jobTitle} onChange={(jobTitle) => setStaffForm((current) => ({ ...current, jobTitle }))} required />
          <FormInput label={t('qualification')} value={staffForm.qualification} onChange={(qualification) => setStaffForm((current) => ({ ...current, qualification }))} />
          <label>{t('department')}<select value={staffForm.departmentId} onChange={(event) => setStaffForm((current) => ({ ...current, departmentId: event.target.value }))}><option value="">{t('noDepartment')}</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label>{t('employmentStatus')}<select value={staffForm.employmentStatus} onChange={(event) => setStaffForm((current) => ({ ...current, employmentStatus: event.target.value }))}><option value="active">{t('activeEmployment')}</option><option value="on_leave">{t('onLeave')}</option><option value="terminated">{t('terminated')}</option></select></label>
          <FormInput label={t('hiredOn')} type="date" value={staffForm.hiredOn} onChange={(hiredOn) => setStaffForm((current) => ({ ...current, hiredOn }))} />
        </div>
        <div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addStaff')}</button></div>
      </form>
    </section>}
    {canInviteStaff && <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('staffAccount')}</h2><p>{t('invitationLinkHint')}</p></div></div>
      <StaffInvitationForm t={t} user={user} />
    </section>}
    <section className="panel history-panel">
      <div className="panel-heading"><div><h2>{t('staff')}</h2><p>{staff.length} {t('records')}</p></div></div>
      {staff.length ? staff.map((item) => <div className="history-row" key={item.id}><span className="history-icon">♙</span><span><strong>{formatStaff(item)}</strong><small>{item.departmentName || t('noDepartment')} · {item.qualification || '—'}</small></span><span className="status-pill">{statusLabel(item.employmentStatus)} · {item.teachingAssignmentCount} {t('workload')}</span></div>) : <div className="empty-state">{t('noStaff')}</div>}
    </section>
    {canManageAssignments && <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('teacherAssignments')}</h2></div></div>
      <form onSubmit={(event) => void submit(event, () => api.createTeachingAssignment({
        ...assignmentForm, dayOfWeek: assignmentForm.dayOfWeek ? Number(assignmentForm.dayOfWeek) : null,
        periodNumber: assignmentForm.periodNumber ? Number(assignmentForm.periodNumber) : null,
        roomId: assignmentForm.roomId || null
      }), t('assignmentSaved'))}>
        <div className="form-grid">
          <label>{t('teacher')}<select required value={assignmentForm.staffId} onChange={(event) => setAssignmentForm((current) => ({ ...current, staffId: event.target.value }))}>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>{t('sections')}<select required value={assignmentForm.sectionId} onChange={(event) => setAssignmentForm((current) => ({ ...current, sectionId: event.target.value, periodNumber: '' }))}>{sections.map((item) => <option key={item.id} value={item.id}>{item.gradeName} · {item.name}</option>)}</select></label>
          <label>{t('subject')}<select required value={assignmentForm.subjectId} onChange={(event) => setAssignmentForm((current) => ({ ...current, subjectId: event.target.value }))}>{assignmentSubjects.map((item) => <option key={item.id} value={item.id}>{item.nameEn}</option>)}</select></label>
          <label>{t('timetableDay')}<select value={assignmentForm.dayOfWeek} onChange={(event) => setAssignmentForm((current) => ({ ...current, dayOfWeek: event.target.value, periodNumber: '' }))}><option value="">{t('unscheduled')}</option>{[1, 2, 3, 4, 5, 6, 7].map((day) => <option key={day} value={day}>{t(['', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][day])}</option>)}</select></label>
          <label>{t('periodNumber')}<select required={Boolean(assignmentForm.dayOfWeek)} value={assignmentForm.periodNumber} onChange={(event) => setAssignmentForm((current) => ({ ...current, periodNumber: event.target.value }))}><option value="">{assignmentForm.dayOfWeek ? t('choosePeriod') : t('unscheduled')}</option>{assignmentPeriods.map((period) => <option key={period.id} value={period.periodNumber}>{period.periodNumber} · {period.startsAt}–{period.endsAt}</option>)}</select></label>
          <label>{t('room')}<select value={assignmentForm.roomId} onChange={(event) => setAssignmentForm((current) => ({ ...current, roomId: event.target.value }))}><option value="">{t('noRoom')}</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !staff.length || !sections.length || !subjects.length}>{t('addAssignment')}</button></div>
      </form>
      <div className="setup-list">{assignments.length ? assignments.map((item) => <div className="setting-row" key={item.id}><span><strong>{item.staffName}</strong><small>{item.sectionName} · {item.subjectName}</small></span><span className="setting-value">{item.dayOfWeek ? `${item.dayOfWeek} · ${t('periodNumber')} ${item.periodNumber}` : ''}</span></div>) : <p className="muted">{t('noAssignments')}</p>}</div>
      <form className="setup-form" onSubmit={(event) => void submit(event, () =>
        api.assignHomeroom(homeroomForm.sectionId, homeroomForm.staffId), t('assignmentSaved'))}>
        <h3>{t('homeroom')}</h3><div className="form-grid">
          <label>{t('sections')}<select required value={homeroomForm.sectionId} onChange={(event) => setHomeroomForm((current) => ({ ...current, sectionId: event.target.value }))}>{sections.map((item) => <option key={item.id} value={item.id}>{item.gradeName} · {item.name}</option>)}</select></label>
          <label>{t('teacher')}<select required value={homeroomForm.staffId} onChange={(event) => setHomeroomForm((current) => ({ ...current, staffId: event.target.value }))}>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !staff.length || !sections.length}>{t('assignHomeroom')}</button></div>
      </form>
    </section>}
    <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('attendanceStaff')}</h2></div>{canManage && <button className="button button-quiet" onClick={() => void downloadCsv()}>{t('exportAttendance')}</button>}</div>
      <form onSubmit={(event) => void submit(event, () => api.recordStaffAttendance({
        staffId: managePerson ? attendanceForm.staffId : selfStaff?.id,
        date: attendanceForm.date, status: attendanceForm.status,
        clockIn: attendanceForm.clockIn || undefined, clockOut: attendanceForm.clockOut || undefined
      }), t('attendanceSavedStaff'))}>
        <div className="form-grid">
          {managePerson && <label>{t('teacher')}<select required value={attendanceForm.staffId} onChange={(event) => setAttendanceForm((current) => ({ ...current, staffId: event.target.value }))}>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <FormInput label={t('date')} type="date" value={attendanceForm.date} onChange={(date) => setAttendanceForm((current) => ({ ...current, date }))} required />
          <label>{t('employmentStatus')}<select value={attendanceForm.status} onChange={(event) => setAttendanceForm((current) => ({ ...current, status: event.target.value }))}><option value="present">{t('present')}</option><option value="absent">{t('absent')}</option><option value="late">{t('late')}</option><option value="excused">{t('excused')}</option></select></label>
          <FormInput label={t('clockIn')} value={attendanceForm.clockIn} onChange={(clockIn) => setAttendanceForm((current) => ({ ...current, clockIn }))} />
          <FormInput label={t('clockOut')} value={attendanceForm.clockOut} onChange={(clockOut) => setAttendanceForm((current) => ({ ...current, clockOut }))} />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || (canManage && !staff.length)}>{t('recordStaffAttendance')}</button></div>
      </form>
      {attendance.length ? attendance.slice(0, 12).map((record) => <div className="history-row" key={record.id}><span className="history-icon">✓</span><span><strong>{record.name ?? staff.find((item) => item.id === record.staffId)?.name}</strong><small>{record.date} · {record.department}</small></span><span className="status-pill">{record.status} {record.clockIn ? `· ${record.clockIn}` : ''}</span></div>) : <div className="empty-state">{t('noStaffAttendance')}</div>}
    </section>
    <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('leaveRequests')}</h2></div></div>
      <form onSubmit={(event) => void submit(event, () => api.createLeaveRequest({
        ...(managePerson ? { staffId: leaveForm.staffId } : {}),
        startDate: leaveForm.startDate, endDate: leaveForm.endDate, reason: leaveForm.reason
      }), t('leaveSaved'))}>
        <div className="form-grid">
          {managePerson && <label>{t('teacher')}<select required value={leaveForm.staffId} onChange={(event) => setLeaveForm((current) => ({ ...current, staffId: event.target.value }))}>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <FormInput label={t('startDate')} type="date" value={leaveForm.startDate} onChange={(startDate) => setLeaveForm((current) => ({ ...current, startDate }))} required />
          <FormInput label={t('endDate')} type="date" value={leaveForm.endDate} onChange={(endDate) => setLeaveForm((current) => ({ ...current, endDate }))} required />
          <FormInput label={t('leaveReason')} value={leaveForm.reason} onChange={(reason) => setLeaveForm((current) => ({ ...current, reason }))} required />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || (canManage && !staff.length)}>{t('requestLeave')}</button></div>
      </form>
      {leaveRequests.length ? leaveRequests.map((item) => <div className="history-row" key={item.id}><span className="history-icon">◷</span><span><strong>{item.staffName} · {item.startDate} – {item.endDate}</strong><small>{item.reason}{item.reviewNote ? ` · ${item.reviewNote}` : ''}</small></span><span className="status-pill">{statusLabel(item.status)}</span>{canManage && item.status === 'pending' && <div className="form-actions"><button className="button button-quiet" disabled={busy} onClick={() => void runAction(() => api.reviewLeaveRequest(item.id, 'approved'), t('setupSaved'))}>{t('approve')}</button><button className="button button-quiet" disabled={busy} onClick={() => void runAction(() => api.reviewLeaveRequest(item.id, 'rejected'), t('setupSaved'))}>{t('reject')}</button></div>}</div>) : <div className="empty-state">{t('noLeave')}</div>}
    </section>
    <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('internalMessages')}</h2></div></div>
      {canManage && <form onSubmit={(event) => void submit(event, () => api.createStaffMessage({
        departmentId: messageForm.departmentId || null, type: messageForm.type,
        title: messageForm.title, body: messageForm.body
      }), t('messageSaved'))}>
        <div className="form-grid">
          <label>{t('announcement')}<select value={messageForm.type} onChange={(event) => setMessageForm((current) => ({ ...current, type: event.target.value as 'handover' | 'announcement' }))}><option value="announcement">{t('announcement')}</option><option value="handover">{t('handover')}</option></select></label>
          <label>{t('department')}<select value={messageForm.departmentId} onChange={(event) => setMessageForm((current) => ({ ...current, departmentId: event.target.value }))}><option value="">{t('noDepartment')}</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <FormInput label={t('messageTitle')} value={messageForm.title} onChange={(title) => setMessageForm((current) => ({ ...current, title }))} required />
        </div>
        <label>{t('messageBody')}<textarea rows={3} value={messageForm.body} onChange={(event) => setMessageForm((current) => ({ ...current, body: event.target.value }))} required /></label>
        <div className="form-actions"><button className="button button-primary" disabled={busy}>{t('publish')}</button></div>
      </form>}
      {messages.length ? messages.map((item) => <div className="history-row" key={item.id}><span className="history-icon">✉</span><span><strong>{item.title} · {t(item.type)}</strong><small>{item.body}</small></span></div>) : <div className="empty-state">{t('noMessages')}</div>}
    </section>
  </>;
}
