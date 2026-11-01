import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, CurriculumUnit, LeaveRequest, LessonPlan, Room, Section, StaffMember, TeachingAssignment, TimetablePeriod } from '../../api';
import FormInput from '../../components/FormInput';
import { dateAfter, localDateInput } from '../../utils/dates';

type T = (key: string) => string;
export default function TimetablePage({ t, canManage, canManageLessons }: { t: T; canManage: boolean; canManageLessons: boolean }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [periods, setPeriods] = useState<TimetablePeriod[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [weekAssignments, setWeekAssignments] = useState<TeachingAssignment[]>([]);
  const [lessonPlans, setLessonPlans] = useState<LessonPlan[]>([]);
  const [curriculumUnits, setCurriculumUnits] = useState<CurriculumUnit[]>([]);
  const [sectionId, setSectionId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  });
  const [periodForm, setPeriodForm] = useState({
    shift: 'morning' as TimetablePeriod['shift'], periodNumber: '1', startsAt: '08:00', endsAt: '08:40'
  });
  const [roomForm, setRoomForm] = useState({ name: '', capacity: '' });
  const [substitutionForm, setSubstitutionForm] = useState({
    assignmentId: '', substituteStaffId: '', leaveRequestId: '', reason: ''
  });
  const [lessonForm, setLessonForm] = useState({
    teachingAssignmentId: '', curriculumUnitId: '', plannedOn: localDateInput(),
    titleEn: '', titleAm: '', objectivesEn: '', objectivesAm: '',
    activitiesEn: '', activitiesAm: '', resources: ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadSetup = useCallback(async () => {
    const [sectionRows, staffRows, periodRows, roomRows, leaveRows, unitRows, planRows] = await Promise.all([
      api.sections(), api.staff(), api.timetablePeriods(), api.rooms(), api.leaveRequests(),
      canManageLessons ? api.curriculumUnits() : Promise.resolve([]),
      canManageLessons ? api.lessonPlans({ from: date, to: dateAfter(date, 6) }) : Promise.resolve([])
    ]);
    setSections(sectionRows);
    setStaff(staffRows);
    setPeriods(periodRows);
    setRooms(roomRows);
    setLeaveRequests(leaveRows);
    setCurriculumUnits(unitRows);
    setLessonPlans(planRows);
  }, [canManageLessons, date]);
  const loadSchedule = useCallback(async () => {
    const [weekly, selectedDate] = await Promise.all([
      api.timetable(), api.timetable({ date })
    ]);
    const weekday = (new Date(`${date}T00:00:00`).getDay() + 6) % 7 + 1;
    setWeekAssignments(weekly);
    setAssignments([
      ...weekly.filter((item) => item.dayOfWeek !== weekday),
      ...selectedDate
    ]);
  }, [date]);
  useEffect(() => {
    Promise.all([loadSetup(), loadSchedule()]).catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [loadSchedule, loadSetup, t]);

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setError(''); setNotice(''); setBusy(true);
    try {
      await action();
      await Promise.all([loadSetup(), loadSchedule()]);
      setNotice(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };
  const submit = (event: FormEvent, action: () => Promise<unknown>, success: string) => {
    event.preventDefault();
    return runAction(action, success);
  };
  const lessonAssignment = weekAssignments.find((item) => item.id === lessonForm.teachingAssignmentId);
  const lessonSection = sections.find((item) => item.id === lessonAssignment?.sectionId);
  const availableLessonUnits = curriculumUnits.filter((unit) =>
    unit.gradeLevelId === lessonSection?.gradeLevelId && unit.subjectId === lessonAssignment?.subjectId);
  const selectedAssignment = weekAssignments.find((item) => item.id === substitutionForm.assignmentId);
  const eligibleLeaves = leaveRequests.filter((leave) =>
    leave.status === 'approved' && leave.staffId === selectedAssignment?.staffId &&
    leave.startDate <= date && leave.endDate >= date);
  const visibleAssignments = assignments
    .filter((item) => !sectionId || item.sectionId === sectionId)
    .filter((item) => !staffId || (item.effectiveStaffId ?? item.staffId) === staffId);
  const periodsInView = periods
    .filter((period) => {
      if (sectionId) return period.shift === (sections.find((section) => section.id === sectionId)?.shift ?? 'morning');
      return true;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.periodNumber - b.periodNumber);
  const days = [
    { number: 1, label: t('monday') }, { number: 2, label: t('tuesday') },
    { number: 3, label: t('wednesday') }, { number: 4, label: t('thursday') },
    { number: 5, label: t('friday') }, { number: 6, label: t('saturday') },
    { number: 7, label: t('sunday') }
  ];
  return <>
    <div className="page-heading compact-heading timetable-heading">
      <div><div className="eyebrow">{t('staff')}</div><h1>{t('timetable')}</h1><p>{t('timetableHint')}</p></div>
      <button className="button button-quiet print-button" onClick={() => window.print()}>{t('printTimetable')}</button>
    </div>
    {notice && <div className="notice notice-success">{notice}</div>}
    {error && <div className="notice notice-error">{error}</div>}
    {canManage && <section className="panel settings-panel timetable-setup">
      <div className="panel-heading"><div><h2>{t('timetableSetup')}</h2><p>{t('timetableSetupHint')}</p></div></div>
      <div className="timetable-setup-grid">
        <form className="setup-form" onSubmit={(event) => void submit(event, () => api.createTimetablePeriod({
          ...periodForm, periodNumber: Number(periodForm.periodNumber)
        }), t('periodSaved'))}>
          <h3>{t('addPeriod')}</h3><div className="form-grid">
            <label>{t('shift')}<select value={periodForm.shift} onChange={(event) => setPeriodForm((current) => ({ ...current, shift: event.target.value as TimetablePeriod['shift'] }))}>
              <option value="morning">{t('morning')}</option><option value="afternoon">{t('afternoon')}</option><option value="evening">{t('evening')}</option>
            </select></label>
            <FormInput label={t('periodNumber')} type="number" value={periodForm.periodNumber} onChange={(periodNumber) => setPeriodForm((current) => ({ ...current, periodNumber }))} required />
            <FormInput label={t('startsAt')} type="time" value={periodForm.startsAt} onChange={(startsAt) => setPeriodForm((current) => ({ ...current, startsAt }))} required />
            <FormInput label={t('endsAt')} type="time" value={periodForm.endsAt} onChange={(endsAt) => setPeriodForm((current) => ({ ...current, endsAt }))} required />
          </div><div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addPeriod')}</button></div>
          <div className="setup-list">{periods.map((period) => <div className="setting-row" key={period.id}><span><strong>{t(period.shift)} · {t('periodNumber')} {period.periodNumber}</strong><small>{period.startsAt}–{period.endsAt}</small></span></div>)}</div>
        </form>
        <form className="setup-form" onSubmit={(event) => void submit(event, () => api.createRoom({
          name: roomForm.name, capacity: roomForm.capacity ? Number(roomForm.capacity) : null
        }), t('roomSaved'))}>
          <h3>{t('addRoom')}</h3><div className="form-grid">
            <FormInput label={t('roomName')} value={roomForm.name} onChange={(name) => setRoomForm((current) => ({ ...current, name }))} required />
            <FormInput label={t('capacity')} type="number" value={roomForm.capacity} onChange={(capacity) => setRoomForm((current) => ({ ...current, capacity }))} />
          </div><div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addRoom')}</button></div>
          <div className="setup-list">{rooms.map((room) => <div className="setting-row" key={room.id}><span><strong>{room.name}</strong><small>{room.capacity ? `${t('capacity')}: ${room.capacity}` : ''}</small></span></div>)}</div>
        </form>
      </div>
    </section>}
    <section className="panel timetable-panel">
      <div className="panel-heading"><div><h2>{t('weeklyTimetable')}</h2><p>{t('substituteDateHint')}</p></div>
        <div className="timetable-filters">
          <label>{t('sections')}<select value={sectionId} onChange={(event) => setSectionId(event.target.value)}><option value="">{t('allSections')}</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.gradeName ? `${section.gradeName} · ` : ''}{section.name}</option>)}</select></label>
          <label>{t('teacher')}<select value={staffId} onChange={(event) => setStaffId(event.target.value)}><option value="">{t('allTeachers')}</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label className="date-picker">{t('date')}<input type="date" value={date} onChange={(event) => {
            setDate(event.target.value);
            setSubstitutionForm((current) => ({ ...current, assignmentId: '', leaveRequestId: '' }));
          }} /></label>
        </div>
      </div>
      {periodsInView.length ? <div className="timetable-scroll"><table className="timetable-grid">
        <thead><tr><th>{t('period')}</th>{days.map((day) => <th key={day.number}>{day.label}</th>)}</tr></thead>
        <tbody>{periodsInView.map((period) => <tr key={period.id}>
          <th><strong>{t(period.shift)} · {t('periodNumber')} {period.periodNumber}</strong><small>{period.startsAt}–{period.endsAt}</small></th>
          {days.map((day) => {
            const entries = visibleAssignments.filter((item) =>
              item.dayOfWeek === day.number && item.periodNumber === period.periodNumber && item.shift === period.shift);
            return <td key={day.number}>{entries.map((item) => <article className={`timetable-entry ${item.isSubstitute ? 'is-substitute' : ''}`} key={item.id}>
              <strong>{item.subjectName}</strong><span>{item.sectionName}</span>
              <small>{item.effectiveStaffName ?? item.staffName}{item.roomName ? ` · ${item.roomName}` : ''}</small>
              {item.isSubstitute && <em>{t('substitute')}</em>}
            </article>)}</td>;
          })}
        </tr>)}</tbody>
      </table></div> : <div className="empty-state">{t('configurePeriods')}</div>}
      {!visibleAssignments.length && periodsInView.length > 0 && <div className="empty-state">{t('noAssignments')}</div>}
    </section>
    {canManageLessons && <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('lessonPlanning')}</h2><p>{t('lessonPlanningNotice')}</p></div></div>
      <form className="setup-form" onSubmit={(event) => void submit(event, async () => {
        if (!lessonForm.teachingAssignmentId) return;
        await api.createLessonPlan({
          teachingAssignmentId: lessonForm.teachingAssignmentId,
          curriculumUnitId: lessonForm.curriculumUnitId || null,
          plannedOn: lessonForm.plannedOn,
          titleEn: lessonForm.titleEn, titleAm: lessonForm.titleAm,
          objectivesEn: lessonForm.objectivesEn, objectivesAm: lessonForm.objectivesAm,
          activitiesEn: lessonForm.activitiesEn, activitiesAm: lessonForm.activitiesAm,
          resources: lessonForm.resources
        });
        setLessonForm((current) => ({ ...current, titleEn: '', titleAm: '', objectivesEn: '', objectivesAm: '', activitiesEn: '', activitiesAm: '', resources: '' }));
      }, t('lessonPlanSaved'))}>
        <div className="form-grid">
          <label>{t('teachingAssignment')}<select required value={lessonForm.teachingAssignmentId} onChange={(event) => setLessonForm((value) => ({ ...value, teachingAssignmentId: event.target.value, curriculumUnitId: '' }))}>
            <option value="">{t('chooseAssignment')}</option>{weekAssignments.map((item) => <option key={item.id} value={item.id}>{item.sectionName} · {item.subjectName} · {item.staffName}</option>)}
          </select></label>
          <label>{t('curriculumUnit')}<select value={lessonForm.curriculumUnitId} onChange={(event) => setLessonForm((value) => ({ ...value, curriculumUnitId: event.target.value }))}>
            <option value="">{t('noCurriculumUnit')}</option>{availableLessonUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.unitNumber}. {unit.titleEn}</option>)}
          </select></label>
          <FormInput label={t('plannedDate')} type="date" value={lessonForm.plannedOn} onChange={(plannedOn) => setLessonForm((value) => ({ ...value, plannedOn }))} required />
          <FormInput label={t('titleEnglish')} value={lessonForm.titleEn} onChange={(titleEn) => setLessonForm((value) => ({ ...value, titleEn }))} required />
          <FormInput label={t('titleAmharic')} value={lessonForm.titleAm} onChange={(titleAm) => setLessonForm((value) => ({ ...value, titleAm }))} required />
          <FormInput label={t('objectivesEnglish')} value={lessonForm.objectivesEn} onChange={(objectivesEn) => setLessonForm((value) => ({ ...value, objectivesEn }))} />
          <FormInput label={t('objectivesAmharic')} value={lessonForm.objectivesAm} onChange={(objectivesAm) => setLessonForm((value) => ({ ...value, objectivesAm }))} />
          <FormInput label={t('activitiesEnglish')} value={lessonForm.activitiesEn} onChange={(activitiesEn) => setLessonForm((value) => ({ ...value, activitiesEn }))} />
          <FormInput label={t('activitiesAmharic')} value={lessonForm.activitiesAm} onChange={(activitiesAm) => setLessonForm((value) => ({ ...value, activitiesAm }))} />
          <FormInput label={t('learningResources')} value={lessonForm.resources} onChange={(resources) => setLessonForm((value) => ({ ...value, resources }))} />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !lessonForm.teachingAssignmentId}>{t('saveLessonPlan')}</button></div>
      </form>
      <div className="setup-list">{lessonPlans.length ? lessonPlans.map((plan) => <div className="setting-row" key={plan.id}>
        <span><strong>{plan.plannedOn} · {plan.titleEn} · {plan.titleAm}</strong><small>{plan.sectionName} · {plan.subjectName} · {plan.teacherName} · {t(plan.status)}</small></span>
        {plan.status === 'planned' && <button type="button" className="button button-quiet" disabled={busy} onClick={() => void runAction(() => api.updateLessonPlan(plan.id, { status: 'completed' }), t('lessonPlanCompleted'))}>{t('markCompleted')}</button>}
      </div>) : <p className="muted">{t('noLessonPlans')}</p>}</div>
    </section>}
    {canManage && <section className="panel settings-panel substitution-panel">
      <div className="panel-heading"><div><h2>{t('assignSubstitute')}</h2><p>{t('substituteLeaveRule')}</p></div></div>
      <form onSubmit={(event) => void submit(event, async () => {
        await api.assignTimetableSubstitute(substitutionForm.assignmentId, {
          substituteStaffId: substitutionForm.substituteStaffId, date,
          leaveRequestId: substitutionForm.leaveRequestId, reason: substitutionForm.reason
        });
        setSubstitutionForm({ assignmentId: '', substituteStaffId: '', leaveRequestId: '', reason: '' });
      }, t('substituteSaved'))}>
        <div className="form-grid">
          <label>{t('assignment')}<select required value={substitutionForm.assignmentId} onChange={(event) => setSubstitutionForm((current) => ({
            ...current, assignmentId: event.target.value, leaveRequestId: ''
          }))}><option value="">{t('chooseAssignment')}</option>{weekAssignments.filter((item) => item.dayOfWeek === ((new Date(`${date}T00:00:00`).getDay() + 6) % 7 + 1)).map((item) =>
            <option key={item.id} value={item.id}>{item.sectionName} · {item.subjectName} · {item.staffName}</option>)}</select></label>
          <label>{t('substituteTeacher')}<select required value={substitutionForm.substituteStaffId} onChange={(event) => setSubstitutionForm((current) => ({ ...current, substituteStaffId: event.target.value }))}><option value="">{t('chooseTeacher')}</option>{staff.filter((person) => person.id !== selectedAssignment?.staffId && person.employmentStatus === 'active').map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label>{t('approvedLeave')}<select required value={substitutionForm.leaveRequestId} onChange={(event) => setSubstitutionForm((current) => ({ ...current, leaveRequestId: event.target.value }))}><option value="">{t('chooseApprovedLeave')}</option>{eligibleLeaves.map((leave) => <option key={leave.id} value={leave.id}>{leave.startDate} – {leave.endDate} · {leave.reason}</option>)}</select></label>
          <FormInput label={t('leaveReason')} value={substitutionForm.reason} onChange={(reason) => setSubstitutionForm((current) => ({ ...current, reason }))} required />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !eligibleLeaves.length || !substitutionForm.assignmentId}>{t('assignSubstitute')}</button></div>
        {substitutionForm.assignmentId && !eligibleLeaves.length && <p className="muted">{t('noApprovedLeaveForDate')}</p>}
      </form>
    </section>}
  </>;
}

