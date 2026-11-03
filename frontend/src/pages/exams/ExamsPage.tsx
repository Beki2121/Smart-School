import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  api, ExamMonitorRow, ExamRecord, ExamType, GradeLevel, Room, Section, StaffMember,
  Subject, Term
} from '../../api';
import { Locale } from '../../i18n';

type T = (key: string) => string;
type ScheduleDraft = {
  sectionId: string; examDate: string; startsAt: string; endsAt: string;
  roomId: string; invigilatorIds: string[]
};

function freshSchedule(): ScheduleDraft {
  return {
    sectionId: '', examDate: '', startsAt: '09:00', endsAt: '10:00',
    roomId: '', invigilatorIds: []
  };
}

export default function ExamsPage({ t, locale, canManage, canMonitor }: {
  t: T; locale: Locale; canManage: boolean; canMonitor: boolean
}) {
  const [types, setTypes] = useState<ExamType[]>([]);
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [monitor, setMonitor] = useState<ExamMonitorRow[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [grades, setGrades] = useState<GradeLevel[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [gradeSubjectIds, setGradeSubjectIds] = useState<string[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [typeCode, setTypeCode] = useState('');
  const [typeName, setTypeName] = useState('');
  const [typeWeight, setTypeWeight] = useState('100');
  const [title, setTitle] = useState('');
  const [termId, setTermId] = useState('');
  const [gradeLevelId, setGradeLevelId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [examTypeId, setExamTypeId] = useState('');
  const [maxValue, setMaxValue] = useState('100');
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleDraft[]>([freshSchedule()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [typeRows, examRows, monitorRows] = await Promise.all([
      api.examTypes(), api.exams(), canMonitor ? api.examMonitoring() : Promise.resolve([])
    ]);
    setTypes(typeRows);
    setExams(examRows);
    setMonitor(monitorRows);
    if (canManage) {
      const [termRows, gradeRows, subjectRows, sectionRows, roomRows, staffRows] = await Promise.all([
        api.terms(), api.grades(), api.subjects(), api.sections(), api.rooms(), api.staff()
      ]);
      setTerms(termRows);
      setGrades(gradeRows);
      setSubjects(subjectRows);
      setSections(sectionRows);
      setRooms(roomRows);
      setStaff(staffRows.filter((item) => item.employmentStatus === 'active'));
      setTermId((current) => current || termRows.find((item) => item.isCurrent)?.id || termRows[0]?.id || '');
      setGradeLevelId((current) => current || gradeRows[0]?.id || '');
      setSubjectId((current) => current || subjectRows[0]?.id || '');
      setExamTypeId((current) => current || typeRows.find((item) => item.isActive)?.id || '');
      setScheduleEntries((current) => current.map((entry) => ({
        ...entry, sectionId: entry.sectionId || sectionRows[0]?.id || ''
      })));
    }
  }, [canManage, canMonitor]);

  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError'))); }, [load, t]);

  useEffect(() => {
    if (!gradeLevelId) { setGradeSubjectIds([]); return; }
    api.gradeSubjects(gradeLevelId).then((rows) =>
      setGradeSubjectIds(rows.map((item) => item.subjectId)))
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [gradeLevelId, t]);

  const availableSubjects = useMemo(() => {
    if (!gradeLevelId || !gradeSubjectIds.length) return subjects;
    return subjects.filter((subject) => gradeSubjectIds.includes(subject.id));
  }, [gradeLevelId, gradeSubjectIds, subjects]);
  const availableSections = sections.filter((section) => section.gradeLevelId === gradeLevelId);
  const activeTypes = types.filter((item) => item.isActive);
  const configuredWeight = activeTypes.reduce((sum, item) => sum + item.weightPercent, 0);

  const submitType = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      await api.createExamType({
        code: typeCode.trim().toLowerCase().replaceAll(' ', '_'),
        name: typeName.trim(), weightPercent: Number(typeWeight)
      });
      setTypeCode(''); setTypeName('');
      setNotice(t('examTypeSaved'));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };

  const updateType = async (item: ExamType, patch: Partial<Pick<ExamType, 'weightPercent' | 'isActive'>>) => {
    setBusy(true); setError('');
    try {
      await api.updateExamType(item.id, patch);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };

  const submitExam = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      await api.createExam({
        title: title.trim(), termId, gradeLevelId, subjectId, examTypeId,
        maxValue: Number(maxValue),
        scheduleEntries: scheduleEntries.map((entry) => ({
          sectionId: entry.sectionId, examDate: entry.examDate,
          startsAt: entry.startsAt, endsAt: entry.endsAt,
          ...(entry.roomId ? { roomId: entry.roomId } : {}),
          invigilatorIds: entry.invigilatorIds
        }))
      });
      setTitle('');
      setNotice(t('examCreated'));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };

  const transition = async (exam: ExamRecord, action: 'publish' | 'open') => {
    setBusy(true); setError(''); setNotice('');
    try {
      if (action === 'publish') {
        await api.publishExamSchedule(exam.id);
        setNotice(t('examSchedulePublished'));
      } else {
        await api.openExamMarks(exam.id);
        setNotice(t('examMarksOpened'));
      }
      await load();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : t('apiError');
      setError(message);
    } finally { setBusy(false); }
  };

  const setSchedule = (index: number, patch: Partial<ScheduleDraft>) =>
    setScheduleEntries((current) => current.map((entry, row) =>
      row === index ? { ...entry, ...patch } : entry));

  return <div className="exams-page">
    <div className="page-heading compact-heading">
      <div><div className="eyebrow">{t('sectionGrade')}</div><h1>{t('examsTitle')}</h1><p>{t('examsHint')}</p></div>
      <span className="state-tag">{t('examSchedule')}</span>
    </div>
    {notice && <div className="notice notice-success">{notice}</div>}
    {error && <div className="notice notice-error">{error}</div>}

    {canManage && <section className="panel">
      <div className="panel-heading"><div><h2>{t('examTypes')}</h2><p>{t('examWeightHint')}</p></div>
        <span className={`state-tag ${Math.round(configuredWeight * 100) === 10000 ? 'state-active' : ''}`}>
          {configuredWeight.toFixed(2)}%
        </span>
      </div>
      <div className="table-scroll"><table className="data-table">
        <thead><tr><th>{t('name')}</th><th>{t('code')}</th><th>{t('weightPercent')}</th><th>{t('status')}</th></tr></thead>
        <tbody>{types.map((item) => <tr key={item.id}>
          <td>{item.name}</td><td>{item.code}</td><td>{canManage ?
            <label className="exam-weight-input"><input aria-label={`${item.name} ${t('weightPercent')}`}
              type="number" min="0" max="100" step="0.01" value={item.weightPercent}
              onChange={(event) => {
                const weightPercent = Number(event.target.value);
                setTypes((current) => current.map((type) =>
                  type.id === item.id ? { ...type, weightPercent } : type));
              }}
              onBlur={(event) => void updateType(item, { weightPercent: Number(event.target.value) })} />
              %</label> : `${item.weightPercent.toFixed(2)}%`}</td>
          <td>{item.isActive ? t('active') : t('inactive')} {canManage &&
            <button type="button" className="button button-secondary" disabled={busy}
              onClick={() => void updateType(item, { isActive: !item.isActive })}>
              {item.isActive ? t('deactivate') : t('activate')}
            </button>}</td>
        </tr>)}</tbody>
      </table></div>
      <form className="setup-form" onSubmit={(event) => void submitType(event)}>
        <div className="form-grid">
          <label>{t('code')}<input value={typeCode} onChange={(event) => setTypeCode(event.target.value)} required maxLength={32} /></label>
          <label>{t('name')}<input value={typeName} onChange={(event) => setTypeName(event.target.value)} required maxLength={100} /></label>
          <label>{t('weightPercent')}<input type="number" min="0" max="100" step="0.01" value={typeWeight} onChange={(event) => setTypeWeight(event.target.value)} required /></label>
        </div>
        <div className="form-actions"><button className="button button-primary" disabled={busy}>{t('saveExamType')}</button></div>
      </form>
    </section>}

    {canManage && <section className="panel">
      <div className="panel-heading"><div><h2>{t('createExam')}</h2><p>{t('examSetupHint')}</p></div></div>
      <form className="setup-form" onSubmit={(event) => void submitExam(event)}>
        <div className="form-grid">
          <label>{t('examTitle')}<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} /></label>
          <label>{t('term')}<select value={termId} onChange={(event) => setTermId(event.target.value)} required>
            <option value="">{t('chooseTerm')}</option>{terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}
          </select></label>
          <label>{t('grade')}<select value={gradeLevelId} onChange={(event) => setGradeLevelId(event.target.value)} required>
            <option value="">{t('chooseGrade')}</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{locale === 'am' ? grade.nameAm : grade.nameEn}</option>)}
          </select></label>
          <label>{t('subject')}<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} required>
            <option value="">{t('chooseSubject')}</option>{availableSubjects.map((subject) => <option key={subject.id} value={subject.id}>{locale === 'am' ? subject.nameAm : subject.nameEn}</option>)}
          </select></label>
          <label>{t('examType')}<select value={examTypeId} onChange={(event) => setExamTypeId(event.target.value)} required>
            <option value="">{t('chooseExamType')}</option>{activeTypes.map((type) => <option key={type.id} value={type.id}>{type.name} · {type.weightPercent}%</option>)}
          </select></label>
          <label>{t('maxMark')}<input type="number" min="0.01" max="1000" step="0.01" value={maxValue} onChange={(event) => setMaxValue(event.target.value)} required /></label>
        </div>
        <h3>{t('examSchedule')}</h3>
        {scheduleEntries.map((entry, index) => <div className="exam-schedule-draft" key={index}>
          <label>{t('section')}<select value={entry.sectionId} onChange={(event) => setSchedule(index, { sectionId: event.target.value })} required>
            <option value="">{t('chooseSection')}</option>{availableSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
          </select></label>
          <label>{t('examDate')}<input type="date" value={entry.examDate} onChange={(event) => setSchedule(index, { examDate: event.target.value })} required /></label>
          <label>{t('startTime')}<input type="time" value={entry.startsAt} onChange={(event) => setSchedule(index, { startsAt: event.target.value })} required /></label>
          <label>{t('endTime')}<input type="time" value={entry.endsAt} onChange={(event) => setSchedule(index, { endsAt: event.target.value })} required /></label>
          <label>{t('room')}<select value={entry.roomId} onChange={(event) => setSchedule(index, { roomId: event.target.value })}>
            <option value="">{t('noRoom')}</option>{rooms.filter((room) => room.isActive).map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </select></label>
          <label>{t('invigilators')}<select multiple value={entry.invigilatorIds} onChange={(event) =>
            setSchedule(index, { invigilatorIds: Array.from(event.target.selectedOptions, (option) => option.value) })}>
            {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select></label>
          {scheduleEntries.length > 1 && <button type="button" className="button button-secondary"
            onClick={() => setScheduleEntries((current) => current.filter((_, row) => row !== index))}>{t('removeSchedule')}</button>}
        </div>)}
        <div className="form-actions">
          <button type="button" className="button button-secondary" onClick={() => setScheduleEntries((current) => [
            ...current, { ...freshSchedule(), sectionId: availableSections[0]?.id ?? '' }
          ])}>{t('addSchedule')}</button>
          <button className="button button-primary" disabled={busy || !activeTypes.length}>{t('createExam')}</button>
        </div>
      </form>
    </section>}

    {canMonitor && <section className="panel">
      <div className="panel-heading"><div><h2>{t('marksMonitoring')}</h2><p>{t('missingMarksHint')}</p></div></div>
      <div className="table-scroll"><table className="data-table">
        <thead><tr><th>{t('examTitle')}</th><th>{t('status')}</th><th>{t('expectedMarks')}</th><th>{t('recordedMarks')}</th><th>{t('missingMarks')}</th></tr></thead>
        <tbody>{monitor.map((row) => <tr key={row.id}>
          <td>{row.title}</td><td>{t(`examState_${row.status}`)}</td><td>{row.expectedMarks}</td>
          <td>{row.recordedMarks}</td><td>{row.missingMarks}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    <section className="panel">
      <div className="panel-heading"><div><h2>{t('examSchedule')}</h2><p>{t('examsHint')}</p></div></div>
      {exams.length ? <div className="table-scroll"><table className="data-table">
        <thead><tr><th>{t('examTitle')}</th><th>{t('examType')}</th><th>{t('section')}</th><th>{t('examDate')}</th><th>{t('time')}</th><th>{t('room')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead>
        <tbody>{exams.flatMap((exam) => exam.scheduleEntries.map((entry) => <tr key={entry.id}>
          <td>{exam.title}</td><td>{exam.examType ?? ''}</td><td>{entry.sectionName}</td>
          <td>{entry.examDate}</td><td>{entry.startsAt.slice(0, 5)}–{entry.endsAt.slice(0, 5)}</td>
          <td>{entry.roomName ?? t('noRoom')}</td><td>{t(`examState_${exam.status}`)}</td>
          <td>{canManage && exam.status === 'scheduled' && <button type="button" className="button button-secondary"
            disabled={busy} onClick={() => void transition(exam, 'publish')}>{t('publishSchedule')}</button>}
            {canManage && exam.status === 'schedule_published' && <button type="button" className="button button-primary"
              disabled={busy} onClick={() => void transition(exam, 'open')}>{t('openMarks')}</button>}
          </td>
        </tr>))}</tbody>
      </table></div> : <div className="empty-state">{t('noExams')}</div>}
    </section>
  </div>;
}
