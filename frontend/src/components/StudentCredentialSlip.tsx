import { StudentCredentials } from '../api';

type T = (key: string) => string;

export default function StudentCredentialSlip({ credentials, t, onDismiss }: {
  credentials: StudentCredentials; t: T; onDismiss: () => void
}) {
  return <section className="credential-slip" aria-live="polite">
    <div><div className="eyebrow">{t('studentCredentials')}</div><h2>{t('credentialSlipTitle')}</h2>
      <h3>{credentials.studentName}</h3>
      <p>{t('credentialSlipNotice')}</p>
    </div>
    <dl><div><dt>{t('username')}</dt><dd>{credentials.username}</dd></div>
      <div><dt>{t('temporaryPassword')}</dt><dd>{credentials.temporaryPassword}</dd></div>
    </dl>
    <div className="form-actions"><button className="button button-quiet" onClick={onDismiss}>{t('dismissCredentials')}</button></div>
  </section>;
}
