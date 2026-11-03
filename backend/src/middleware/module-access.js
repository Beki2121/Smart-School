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
  return modulePathPrefixes.find(([, prefixes]) =>
    prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)))?.[0] ?? null;
}
