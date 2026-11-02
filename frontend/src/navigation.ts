import type { SidebarNavGroupDefinition, SidebarNavItem } from './components/SidebarNavGroup';

type T = (key: string) => string;

const staffRoles = ['owner_director', 'group_executive', 'principal', 'academic_head', 'hr_admin',
  'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'];
const accountRoles = ['owner_director', 'principal', 'registrar', 'hr_admin', 'system_admin'];
const admissionViewRoles = ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'];
const studentViewRoles = ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher',
  'subject_teacher', 'counsellor', 'system_admin'];
const attendanceViewRoles = ['owner_director', 'principal', 'registrar', 'academic_head',
  'homeroom_teacher', 'subject_teacher', 'system_admin'];
const feeViewRoles = ['owner_director', 'principal', 'registrar', 'accountant_cashier', 'system_admin'];
const communicationViewRoles = ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head',
  'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin'];
const dashboardRoles = communicationViewRoles;
const schoolSetupRoles = ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'];

type SchoolItem = { label: string; icon: string; roles: string[] } & (
  { to: string; soon?: false } |
  { soon: true; to?: never }
);
type SchoolGroup = { label: string; icon: string; items: SchoolItem[] };

const schoolGroups: SchoolGroup[] = [
  { label: 'navStudents', icon: '♙', items: [
    { label: 'students', to: '/students', icon: '♙', roles: studentViewRoles },
    { label: 'admissions', to: '/admissions', icon: '▣', roles: admissionViewRoles }
  ] },
  { label: 'navAcademics', icon: '▤', items: [
    { label: 'attendance', to: '/attendance', icon: '✓', roles: attendanceViewRoles },
    { label: 'marks', to: '/marks', icon: '▤', roles: attendanceViewRoles },
    { label: 'timetable', to: '/timetable', icon: '▦', roles: staffRoles },
    { label: 'schoolSetup', to: '/school', icon: '⌂', roles: schoolSetupRoles }
  ] },
  { label: 'navSchoolServices', icon: '✉', items: [
    { label: 'fees', to: '/fees', icon: '¤', roles: feeViewRoles },
    { label: 'communications', to: '/communications', icon: '✉', roles: communicationViewRoles },
    { label: 'navLibrary', icon: '▤', roles: dashboardRoles, soon: true },
    { label: 'navTransport', icon: '↔', roles: dashboardRoles, soon: true }
  ] },
  { label: 'navAdministration', icon: '⚙', items: [
    { label: 'staff', to: '/staff', icon: '♙', roles: staffRoles },
    { label: 'accounts', to: '/accounts', icon: '⚙', roles: accountRoles },
    { label: 'branches', to: '/branches', icon: '⌂', roles: ['owner_director'] },
    { label: 'subscription', to: '/subscription', icon: '◇', roles: ['owner_director'] },
    { label: 'navPayroll', icon: '¤', roles: ['owner_director', 'principal', 'hr_admin', 'system_admin'], soon: true },
    { label: 'navAnalytics', icon: '▥', roles: ['owner_director', 'group_executive', 'principal', 'academic_head', 'system_admin'], soon: true }
  ] }
];

function itemFor(item: SchoolItem, t: T): SidebarNavItem {
  return item.soon
    ? { label: t(item.label), icon: item.icon, disabled: true, availability: t('navSoon') }
    : { label: t(item.label), icon: item.icon, to: item.to };
}

export function getSchoolNavigation(role: string, t: T): SidebarNavGroupDefinition[] {
  return schoolGroups.map((group) => ({
    label: t(group.label),
    icon: group.icon,
    items: group.items.filter((item) => item.roles.includes(role)).map((item) => itemFor(item, t))
  })).filter((group) => group.items.length > 0);
}

export function getPlatformNavigation(t: T): SidebarNavGroupDefinition[] {
  return [
    { label: t('navPlatformSchools'), icon: '▣', items: [
      { label: t('schools'), to: '#platform-schools', icon: '▣' }
    ] },
    { label: t('navPlatformSubscriptions'), icon: '◇', items: [
      { label: t('planConfiguration'), to: '#platform-plans', icon: '◇' },
      { label: t('manualBilling'), to: '#platform-billing', icon: '¤' }
    ] },
    { label: t('navPlatformGovernance'), icon: '⚖', items: [
      { label: t('closureRequests'), to: '#platform-closures', icon: '⚖' },
      { label: t('navAnalytics'), icon: '▥', disabled: true, availability: t('navSoon') }
    ] }
  ];
}

export function getPortalNavigation(t: T, hasResults: boolean, hasFees: boolean): SidebarNavGroupDefinition[] {
  return [
    { label: t('navPortalChildren'), icon: '♙', items: [{ label: t('students'), to: '#portal-children', icon: '♙' }] },
    { label: t('attendance'), icon: '✓', items: [{ label: t('attendance'), to: '#portal-attendance', icon: '✓' }] },
    { label: t('navSchoolServices'), icon: '✉', items: [
      { label: t('navMessaging'), icon: '✉', disabled: true, availability: t('navSoon') }
    ] },
    ...(hasResults ? [{ label: t('navPortalAcademics'), icon: '▤', items: [
      { label: t('results'), to: '#portal-results', icon: '▤' }
    ] }] : []),
    ...(hasFees ? [{ label: t('fees'), icon: '¤', items: [
      { label: t('fees'), to: '#portal-fees', icon: '¤' }
    ] }] : [])
  ];
}
