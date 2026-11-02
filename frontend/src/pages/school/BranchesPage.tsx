import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, OrganizationBranch, User } from '../../api';
import FormInput from '../../components/FormInput';

type T = (key: string) => string;

export default function BranchesPage({ t, user, onUserUpdate }: {
  t: T; user: User; onUserUpdate: (user: User) => void
}) {
  const [branches, setBranches] = useState<OrganizationBranch[]>([]);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setBranches(await api.schoolBranches());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const createBranch = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      await api.createSchoolBranch({ name, address, phone });
      onUserUpdate(await api.me());
      setName(''); setAddress(''); setPhone('');
      await load();
      setNotice(t('branchCreated'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };

  const setBranchActive = async (branch: OrganizationBranch, isActive: boolean) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api.updateSchoolBranch(branch.id, { isActive });
      await load();
      setNotice(t(isActive ? 'branchActivated' : 'branchDeactivated'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };

  return <section className="page-section">
    <header className="section-heading">
      <div><span className="eyebrow">{t('schoolSetup')}</span>
        <h1>{t('branches')}</h1><p className="muted">{t('branchManagementHint')}</p></div>
      <button className="button button-quiet" type="button" onClick={() => void load()}>
        {t('refresh')}
      </button>
    </header>
    {error && <div className="form-error" role="alert">{error}</div>}
    {notice && <div className="notice notice-success" role="status">{notice}</div>}
    <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('createBranch')}</h2></div></div>
      <form onSubmit={(event) => void createBranch(event)}>
        <div className="form-grid">
          <FormInput label={t('branchName')} value={name} onChange={setName} required />
          <FormInput label={t('address')} value={address} onChange={setAddress} />
          <FormInput label={t('schoolPhone')} type="tel" value={phone} onChange={setPhone} />
        </div>
        <div className="form-actions"><button className="button button-primary" disabled={busy}>
          {busy ? t('loading') : t('createBranch')}
        </button></div>
      </form>
    </section>
    <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{t('branches')}</h2></div></div>
      {loading ? <div className="loading-state">{t('loading')}</div> :
        <div className="account-list">{branches.map((branch) => <article className="account-row" key={branch.id}>
          <div><strong>{branch.name}</strong>
            <span>{branch.address || branch.phone || t('noBranchContact')}</span></div>
          <div><span className={`status-pill ${branch.isActive ? '' : 'status-inactive'}`}>
            {t(branch.isActive ? 'active' : 'inactive')}
          </span>{branch.id === user.activeCampusId && <small>{t('currentBranch')}</small>}</div>
          <button type="button" className={branch.isActive ? 'button button-quiet' : 'button button-primary'}
            disabled={busy || branch.id === user.activeCampusId}
            title={branch.id === user.activeCampusId ? t('switchBeforeDeactivating') : undefined}
            onClick={() => void setBranchActive(branch, !branch.isActive)}>
            {branch.isActive ? t('deactivateBranch') : t('activateBranch')}
          </button>
        </article>)}
        {!branches.length && <p className="muted">{t('noBranches')}</p>}</div>}
    </section>
  </section>;
}
