type T = (key: string) => string;

export default function routeTitle(path: string, t: T) {
  if (path.startsWith('/timetable')) return t('timetable');
  if (path.startsWith('/assignments')) return t('assignments');
  if (path.startsWith('/my-classes')) return t('myClasses');
  if (path.startsWith('/student-progress')) return t('studentProgressNotes');
  if (path.startsWith('/staff')) return t('staff');
  if (path.startsWith('/admissions')) return t('admissions');
  if (path.startsWith('/students')) return t('students');
  if (path.startsWith('/attendance')) return t('attendance');
  if (path.startsWith('/marks')) return t('marks');
  if (path.startsWith('/exams')) return t('examSchedule');
  if (path.startsWith('/fees')) return t('fees');
  if (path.startsWith('/communications')) return t('communications');
  if (path.startsWith('/front-desk')) return t('frontDeskTitle');
  if (path.startsWith('/support')) return t('supportTitle');
  if (path.startsWith('/login-history')) return t('loginHistory');
  if (path.startsWith('/roles')) return t('rolesPermissions');
  if (path.startsWith('/accounts')) return t('accounts');
  if (path.startsWith('/audit')) return t('auditLog');
  if (path.startsWith('/reports')) return t('navReports');
  if (path.startsWith('/hr-management')) return t('hrManagement');
  if (path.startsWith('/hr')) return t('hrDashboard');
  if (path.startsWith('/payroll')) return t('navPayroll');
  if (path.startsWith('/library')) return t('navLibrary');
  if (path.startsWith('/inventory')) return t('navInventory');
  if (path.startsWith('/school')) return t('schoolSetup');
  if (path.startsWith('/branches')) return t('branches');
  if (path.startsWith('/subscription')) return t('subscription');
  return t('overview');
}
