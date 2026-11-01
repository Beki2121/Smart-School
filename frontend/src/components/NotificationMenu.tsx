import { useCallback, useState } from 'react';
import { api, NotificationInbox, UserNotification } from '../api';
import { Locale } from '../i18n';

type T = (key: string) => string;
export default function NotificationMenu({ t, locale }: { t: T; locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState<NotificationInbox | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setInbox(await api.notifications()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setLoading(false); }
  }, [t]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  };
  const markRead = async (notification: UserNotification) => {
    if (notification.readAt) return;
    try {
      const saved = await api.markNotificationRead(notification.id);
      setInbox((current) => current ? {
        ...current,
        items: current.items.map((item) => item.id === saved.id ? saved : item),
        unreadCount: Math.max(0, current.unreadCount - 1)
      } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  };
  const localized = (en: string, am: string) => locale === 'am' ? am : en;
  return <div className="notification-wrap">
    <button className="notification-button" aria-label={t('notifications')} aria-expanded={open} onClick={toggle}>
      ♧{Boolean(inbox?.unreadCount) && <i />}
      {Boolean(inbox?.unreadCount) && <span className="notification-count">{inbox?.unreadCount}</span>}
    </button>
    {open && <section className="notification-panel" role="dialog" aria-label={t('notifications')}>
      <div className="notification-panel-heading">
        <strong>{t('notifications')}</strong>
        <button className="button button-secondary" onClick={() => void load()} disabled={loading}>{t('refresh')}</button>
      </div>
      {error && <div className="notice notice-error">{error}</div>}
      {loading ? <div className="empty-state">{t('loading')}</div> :
        !inbox?.items.length ? <div className="empty-state">{t('noNotifications')}</div> :
          <div className="notification-list">{inbox.items.map((notification) =>
            <button
              className={`notification-row ${notification.readAt ? '' : 'is-unread'}`}
              key={notification.id}
              onClick={() => void markRead(notification)}
            >
              <span className="notification-row-title">{localized(notification.titleEn, notification.titleAm)}</span>
              {(notification.bodyEn || notification.bodyAm) &&
                <span className="notification-row-body">{localized(notification.bodyEn, notification.bodyAm)}</span>}
              <time>{new Date(notification.createdAt).toLocaleString(locale === 'am' ? 'am-ET' : 'en-ET')}</time>
            </button>)}</div>}
    </section>}
  </div>;
}

