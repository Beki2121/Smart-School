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

    expect(activeItems.map((item) => item.to)).toEqual([
      '/timetable', '/fees', '/communications', '/reports', '/staff'
    ]);
    expect(items.some((item) => item.to === '/students')).toBe(false);
    expect(items.some((item) => item.label === 'navPayroll' && item.disabled)).toBe(false);
  });

  it('exposes assignments to assigned-teacher roles and portal learners', () => {
    const teacherItems = getSchoolNavigation('subject_teacher', t).flatMap((group) => group.items);
    expect(teacherItems.some((item) => item.to === '/assignments')).toBe(true);
    expect(teacherItems.map((item) => item.to)).toEqual(expect.arrayContaining([
      '/my-classes', '/student-progress', '/timetable'
    ]));

    const portalItems = getPortalNavigation(t, false, false, false, true).flatMap((group) => group.items);
    expect(portalItems.map((item) => item.to)).toEqual(expect.arrayContaining([
      '#portal-assignments', '#portal-announcements', '#portal-events', '#portal-timetable',
      '#portal-requests', '#portal-messages'
    ]));
    const studentPortalItems = getPortalNavigation(t, false, false, false, false, 'student')
      .flatMap((group) => group.items);
    expect(studentPortalItems.some((item) => item.to === '#portal-support')).toBe(true);
    expect(studentPortalItems.some((item) => item.to === '#portal-messages')).toBe(false);
  });

  it('exposes the HR dashboard only to authorized school roles', () => {
    for (const role of ['owner_director', 'principal', 'hr_admin', 'system_admin']) {
      expect(getSchoolNavigation(role, t).flatMap((group) => group.items)
        .some((item) => item.to === '/hr')).toBe(true);
    }
    for (const role of ['registrar', 'subject_teacher', 'parent_guardian']) {
      expect(getSchoolNavigation(role, t).flatMap((group) => group.items)
        .some((item) => item.to === '/hr')).toBe(false);
    }
  });

  it('exposes HR management only to roles with HR responsibilities', () => {
    for (const role of ['owner_director', 'principal', 'hr_admin', 'system_admin']) {
      expect(getSchoolNavigation(role, t).flatMap((group) => group.items)
        .some((item) => item.to === '/hr-management')).toBe(true);
    }
    for (const role of ['registrar', 'subject_teacher', 'accountant_cashier', 'parent_guardian']) {
      expect(getSchoolNavigation(role, t).flatMap((group) => group.items)
        .some((item) => item.to === '/hr-management')).toBe(false);
    }
  });

  it('exposes payroll only to roles with payroll-view permission', () => {
    for (const role of ['payroll_officer', 'owner_director', 'principal', 'system_admin']) {
      expect(getSchoolNavigation(role, t).flatMap((group) => group.items)
        .some((item) => item.to === '/payroll')).toBe(true);
    }
    for (const role of ['accountant_cashier', 'subject_teacher', 'parent_guardian', 'student']) {
      expect(getSchoolNavigation(role, t).flatMap((group) => group.items)
        .some((item) => item.to === '/payroll')).toBe(false);
    }
  });

  it('preserves portal grants and provides a localized disabled platform entry', () => {
    const portal = getPortalNavigation(t, false, true).flatMap((group) => group.items);
    expect(portal.filter((item) => item.to).map((item) => item.to)).toEqual([
      '#portal-children', '#portal-attendance', '#portal-announcements', '#portal-events',
      '#portal-timetable', '#portal-requests', '#portal-messages', '#portal-fees'
    ]);

    const platform = getPlatformNavigation((key) => translate('am', key));
    const soon = platform.flatMap((group) => group.items).find((item) => item.disabled);
    expect(soon?.availability).toBe(translate('am', 'navSoon'));
    expect(soon?.to).toBeUndefined();
  });
});
