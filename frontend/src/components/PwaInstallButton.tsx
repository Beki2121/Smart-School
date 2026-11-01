import { useEffect, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export default function PwaInstallButton({ t }: { t: (key: string) => string }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [installed, setInstalled] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && Boolean(navigator.standalone))
  );

  useEffect(() => {
    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setHelpOpen(false);
    };
    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) {
      setHelpOpen((open) => !open);
      return;
    }
    const prompt = installPrompt;
    setInstallPrompt(null);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      else setHelpOpen(true);
    } catch {
      setHelpOpen(true);
    }
  };

  if (installed) return null;
  return (
    <div className="pwa-install-wrap">
      <button
        className="pwa-install-button"
        type="button"
        onClick={() => void install()}
        aria-label={t('installApp')}
        aria-expanded={helpOpen}
        title={t('installApp')}
      >
        <span aria-hidden="true">↓</span><span className="pwa-install-label">{t('installApp')}</span>
      </button>
      {helpOpen && (
        <section className="pwa-help-panel" role="dialog" aria-label={t('installApp')}>
          <button className="pwa-help-close" type="button" onClick={() => setHelpOpen(false)} aria-label={t('close')}>×</button>
          <strong>{t('installApp')}</strong>
          <p>{t('installInstructions')}</p>
        </section>
      )}
    </div>
  );
}
