import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { api, PlatformMonitoring, SupportTicket } from '../../api';

type T = (key: string) => string;
type Mode = 'customer' | 'internal' | 'platform';
type Props = { t: T; permissions: string[]; userId: string };
const modes: Mode[] = ['customer', 'internal', 'platform'];

export default function SupportPage({ t, permissions, userId }: Props) {
  const can = (permission: string) => permissions.includes(permission);
  const allowedModes = modes.filter((mode) => mode === 'customer'
    ? can('support.tickets.view')
    : mode === 'internal' ? can('support.internal.view') : can('support.platform.view'));
  const [mode, setMode] = useState<Mode>(allowedModes[0] ?? 'customer');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [monitoring, setMonitoring] = useState<PlatformMonitoring | null>(null);
  const [backupHistory, setBackupHistory] = useState<Awaited<ReturnType<typeof api.platformBackupHistory>>>([]);
  const [filters, setFilters] = useState({ search: '', status: '', priority: '' });
  const [page, setPage] = useState(1);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [recipient, setRecipient] = useState('');
  const [draft, setDraft] = useState<{
    subject: string; category: string; priority: SupportTicket['priority']
  }>({ subject: '', category: 'technical', priority: 'normal' });
  const [comment, setComment] = useState('');
  const [internalComment, setInternalComment] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadTickets = useCallback(async () => {
    if (!allowedModes.includes(mode)) return;
    setTickets(await api.supportTickets(mode, { ...filters, page, pageSize: 50 }));
  }, [mode, permissions, filters, page]);
  const loadMonitoring = useCallback(async () => {
    if (!can('platform.monitor.view')) return;
    const snapshot = await api.platformMonitoring();
    setMonitoring(snapshot);
  }, [permissions]);

  useEffect(() => {
    setError('');
    void loadTickets().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [loadTickets, t]);
  useEffect(() => {
    if (!can('integrations.email.view')) return;
    void api.emailIntegrationStatus().then((result) => setEmailConfigured(result.configured))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [permissions, t]);
  useEffect(() => {
    void loadMonitoring().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [loadMonitoring]);
  useEffect(() => {
    if (!can('platform.backups.view')) return;
    void api.platformBackupHistory().then(setBackupHistory)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [permissions, t]);

  async function run(action: () => Promise<unknown>, success = t('supportSaved')) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await loadTickets(); setNotice(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  }
  async function selectTicket(ticket: SupportTicket) {
    setError('');
    try { setSelected(await api.getSupportTicket(mode, ticket.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  }
  function fileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = [...(event.target.files ?? [])];
    if (selectedFiles.some((file) => file.size > 5 * 1024 * 1024)) {
      setError(t('supportAttachmentLimit')); event.target.value = ''; return;
    }
    setFiles(selectedFiles);
  }
  async function createTicket(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (mode === 'platform') throw new Error(t('apiError'));
      const ticket = await api.createSupportTicket(mode, draft);
      for (const file of files) await api.uploadSupportAttachment(mode, ticket.id, file);
      setDraft({ subject: '', category: 'technical', priority: 'normal' });
      setFiles([]);
      setSelected(await api.getSupportTicket(mode, ticket.id));
    }, t('supportCreated'));
  }
  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    await run(async () => {
      await api.commentSupportTicket(mode, selected.id, {
        body: comment, isInternal: mode === 'platform' && internalComment
      });
      setComment('');
      setSelected(await api.getSupportTicket(mode, selected.id));
    });
  }
  async function addFiles() {
    if (!selected) return;
    await run(async () => {
      for (const file of files) await api.uploadSupportAttachment(mode, selected.id, file);
      setFiles([]);
      setSelected(await api.getSupportTicket(mode, selected.id));
    });
  }
  async function download(id: string) {
    try {
      const blob = await api.downloadSupportAttachment(mode, id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = selected?.attachments?.find((item) => item.id === id)?.originalName ?? 'attachment';
      link.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  }
  async function sendTest(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.sendIntegrationTestEmail(recipient);
      setRecipient('');
    }, t('integrationTestSent'));
  }
  const platformMode = mode === 'platform';
  const canCreate = mode === 'internal' ? can('support.internal.manage')
    : mode === 'customer' && can('support.tickets.create');
  const canUpdate = platformMode ? can('support.platform.manage')
    : mode === 'internal' && can('support.internal.manage');
  const canComment = canUpdate || mode === 'customer' && can('support.tickets.view');
  const canUpload = canUpdate || mode === 'customer' && can('support.tickets.create');

  return <div className="page-stack">
    <header className="page-heading"><div><div className="eyebrow">{t('supportEyebrow')}</div>
      <h1>{t('supportTitle')}</h1><p>{t('supportHint')}</p></div></header>
    {error && <div className="form-error" role="alert">{error}</div>}
    {notice && <div className="success-banner" role="status">{notice}</div>}
    {allowedModes.length > 1 && <div className="tab-list" role="tablist">
      {allowedModes.map((item) => <button key={item} type="button" role="tab"
        aria-selected={mode === item} onClick={() => { setMode(item); setSelected(null); }}>
        {t(`supportMode_${item}`)}</button>)}
    </div>}
    {canCreate && <form className="panel form-grid" onSubmit={(event) => void createTicket(event)}>
      <h2>{t('supportNewTicket')}</h2>
      <label>{t('supportSubject')}<input required maxLength={180} minLength={3}
        value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></label>
      <label>{t('supportCategory')}<select value={draft.category}
        onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
        {['technical', 'account', 'billing', 'security', 'other'].map((value) =>
          <option value={value} key={value}>{t(`supportCategory_${value}`)}</option>)}
      </select></label>
      <label>{t('supportPriority')}<select value={draft.priority}
        onChange={(event) => setDraft({ ...draft, priority: event.target.value as typeof draft.priority })}>
        {['low', 'normal', 'high', 'urgent'].map((value) =>
          <option value={value} key={value}>{t(`supportPriority_${value}`)}</option>)}
      </select></label>
      <label>{t('supportAttachments')}<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.txt"
        onChange={fileChange} /></label>
      <button className="button button-primary" disabled={busy}>{t('supportCreate')}</button>
    </form>}
    <section className="panel">
      <h2>{t(`supportMode_${mode}`)}</h2>
      <div className="inline-form">
        <label>{t('supportSearch')}<input type="search" value={filters.search}
          onChange={(event) => { setFilters({ ...filters, search: event.target.value }); setPage(1); }} /></label>
        <label>{t('supportStatus')}<select value={filters.status}
          onChange={(event) => { setFilters({ ...filters, status: event.target.value }); setPage(1); }}>
          <option value="">{t('allStatuses')}</option>
          {['open', 'in_progress', 'waiting_school', 'resolved'].map((value) =>
            <option value={value} key={value}>{t(`supportStatus_${value}`)}</option>)}
        </select></label>
        <label>{t('supportPriority')}<select value={filters.priority}
          onChange={(event) => { setFilters({ ...filters, priority: event.target.value }); setPage(1); }}>
          <option value="">{t('allPriorities')}</option>
          {['low', 'normal', 'high', 'urgent'].map((value) =>
            <option value={value} key={value}>{t(`supportPriority_${value}`)}</option>)}
        </select></label>
      </div>
      <div className="table-wrap"><table><thead><tr>
        <th>{t('supportSubject')}</th><th>{t('supportCategory')}</th><th>{t('supportPriority')}</th>
        <th>{t('status')}</th><th>{t('supportUpdated')}</th>
      </tr></thead><tbody>{tickets.map((ticket) => <tr key={ticket.id}>
        <td><button className="button-link" type="button" onClick={() => void selectTicket(ticket)}>
          {ticket.subject}</button></td><td>{t(`supportCategory_${ticket.category}`)}</td>
        <td>{t(`supportPriority_${ticket.priority}`)}</td><td>{t(`supportStatus_${ticket.status}`)}</td>
        <td>{ticket.updatedAt}</td></tr>)}
        {!tickets.length && <tr><td colSpan={5}>{t('supportNoTickets')}</td></tr>}
      </tbody></table></div>
      <div className="inline-form">
        <button className="button button-quiet" disabled={page === 1}
          onClick={() => setPage((value) => Math.max(1, value - 1))}>{t('previous')}</button>
        <span>{t('page')} {page}</span>
        <button className="button button-quiet" disabled={tickets.length < 50}
          onClick={() => setPage((value) => value + 1)}>{t('next')}</button>
      </div>
    </section>
    {selected && <section className="panel">
      <h2>{selected.subject}</h2><p>{t(`supportStatus_${selected.status}`)} · {t(`supportPriority_${selected.priority}`)}</p>
      {canUpdate && <div className="inline-form">
        <label>{t('supportStatus')}<select aria-label={t('supportStatus')} value={selected.status}
          onChange={(event) => {
            const status = event.target.value as SupportTicket['status'];
            void run(async () => {
              await api.updateSupportTicket(mode as 'internal' | 'platform', selected.id, {
                status, ...(platformMode ? { assignedTo: userId } : {})
              });
              setSelected(await api.getSupportTicket(mode, selected.id));
            });
          }}>
          {['open', 'in_progress', 'waiting_school', 'resolved'].map((value) =>
            <option value={value} key={value}>{t(`supportStatus_${value}`)}</option>)}
        </select></label>
        {platformMode && <button className="button button-secondary" disabled={busy}
          onClick={() => void run(async () => {
            await api.updateSupportTicket('platform', selected.id, { assignedTo: userId });
            setSelected(await api.getSupportTicket(mode, selected.id));
          })}>{t('supportAssignToMe')}</button>}
      </div>}
      <h3>{t('supportComments')}</h3>
      <ul>{selected.comments?.map((item) => <li key={item.id}>
        <p>{item.body}</p><small>{item.createdAt}{item.isInternal ? ` · ${t('supportInternalNote')}` : ''}</small>
      </li>)}</ul>
      {canComment && <form className="form-grid" onSubmit={(event) => void addComment(event)}>
        <label>{t('supportComment')}<textarea required maxLength={4000} value={comment}
          onChange={(event) => setComment(event.target.value)} /></label>
        {platformMode && <label className="checkbox-field"><input type="checkbox" checked={internalComment}
          onChange={(event) => setInternalComment(event.target.checked)} />{t('supportInternalNote')}</label>}
        <button className="button button-secondary" disabled={busy || !comment.trim()}>{t('supportAddComment')}</button>
      </form>}
      <h3>{t('supportAttachments')}</h3><ul>{selected.attachments?.map((item) => <li key={item.id}>
        <button className="button-link" type="button" onClick={() => void download(item.id)}>
          {item.originalName}</button> ({item.sizeBytes} B)
      </li>)}</ul>
      {canUpload && <div className="inline-form"><input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.txt"
        onChange={fileChange} /><button className="button button-secondary" disabled={busy || !files.length}
        onClick={() => void addFiles()}>{t('supportUpload')}</button></div>}
    </section>}
    {can('integrations.email.view') && <section className="panel">
      <h2>{t('integrationEmail')}</h2><p>{t('integrationEmailStatus')}: {
        emailConfigured ? t('configured') : t('notConfigured')}</p>
      {can('integrations.email.test') && <form className="inline-form" onSubmit={(event) => void sendTest(event)}>
        <label>{t('integrationTestRecipient')}<input type="email" required maxLength={254}
          value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label>
        <button className="button button-secondary" disabled={busy || !emailConfigured}>{t('integrationSendTest')}</button>
      </form>}
      <p>{t('integrationSecretsNote')}</p>
    </section>}
    {can('platform.monitor.view') && <section className="panel">
      <h2>{t('platformMonitoring')}</h2>
      {!monitoring ? <p>{t('platformMonitoringUnavailable')}</p> : <>
        <p>{t('platformApiStatus')}: {monitoring.api} · {t('platformDatabaseStatus')}: {
          monitoring.database.reachable ? t('configured') : t('notConfigured')}</p>
        <p>{t('platformRuntimeErrors')}: {monitoring.runtime.serverErrorCount} / {
          monitoring.runtime.requestCount}</p>
        <h3>{t('platformBackgroundJobs')}</h3><ul>{monitoring.runtime.backgroundJobs.map((job) =>
          <li key={job.name}>{job.name}: {job.status} ({job.lastSucceededAt ?? t('notAvailable')})</li>)}</ul>
        <h3>{t('platformStorageBySchool')}</h3><ul>{monitoring.storageBySchool.map((school) =>
          <li key={school.id}>{school.name}: {Math.round(school.usedBytes / 1024)} KB</li>)}</ul>
        <h3>{t('platformBackupStatus')}</h3><p>{monitoring.backupLatest
          ? `${monitoring.backupLatest.status} · ${monitoring.backupLatest.completedAt ?? monitoring.backupLatest.startedAt}`
          : t('platformNoBackupYet')}</p>
        <h3>{t('platformBackupHistory')}</h3>
        {backupHistory.length ? <ul>{backupHistory.map((backup) => <li key={backup.id}>
          {backup.startedAt} · {backup.status}
          {backup.sizeBytes === null ? '' : ` · ${Math.round(backup.sizeBytes / 1024)} KB`}
          {backup.errorCode ? ` · ${backup.errorCode}` : ''}
        </li>)}</ul> : <p>{t('platformNoBackupYet')}</p>}
        <p>{t('platformRestoreInstructions')}</p>
      </>}
    </section>}
  </div>;
}
