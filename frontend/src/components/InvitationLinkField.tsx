import { useId, useState } from 'react';

type T = (key: string) => string;

export default function InvitationLinkField({ value, t }: { value: string; t: T }) {
  const linkId = useId();
  const [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | ''>('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  };
  return <div className="invitation-link-field">
    <label htmlFor={linkId}>{t('invitationLink')}</label>
    <div className="invitation-link-row">
      <input id={linkId} readOnly value={value}
        onFocus={(event) => event.currentTarget.select()} />
      <button className="button button-quiet" type="button" onClick={() => void copy()}>
        {t(copyStatus === 'copied' ? 'invitationLinkCopied' : 'copyLink')}
      </button>
    </div>
    {copyStatus && <small role={copyStatus === 'failed' ? 'alert' : 'status'}>
      {t(copyStatus === 'failed' ? 'invitationLinkCopyFailed' : 'invitationLinkCopied')}
    </small>}
  </div>;
}
