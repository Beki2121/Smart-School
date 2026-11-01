import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, AcademicYear, AcademicYearRecord, CurriculumUnit, GradeCatalogEntry, GradeLevel, GradeSubject, PromotionRule, SchoolCalendarEntry, SchoolProfile, Section, Subject, Term } from '../../api';
import { Locale } from '../../i18n';
import { formatEthiopianDate } from '../../calendar';
import FormInput from '../../components/FormInput';

type T = (key: string) => string;
const academicDateLabel = (date: string, locale: Locale) => {
  const [year, month, day] = date.split('-').map(Number);
  return `${date} ? ${formatEthiopianDate({ year, month, day }, locale)}`;
};
export default function SchoolPage({ t, locale }: { t: T; locale: Locale }) {
  const [campus, setCampus] = useState<SchoolProfile | null>(null);
  const [academicYear, setAcademicYear] = useState<AcademicYear>(null);
  const [academicYears, setAcademicYears] = useState<AcademicYearRecord[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [grades, setGrades] = useState<GradeLevel[]>([]);
  const [gradeCatalog, setGradeCatalog] = useState<GradeCatalogEntry[]>([]);
  const [curriculumGradeId, setCurriculumGradeId] = useState('');
  const [gradeSubjects, setGradeSubjects] = useState<GradeSubject[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionCapacityValues, setSectionCapacityValues] = useState<Record<string, string>>({});
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [calendarEntries, setCalendarEntries] = useState<SchoolCalendarEntry[]>([]);
  const [calendarEditId, setCalendarEditId] = useState('');
  const [curriculumUnits, setCurriculumUnits] = useState<CurriculumUnit[]>([]);
  const [curriculumUnitEditId, setCurriculumUnitEditId] = useState('');
  const [curriculumUnitAcademicYearId, setCurriculumUnitAcademicYearId] = useState('');
  const [promotionRules, setPromotionRules] = useState<PromotionRule[]>([]);
  const [form, setForm] = useState({ name: '', address: '', phone: '' });
  const [yearForm, setYearForm] = useState({ labelEc: '', startDate: '', endDate: '' });
  const [termForm, setTermForm] = useState({ name: '', periodType: 'term' as Term['periodType'], startDate: '', endDate: '' });
  const [gradeForm, setGradeForm] = useState({ code: '', nameEn: '', nameAm: '', band: 'primary', sortOrder: 1 });
  const [sectionForm, setSectionForm] = useState({
    gradeLevelId: '', name: '', capacity: '', shift: 'morning' as NonNullable<Section['shift']>,
    stream: 'natural_science' as NonNullable<Section['stream']>
  });
  const [subjectForm, setSubjectForm] = useState({ code: '', nameEn: '', nameAm: '', category: 'core' as Subject['category'] });
  const [calendarForm, setCalendarForm] = useState({
    academicYearId: null as string | null,
    entryType: 'holiday' as SchoolCalendarEntry['entryType'], titleEn: '', titleAm: '',
    startDate: '', endDate: '', isNonInstructionalDay: true, notesEn: '', notesAm: ''
  });
  const [unitForm, setUnitForm] = useState({
    subjectId: '', stream: 'all' as CurriculumUnit['stream'], unitNumber: '1',
    titleEn: '', titleAm: '', learningOutcomesEn: '', learningOutcomesAm: '',
    plannedStart: '', plannedEnd: ''
  });
  const [promotionForm, setPromotionForm] = useState({
    gradeLevelId: '', minimumAnnualPercent: '50', maximumFailedRequiredSubjects: '0'
  });
  const [gradeSubjectForm, setGradeSubjectForm] = useState({
    subjectId: '', stream: 'all' as GradeSubject['stream'], weeklyPeriods: '1'
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => Promise.all([
    api.school(), api.academicYear(), api.academicYears(), api.terms(),
    api.grades(), api.curriculumGrades(), api.sections(), api.subjects(),
    api.schoolCalendar(), api.curriculumUnits(), api.promotionRules()
  ]).then(([profile, year, years, termRows, gradeRows, catalogRows, sectionRows, subjectRows, calendarRows, unitRows, ruleRows]) => {
      setCampus(profile);
      setAcademicYear(year);
      setForm({ name: profile.name, address: profile.address, phone: profile.phone });
      setAcademicYears(years); setTerms(termRows); setGrades(gradeRows); setGradeCatalog(catalogRows);
      setSections(sectionRows); setSubjects(subjectRows);
      setSectionCapacityValues(Object.fromEntries(sectionRows.map((section) => [section.id, section.capacity == null ? '' : String(section.capacity)])));
      setCalendarEntries(calendarRows); setCurriculumUnits(unitRows); setPromotionRules(ruleRows);
      setSectionForm((current) => ({ ...current, gradeLevelId: current.gradeLevelId || gradeRows[0]?.id || '' }));
      setCurriculumGradeId((current) => current || gradeRows[0]?.id || '');
      setPromotionForm((current) => ({ ...current, gradeLevelId: current.gradeLevelId || gradeRows[0]?.id || '' }));
      setUnitForm((current) => ({ ...current, subjectId: current.subjectId || subjectRows[0]?.id || '' }));
      setGradeForm((current) => {
        const selected = catalogRows.find((item) =>
          item.code === current.code && !gradeRows.some((grade) => grade.code === item.code)) ??
          catalogRows.find((item) => !gradeRows.some((grade) => grade.code === item.code));
        return selected ? { ...selected } : current;
      });
      setGradeSubjectForm((current) => ({ ...current, subjectId: current.subjectId || subjectRows[0]?.id || '' }));
    }), []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
  useEffect(() => {
    if (!curriculumGradeId) { setGradeSubjects([]); return; }
    api.gradeSubjects(curriculumGradeId).then(setGradeSubjects)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load grade subjects.'));
  }, [curriculumGradeId]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      const updated = await api.updateSchool(form);
      setCampus(updated);
      setNotice(t('schoolSaved'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const runSetup = async (action: () => Promise<unknown>) => {
    setError(''); setNotice(''); setBusy(true);
    try {
      await action();
      await load();
      setNotice(t('setupSaved'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const saveSetup = (event: FormEvent, action: () => Promise<unknown>) => {
    event.preventDefault();
    return runSetup(action);
  };
  const selectedSectionGrade = grades.find((grade) => grade.id === sectionForm.gradeLevelId);
  const selectedCurriculumGrade = grades.find((grade) => grade.id === curriculumGradeId);
  const selectedPromotionRule = promotionRules.find((rule) => rule.gradeLevelId === promotionForm.gradeLevelId);
  const availableGradeCatalog = gradeCatalog.filter((item) => !grades.some((grade) => grade.code === item.code));
  const saveGradeSubjects = async (next: GradeSubject[]) => {
    if (!curriculumGradeId) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      const saved = await api.replaceGradeSubjects(curriculumGradeId, next.map((item) => ({
        subjectId: item.subjectId, stream: item.stream,
        weeklyPeriods: item.weeklyPeriods, isRequired: item.isRequired
      })));
      setGradeSubjects(saved);
      setNotice(t('setupSaved'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  return <>
    <div className="page-heading compact-heading"><div><div className="eyebrow">{t('activeCampus')}</div><h1>{t('schoolSetup')}</h1><p>{t('schoolProfile')}</p></div></div>
    {error && <div className="notice notice-error">{error}</div>}{notice && <div className="notice notice-success">{notice}</div>}
    <form className="panel school-profile-form" onSubmit={save}>
      <div className="school-profile">
        <div className="school-monogram">S</div><div className="school-info"><span className="eyebrow">{t('profileEdit')}</span><h2>{campus?.name ?? t('loading')}</h2><p>{campus?.timezone ?? 'Africa/Addis_Ababa'} · {t('campus')}</p><span className="status-pill">{t('activeCampus')}</span></div>
      </div>
      <div className="form-grid school-form-grid">
        <FormInput label={t('schoolProfile')} value={form.name} onChange={(name) => setForm((current) => ({ ...current, name }))} required />
        <FormInput label={t('address')} value={form.address} onChange={(address) => setForm((current) => ({ ...current, address }))} />
        <FormInput label={t('phone')} value={form.phone} onChange={(phone) => setForm((current) => ({ ...current, phone }))} />
      </div>
      <div className="form-actions"><button className="button button-primary" disabled={busy || !campus}>{busy ? t('loading') : t('saveChanges')}</button></div>
    </form>
    <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('setupAcademic')}</h2><p>{t('schoolCalendarDefaults')}</p></div></div>
      <div className="setting-row"><span><strong>{t('campusTimezone')}</strong><small>{campus?.timezone ?? 'Africa/Addis_Ababa'}</small></span><span className="setting-value">Africa/Addis_Ababa</span></div>
      <div className="setting-row"><span><strong>{t('calendar')}</strong><small>{t('ethiopian')}</small></span><span className="setting-value">{t('ethiopian')}</span></div>
      <div className="notice notice-warm">{t('academicRulesNotice')}</div>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, () => api.createAcademicYear(yearForm))}>
        <h3>{t('addAcademicYear')}</h3><div className="form-grid">
          <FormInput label={t('yearLabel')} value={yearForm.labelEc} onChange={(labelEc) => setYearForm((value) => ({ ...value, labelEc }))} required />
          <FormInput label={t('startDate')} type="date" value={yearForm.startDate} onChange={(startDate) => setYearForm((value) => ({ ...value, startDate }))} required />
          <FormInput label={t('endDate')} type="date" value={yearForm.endDate} onChange={(endDate) => setYearForm((value) => ({ ...value, endDate }))} required />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addAcademicYear')}</button></div>
      </form>
      <div className="setup-list">{academicYears.length ? academicYears.map((year) => <div className="setting-row" key={year.id}><span><strong>{year.labelEc}</strong><small>{academicDateLabel(year.startDate, locale)} – {academicDateLabel(year.endDate, locale)}</small></span>{year.status === 'active' ? <span className="status-pill">{t('current')}</span> : <button className="button button-quiet" disabled={busy} onClick={() => void runSetup(() => api.activateAcademicYear(year.id))}>{t('activateYear')}</button>}</div>) : <p className="muted">{t('noAcademicYears')}</p>}</div>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, () => api.createTerm(termForm))}>
        <h3>{t('addTerm')}</h3><div className="form-grid">
          <FormInput label={t('termName')} value={termForm.name} onChange={(name) => setTermForm((value) => ({ ...value, name }))} required />
          <label>{t('periodType')}<select value={termForm.periodType} onChange={(event) => setTermForm((value) => ({ ...value, periodType: event.target.value as Term['periodType'] }))}><option value="term">{t('term')}</option><option value="semester">{t('semester')}</option></select></label>
          <FormInput label={t('startDate')} type="date" value={termForm.startDate} onChange={(startDate) => setTermForm((value) => ({ ...value, startDate }))} required />
          <FormInput label={t('endDate')} type="date" value={termForm.endDate} onChange={(endDate) => setTermForm((value) => ({ ...value, endDate }))} required />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !academicYear}>{t('addTerm')}</button></div>
      </form>
      <div className="setup-list">{terms.length ? terms.map((term) => <div className="setting-row" key={term.id}><span><strong>{term.name}</strong><small>{academicDateLabel(term.startDate, locale)} – {academicDateLabel(term.endDate, locale)}</small></span>{term.isCurrent ? <span className="status-pill">{t('current')}</span> : term.academicYearId === academicYear?.id && <button className="button button-quiet" disabled={busy} onClick={() => void runSetup(() => api.setCurrentTerm(term.id))}>{t('setCurrentTerm')}</button>}</div>) : <p className="muted">{t('noTerms')}</p>}</div>
      <form className="setup-form" onSubmit={(event) => {
        event.preventDefault();
        void runSetup(async () => {
          const entry = {
            ...calendarForm,
            academicYearId: calendarEditId ? calendarForm.academicYearId : academicYear?.id ?? null
          };
          if (calendarEditId) await api.updateCalendarEntry(calendarEditId, entry);
          else await api.createCalendarEntry(entry);
          setCalendarEditId('');
          setCalendarForm({
            academicYearId: null, entryType: 'holiday', titleEn: '', titleAm: '', startDate: '', endDate: '',
            isNonInstructionalDay: true, notesEn: '', notesAm: ''
          });
        });
      }}>
        <h3>{calendarEditId ? t('editCalendarEntry') : t('addCalendarEntry')}</h3><div className="form-grid">
          <label>{t('calendarEntryType')}<select value={calendarForm.entryType} onChange={(event) => setCalendarForm((value) => ({ ...value, entryType: event.target.value as SchoolCalendarEntry['entryType'] }))}>
            <option value="holiday">{t('holiday')}</option><option value="event">{t('event')}</option>
            <option value="exam">{t('exam')}</option><option value="closure">{t('closure')}</option>
          </select></label>
          <FormInput label={t('titleEnglish')} value={calendarForm.titleEn} onChange={(titleEn) => setCalendarForm((value) => ({ ...value, titleEn }))} required />
          <FormInput label={t('titleAmharic')} value={calendarForm.titleAm} onChange={(titleAm) => setCalendarForm((value) => ({ ...value, titleAm }))} required />
          <FormInput label={t('startDate')} type="date" value={calendarForm.startDate} onChange={(startDate) => setCalendarForm((value) => ({ ...value, startDate }))} required />
          <FormInput label={t('endDate')} type="date" value={calendarForm.endDate} onChange={(endDate) => setCalendarForm((value) => ({ ...value, endDate }))} required />
          <label><span>{t('nonInstructionalDay')}</span><input type="checkbox" checked={calendarForm.isNonInstructionalDay} onChange={(event) => setCalendarForm((value) => ({ ...value, isNonInstructionalDay: event.target.checked }))} /></label>
          <FormInput label={t('notesEnglish')} value={calendarForm.notesEn} onChange={(notesEn) => setCalendarForm((value) => ({ ...value, notesEn }))} />
          <FormInput label={t('notesAmharic')} value={calendarForm.notesAm} onChange={(notesAm) => setCalendarForm((value) => ({ ...value, notesAm }))} />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy}>{calendarEditId ? t('saveChanges') : t('addCalendarEntry')}</button>{calendarEditId && <button type="button" className="button button-quiet" onClick={() => {
          setCalendarEditId('');
          setCalendarForm({
            academicYearId: null, entryType: 'holiday', titleEn: '', titleAm: '', startDate: '', endDate: '',
            isNonInstructionalDay: true, notesEn: '', notesAm: ''
          });
        }}>{t('cancel')}</button>}</div>
      </form>
      <div className="setup-list">{calendarEntries.length ? calendarEntries.map((entry) => <div className="setting-row" key={entry.id}>
        <span><strong>{entry.titleEn} · {entry.titleAm}</strong><small>{t(entry.entryType)} · {academicDateLabel(entry.startDate, locale)} – {academicDateLabel(entry.endDate, locale)}</small></span>
        <div className="form-actions">
          <button type="button" className="button button-quiet" disabled={busy} onClick={() => {
            setCalendarEditId(entry.id);
            setCalendarForm({
              academicYearId: entry.academicYearId, entryType: entry.entryType,
              titleEn: entry.titleEn, titleAm: entry.titleAm,
              startDate: entry.startDate, endDate: entry.endDate,
              isNonInstructionalDay: entry.isNonInstructionalDay,
              notesEn: entry.notesEn, notesAm: entry.notesAm
            });
          }}>{t('editEntry')}</button>
          <button type="button" className="button button-quiet" disabled={busy} onClick={() => void runSetup(() => api.deleteCalendarEntry(entry.id))}>{t('remove')}</button>
        </div>
      </div>) : <p className="muted">{t('noCalendarEntries')}</p>}</div>
      <div className="notice notice-warm">{t('editableCurriculumNotice')}</div>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, async () => {
        const created = await api.createGrade({ code: gradeForm.code });
        setCurriculumGradeId(created.id);
      })}>
        <h3>{t('addGrade')}</h3><div className="form-grid">
          <label>{t('gradeCode')}<select required value={gradeForm.code} onChange={(event) => {
            const next = gradeCatalog.find((item) => item.code === event.target.value);
            if (next) setGradeForm(next);
          }}>
            {availableGradeCatalog.map((item) => <option key={item.code} value={item.code}>{item.nameEn} · {item.nameAm}</option>)}
          </select></label>
          {gradeForm.code && <p className="muted">{gradeForm.nameEn} · {gradeForm.nameAm} · {gradeForm.band}</p>}
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !availableGradeCatalog.length}>{t('addGrade')}</button></div>
      </form>
      <div className="setup-list">{grades.length ? grades.map((grade) => <div className="setting-row" key={grade.id}><span><strong>{grade.nameEn} · {grade.nameAm}</strong><small>{grade.code} · {grade.band}</small></span></div>) : <p className="muted">{t('noGrades')}</p>}</div>
      <section className="setup-form">
        <h3>{t('gradeSubjects')}</h3><p className="muted">{t('gradeSubjectsHint')}</p>
        <div className="form-grid">
          <label>{t('grades')}<select value={curriculumGradeId} onChange={(event) => setCurriculumGradeId(event.target.value)}><option value="">{t('chooseGrade')}</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.nameEn}</option>)}</select></label>
          {selectedCurriculumGrade && (selectedCurriculumGrade.code === 'G11' || selectedCurriculumGrade.code === 'G12') &&
            <label>{t('stream')}<select value={gradeSubjectForm.stream === 'all' ? 'natural_science' : gradeSubjectForm.stream}
              onChange={(event) => setGradeSubjectForm((current) => ({ ...current, stream: event.target.value as GradeSubject['stream'] }))}>
              <option value="natural_science">{t('naturalScience')}</option><option value="social_science">{t('socialScience')}</option>
            </select></label>}
        </div>
        {gradeSubjects.length > 0 && <div className="setup-list">{gradeSubjects.map((item) => <div className="setting-row" key={item.id}>
          <span><strong>{item.nameEn} · {item.nameAm}</strong><small>{item.code} · {item.stream === 'all' ? t('allStreams') : t(item.stream === 'natural_science' ? 'naturalScience' : 'socialScience')}</small></span>
          <div className="form-actions">
            <label>{t('weeklyPeriods')}<input aria-label={`${item.nameEn} ${t('weeklyPeriods')}`} type="number" min="1" max="60"
              value={item.weeklyPeriods} onChange={(event) => setGradeSubjects((current) => current.map((row) =>
                row.id === item.id ? { ...row, weeklyPeriods: Number(event.target.value) } : row))} /></label>
            <button type="button" className="button button-quiet" disabled={busy} onClick={() =>
              void saveGradeSubjects(gradeSubjects.filter((row) => row.id !== item.id))}>{t('remove')}</button>
          </div>
        </div>)}</div>}
        {selectedCurriculumGrade && <form className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          const subject = subjects.find((item) => item.id === gradeSubjectForm.subjectId);
          if (!subject) return;
          const next: GradeSubject = {
            ...subject, id: `${subject.id}-${gradeSubjectForm.stream}`, gradeLevelId: curriculumGradeId,
            subjectId: subject.id, stream: gradeSubjectForm.stream,
            weeklyPeriods: Number(gradeSubjectForm.weeklyPeriods), isRequired: true
          };
          void saveGradeSubjects([...gradeSubjects, next]);
        }}>
          <label>{t('addSubject')}<select required value={gradeSubjectForm.subjectId} onChange={(event) =>
            setGradeSubjectForm((current) => ({ ...current, subjectId: event.target.value }))}>
            <option value="">{t('chooseSubject')}</option>{subjects.filter((subject) =>
              !gradeSubjects.some((item) => item.subjectId === subject.id && item.stream === gradeSubjectForm.stream))
              .map((subject) => <option key={subject.id} value={subject.id}>{subject.nameEn}</option>)}
          </select></label>
          <FormInput label={t('weeklyPeriods')} type="number" value={gradeSubjectForm.weeklyPeriods}
            onChange={(weeklyPeriods) => setGradeSubjectForm((current) => ({ ...current, weeklyPeriods }))} required />
          <button className="button button-secondary" disabled={busy || !gradeSubjectForm.subjectId}>{t('addSubject')}</button>
          <button type="button" className="button button-primary" disabled={busy || !gradeSubjects.length}
            onClick={() => void saveGradeSubjects(gradeSubjects)}>{t('saveChanges')}</button>
        </form>}
      </section>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, () => {
        const academicYearId = curriculumUnitEditId
          ? curriculumUnitAcademicYearId
          : academicYear?.id ?? '';
        if (!academicYearId || !curriculumGradeId) throw new Error(t('activeYearRequired'));
        const unit = {
          academicYearId, gradeLevelId: curriculumGradeId,
          subjectId: unitForm.subjectId, stream: unitForm.stream,
          unitNumber: Number(unitForm.unitNumber), titleEn: unitForm.titleEn, titleAm: unitForm.titleAm,
          learningOutcomesEn: unitForm.learningOutcomesEn, learningOutcomesAm: unitForm.learningOutcomesAm,
          plannedStart: unitForm.plannedStart || null, plannedEnd: unitForm.plannedEnd || null
        };
        return (curriculumUnitEditId
          ? api.updateCurriculumUnit(curriculumUnitEditId, unit)
          : api.createCurriculumUnit(unit)).then((result) => {
          setCurriculumUnitEditId('');
          setCurriculumUnitAcademicYearId('');
          setUnitForm({
            subjectId: subjects[0]?.id ?? '', stream: 'all', unitNumber: '1',
            titleEn: '', titleAm: '', learningOutcomesEn: '', learningOutcomesAm: '',
            plannedStart: '', plannedEnd: ''
          });
          return result;
        });
      })}>
        <h3>{curriculumUnitEditId ? t('editCurriculumUnit') : t('curriculumSyllabus')}</h3><div className="form-grid">
          <label>{t('grades')}<select required value={curriculumGradeId} onChange={(event) => setCurriculumGradeId(event.target.value)}><option value="">{t('chooseGrade')}</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.nameEn} · {grade.nameAm}</option>)}</select></label>
          <label>{t('subject')}<select required value={unitForm.subjectId} onChange={(event) => setUnitForm((value) => ({ ...value, subjectId: event.target.value }))}><option value="">{t('chooseSubject')}</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.nameEn} · {subject.nameAm}</option>)}</select></label>
          <label>{t('stream')}<select value={unitForm.stream} onChange={(event) => setUnitForm((value) => ({ ...value, stream: event.target.value as CurriculumUnit['stream'] }))}><option value="all">{t('allStreams')}</option><option value="natural_science">{t('naturalScience')}</option><option value="social_science">{t('socialScience')}</option></select></label>
          <FormInput label={t('unitNumber')} type="number" value={unitForm.unitNumber} onChange={(unitNumber) => setUnitForm((value) => ({ ...value, unitNumber }))} required />
          <FormInput label={t('titleEnglish')} value={unitForm.titleEn} onChange={(titleEn) => setUnitForm((value) => ({ ...value, titleEn }))} required />
          <FormInput label={t('titleAmharic')} value={unitForm.titleAm} onChange={(titleAm) => setUnitForm((value) => ({ ...value, titleAm }))} required />
          <FormInput label={t('learningOutcomesEnglish')} value={unitForm.learningOutcomesEn} onChange={(learningOutcomesEn) => setUnitForm((value) => ({ ...value, learningOutcomesEn }))} />
          <FormInput label={t('learningOutcomesAmharic')} value={unitForm.learningOutcomesAm} onChange={(learningOutcomesAm) => setUnitForm((value) => ({ ...value, learningOutcomesAm }))} />
          <FormInput label={t('plannedStart')} type="date" value={unitForm.plannedStart} onChange={(plannedStart) => setUnitForm((value) => ({ ...value, plannedStart }))} />
          <FormInput label={t('plannedEnd')} type="date" value={unitForm.plannedEnd} onChange={(plannedEnd) => setUnitForm((value) => ({ ...value, plannedEnd }))} />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || (!academicYear && !curriculumUnitEditId) || !curriculumGradeId || !unitForm.subjectId}>{curriculumUnitEditId ? t('saveChanges') : t('addCurriculumUnit')}</button>{curriculumUnitEditId && <button type="button" className="button button-quiet" onClick={() => {
          setCurriculumUnitEditId('');
          setCurriculumUnitAcademicYearId('');
          setUnitForm({
            subjectId: subjects[0]?.id ?? '', stream: 'all', unitNumber: '1',
            titleEn: '', titleAm: '', learningOutcomesEn: '', learningOutcomesAm: '',
            plannedStart: '', plannedEnd: ''
          });
        }}>{t('cancel')}</button>}</div>
      </form>
      <div className="setup-list">{curriculumUnits.filter((unit) => unit.gradeLevelId === curriculumGradeId).map((unit) => <div className="setting-row" key={unit.id}>
        <span><strong>{unit.unitNumber}. {unit.titleEn} · {unit.titleAm}</strong><small>{unit.subjectName} · {unit.plannedStart ?? ''}{unit.plannedEnd ? ` – ${unit.plannedEnd}` : ''}</small></span>
        <div className="form-actions">
          <button type="button" className="button button-quiet" disabled={busy} onClick={() => {
            setCurriculumUnitEditId(unit.id);
            setCurriculumUnitAcademicYearId(unit.academicYearId);
            setCurriculumGradeId(unit.gradeLevelId);
            setUnitForm({
              subjectId: unit.subjectId, stream: unit.stream, unitNumber: String(unit.unitNumber),
              titleEn: unit.titleEn, titleAm: unit.titleAm,
              learningOutcomesEn: unit.learningOutcomesEn, learningOutcomesAm: unit.learningOutcomesAm,
              plannedStart: unit.plannedStart ?? '', plannedEnd: unit.plannedEnd ?? ''
            });
          }}>{t('editEntry')}</button>
          <button type="button" className="button button-quiet" disabled={busy} onClick={() => void runSetup(() => api.deleteCurriculumUnit(unit.id))}>{t('remove')}</button>
        </div>
      </div>)}</div>
      <form className="setup-form" onSubmit={(event) => {
        event.preventDefault();
        if (!promotionForm.gradeLevelId) return;
        void runSetup(() => api.savePromotionRule(promotionForm.gradeLevelId, {
          minimumAnnualPercent: Number(promotionForm.minimumAnnualPercent),
          maximumFailedRequiredSubjects: Number(promotionForm.maximumFailedRequiredSubjects)
        }));
      }}>
        <h3>{t('promotionRules')}</h3><p className="muted">{t('promotionRuleNotice')}</p><div className="form-grid">
          <label>{t('grades')}<select required value={promotionForm.gradeLevelId} onChange={(event) => {
            const gradeLevelId = event.target.value;
            const existing = promotionRules.find((rule) => rule.gradeLevelId === gradeLevelId);
            setPromotionForm({ gradeLevelId, minimumAnnualPercent: String(existing?.minimumAnnualPercent ?? 50), maximumFailedRequiredSubjects: String(existing?.maximumFailedRequiredSubjects ?? 0) });
          }}><option value="">{t('chooseGrade')}</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.nameEn} · {grade.nameAm}</option>)}</select></label>
          <FormInput label={t('minimumAnnualPercent')} type="number" value={promotionForm.minimumAnnualPercent} onChange={(minimumAnnualPercent) => setPromotionForm((value) => ({ ...value, minimumAnnualPercent }))} required />
          <FormInput label={t('maximumFailedSubjects')} type="number" value={promotionForm.maximumFailedRequiredSubjects} onChange={(maximumFailedRequiredSubjects) => setPromotionForm((value) => ({ ...value, maximumFailedRequiredSubjects }))} required />
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !academicYear || !promotionForm.gradeLevelId}>{t(selectedPromotionRule ? 'saveChanges' : 'savePromotionRule')}</button></div>
      </form>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, () => api.createSection({
        ...sectionForm, capacity: sectionForm.capacity ? Number(sectionForm.capacity) : null,
        stream: selectedSectionGrade?.code === 'G11' || selectedSectionGrade?.code === 'G12' ? sectionForm.stream : undefined
      }))}>
        <h3>{t('addSection')}</h3><div className="form-grid">
          <label>{t('grades')}<select required value={sectionForm.gradeLevelId} onChange={(event) => setSectionForm((value) => ({ ...value, gradeLevelId: event.target.value }))}>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.nameEn}</option>)}</select></label>
          {selectedSectionGrade && (selectedSectionGrade.code === 'G11' || selectedSectionGrade.code === 'G12') &&
            <label>{t('stream')}<select value={sectionForm.stream} onChange={(event) => setSectionForm((value) => ({ ...value, stream: event.target.value as NonNullable<Section['stream']> }))}>
              <option value="natural_science">{t('naturalScience')}</option><option value="social_science">{t('socialScience')}</option>
            </select></label>}
          <FormInput label={t('sectionName')} value={sectionForm.name} onChange={(name) => setSectionForm((value) => ({ ...value, name }))} required />
          <FormInput label={t('capacity')} type="number" value={sectionForm.capacity} onChange={(capacity) => setSectionForm((value) => ({ ...value, capacity }))} />
          <label>{t('shift')}<select value={sectionForm.shift} onChange={(event) => setSectionForm((value) => ({ ...value, shift: event.target.value as NonNullable<Section['shift']> }))}><option value="morning">{t('morning')}</option><option value="afternoon">{t('afternoon')}</option><option value="evening">{t('evening')}</option></select></label>
        </div><div className="form-actions"><button className="button button-primary" disabled={busy || !academicYear || !grades.length}>{t('addSection')}</button></div>
      </form>
      <div className="setup-list">{sections.length ? sections.map((section) => <form className="setting-row" key={section.id} onSubmit={(event) => {
        event.preventDefault();
        const value = sectionCapacityValues[section.id] ?? '';
        void runSetup(() => api.updateSectionCapacity(section.id, value ? Number(value) : null));
      }}><span><strong>{section.gradeName} · {section.name}</strong><small>{t(section.shift ?? 'morning')}{section.stream ? ` · ${t(section.stream === 'natural_science' ? 'naturalScience' : 'socialScience')}` : ''}</small></span>
        <div className="form-actions"><label>{t('capacity')}<input type="number" min="1" max="1000" value={sectionCapacityValues[section.id] ?? ''} onChange={(event) => setSectionCapacityValues((value) => ({ ...value, [section.id]: event.target.value }))} /></label>
          <button className="button button-quiet" disabled={busy}>{t('saveChanges')}</button></div>
      </form>) : <p className="muted">{t('noSections')}</p>}</div>
      <form className="setup-form" onSubmit={(event) => void saveSetup(event, () => api.createSubject(subjectForm))}>
        <h3>{t('addSubject')}</h3><div className="form-grid">
          <FormInput label={t('subjectCode')} value={subjectForm.code} onChange={(code) => setSubjectForm((value) => ({ ...value, code }))} required />
          <FormInput label={t('subjectNameEn')} value={subjectForm.nameEn} onChange={(nameEn) => setSubjectForm((value) => ({ ...value, nameEn }))} required />
          <FormInput label={t('subjectNameAm')} value={subjectForm.nameAm} onChange={(nameAm) => setSubjectForm((value) => ({ ...value, nameAm }))} required />
          <label>{t('subjectCategory')}<select value={subjectForm.category} onChange={(event) => setSubjectForm((value) => ({ ...value, category: event.target.value as Subject['category'] }))}>
            {['core', 'language', 'mathematics', 'science', 'social_science', 'arts', 'health', 'technology', 'other'].map((category) => <option key={category} value={category}>{t(`subjectCategory_${category}`)}</option>)}
          </select></label>
        </div><div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addSubject')}</button></div>
      </form>
      <div className="setup-list">{subjects.length ? subjects.map((subject) => <div className="setting-row" key={subject.id}><span><strong>{subject.nameEn} · {subject.nameAm}</strong><small>{subject.code}</small></span></div>) : <p className="muted">{t('noSubjects')}</p>}</div>
    </section>
  </>;
}

