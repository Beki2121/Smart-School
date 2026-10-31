type T = (key: string) => string;

export default function ErrorState({ t, error, retry }: {
  t: T; error: string; retry: () => void
}) {
  return <div className="error-state"><span>!</span><h2>{t('errorTitle')}</h2><p>{error}</p><button className="button button-primary" onClick={retry}>{t('retry')}</button></div>;
}
