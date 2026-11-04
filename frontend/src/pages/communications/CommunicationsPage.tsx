import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, CampusAnnouncement, CampusEvent, PortalMessageThread, PortalRequest } from '../../api';
import { Locale } from '../../i18n';
import FormInput from '../../components/FormInput';
import { dateAfter, localDateInput } from '../../utils/dates';

type T = (key: string) => string;
export default function CommunicationsPage({ t, locale, canManage, canMessage = false,
  canConfigureMessaging = false, canHandleRequests = canManage }: {
  t: T; locale: Locale; canManage: boolean; canMessage?: boolean; canConfigureMessaging?: boolean
  canHandleRequests?: boolean
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
  const [threads, setThreads] = useState<PortalMessageThread[]>([]);
  const [requests, setRequests] = useState<PortalRequest[]>([]);
  const [supportRequests, setSupportRequests] = useState<PortalRequest[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [messagingEnabled, setMessagingEnabled] = useState(true);

  const load = useCallback(async () => {
    const [announcementRows, eventRows] = await Promise.all([
      api.campusAnnouncements(), api.campusEvents(today, dateAfter(today, 365))
    ]);
    setAnnouncements(announcementRows);
    setEvents(eventRows);
  }, [today]);
  useEffect(() => {
    const loadPage = async () => {
      await load();
      if (canMessage) setThreads(await api.portalMessageThreads());
      if (canHandleRequests) {
        setRequests(await api.portalRequests());
        setSupportRequests(await api.portalSupportRequests());
      }
      if (canConfigureMessaging) {
        setMessagingEnabled((await api.portalMessagingSettings()).messagingEnabled);
      }
    };
    loadPage().catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')))
      .finally(() => setLoading(false));
  }, [load, t, canHandleRequests, canMessage, canConfigureMessaging]);
  const updateRequest = async (item: PortalRequest, status: string) => {
    setError(''); setNotice('');
    try {
      await api.updatePortalRequest(item.id, { status, response: item.response ?? '' });
      setRequests(await api.portalRequests());
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const updateSupport = async (item: PortalRequest, status: string) => {
    setError(''); setNotice('');
    try {
      await api.updatePortalSupportRequest(item.id, { status, response: item.response ?? '' });
      setSupportRequests(await api.portalSupportRequests());
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const sendReply = async (threadId: string) => {
    setError('');
    try {
      await api.sendPortalThreadMessage(threadId, replyDrafts[threadId] ?? '');
      setReplyDrafts((current) => ({ ...current, [threadId]: '' }));
      setThreads(await api.portalMessageThreads());
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const toggleMessaging = async () => {
    setError('');
    try {
      const result = await api.setPortalMessagingEnabled(!messagingEnabled);
      setMessagingEnabled(result.messagingEnabled);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  };
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
      {canConfigureMessaging && <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>{t('parentTeacherMessages')}</h2>
          <p>{t('messagingAvailabilityNotice')}</p></div></div>
        <button className="button button-quiet" onClick={() => void toggleMessaging()}>
          {messagingEnabled ? t('disableMessaging') : t('enableMessaging')}
        </button>
      </section>}
      <section className="panel history-panel">
        <div className="panel-heading"><div><h2>{t('announcements')}</h2><p>{announcements.length} {t('records')}</p></div></div>
        {announcements.length ? announcements.map((item) => <article className="communication-item" key={item.id}>
          <div className="communication-date">{new Date(item.publishedAt).toLocaleDateString(locale === 'am' ? 'am-ET' : 'en-ET')}</div>
          <div><h3>{localized(item.titleEn, item.titleAm)}</h3><p>{localized(item.bodyEn, item.bodyAm)}</p></div>
        </article>) : <div className="empty-state">{t('noAnnouncements')}</div>}
      </section>
      {canManage && <section className="panel history-panel">
        <div className="panel-heading"><div><h2>{t('schoolRequests')}</h2></div></div>
        {requests.map((item) => <article className="communication-item" key={item.id}>
          <div><h3>{item.subject}</h3><p>{item.details}</p><small>{item.status}</small></div>
          {item.status === 'pending' && <div>
            <button className="button button-quiet" onClick={() => void updateRequest(item, 'approved')}>{t('approveRequest')}</button>
            <button className="button button-quiet" onClick={() => void updateRequest(item, 'rejected')}>{t('rejectRequest')}</button>
          </div>}
          {item.status === 'approved' && <button className="button button-quiet"
            onClick={() => void updateRequest(item, 'completed')}>{t('completeRequest')}</button>}
        </article>)}
      </section>}
      {canManage && <section className="panel history-panel">
        <div className="panel-heading"><div><h2>{t('studentSupport')}</h2></div></div>
        {supportRequests.map((item) => <article className="communication-item" key={item.id}>
          <div><h3>{item.subject}</h3><p>{item.details}</p><small>{item.status}</small></div>
          {item.status === 'open' && <button className="button button-quiet"
            onClick={() => void updateSupport(item, 'in_progress')}>{t('startHandlingRequest')}</button>}
          {item.status !== 'closed' && <button className="button button-quiet"
            onClick={() => void updateSupport(item, 'resolved')}>{t('resolveRequest')}</button>}
        </article>)}
      </section>}
      {canMessage && <section className="panel history-panel">
        <div className="panel-heading"><div><h2>{t('parentTeacherMessages')}</h2></div></div>
        {threads.map((thread) => <article className="communication-item" key={thread.id}>
          <div><h3>{thread.participants.map((participant) => participant.name).join(', ')}</h3>
            {thread.messages.map((message) => <p key={message.id}>{message.body}</p>)}
            <textarea aria-label={t('replyMessage')} value={replyDrafts[thread.id] ?? ''}
              onChange={(event) => setReplyDrafts((current) => ({ ...current, [thread.id]: event.target.value }))} />
            <button className="button button-quiet" onClick={() => void sendReply(thread.id)}>{t('sendMessage')}</button>
          </div>
        </article>)}
      </section>}
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
