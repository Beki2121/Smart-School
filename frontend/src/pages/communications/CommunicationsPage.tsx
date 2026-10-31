import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, CampusAnnouncement, CampusEvent } from '../../api';
import { Locale } from '../../i18n';
import FormInput from '../../components/FormInput';
import { dateAfter, localDateInput } from '../../utils/dates';

type T = (key: string) => string;
export default function CommunicationsPage({ t, locale, canManage }: {
  t: T; locale: Locale; canManage: boolean
}) {
  const today = localDateInput();
  const [announcements, setAnnouncements] = useState<CampusAnnouncement[]>([]);
  const [events, setEvents] = useState<CampusEvent[]>([]);
  const [announcementForm, setAnnouncementForm] = useState({
    titleEn: '', titleAm: '', bodyEn: '', bodyAm: ''
  });
  const [eventForm, setEventForm] = useState({
    titleEn: '', titleAm: '', descriptionEn: '', descriptionAm: '',
    startsOn: today, endsOn: today, startsAt: '', endsAt: '', location: ''
  });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [announcementRows, eventRows] = await Promise.all([
      api.campusAnnouncements(), api.campusEvents(today, dateAfter(today, 365))
    ]);
    setAnnouncements(announcementRows);
    setEvents(eventRows);
  }, [today]);
  useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')))
      .finally(() => setLoading(false));
  }, [load, t]);
  const publishAnnouncement = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api.createCampusAnnouncement(announcementForm);
      setAnnouncementForm({ titleEn: '', titleAm: '', bodyEn: '', bodyAm: '' });
      setNotice(t('announcementPublished')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const createEvent = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api.createCampusEvent({
        ...eventForm, startsAt: eventForm.startsAt || null, endsAt: eventForm.endsAt || null
      });
      setEventForm({
        titleEn: '', titleAm: '', descriptionEn: '', descriptionAm: '',
        startsOn: today, endsOn: today, startsAt: '', endsAt: '', location: ''
      });
      setNotice(t('eventCreated')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const localized = (en: string, am: string) => locale === 'am' ? am : en;
  const dateLabel = (start: string, end: string) => start === end ? start : `${start} – ${end}`;

  return <>
    <div className="page-heading compact-heading"><div><div className="eyebrow">{t('releaseOne')}</div><h1>{t('communications')}</h1><p>{t('communicationsHint')}</p></div><span className="state-tag">{t('inAppOnly')}</span></div>
    {notice && <div className="notice notice-success">{notice}</div>}
    {error && <div className="notice notice-error">{error}</div>}
    <div className="marks-integrity fee-scope-notice">ⓘ {t('communicationsDeliveryNotice')}</div>
    {loading ? <div className="loading-state">{t('loading')}</div> : <>
      {canManage && <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>{t('publishAnnouncement')}</h2><p>{t('announcementHint')}</p></div></div>
        <form className="setup-form communication-form" onSubmit={(event) => void publishAnnouncement(event)}>
          <div className="form-grid">
            <FormInput label={t('announcementTitleEn')} value={announcementForm.titleEn} onChange={(titleEn) => setAnnouncementForm((current) => ({ ...current, titleEn }))} required />
            <FormInput label={t('announcementTitleAm')} value={announcementForm.titleAm} onChange={(titleAm) => setAnnouncementForm((current) => ({ ...current, titleAm }))} required />
          </div>
          <div className="form-grid">
            <label>{t('announcementBodyEn')}<textarea rows={4} value={announcementForm.bodyEn} onChange={(event) => setAnnouncementForm((current) => ({ ...current, bodyEn: event.target.value }))} required /></label>
            <label>{t('announcementBodyAm')}<textarea rows={4} value={announcementForm.bodyAm} onChange={(event) => setAnnouncementForm((current) => ({ ...current, bodyAm: event.target.value }))} required /></label>
          </div>
          <div className="form-actions"><button className="button button-primary" disabled={busy}>{t('publishAnnouncement')}</button></div>
        </form>
      </section>}
      <section className="panel history-panel">
        <div className="panel-heading"><div><h2>{t('announcements')}</h2><p>{announcements.length} {t('records')}</p></div></div>
        {announcements.length ? announcements.map((item) => <article className="communication-item" key={item.id}>
          <div className="communication-date">{new Date(item.publishedAt).toLocaleDateString(locale === 'am' ? 'am-ET' : 'en-ET')}</div>
          <div><h3>{localized(item.titleEn, item.titleAm)}</h3><p>{localized(item.bodyEn, item.bodyAm)}</p></div>
        </article>) : <div className="empty-state">{t('noAnnouncements')}</div>}
      </section>
      {canManage && <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>{t('addSchoolEvent')}</h2><p>{t('eventHint')}</p></div></div>
        <form className="setup-form communication-form" onSubmit={(event) => void createEvent(event)}>
          <div className="form-grid">
            <FormInput label={t('eventTitleEn')} value={eventForm.titleEn} onChange={(titleEn) => setEventForm((current) => ({ ...current, titleEn }))} required />
            <FormInput label={t('eventTitleAm')} value={eventForm.titleAm} onChange={(titleAm) => setEventForm((current) => ({ ...current, titleAm }))} required />
            <FormInput label={t('startDate')} type="date" value={eventForm.startsOn} onChange={(startsOn) => setEventForm((current) => ({ ...current, startsOn, endsOn: current.endsOn < startsOn ? startsOn : current.endsOn }))} required />
            <FormInput label={t('endDate')} type="date" value={eventForm.endsOn} onChange={(endsOn) => setEventForm((current) => ({ ...current, endsOn }))} required />
            <FormInput label={t('startsAt')} type="time" value={eventForm.startsAt} onChange={(startsAt) => setEventForm((current) => ({ ...current, startsAt }))} />
            <FormInput label={t('endsAt')} type="time" value={eventForm.endsAt} onChange={(endsAt) => setEventForm((current) => ({ ...current, endsAt }))} />
            <FormInput label={t('eventLocation')} value={eventForm.location} onChange={(location) => setEventForm((current) => ({ ...current, location }))} />
          </div>
          <div className="form-grid">
            <label>{t('eventDescriptionEn')}<textarea rows={3} value={eventForm.descriptionEn} onChange={(event) => setEventForm((current) => ({ ...current, descriptionEn: event.target.value }))} /></label>
            <label>{t('eventDescriptionAm')}<textarea rows={3} value={eventForm.descriptionAm} onChange={(event) => setEventForm((current) => ({ ...current, descriptionAm: event.target.value }))} /></label>
          </div>
          <div className="form-actions"><button className="button button-primary" disabled={busy}>{t('addSchoolEvent')}</button></div>
        </form>
      </section>}
      <section className="panel history-panel">
        <div className="panel-heading"><div><h2>{t('schoolEvents')}</h2><p>{events.length} {t('records')}</p></div></div>
        {events.length ? events.map((item) => <article className="communication-item" key={item.id}>
          <div className="communication-date">{dateLabel(item.startsOn, item.endsOn)}{item.startsAt && <small>{item.startsAt}{item.endsAt ? ` – ${item.endsAt}` : ''}</small>}</div>
          <div><h3>{localized(item.titleEn, item.titleAm)}</h3>{item.location && <small>{item.location}</small>}
            {(item.descriptionEn || item.descriptionAm) && <p>{localized(item.descriptionEn, item.descriptionAm)}</p>}</div>
        </article>) : <div className="empty-state">{t('noEvents')}</div>}
      </section>
    </>}
  </>;
}

