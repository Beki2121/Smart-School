import { useCallback, useEffect, useState } from 'react';
import { api, HrDashboard } from '../../api';

type T = (key: string) => string;

export default function HrDashboardPage({ t }: { t: T }) {
  const [data, setData] = useState<HrDashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try { setData(await api.hrDashboard()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  return <section className="page-section">
    <header className="section-heading">
      <div><span className="eyebrow">{t('navAdministration')}</span>
        <h1>{t('hrDashboard')}</h1><p className="muted">{t('hrDashboardHint')}</p></div>
      <button className="button button-quiet" onClick={() => void load()} disabled={loading}>
        {t('refresh')}
      </button>
    </header>
    {error && <div className="form-error" role="alert">{error}</div>}
    {loading && !data ? <div className="loading-state">{t('loading')}</div> : data &&
      <div className="metric-grid" aria-live="polite">
        <Metric label={t('hrTotalStaff')} value={data.totalStaff} />
        <Metric label={t('hrActiveStaff')} value={data.activeStaff} />
        <Metric label={t('hrPendingLeave')} value={data.pendingLeaveRequests} />
        <Metric label={t('hrContractsExpiring')} value={data.contractsExpiringWithin30Days} />
      </div>}
  </section>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article className="metric-card"><div className="metric-content">
    <span>{label}</span><strong>{value}</strong>
  </div></article>;
}
