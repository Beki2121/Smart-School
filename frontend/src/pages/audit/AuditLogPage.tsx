import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ActiveSession, api, AuditEvent, AuditFilters, AuditPage } from '../../api';

type T = (key: string) => string;

const initialFilters: AuditFilters = { page: 1, pageSize: 25 };

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function AuditLogPage({
  t, history = false, platform = false, currentSessionId, onCurrentSessionRevoked
}: {
  t: T; history?: boolean; platform?: boolean; currentSessionId?: string;
  onCurrentSessionRevoked?: () => Promise<void> | void
}) {
  const [filters, setFilters] = useState<AuditFilters>(initialFilters);
  const [draftFilters, setDraftFilters] = useState<AuditFilters>(initialFilters);
  const [page, setPage] = useState<AuditPage | null>(null);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [result, activeSessions] = await Promise.all([
        history ? api.loginHistory(filters) : api.auditLog(filters),
        history ? api.activeSessions() : Promise.resolve([])
      ]);
      setPage(result);
      setSessions(activeSessions);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setLoading(false); }
  }, [filters, history, t]);

  useEffect(() => { void load(); }, [load]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    setFilters({ ...draftFilters, page: 1 });
  };
  const updateFilter = (key: keyof AuditFilters, value: string) => {
    setDraftFilters((current) => ({ ...current, [key]: value, page: 1 }));
  };
  const changePage = (pageNumber: number) => {
    const updated = { ...filters, page: pageNumber };
    setFilters(updated);
    setDraftFilters(updated);
  };
  const exportCsv = async () => {
    setBusy(true);
    setError('');
    try { download(await api.exportAuditLog(filters), 'audit-log.csv'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const revoke = async (session: ActiveSession) => {
    if (!window.confirm(t('revokeSessionConfirm'))) return;
    setBusy(true);
    setError('');
    try {
      await api.revokeSession(session.sessionId);
      if (session.sessionId === currentSessionId) await onCurrentSessionRevoked?.();
      else await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const pages = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;

  return <section className={`panel audit-panel${platform ? ' platform-audit-panel' : ''}`}
    id={platform ? history ? 'platform-login-history' : 'platform-audit' : undefined}>
    <div className="panel-heading">
      <div><h2>{t(history ? 'loginHistory' : 'auditLog')}</h2>
        <p>{t(history ? 'loginHistoryHint' : 'auditLogHint')}</p></div>
      {!history && <button className="button button-secondary" disabled={busy}
        onClick={() => void exportCsv()}>{t('exportCsv')}</button>}
    </div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <form className="audit-filters" onSubmit={applyFilters}>
      <label>{t('fromDate')}<input type="date" value={draftFilters.from ?? ''}
        onChange={(event) => updateFilter('from', event.target.value)} /></label>
      <label>{t('toDate')}<input type="date" value={draftFilters.to ?? ''}
        onChange={(event) => updateFilter('to', event.target.value)} /></label>
      <label>{t('userId')}<input value={draftFilters.userId ?? ''}
        onChange={(event) => updateFilter('userId', event.target.value)} /></label>
      {!history && <>
        <label>{t('auditAction')}<input value={draftFilters.action ?? ''}
          onChange={(event) => updateFilter('action', event.target.value)} /></label>
        <label>{t('entityType')}<input value={draftFilters.entityType ?? ''}
          onChange={(event) => updateFilter('entityType', event.target.value)} /></label>
        <label>{t('entityId')}<input value={draftFilters.entityId ?? ''}
          onChange={(event) => updateFilter('entityId', event.target.value)} /></label>
      </>}
      <label className="audit-filter-search">{t('search')}<input value={draftFilters.search ?? ''}
        onChange={(event) => updateFilter('search', event.target.value)} /></label>
      <label>{t('recordsPerPage')}<select value={draftFilters.pageSize}
        onChange={(event) => {
          const updated = { ...draftFilters, page: 1, pageSize: Number(event.target.value) };
          setDraftFilters(updated);
          setFilters(updated);
        }}>
        {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
      </select></label>
      <button className="button button-primary" type="submit">{t('applyFilters')}</button>
    </form>

    {loading ? <div className="loading-state">{t('loading')}</div> : page?.events.length ? <>
      <div className="table-scroll"><table className="data-table">
        <thead><tr>
          <th>{t('date')}</th><th>{t('user')}</th><th>{t('role')}</th>
          {history ? <><th>{t('result')}</th><th>{t('ipAddress')}</th><th>{t('userAgent')}</th></> :
            <><th>{t('auditAction')}</th><th>{t('entityType')}</th><th>{t('entityId')}</th></>}
          <th>{t('details')}</th>
        </tr></thead>
        <tbody>{page.events.map((event) => <tr key={event.id}>
          <td>{displayDate(event.createdAt)}</td>
          <td>{event.actorName || event.actorEmail || t('unknownUser')}</td>
          <td>{event.actorRole ? t(`role_${event.actorRole}`) : '—'}</td>
          {history ? <>
            <td>{t(event.action === 'auth.login_failed' ? 'failed' :
              event.action === 'auth.logout' ? 'loggedOut' : 'successful')}</td>
            <td>{event.ipAddress || '—'}</td><td>{event.userAgent || '—'}</td>
          </> : <>
            <td>{event.action}</td><td>{event.entityType}</td><td>{event.entityId ?? '—'}</td>
          </>}
          <td><button className="button button-secondary" type="button"
            onClick={() => setSelected(event)}>{t('viewDetails')}</button></td>
        </tr>)}</tbody>
      </table></div>
      <div className="audit-pagination">
        <span>{page.total} {t('records')}</span>
        <button className="button button-secondary" disabled={page.page <= 1}
          onClick={() => changePage(page.page - 1)}>{t('previous')}</button>
        <span>{page.page} / {pages}</span>
        <button className="button button-secondary" disabled={page.page >= pages}
          onClick={() => changePage(page.page + 1)}>{t('next')}</button>
      </div>
    </> : <div className="empty-state">{t('noAuditEvents')}</div>}

    {history && <section className="audit-sessions">
      <div className="panel-heading"><div><h3>{t('activeSessions')}</h3>
        <p>{t('activeSessionsHint')}</p></div></div>
      {sessions.length ? <div className="table-scroll"><table className="data-table">
        <thead><tr><th>{t('user')}</th><th>{t('role')}</th><th>{t('campus')}</th>
          <th>{t('lastSeen')}</th><th>{t('expiresAt')}</th><th>{t('ipAddress')}</th>
          <th>{t('userAgent')}</th><th>{t('actions')}</th></tr></thead>
        <tbody>{sessions.map((session) => <tr key={session.sessionId}>
          <td>{session.name}<small>{session.email}</small></td>
          <td>{t(`role_${session.role}`)}</td><td>{session.campusName || '—'}</td>
          <td>{displayDate(session.lastSeenAt)}</td><td>{displayDate(session.expiresAt)}</td>
          <td>{session.ipAddress || '—'}</td><td>{session.userAgent || '—'}</td>
          <td><button className="button button-secondary" disabled={busy}
            onClick={() => void revoke(session)}>{t('revokeSession')}</button></td>
        </tr>)}</tbody>
      </table></div> : <div className="empty-state">{t('noActiveSessions')}</div>}
    </section>}

    {selected && <div className="audit-drawer-backdrop" role="presentation"
      onClick={() => setSelected(null)}>
      <aside className="audit-drawer" role="dialog" aria-modal="true"
        aria-label={t('auditEventDetails')} onClick={(event) => event.stopPropagation()}>
        <div className="panel-heading"><h2>{t('auditEventDetails')}</h2>
          <button className="button button-secondary" onClick={() => setSelected(null)}>{t('close')}</button>
        </div>
        <dl><dt>{t('date')}</dt><dd>{displayDate(selected.createdAt)}</dd>
          <dt>{t('user')}</dt><dd>{selected.actorName || selected.actorEmail || t('unknownUser')}</dd>
          <dt>{t('auditAction')}</dt><dd>{selected.action}</dd>
          <dt>{t('entityType')}</dt><dd>{selected.entityType}</dd>
          <dt>{t('entityId')}</dt><dd>{selected.entityId ?? '—'}</dd>
          {platform && <><dt>{t('schoolName')}</dt><dd>{selected.organizationName || '—'}</dd></>}
        </dl>
        <h3>{t('before')}</h3><pre>{JSON.stringify(selected.before, null, 2) ?? '—'}</pre>
        <h3>{t('after')}</h3><pre>{JSON.stringify(selected.after, null, 2) ?? '—'}</pre>
      </aside>
    </div>}
  </section>;
}
