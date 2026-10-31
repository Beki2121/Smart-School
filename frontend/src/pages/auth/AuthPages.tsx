import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, User } from '../../api';
import { Locale } from '../../i18n';
import FormInput from '../../components/FormInput';
import PwaInstallButton from '../../components/PwaInstallButton';

type T = (key: string) => string;

export function LoginPage({ t, onLogin }: { t: T; onLogin: (login: string, password: string) => Promise<void> }) {
  const [registering, setRegistering] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegistrationPassword, setShowRegistrationPassword] = useState(false);
  const [showRegistrationPasswordConfirmation, setShowRegistrationPasswordConfirmation] = useState(false);
  const [registration, setRegistration] = useState({
    schoolName: '', ownerName: '', ownerEmail: '', ownerPhone: '',
    schoolPhone: '', address: '', password: '', confirmPassword: '', locale: 'en' as Locale,
    currencyCode: 'ETB', timezone: 'Africa/Addis_Ababa'
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (registering) {
        if (registration.password !== registration.confirmPassword) {
          setError(t('passwordMismatch'));
          return;
        }
        await api.registerSchool(registration);
        setNotice(t('registrationComplete'));
        setRegistering(false);
      } else {
        await onLogin(login, password);
      }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  return (
    <div className="login-page">
      <div className="login-visual">
        <div className="login-visual-actions"><PwaInstallButton t={t} /></div>
        <div className="login-brand"><span className="brand-mark">S</span><strong>{t('brand')}</strong></div>
        <div className="login-message"><span className="eyebrow">{t('releaseOne')}</span><h1>{t('welcome')}</h1><p>{t('welcomeNote')}</p><div className="login-orbit">እንኳን ደህና መጡ</div></div>
        <span className="login-foot">{t('campus')} · {t('location')}</span>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>{registering ? t('registerSchool') : t('signIn')}</h2>
        <p className="muted">{registering ? t('registrationHint') : t('signInHint')}</p>
        {registering ? <>
          <label>{t('schoolName')}<input value={registration.schoolName} onChange={(e) => setRegistration({ ...registration, schoolName: e.target.value })} required /></label>
          <label>{t('ownerName')}<input value={registration.ownerName} onChange={(e) => setRegistration({ ...registration, ownerName: e.target.value })} required /></label>
          <label>{t('email')}<input type="email" autoComplete="email" value={registration.ownerEmail} onChange={(e) => setRegistration({ ...registration, ownerEmail: e.target.value })} required /></label>
          <label>{t('ownerPhone')}<input type="tel" value={registration.ownerPhone} onChange={(e) => setRegistration({ ...registration, ownerPhone: e.target.value })} required /></label>
          <label>{t('schoolPhone')}<input type="tel" value={registration.schoolPhone} onChange={(e) => setRegistration({ ...registration, schoolPhone: e.target.value })} required /></label>
          <label>{t('address')}<input value={registration.address} onChange={(e) => setRegistration({ ...registration, address: e.target.value })} required /></label>
          <PasswordInput
            label={t('password')} value={registration.password}
            onChange={(value) => setRegistration({ ...registration, password: value })}
            visible={showRegistrationPassword} onToggle={() => setShowRegistrationPassword(!showRegistrationPassword)}
            showLabel={t('showPassword')} hideLabel={t('hidePassword')}
            autoComplete="new-password" required minLength={12}
          />
          <PasswordInput
            label={t('confirmPassword')} value={registration.confirmPassword}
            onChange={(value) => setRegistration({ ...registration, confirmPassword: value })}
            visible={showRegistrationPasswordConfirmation}
            onToggle={() => setShowRegistrationPasswordConfirmation(!showRegistrationPasswordConfirmation)}
            showLabel={t('showPassword')} hideLabel={t('hidePassword')}
            autoComplete="new-password" required minLength={12}
          />
          <div className="form-grid">
            <label>{t('language')}<select value={registration.locale} onChange={(e) => setRegistration({ ...registration, locale: e.target.value as Locale })}><option value="en">{t('english')}</option><option value="am">{t('amharic')}</option></select></label>
            <label>{t('currency')}<select value={registration.currencyCode} onChange={(e) => setRegistration({ ...registration, currencyCode: e.target.value })}><option value="ETB">ETB</option><option value="USD">USD</option></select></label>
          </div>
        </> : <>
          <label>{t('email')}<input autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required /></label>
          <PasswordInput
            label={t('password')} value={password} onChange={setPassword}
            visible={showLoginPassword} onToggle={() => setShowLoginPassword(!showLoginPassword)}
            showLabel={t('showPassword')} hideLabel={t('hidePassword')}
            autoComplete="current-password" required
          />
        </>}
        {error && <div className="form-error">{error}</div>}
        {notice && <div className="notice notice-success">{notice}</div>}
        <button className="button button-primary full-width" disabled={busy}>{busy ? t('loading') : registering ? t('submitRegistration') : t('signInAction')}<span>→</span></button>
        <button className="text-link" type="button" onClick={() => { setRegistering(!registering); setError(''); setNotice(''); }}>
          {registering ? t('backToSignIn') : t('registerSchool')}
        </button>
        {!registering && <Link className="text-link" to="/forgot-password">{t('forgotPassword')}</Link>}
        {!registering && <div className="demo-credentials">{t('demoNote')}</div>}
      </form>
    </div>
  );
}

export function InvitationSetupPage({ t, token, onAccepted }: {
  t: T; token: string; onAccepted: (user: User) => void
}) {
  const [invitation, setInvitation] = useState<{ email: string; role: string; name: string } | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.invitationDetails(token).then(setInvitation)
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [token, t]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) { setError(t('passwordMismatch')); return; }
    setBusy(true);
    try { onAccepted(await api.acceptInvitation(token, password)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  return <main className="login-page invitation-page">
    <section className="login-card">
      <div className="eyebrow">{t('accountInvitation')}</div>
      <h2>{t('setUpAccount')}</h2>
      {invitation ? <>
        <p>{invitation.name} · {invitation.email}</p>
        <form onSubmit={(event) => void submit(event)}>
          <FormInput label={t('password')} type="password" value={password} onChange={setPassword} required />
          <FormInput label={t('confirmPassword')} type="password" value={confirmPassword} onChange={setConfirmPassword} required />
          <p className="muted">{t('passwordRequirement')}</p>
          {error && <div className="form-error">{error}</div>}
          <button className="button button-primary full-width" disabled={busy}>{busy ? t('loading') : t('createAccount')}</button>
        </form>
      </> : error ? <div className="notice notice-error">{error}</div> : <div className="loading-state">{t('loading')}</div>}
    </section>
  </main>;
}

export function PasswordChangePage({ t, user, onChanged }: {
  t: T; user: User; onChanged: (user: User) => void
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) { setError(t('passwordMismatch')); return; }
    setBusy(true);
    try { onChanged(await api.changePassword(currentPassword, password)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  };
  return <main className="login-page invitation-page">
    <section className="login-card">
      <div className="eyebrow">{t('studentPortal')}</div>
      <h2>{t('changeTemporaryPassword')}</h2>
      <p>{t('temporaryPasswordNotice')}</p>
      <form onSubmit={(event) => void submit(event)}>
        <FormInput label={t('temporaryPassword')} type="password" value={currentPassword} onChange={setCurrentPassword} required />
        <FormInput label={t('newPassword')} type="password" value={password} onChange={setPassword} required />
        <FormInput label={t('confirmPassword')} type="password" value={confirmPassword} onChange={setConfirmPassword} required />
        <p className="muted">{t('newPasswordRequirement')}</p>
        {error && <div className="form-error">{error}</div>}
        <button className="button button-primary full-width" disabled={busy}>{busy ? t('loading') : t('saveNewPassword')}</button>
      </form>
      <p className="muted">{user.name}</p>
    </section>
  </main>;
}

export function ForgotPasswordPage({ t }: { t: T }) {
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api.requestPasswordReset(email);
      setNotice(result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };
  return <main className="login-page"><form className="login-card" onSubmit={submit}>
    <h2>{t('forgotPassword')}</h2>
    <p className="muted">{t('forgotPasswordHint')}</p>
    <label>{t('email')}<input type="email" autoComplete="email" value={email}
      onChange={(event) => setEmail(event.target.value)} required /></label>
    {error && <div className="form-error">{error}</div>}
    {notice && <div className="notice notice-success">{notice}</div>}
    <button className="button button-primary full-width" disabled={busy}>
      {busy ? t('loading') : t('sendResetLink')}
    </button>
    <Link className="text-link" to="/login">{t('backToSignIn')}</Link>
  </form></main>;
}

export function PasswordResetPage({ t, token, onReset }: { t: T; token: string; onReset: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [visibleConfirmation, setVisibleConfirmation] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError(t('passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token, password, confirmPassword);
      onReset();
      setCompleted(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };
  if (completed) return <main className="login-page"><section className="login-card">
    <h2>{t('passwordReset')}</h2>
    <div className="notice notice-success">{t('passwordResetComplete')}</div>
    <Link className="text-link" to="/login">{t('signIn')}</Link>
  </section></main>;
  return <main className="login-page"><form className="login-card" onSubmit={submit}>
    <h2>{t('resetPassword')}</h2>
    <p className="muted">{t('newPasswordRequirement')}</p>
    <PasswordInput label={t('newPassword')} value={password} onChange={setPassword}
      visible={visible} onToggle={() => setVisible(!visible)}
      showLabel={t('showPassword')} hideLabel={t('hidePassword')}
      autoComplete="new-password" required minLength={12} />
    <PasswordInput label={t('confirmPassword')} value={confirmPassword} onChange={setConfirmPassword}
      visible={visibleConfirmation} onToggle={() => setVisibleConfirmation(!visibleConfirmation)}
      showLabel={t('showPassword')} hideLabel={t('hidePassword')}
      autoComplete="new-password" required minLength={12} />
    {error && <div className="form-error">{error}</div>}
    <button className="button button-primary full-width" disabled={busy}>
      {busy ? t('loading') : t('saveNewPassword')}
    </button>
    <Link className="text-link" to="/login">{t('backToSignIn')}</Link>
  </form></main>;
}

function PasswordInput({
  label, value, onChange, visible, onToggle, showLabel, hideLabel,
  autoComplete, required = false, minLength
}: {
  label: string; value: string; onChange: (value: string) => void; visible: boolean;
  onToggle: () => void; showLabel: string; hideLabel: string; autoComplete: string;
  required?: boolean; minLength?: number;
}) {
  const toggleLabel = visible ? hideLabel : showLabel;
  return (
    <label className="password-input-label">
      {label}
      <span className="password-input-wrap">
        <input
          type={visible ? 'text' : 'password'} autoComplete={autoComplete}
          value={value} onChange={(event) => onChange(event.target.value)}
          required={required} minLength={minLength}
        />
        <button className="password-visibility-toggle" type="button" onClick={onToggle}
          aria-label={toggleLabel} title={toggleLabel} aria-pressed={visible}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {visible ? <>
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
              <path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5 0 8.5 4.1 9.5 7-.4 1.1-1.2 2.3-2.3 3.4" />
              <path d="M6.2 6.2C4.3 7.5 3 9.4 2.5 12c.5 1.4 1.4 2.8 2.7 3.9A10.1 10.1 0 0 0 12 19c1 0 2-.2 2.9-.5" />
            </> : <>
              <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
              <circle cx="12" cy="12" r="2.6" />
            </>}
          </svg>
        </button>
      </span>
    </label>
  );
}
