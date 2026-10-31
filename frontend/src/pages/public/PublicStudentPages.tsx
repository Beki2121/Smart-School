import { FormEvent, useEffect, useState } from 'react';
import { api, Student } from '../../api';
import { Locale } from '../../i18n';
import FormInput from '../../components/FormInput';

type T = (key: string) => string;

export function PublicAdmissionPage({ t, locale, token }: { t: T; locale: Locale; token: string }) {
  const [school, setSchool] = useState<Awaited<ReturnType<typeof api.publicAdmissionInfo>> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState('');
  const [form, setForm] = useState({
    givenNameAm: '', fatherNameAm: '', grandfatherNameAm: '',
    givenNameEn: '', fatherNameEn: '', grandfatherNameEn: '',
    gender: 'female', dateOfBirth: '', guardianName: '', guardianPhone: '',
    guardianEmail: '', gradeLevelId: '', previousSchool: ''
  });
  useEffect(() => {
    api.publicAdmissionInfo(token).then((info) => {
      setSchool(info);
      setForm((current) => ({ ...current, gradeLevelId: info.grades[0]?.id ?? '' }));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [token, t]);
  const update = (field: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api.submitPublicAdmission(token, {
        ...form, gender: form.gender as Student['gender'],
        dateOfBirth: form.dateOfBirth || null,
        guardianEmail: form.guardianEmail || null,
        previousSchool: form.previousSchool || null,
        privacyConsent: true
      });
      setReference(result.reference);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };
  return <main className="login-page invitation-page">
    <section className="login-card public-admission-card">
      <div className="eyebrow">{t('onlineAdmission')}</div>
      <h2>{school ? `${school.schoolName} · ${school.campusName}` : t('onlineAdmission')}</h2>
      {school && <p>{school.address}{school.phone ? ` · ${school.phone}` : ''}</p>}
      {error && <div className="notice notice-error">{error}</div>}
      {!school && !error && <div className="loading-state">{t('loading')}</div>}
      {reference ? <div className="notice notice-success">
        <strong>{t('applicationSubmitted')}</strong><p>{t('applicationReference')}: {reference}</p>
      </div> : school && <form className="student-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <FormInput label={t('givenNameEn')} value={form.givenNameEn} onChange={(v) => update('givenNameEn', v)} required />
          <FormInput label={t('fatherNameEn')} value={form.fatherNameEn} onChange={(v) => update('fatherNameEn', v)} required />
          <FormInput label={t('grandfatherNameEn')} value={form.grandfatherNameEn} onChange={(v) => update('grandfatherNameEn', v)} required />
          <FormInput label={t('givenNameAm')} value={form.givenNameAm} onChange={(v) => update('givenNameAm', v)} required />
          <FormInput label={t('fatherNameAm')} value={form.fatherNameAm} onChange={(v) => update('fatherNameAm', v)} required />
          <FormInput label={t('grandfatherNameAm')} value={form.grandfatherNameAm} onChange={(v) => update('grandfatherNameAm', v)} required />
          <label>{t('gender')}<select value={form.gender} onChange={(e) => update('gender', e.target.value)}>
            <option value="female">{t('female')}</option><option value="male">{t('male')}</option><option value="other">{t('other')}</option>
          </select></label>
          <FormInput label={t('dateOfBirth')} type="date" value={form.dateOfBirth} onChange={(v) => update('dateOfBirth', v)} />
          <FormInput label={t('guardianName')} value={form.guardianName} onChange={(v) => update('guardianName', v)} required />
          <FormInput label={t('guardianPhone')} value={form.guardianPhone} onChange={(v) => update('guardianPhone', v)} required />
          <FormInput label={t('guardianEmail')} type="email" value={form.guardianEmail} onChange={(v) => update('guardianEmail', v)} />
          <label>{t('grade')}<select required value={form.gradeLevelId} onChange={(e) => update('gradeLevelId', e.target.value)}>
            {school.grades.map((grade) => <option key={grade.id} value={grade.id}>
              {locale === 'am' ? grade.nameAm : grade.nameEn}
            </option>)}
          </select></label>
          <FormInput label={t('previousSchool')} value={form.previousSchool} onChange={(v) => update('previousSchool', v)} />
        </div>
        <label className="public-consent"><input type="checkbox" required />
          {t('admissionPrivacyConsent')}</label>
        <button className="button button-primary full-width" disabled={busy || !school.grades.length}>
          {busy ? t('loading') : t('submitApplication')}
        </button>
      </form>}
    </section>
  </main>;
}

export function PublicTransferPage({ t, token }: { t: T; token: string }) {
  const [packet, setPacket] = useState<Awaited<ReturnType<typeof api.studentTransferPacket>> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.studentTransferPacket(token).then(setPacket)
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [token, t]);
  const download = () => {
    if (!packet) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2)], {
      type: 'application/json'
    }));
    const link = window.document.createElement('a');
    link.href = url; link.download = 'student-transfer-packet.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <main className="login-page invitation-page">
    <section className="login-card">
      <div className="eyebrow">{t('studentTransferPacket')}</div>
      {error ? <div className="notice notice-error">{error}</div> : !packet
        ? <div className="loading-state">{t('loading')}</div> : <>
          <h2>{packet.sourceSchool} → {packet.recipientSchool}</h2>
          <p>{t('guardianConsentConfirmed')}: {packet.guardianConsent.guardianName} ·
            {' '}{packet.guardianConsent.relationship} · {packet.guardianConsent.recordedOn}</p>
          <h3>{packet.student.givenNameEn} {packet.student.fatherNameEn} {packet.student.grandfatherNameEn}</h3>
          <p>{packet.student.givenNameAm} {packet.student.fatherNameAm} {packet.student.grandfatherNameAm}</p>
          <p>{t('studentNumber')}: {packet.student.studentNo} · {t('gender')}: {t(packet.student.gender)}</p>
          <p>{t('dateOfBirth')}: {packet.student.dateOfBirth ?? '—'} · {t('previousSchool')}: {packet.student.previousSchool ?? '—'}</p>
          <div className="table-scroll"><table className="data-table"><thead><tr>
            <th>{t('academicYear')}</th><th>{t('grade')}</th><th>{t('section')}</th><th>{t('state')}</th>
          </tr></thead><tbody>{packet.academicHistory.map((entry, index) => <tr key={`${entry.academicYear}-${index}`}>
            <td>{entry.academicYear}</td><td>{entry.grade}</td><td>{entry.section}</td><td>{t(entry.outcome || entry.status)}</td>
          </tr>)}</tbody></table></div>
          <div className="form-actions"><button className="button button-primary" onClick={download}>{t('downloadTransferPacket')}</button>
            <button className="button button-secondary" onClick={() => window.print()}>{t('printTransferPacket')}</button></div>
        </>}
    </section>
  </main>;
}
