import { Link } from 'react-router-dom';
import type { Locale } from '../../i18n';

type T = (key: string) => string;
export type PublicContact = { email: string; phone: string; address: string };

export default function LandingPage({ t, locale, onLocaleChange, contact }: {
  t: T; locale: Locale; onLocaleChange: (locale: Locale) => void; contact: PublicContact
}) {
  const hasContact = Boolean(contact.email || contact.phone || contact.address);

  return <main className={`public-landing${locale === 'am' ? ' locale-am' : ''}`}>
    <header className="landing-header">
      <Link className="landing-brand" to="/">
        <span className="brand-mark">S</span>
        <span><strong>{t('brand')}</strong><small>{t('subtitle')}</small></span>
      </Link>
      <nav className="landing-actions" aria-label={t('publicNavigation')}>
        <div className="locale-switch" aria-label={t('language')}>
          <button type="button" className={locale === 'en' ? 'selected' : ''}
            aria-pressed={locale === 'en'} onClick={() => onLocaleChange('en')}>EN</button>
          <button type="button" className={locale === 'am' ? 'selected' : ''}
            aria-pressed={locale === 'am'} onClick={() => onLocaleChange('am')}>አማ</button>
        </div>
        <Link className="button button-secondary" to="/login">{t('signIn')}</Link>
      </nav>
    </header>

    <section className="landing-hero">
      <div className="landing-copy">
        <span className="eyebrow">{t('landingEyebrow')}</span>
        <h1>{t('landingTitle')}</h1>
        <p>{t('landingDescription')}</p>
        <Link className="button button-primary landing-cta" to="/login">
          {t('signInAction')} <span aria-hidden="true">→</span>
        </Link>
        <div className="landing-proof">
          <span><strong>01</strong>{t('landingFeatureStudents')}</span>
          <span><strong>02</strong>{t('landingFeatureAcademics')}</span>
          <span><strong>03</strong>{t('landingFeatureOperations')}</span>
        </div>
      </div>
      <div className="landing-art" aria-hidden="true">
        <div className="landing-art-orbit landing-art-orbit-outer" />
        <div className="landing-art-orbit landing-art-orbit-inner" />
        <div className="landing-art-card">
          <span className="landing-art-mark">S</span>
          <span className="landing-art-lines"><i /><i /><i /></span>
          <span className="landing-art-dot" />
        </div>
        <span className="landing-art-caption">{t('landingArtCaption')}</span>
      </div>
    </section>

    {hasContact && <section className="landing-contact" aria-labelledby="landing-contact-title">
      <div><span className="eyebrow">{t('contactUs')}</span><h2 id="landing-contact-title">{t('landingContactTitle')}</h2></div>
      <div className="landing-contact-details">
        {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
        {contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
        {contact.address && <span>{contact.address}</span>}
      </div>
    </section>}

    <footer className="landing-footer">
      <span>{t('brand')} · {t('landingFooter')}</span>
      <Link to="/login">{t('signIn')}</Link>
    </footer>
  </main>;
}
