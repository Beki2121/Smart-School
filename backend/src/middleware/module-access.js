const modulePathPrefixes = [
  ['student_information', ['/students', '/portal', '/account-invitations']],
  ['admissions', ['/admissions']],
  ['attendance', ['/attendance', '/staff/attendance', '/leave-requests']],
  ['marks', ['/marks', '/report-cards', '/grading', '/exams', '/exam-types']],
  ['academic_setup', ['/assignments', '/portal/assignments', '/portal/assignment-attachments']],
  ['fees', ['/fees', '/cashier']],
  ['communications', ['/communications', '/notifications']],
  ['staff', ['/staff', '/departments', '/teaching-assignments', '/homeroom-assignments', '/timetable']],
  ['academic_setup', ['/academic-year', '/academic-years', '/terms', '/grades', '/sections', '/subjects', '/curriculum', '/school-calendar', '/lesson-plans', '/promotion-rules']]
];
export function moduleForApiPath(pathname) {
  if (pathname === '/reports' || pathname.startsWith('/reports/')) {
    const reportId = pathname.split('/')[2]?.replace(/\.csv$/, '');
    if (!reportId || reportId === 'catalog') return 'student_information';
    if (reportId?.startsWith('finance-')) return 'fees';
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
