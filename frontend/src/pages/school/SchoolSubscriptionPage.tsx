import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, OrganizationSettings, SchoolSubscription } from '../../api';
import { Locale } from '../../i18n';
import ErrorState from '../../components/ErrorState';

type T = (key: string) => string;
export default function SchoolSubscriptionPage({ t }: { t: T }) {
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [subscription, setSubscription] = useState<SchoolSubscription | null>(null);
  const [closureReason, setClosureReason] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [school, plan] = await Promise.all([api.schoolSettings(), api.schoolSubscription()]);
      setSettings(school); setSubscription(plan); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  const updateSetting = <K extends keyof OrganizationSettings>(
    key: K, value: OrganizationSettings[K]
  ) => settings && setSettings({ ...settings, [key]: value });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const updated = await api.updateSchoolSettings({
        preferredLocale: settings.preferredLocale, currencyCode: settings.currencyCode,
        branding: settings.branding
      });
      setSettings(updated); setMessage(t('settingsSaved'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const downloadExport = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const blob = await api.exportSchoolData();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `${settings?.name ?? 'school'}-data-export.json`;
      link.click(); URL.revokeObjectURL(url);
      setMessage(t('exportDownloaded')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  const requestClosure = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      await api.requestSchoolClosure(closureReason);
      setClosureReason(''); setMessage(t('closureRequested')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  if (!settings) return error ? <ErrorState t={t} error={error} retry={load} /> : <div className="loading-state">{t('loading')}</div>;
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">{t('subscription')}</div><h1>{settings.name}</h1><p>{t('schoolSettingsHint')}</p></div></div>
    {error && <div className="form-error">{error}</div>}
    {message && <div className="notice notice-success">{message}</div>}
    <section className="panel">
      <div className="panel-heading"><div><h2>{t('schoolSettings')}</h2><p>{t('brandingAndLocale')}</p></div></div>
      <form className="settings-form" onSubmit={(event) => void save(event)}>
        <div className="form-grid">
          <label>{t('schoolName')}<input value={settings.name} readOnly /></label>
          <label>{t('language')}<select value={settings.preferredLocale} onChange={(e) => updateSetting('preferredLocale', e.target.value as Locale)}>
            <option value="en">{t('english')}</option><option value="am">{t('amharic')}</option>
          </select></label>
          <label>{t('currency')}<select value={settings.currencyCode} onChange={(e) => updateSetting('currencyCode', e.target.value)}>
            <option value="ETB">ETB</option><option value="USD">USD</option>
          </select></label>
          <label>{t('logoUrl')}<input type="url" value={settings.branding.logoUrl}
            onChange={(e) => updateSetting('branding', { ...settings.branding, logoUrl: e.target.value })} /></label>
          <label>{t('primaryColor')}<input type="color" value={settings.branding.primaryColor}
            onChange={(e) => updateSetting('branding', { ...settings.branding, primaryColor: e.target.value })} /></label>
        </div>
        <button className="button button-primary" disabled={busy}>{t('saveSettings')}</button>
      </form>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>{t('subscription')}</h2><p>{t('schoolSubscriptionHint')}</p></div></div>
      {subscription ? <>
        <div className="subscription-summary">
          <strong>{subscription.plan.name}</strong>
          <span>{t(`subscriptionStatus_${subscription.status}`)}</span>
          <span>{subscription.plan.monthlyPrice} {subscription.plan.currencyCode} / {t('month')}</span>
          <span>{subscription.trialEndsAt ? `${t('trialEnds')}: ${subscription.trialEndsAt.slice(0, 10)}` : ''}</span>
          <span>{t('studentLimit')}: {subscription.plan.studentLimit ?? t('unlimited')}</span>
        </div>
        <div className="invoice-list">{subscription.invoices.map((invoice) => <article className="invoice-row" key={invoice.id}>
          <div><strong>{invoice.invoiceNumber}</strong><small>{invoice.amount} {invoice.currencyCode} · {t(`invoice_${invoice.status}`)}</small></div>
          <span>{invoice.dueOn ? `${t('dueDate')}: ${invoice.dueOn}` : ''}</span>
        </article>)}</div>
      </> : <div className="empty-state">{t('noSubscription')}</div>}
    </section>
    <section className="panel closure-panel">
      <div className="panel-heading"><div><h2>{t('schoolClosure')}</h2><p>{t('closureRetentionHint')}</p></div></div>
      <button className="button button-secondary" disabled={busy} onClick={() => void downloadExport()}>{t('downloadSchoolExport')}</button>
      <form className="settings-form" onSubmit={(event) => void requestClosure(event)}>
        <label>{t('closureReason')}<textarea minLength={10} maxLength={1000} value={closureReason}
          onChange={(e) => setClosureReason(e.target.value)} required /></label>
        <button className="button button-danger" disabled={busy}>{t('requestSchoolClosure')}</button>
      </form>
    </section>
  </div>;
}

