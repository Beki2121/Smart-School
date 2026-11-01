import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import SidebarNavGroup from './components/SidebarNavGroup';
import { getPlatformNavigation, getPortalNavigation, getSchoolNavigation } from './navigation';
import { translate } from './i18n';

const t = (key: string) => key;

describe('role navigation definitions', () => {
  it('preserves registrar routes and marks future school features as disabled', () => {
    const groups = getSchoolNavigation('registrar', t);
    const items = groups.flatMap((group) => group.items);

    expect(items.filter((item) => item.to).map((item) => item.to)).toEqual(expect.arrayContaining([
      '/students', '/admissions', '/attendance', '/marks', '/school',
      '/fees', '/communications', '/accounts'
    ]));
    expect(items.some((item) => item.to === '/timetable')).toBe(false);
    expect(items.some((item) => item.to === '/branches')).toBe(false);
    expect(items.filter((item) => item.disabled).map((item) => item.label)).toEqual([
      'navLibrary', 'navTransport'
    ]);

    const services = groups.find((group) => group.label === 'navSchoolServices');
    render(<MemoryRouter><SidebarNavGroup group={services!} activePath="" onNavigate={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /navSchoolServices/ }));
    const disabledLibrary = screen.getByText('navLibrary').closest('[aria-disabled="true"]');
    expect(disabledLibrary).toBeTruthy();
    expect(disabledLibrary?.querySelector('a,button')).toBeNull();
    expect(screen.getAllByText('navSoon')).toHaveLength(2);
  });

  it('keeps accountant navigation limited to previously permitted routes', () => {
    const items = getSchoolNavigation('accountant_cashier', t).flatMap((group) => group.items);
    const activeItems = items.filter((item) => item.to);

    expect(activeItems.map((item) => item.to)).toEqual(['/timetable', '/fees', '/communications', '/staff']);
    expect(items.some((item) => item.to === '/students')).toBe(false);
    expect(items.some((item) => item.label === 'navPayroll' && item.disabled)).toBe(false);
  });

  it('preserves portal grants and provides a localized disabled platform entry', () => {
    const portal = getPortalNavigation(t, false, true).flatMap((group) => group.items);
    expect(portal.filter((item) => item.to).map((item) => item.to)).toEqual([
      '#portal-children', '#portal-attendance', '#portal-fees'
    ]);
    expect(portal.find((item) => item.label === 'navMessaging')).toMatchObject({
      disabled: true, availability: 'navSoon'
    });

    const platform = getPlatformNavigation((key) => translate('am', key));
    const soon = platform.flatMap((group) => group.items).find((item) => item.disabled);
    expect(soon?.availability).toBe(translate('am', 'navSoon'));
    expect(soon?.to).toBeUndefined();
  });
});
