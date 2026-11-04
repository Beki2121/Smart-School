import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, FrontDeskAppointment, FrontDeskAuthorization, FrontDeskDashboard,
  FrontDeskDelivery, FrontDeskLostFound, FrontDeskMessage, FrontDeskPickupAttempt,
  FrontDeskPickupEvent, FrontDeskSettings, FrontDeskVisitor } from '../../api';

type T = (key: string) => string;
type Props = { t: T; permissions: string[] };
type Tab = 'visitors' | 'appointments' | 'messages' | 'pickups' | 'deliveries' | 'lostFound';
const PAGE_SIZE = 50;

export default function FrontDeskPage({ t, permissions }: Props) {
  const can = (permission: string) => permissions.includes(permission);
  const tabs: {
    id: Tab;
    label: string;
    permission: string;
    selfPermission?: string;
    viewPermissions?: string[];
  }[] = [
    { id: 'visitors', label: 'frontDeskVisitors', permission: 'frontdesk.visitors.view' },
    { id: 'appointments', label: 'frontDeskAppointments', permission: 'frontdesk.appointments.view',
      selfPermission: 'frontdesk.appointments.self.view' },
    { id: 'messages', label: 'frontDeskMessages', permission: 'frontdesk.messages.view',
      selfPermission: 'frontdesk.messages.self.view' },
    { id: 'pickups', label: 'frontDeskPickups', permission: 'frontdesk.pickup.log.view',
      viewPermissions: ['frontdesk.pickup.release', 'frontdesk.pickup.authorizations.view'] },
    { id: 'deliveries', label: 'frontDeskDeliveries', permission: 'frontdesk.deliveries.view' },
    { id: 'lostFound', label: 'frontDeskLostFound', permission: 'frontdesk.lost-found.view' }
  ];
  const availableTabs = tabs.filter((tab) => can(tab.permission) ||
    Boolean(tab.selfPermission && can(tab.selfPermission)) ||
    Boolean(tab.viewPermissions?.some(can)));
  const [tab, setTab] = useState<Tab>(availableTabs[0]?.id ?? 'visitors');
  const [dashboard, setDashboard] = useState<FrontDeskDashboard | null>(null);
  const [settings, setSettings] = useState<FrontDeskSettings>({
    blockAbsentPickup: false, blockReleasedToday: true, securityRoleKey: null
  });
  const [visitors, setVisitors] = useState<FrontDeskVisitor[]>([]);
  const [appointments, setAppointments] = useState<FrontDeskAppointment[]>([]);
  const [messages, setMessages] = useState<FrontDeskMessage[]>([]);
  const [authorizations, setAuthorizations] = useState<FrontDeskAuthorization[]>([]);
  const [releases, setReleases] = useState<FrontDeskPickupEvent[]>([]);
  const [attempts, setAttempts] = useState<FrontDeskPickupAttempt[]>([]);
  const [deliveries, setDeliveries] = useState<FrontDeskDelivery[]>([]);
  const [lostFound, setLostFound] = useState<FrontDeskLostFound[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState<Record<string, number>>({});
  const [visitorDraft, setVisitorDraft] = useState({ visitorName: '', purpose: '', hostStaffId: '' });
  const [appointmentDraft, setAppointmentDraft] = useState({
    parentName: '', studentId: '', staffId: '', appointmentAt: '', purpose: ''
  });
  const [messageDraft, setMessageDraft] = useState({
    senderName: '', recipientStaffId: '', subject: '', message: ''
  });
  const [authorizationDraft, setAuthorizationDraft] = useState({
    studentId: '', guardianName: '', relationship: '', phone: '', authorizationType: 'regular' as 'regular' | 'temporary',
    oneTime: false, expiresAt: ''
  });
  const [pickupDraft, setPickupDraft] = useState({
    studentId: '', personName: '', authorizationId: '', verificationNote: '', confirmOneTime: false
  });
  const [correctionReasons, setCorrectionReasons] = useState<Record<string, string>>({});
  const [deliveryDraft, setDeliveryDraft] = useState({ recipientName: '', recipientStaffId: '', description: '' });
  const [lostDraft, setLostDraft] = useState({ description: '', locationFound: '', foundAt: '' });
  const [claimNames, setClaimNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const pageFor = (key: string) => pages[key] ?? 1;
    const jobs: Promise<void>[] = [];
    if (can('frontdesk.dashboard.view')) jobs.push(api.frontDeskDashboard().then(setDashboard));
    if (can('frontdesk.settings.manage')) jobs.push(api.frontDeskSettings().then(setSettings));
    if (can('frontdesk.visitors.view')) jobs.push(api.frontDeskVisitors({
      page: pageFor('visitors'), pageSize: PAGE_SIZE
    }).then((rows) => setVisitors((current) => pageFor('visitors') === 1 ? rows : [...current, ...rows])));
    if (can('frontdesk.appointments.view') || can('frontdesk.appointments.self.view')) {
      jobs.push(api.frontDeskAppointments({ page: pageFor('appointments'), pageSize: PAGE_SIZE })
        .then((rows) => setAppointments((current) =>
          pageFor('appointments') === 1 ? rows : [...current, ...rows])));
    }
    if (can('frontdesk.messages.view') || can('frontdesk.messages.self.view')) {
      jobs.push(api.frontDeskMessages({ page: pageFor('messages'), pageSize: PAGE_SIZE })
        .then((rows) => setMessages((current) => pageFor('messages') === 1 ? rows : [...current, ...rows])));
    }
    if (can('frontdesk.pickup.authorizations.manage')) {
      jobs.push(api.frontDeskAuthorizations({ page: pageFor('authorizations'), pageSize: PAGE_SIZE })
        .then((rows) => setAuthorizations((current) =>
          pageFor('authorizations') === 1 ? rows : [...current, ...rows])));
    }
    if (can('frontdesk.pickup.log.view')) {
      jobs.push(api.frontDeskPickupReleases({ page: pageFor('releases'), pageSize: PAGE_SIZE })
        .then((rows) => setReleases((current) =>
          pageFor('releases') === 1 ? rows : [...current, ...rows])));
      jobs.push(api.frontDeskPickupAttempts({ page: pageFor('attempts'), pageSize: PAGE_SIZE })
        .then((rows) => setAttempts((current) =>
          pageFor('attempts') === 1 ? rows : [...current, ...rows])));
    }
    if (can('frontdesk.deliveries.view')) jobs.push(api.frontDeskDeliveries({
      page: pageFor('deliveries'), pageSize: PAGE_SIZE
    }).then((rows) => setDeliveries((current) => pageFor('deliveries') === 1 ? rows : [...current, ...rows])));
    if (can('frontdesk.lost-found.view')) jobs.push(api.frontDeskLostFound({
      page: pageFor('lostFound'), pageSize: PAGE_SIZE
    }).then((rows) => setLostFound((current) => pageFor('lostFound') === 1 ? rows : [...current, ...rows])));
    await Promise.all(jobs);
  }, [pages, permissions]);

  useEffect(() => {
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [load, t]);

  async function perform(action: () => Promise<unknown>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await load(); setNotice(t('frontDeskSaved')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent, action: () => Promise<unknown>) {
    event.preventDefault();
    void perform(action);
  }
  function loadMore(key: string) {
    setPages((current) => ({ ...current, [key]: (current[key] ?? 1) + 1 }));
  }
  const more = (key: string, rows: unknown[]) => rows.length === PAGE_SIZE &&
    <button className="button button-secondary" type="button" onClick={() => loadMore(key)}>
      {t('frontDeskLoadMore')}
    </button>;
  const statusButton = (label: string, action: () => Promise<unknown>) =>
    <button className="button button-secondary" type="button" disabled={busy}
      onClick={() => void perform(action)}>{label}</button>;

  function visitorForm(event: FormEvent) {
    submit(event, async () => {
      await api.createFrontDeskVisitor({
        ...visitorDraft, hostStaffId: visitorDraft.hostStaffId || null
      });
      setVisitorDraft({ visitorName: '', purpose: '', hostStaffId: '' });
      setPages((current) => ({ ...current, visitors: 1 }));
      setVisitors([]);
    });
  }
  function appointmentForm(event: FormEvent) {
    submit(event, async () => {
      await api.createFrontDeskAppointment({
        ...appointmentDraft, studentId: appointmentDraft.studentId || null
      });
      setAppointmentDraft({ parentName: '', studentId: '', staffId: '', appointmentAt: '', purpose: '' });
      setPages((current) => ({ ...current, appointments: 1 }));
      setAppointments([]);
    });
  }
  function messageForm(event: FormEvent) {
    submit(event, async () => {
      await api.createFrontDeskMessage(messageDraft);
      setMessageDraft({ senderName: '', recipientStaffId: '', subject: '', message: '' });
      setPages((current) => ({ ...current, messages: 1 }));
      setMessages([]);
    });
  }
  function authorizationForm(event: FormEvent) {
    submit(event, async () => {
      await api.createFrontDeskAuthorization({
        ...authorizationDraft, expiresAt: authorizationDraft.expiresAt || null
      });
      setAuthorizationDraft({ studentId: '', guardianName: '', relationship: '', phone: '',
        authorizationType: 'regular', oneTime: false, expiresAt: '' });
    });
  }
  function pickupForm(event: FormEvent) {
    submit(event, async () => {
      await api.releaseFrontDeskPickup({
        ...pickupDraft, occasionKey: crypto.randomUUID()
      });
      setPickupDraft({ studentId: '', personName: '', authorizationId: '',
        verificationNote: '', confirmOneTime: false });
    });
  }
  async function findPickupAuthorizations() {
    setBusy(true); setError('');
    try {
      const rows = await api.frontDeskAuthorizations({
        page: 1, pageSize: PAGE_SIZE, studentId: pickupDraft.studentId
      });
      setAuthorizations(rows);
      setPickupDraft((current) => ({ ...current, authorizationId: '' }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally {
      setBusy(false);
    }
  }

  return <div className="front-desk-page">
    <header className="page-heading">
      <div><div className="eyebrow">{t('frontDeskEyebrow')}</div><h1>{t('frontDeskTitle')}</h1>
        <p>{t('frontDeskHint')}</p></div>
      {can('frontdesk.reports.view') && <Link className="button button-secondary" to="/reports">
        {t('frontDeskReports')}
      </Link>}
    </header>
    {dashboard && <div className="metric-grid">
      <article className="metric-card"><span>{t('frontDeskVisitorsToday')}</span><strong>{dashboard.visitorsToday}</strong></article>
      <article className="metric-card"><span>{t('frontDeskAppointmentsToday')}</span><strong>{dashboard.appointmentsToday}</strong></article>
      <article className="metric-card"><span>{t('frontDeskPendingMessages')}</span><strong>{dashboard.pendingMessages}</strong></article>
    </div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    {notice && <div className="success-banner" role="status">{notice}</div>}
    {can('frontdesk.settings.manage') && <form className="panel form-grid"
      onSubmit={(event) => submit(event, () => api.updateFrontDeskSettings(settings))}>
      <h2>{t('frontDeskSafetySettings')}</h2>
      <label className="checkbox-field"><input type="checkbox" checked={settings.blockAbsentPickup}
        onChange={(event) => setSettings({ ...settings, blockAbsentPickup: event.target.checked })} />
        {t('frontDeskBlockAbsent')}</label>
      <label className="checkbox-field"><input type="checkbox" checked={settings.blockReleasedToday}
        onChange={(event) => setSettings({ ...settings, blockReleasedToday: event.target.checked })} />
        {t('frontDeskBlockSecondRelease')}</label>
      <label>{t('frontDeskSecurityRole')}<input maxLength={80}
        value={settings.securityRoleKey ?? ''}
        onChange={(event) => setSettings({ ...settings, securityRoleKey: event.target.value || null })} />
      </label>
      <button className="button button-primary" disabled={busy}>{t('frontDeskSaveSettings')}</button>
    </form>}
    <div className="tab-list" role="tablist">
      {availableTabs.map((item) => <button key={item.id} type="button" role="tab"
        aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{t(item.label)}</button>)}
    </div>
    {tab === 'visitors' && <section className="panel">
      <h2>{t('frontDeskVisitors')}</h2>
      {can('frontdesk.visitors.manage') && <form className="form-grid" onSubmit={visitorForm}>
        <label>{t('frontDeskVisitorName')}<input required maxLength={180} value={visitorDraft.visitorName}
          onChange={(event) => setVisitorDraft({ ...visitorDraft, visitorName: event.target.value })} /></label>
        <label>{t('frontDeskPurpose')}<input required maxLength={500} value={visitorDraft.purpose}
          onChange={(event) => setVisitorDraft({ ...visitorDraft, purpose: event.target.value })} /></label>
        <label>{t('frontDeskHostId')}<input value={visitorDraft.hostStaffId}
          onChange={(event) => setVisitorDraft({ ...visitorDraft, hostStaffId: event.target.value })} /></label>
        <button className="button button-primary" disabled={busy}>{t('frontDeskCheckIn')}</button>
      </form>}
      <div className="table-scroll"><table><thead><tr><th>{t('frontDeskVisitorName')}</th>
        <th>{t('frontDeskPurpose')}</th><th>{t('frontDeskCheckedIn')}</th><th>{t('status')}</th><th /></tr></thead>
        <tbody>{visitors.map((row) => <tr key={row.id}><td>{row.visitorName}</td><td>{row.purpose}</td>
          <td>{row.checkedInAt}</td><td>{t(row.status)}</td><td>{row.status === 'checked_in' &&
            can('frontdesk.visitors.manage') && statusButton(t('frontDeskCheckOut'),
              () => api.checkoutFrontDeskVisitor(row.id))}</td></tr>)}</tbody></table></div>
      {more('visitors', visitors)}
    </section>}
    {tab === 'appointments' && <section className="panel">
      <h2>{t('frontDeskAppointments')}</h2>
      {can('frontdesk.appointments.manage') && <form className="form-grid" onSubmit={appointmentForm}>
        <label>{t('frontDeskParentName')}<input required maxLength={180} value={appointmentDraft.parentName}
          onChange={(event) => setAppointmentDraft({ ...appointmentDraft, parentName: event.target.value })} /></label>
        <label>{t('frontDeskStudentId')}<input value={appointmentDraft.studentId}
          onChange={(event) => setAppointmentDraft({ ...appointmentDraft, studentId: event.target.value })} /></label>
        <label>{t('frontDeskStaffId')}<input required value={appointmentDraft.staffId}
          onChange={(event) => setAppointmentDraft({ ...appointmentDraft, staffId: event.target.value })} /></label>
        <label>{t('frontDeskAppointmentAt')}<input required type="datetime-local" value={appointmentDraft.appointmentAt}
          onChange={(event) => setAppointmentDraft({ ...appointmentDraft, appointmentAt: event.target.value })} /></label>
        <label>{t('frontDeskPurpose')}<input required maxLength={500} value={appointmentDraft.purpose}
          onChange={(event) => setAppointmentDraft({ ...appointmentDraft, purpose: event.target.value })} /></label>
        <button className="button button-primary" disabled={busy}>{t('frontDeskCreateAppointment')}</button>
      </form>}
      <div className="table-scroll"><table><thead><tr><th>{t('frontDeskParentName')}</th>
        <th>{t('frontDeskStaffId')}</th><th>{t('frontDeskAppointmentAt')}</th>
        <th>{t('frontDeskPurpose')}</th><th>{t('status')}</th><th /></tr></thead>
        <tbody>{appointments.map((row) => <tr key={row.id}><td>{row.parentName}</td><td>{row.staffId}</td>
          <td>{row.appointmentAt}</td><td>{row.purpose}</td><td>{t(row.status)}</td><td>
            {can('frontdesk.appointments.manage') && row.status === 'scheduled' &&
              statusButton(t('frontDeskConfirm'), () => api.updateFrontDeskAppointmentStatus(row.id, 'confirmed'))}
            {can('frontdesk.appointments.manage') && row.status === 'confirmed' &&
              statusButton(t('frontDeskComplete'), () => api.updateFrontDeskAppointmentStatus(row.id, 'completed'))}
          </td></tr>)}</tbody></table></div>
      {more('appointments', appointments)}
    </section>}
    {tab === 'messages' && <section className="panel">
      <h2>{t('frontDeskMessages')}</h2>
      {can('frontdesk.messages.manage') && <form className="form-grid" onSubmit={messageForm}>
        <label>{t('frontDeskSenderName')}<input required maxLength={180} value={messageDraft.senderName}
          onChange={(event) => setMessageDraft({ ...messageDraft, senderName: event.target.value })} /></label>
        <label>{t('frontDeskRecipientStaffId')}<input required value={messageDraft.recipientStaffId}
          onChange={(event) => setMessageDraft({ ...messageDraft, recipientStaffId: event.target.value })} /></label>
        <label>{t('frontDeskSubject')}<input required maxLength={180} value={messageDraft.subject}
          onChange={(event) => setMessageDraft({ ...messageDraft, subject: event.target.value })} /></label>
        <label>{t('frontDeskMessage')}<textarea required maxLength={2000} value={messageDraft.message}
          onChange={(event) => setMessageDraft({ ...messageDraft, message: event.target.value })} /></label>
        <button className="button button-primary" disabled={busy}>{t('frontDeskCreateMessage')}</button>
      </form>}
      <div className="table-scroll"><table><thead><tr><th>{t('frontDeskSenderName')}</th>
        <th>{t('frontDeskSubject')}</th><th>{t('frontDeskMessage')}</th><th>{t('status')}</th><th /></tr></thead>
        <tbody>{messages.map((row) => <tr key={row.id}><td>{row.senderName}</td><td>{row.subject}</td>
          <td>{row.message}</td><td>{t(row.status)}</td><td>
            {can('frontdesk.messages.manage') && row.status === 'new' &&
              statusButton(t('frontDeskMarkRead'), () => api.updateFrontDeskMessageStatus(row.id, 'read'))}
            {can('frontdesk.messages.manage') && row.status === 'read' &&
              statusButton(t('frontDeskResolve'), () => api.updateFrontDeskMessageStatus(row.id, 'resolved'))}
          </td></tr>)}</tbody></table></div>
      {more('messages', messages)}
    </section>}
    {tab === 'pickups' && <section className="panel">
      <h2>{t('frontDeskPickups')}</h2>
      {can('frontdesk.pickup.authorizations.manage') && <form className="form-grid" onSubmit={authorizationForm}>
        <label>{t('frontDeskStudentId')}<input required value={authorizationDraft.studentId}
          onChange={(event) => setAuthorizationDraft({ ...authorizationDraft, studentId: event.target.value })} /></label>
        <label>{t('frontDeskGuardianName')}<input required maxLength={180} value={authorizationDraft.guardianName}
          onChange={(event) => setAuthorizationDraft({ ...authorizationDraft, guardianName: event.target.value })} /></label>
        <label>{t('frontDeskRelationship')}<input required maxLength={80} value={authorizationDraft.relationship}
          onChange={(event) => setAuthorizationDraft({ ...authorizationDraft, relationship: event.target.value })} /></label>
        <label>{t('frontDeskPhone')}<input maxLength={40} value={authorizationDraft.phone}
          onChange={(event) => setAuthorizationDraft({ ...authorizationDraft, phone: event.target.value })} /></label>
        <label>{t('frontDeskAuthorizationType')}<select value={authorizationDraft.authorizationType}
          onChange={(event) => setAuthorizationDraft({ ...authorizationDraft,
            authorizationType: event.target.value as 'regular' | 'temporary' })}>
          <option value="regular">{t('frontDeskRegular')}</option><option value="temporary">{t('frontDeskTemporary')}</option>
        </select></label>
        {authorizationDraft.authorizationType === 'temporary' && <label>{t('frontDeskExpiry')}
          <input required type="datetime-local" value={authorizationDraft.expiresAt}
            onChange={(event) => setAuthorizationDraft({ ...authorizationDraft, expiresAt: event.target.value })} />
        </label>}
        <label className="checkbox-field"><input type="checkbox" checked={authorizationDraft.oneTime}
          onChange={(event) => setAuthorizationDraft({ ...authorizationDraft, oneTime: event.target.checked })} />
          {t('frontDeskOneTime')}</label>
        <button className="button button-primary" disabled={busy}>{t('frontDeskAddAuthorization')}</button>
      </form>}
      {can('frontdesk.pickup.release') && <form className="form-grid" onSubmit={pickupForm}>
        <h3>{t('frontDeskVerifyPickup')}</h3>
        <label>{t('frontDeskStudentId')}<input required value={pickupDraft.studentId}
          onChange={(event) => {
            setAuthorizations([]);
            setPickupDraft({ ...pickupDraft, studentId: event.target.value, authorizationId: '' });
          }} /></label>
        {(can('frontdesk.pickup.authorizations.view') || can('frontdesk.pickup.authorizations.manage')) &&
          <button type="button" className="button button-secondary" disabled={busy || !pickupDraft.studentId}
            onClick={() => void findPickupAuthorizations()}>{t('frontDeskFindGuardians')}</button>}
        <label>{t('frontDeskCollector')}<input required maxLength={180} value={pickupDraft.personName}
          onChange={(event) => setPickupDraft({ ...pickupDraft, personName: event.target.value })} /></label>
        <label>{t('frontDeskAuthorization')}<select required value={pickupDraft.authorizationId}
          onChange={(event) => setPickupDraft({ ...pickupDraft, authorizationId: event.target.value })}>
          <option value="">{t('frontDeskSelectAuthorization')}</option>
          {authorizations.filter((row) => row.status === 'active').map((row) =>
            <option key={row.id} value={row.id}>{row.studentId} — {row.guardianName}</option>)}
        </select></label>
        <label>{t('frontDeskVerificationNote')}<input maxLength={200} value={pickupDraft.verificationNote}
          onChange={(event) => setPickupDraft({ ...pickupDraft, verificationNote: event.target.value })} />
          <small>{t('frontDeskNoIdNumbers')}</small></label>
        <label className="checkbox-field"><input type="checkbox" checked={pickupDraft.confirmOneTime}
          onChange={(event) => setPickupDraft({ ...pickupDraft, confirmOneTime: event.target.checked })} />
          {t('frontDeskConfirmOneTime')}</label>
        <button className="button button-primary" disabled={busy}>{t('frontDeskRelease')}</button>
      </form>}
      {can('frontdesk.pickup.authorizations.manage') && <div className="table-scroll">
        <h3>{t('frontDeskAuthorizations')}</h3><table><thead><tr><th>{t('frontDeskStudentId')}</th>
          <th>{t('frontDeskGuardianName')}</th><th>{t('frontDeskRelationship')}</th>
          <th>{t('status')}</th><th /></tr></thead><tbody>
          {authorizations.map((row) => <tr key={row.id}><td>{row.studentId}</td><td>{row.guardianName}</td>
            <td>{row.relationship}</td><td>{t(row.status)}</td><td>{row.status === 'active' &&
              statusButton(t('frontDeskRemoveAuthorization'),
                () => api.updateFrontDeskAuthorizationStatus(row.id, 'removed'))}</td></tr>)}
        </tbody></table></div>}
      {can('frontdesk.pickup.authorizations.manage') && more('authorizations', authorizations)}
      <div className="table-scroll"><h3>{t('frontDeskReleaseLog')}</h3><table><thead><tr>
        <th>{t('frontDeskStudentId')}</th><th>{t('frontDeskCollector')}</th><th>{t('frontDeskReleasedAt')}</th>
        <th>{t('frontDeskVerificationNote')}</th><th /></tr></thead><tbody>
        {releases.map((row) => <tr key={row.id}><td>{row.studentId}</td><td>{row.pickedUpBy}</td>
          <td>{row.releasedAt}</td><td>{row.note}</td><td>{can('frontdesk.pickup.authorizations.manage') &&
            row.eventType === 'release' && <form onSubmit={(event) => submit(event, () =>
              api.correctFrontDeskPickup(row.id, { reason: correctionReasons[row.id] ?? '' }))}>
              <input required maxLength={500} aria-label={t('frontDeskCorrectionReason')}
                value={correctionReasons[row.id] ?? ''} onChange={(event) => setCorrectionReasons({
                  ...correctionReasons, [row.id]: event.target.value
                })} />
              <button className="button button-secondary">{t('frontDeskCorrect')}</button>
            </form>}</td></tr>)}</tbody></table></div>
      {attempts.length > 0 && <div className="table-scroll"><h3>{t('frontDeskRefusedAttempts')}</h3>
        <table><thead><tr><th>{t('frontDeskStudentId')}</th><th>{t('frontDeskCollector')}</th>
          <th>{t('frontDeskRefusalReason')}</th><th>{t('frontDeskReleasedAt')}</th></tr></thead>
          <tbody>{attempts.map((row) => <tr key={row.id}><td>{row.studentId}</td><td>{row.personName}</td>
            <td>{row.reason}</td><td>{row.attemptedAt}</td></tr>)}</tbody></table></div>}
      {more('releases', releases)}
      {more('attempts', attempts)}
    </section>}
    {tab === 'deliveries' && <section className="panel">
      <h2>{t('frontDeskDeliveries')}</h2>
      {can('frontdesk.deliveries.manage') && <form className="form-grid" onSubmit={(event) => submit(event, async () => {
        await api.createFrontDeskDelivery({ ...deliveryDraft, recipientStaffId: deliveryDraft.recipientStaffId || null });
        setDeliveryDraft({ recipientName: '', recipientStaffId: '', description: '' });
        setPages((current) => ({ ...current, deliveries: 1 })); setDeliveries([]);
      })}>
        <label>{t('frontDeskRecipientName')}<input required value={deliveryDraft.recipientName}
          onChange={(event) => setDeliveryDraft({ ...deliveryDraft, recipientName: event.target.value })} /></label>
        <label>{t('frontDeskStaffId')}<input value={deliveryDraft.recipientStaffId}
          onChange={(event) => setDeliveryDraft({ ...deliveryDraft, recipientStaffId: event.target.value })} /></label>
        <label>{t('frontDeskDescription')}<input required value={deliveryDraft.description}
          onChange={(event) => setDeliveryDraft({ ...deliveryDraft, description: event.target.value })} /></label>
        <button className="button button-primary">{t('frontDeskRecordDelivery')}</button>
      </form>}
      <ul>{deliveries.map((row) => <li key={row.id}>{row.recipientName} — {row.description} ({t(row.status)})
        {row.status === 'received' && can('frontdesk.deliveries.manage') &&
          statusButton(t('frontDeskMarkCollected'), () => api.updateFrontDeskDeliveryStatus(row.id, 'collected'))}
        {row.status === 'received' && can('frontdesk.deliveries.manage') &&
          statusButton(t('frontDeskMarkReturned'), () => api.updateFrontDeskDeliveryStatus(row.id, 'returned'))}
      </li>)}</ul>{more('deliveries', deliveries)}
    </section>}
    {tab === 'lostFound' && <section className="panel">
      <h2>{t('frontDeskLostFound')}</h2>
      {can('frontdesk.lost-found.manage') && <form className="form-grid" onSubmit={(event) => submit(event, async () => {
        await api.createFrontDeskLostFound(lostDraft);
        setLostDraft({ description: '', locationFound: '', foundAt: '' });
        setPages((current) => ({ ...current, lostFound: 1 })); setLostFound([]);
      })}>
        <label>{t('frontDeskDescription')}<input required value={lostDraft.description}
          onChange={(event) => setLostDraft({ ...lostDraft, description: event.target.value })} /></label>
        <label>{t('frontDeskLocationFound')}<input required value={lostDraft.locationFound}
          onChange={(event) => setLostDraft({ ...lostDraft, locationFound: event.target.value })} /></label>
        <label>{t('frontDeskFoundAt')}<input required type="datetime-local" value={lostDraft.foundAt}
          onChange={(event) => setLostDraft({ ...lostDraft, foundAt: event.target.value })} /></label>
        <button className="button button-primary">{t('frontDeskRecordFoundItem')}</button>
      </form>}
      <ul>{lostFound.map((row) => <li key={row.id}>{row.description} — {row.locationFound} ({t(row.status)})
        {row.status === 'unclaimed' && can('frontdesk.lost-found.manage') && <form
          onSubmit={(event) => submit(event, () => api.updateFrontDeskLostFoundStatus(row.id, {
            status: 'claimed', claimedBy: claimNames[row.id] ?? ''
          }))}>
          <label>{t('frontDeskClaimant')}<input required maxLength={180}
            value={claimNames[row.id] ?? ''} onChange={(event) => setClaimNames({
              ...claimNames, [row.id]: event.target.value
            })} /></label>
          <button className="button button-secondary" disabled={busy}>{t('frontDeskMarkClaimed')}</button>
        </form>}
        {row.status === 'unclaimed' && can('frontdesk.lost-found.manage') &&
          statusButton(t('frontDeskMarkDisposed'), () =>
            api.updateFrontDeskLostFoundStatus(row.id, { status: 'disposed' }))}
      </li>)}</ul>{more('lostFound', lostFound)}
    </section>}
  </div>;
}
