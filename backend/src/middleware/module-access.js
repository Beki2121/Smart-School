const modulePathPrefixes = [
  ['student_information', ['/students', '/portal', '/account-invitations']],
  ['admissions', ['/admissions']],
  ['attendance', ['/attendance', '/staff/attendance', '/leave-requests']],
  ['marks', ['/marks', '/report-cards', '/grading', '/exams', '/exam-types']],
  ['academic_setup', ['/assignments', '/portal/assignments', '/portal/assignment-attachments']],
  ['fees', ['/fees', '/cashier']],
  ['communications', ['/communications', '/notifications']],
  ['staff', ['/hr', '/staff', '/departments', '/teaching-assignments', '/homeroom-assignments', '/timetable']],
  ['payroll', ['/payroll']],
  ['library', ['/library']],
  ['inventory', ['/inventory']],
  ['front_desk', ['/front-desk']],
  ['academic_setup', ['/academic-year', '/academic-years', '/terms', '/grades', '/sections', '/subjects', '/curriculum', '/school-calendar', '/lesson-plans', '/promotion-rules']]
];
export function moduleForApiPath(pathname) {
  if (pathname.startsWith('/portal/library')) return 'library';
  if (pathname.startsWith('/portal/messages')) return 'communications';
  if (pathname.startsWith('/portal/calendar') || pathname.startsWith('/portal/announcements')) {
    return 'communications';
  }
  if (pathname.startsWith('/portal/support')) return 'communications';
  if (pathname.startsWith('/school/messaging-settings')) return 'communications';
  if (pathname === '/reports' || pathname.startsWith('/reports/')) {
    const reportId = pathname.split('/')[2]?.replace(/\.csv$/, '');
    if (!reportId || reportId === 'catalog') return 'student_information';
    if (reportId?.startsWith('finance-')) return 'fees';
    if (reportId?.startsWith('payroll-')) return 'payroll';
    if (reportId?.startsWith('library-')) return 'library';
    if (reportId?.startsWith('inventory-') || reportId?.startsWith('assets-')) return 'inventory';
    if (reportId?.startsWith('front-desk-')) return 'front_desk';
    if (reportId?.startsWith('admissions-')) return 'admissions';
    if (reportId?.startsWith('attendance-')) return 'attendance';
    if (reportId?.startsWith('academic-') || reportId === 'student-progress' ||
        reportId === 'teacher-workload' || reportId === 'my-classes' ||
        reportId === 'subject-performance' || reportId === 'class-comparison' ||
        reportId === 'syllabus-coverage') return 'academic_setup';
    if (reportId === 'student-directory') return 'student_information';
    return 'student_information';
  }
  return modulePathPrefixes.find(([, prefixes]) =>
    prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)))?.[0] ?? null;
}
