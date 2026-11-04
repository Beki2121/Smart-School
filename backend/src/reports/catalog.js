const filters = ['year', 'term', 'grade', 'section', 'from', 'to'];

const definitions = [
  {
    id: 'student-directory', category: 'students', permission: 'reports.students.view',
    roleScope: ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher',
      'subject_teacher', 'system_admin'],
    columns: ['studentNo', 'name', 'grade', 'section', 'gender', 'status']
  },
  {
    id: 'admissions-enrolment', category: 'admissions', permission: 'reports.admissions.view',
    roleScope: ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'],
    columns: ['grade', 'applications', 'enrolled', 'availableSeats']
  },
  {
    id: 'attendance-class', category: 'attendance', permission: 'reports.attendance.view',
    roleScope: ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher',
      'subject_teacher', 'system_admin'],
    columns: ['grade', 'section', 'date', 'present', 'absent', 'late', 'attendanceRate']
  },
  {
    id: 'attendance-student', category: 'attendance', permission: 'reports.attendance.view',
    roleScope: ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher',
      'subject_teacher', 'system_admin'],
    columns: ['studentNo', 'name', 'grade', 'section', 'present', 'absent', 'attendanceRate']
  },
  {
    id: 'attendance-trend', category: 'attendance', permission: 'reports.attendance.view',
    roleScope: ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher',
      'subject_teacher', 'system_admin'],
    columns: ['date', 'present', 'absent', 'late', 'attendanceRate']
  },
  {
    id: 'academic-pass-rates', category: 'academics', permission: 'reports.academics.view',
    roleScope: ['owner_director', 'principal', 'academic_head', 'homeroom_teacher',
      'subject_teacher', 'system_admin'],
    columns: ['grade', 'section', 'students', 'passed', 'failed', 'passRate']
  },
  {
    id: 'subject-performance', category: 'academics', permission: 'reports.academics.view',
    roleScope: ['owner_director', 'principal', 'academic_head', 'homeroom_teacher',
      'subject_teacher', 'system_admin'],
    columns: ['subject', 'students', 'average', 'passed', 'failed', 'passRate']
  },
  {
    id: 'class-comparison', category: 'academics', permission: 'reports.academics.view',
    roleScope: ['owner_director', 'principal', 'academic_head', 'system_admin'],
    columns: ['grade', 'section', 'students', 'average', 'passRate']
  },
  {
    id: 'student-progress', category: 'academics', permission: 'reports.academics.view',
    roleScope: ['owner_director', 'principal', 'academic_head', 'homeroom_teacher',
      'subject_teacher', 'system_admin'],
    columns: ['studentNo', 'name', 'term', 'subject', 'score', 'grade']
  },
  {
    id: 'finance-collection', category: 'finance', permission: 'reports.finance.view',
    roleScope: ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
    columns: ['date', 'class', 'feeType', 'currency', 'collected']
  },
  {
    id: 'finance-arrears', category: 'finance', permission: 'reports.finance.view',
    roleScope: ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
    columns: ['studentNo', 'name', 'grade', 'section', 'currency', 'outstanding']
  },
  {
    id: 'hr-employees', category: 'hr', permission: 'reports.hr.view',
    roleScope: ['owner_director', 'principal', 'hr_admin', 'system_admin'],
    columns: ['status', 'count']
  },
  {
    id: 'hr-leave', category: 'hr', permission: 'reports.hr.view',
    roleScope: ['owner_director', 'principal', 'hr_admin', 'system_admin'],
    columns: ['staff', 'leaveType', 'status', 'startDate', 'endDate', 'halfDays']
  },
  {
    id: 'hr-staff-attendance', category: 'hr', permission: 'reports.hr.view',
    roleScope: ['owner_director', 'principal', 'hr_admin', 'system_admin'],
    columns: ['staff', 'department', 'date', 'status', 'clockIn', 'clockOut']
  },
  {
    id: 'payroll-monthly', category: 'payroll', permission: 'payroll.reports.view',
    roleScope: ['payroll_officer', 'owner_director', 'principal', 'system_admin'],
    columns: ['period', 'status', 'currencyCode', 'staffCount', 'grossMinor', 'netMinor']
  },
  {
    id: 'payroll-department-expense', category: 'payroll', permission: 'payroll.reports.view',
    roleScope: ['payroll_officer', 'owner_director', 'principal', 'system_admin'],
    columns: ['department', 'currencyCode', 'staffCount', 'grossMinor']
  },
  {
    id: 'payroll-deductions', category: 'payroll', permission: 'payroll.reports.view',
    roleScope: ['payroll_officer', 'owner_director', 'principal', 'system_admin'],
    columns: ['deductionType', 'currencyCode', 'amountMinor']
  },
  {
    id: 'library-inventory', category: 'library', permission: 'library.reports.view',
    roleScope: ['library_librarian', 'owner_director', 'principal', 'system_admin'],
    columns: ['title', 'author', 'isbn', 'category', 'totalCopies', 'availableCopies',
      'borrowedCopies', 'reservedCopies', 'unavailableCopies']
  },
  {
    id: 'library-copies', category: 'library', permission: 'library.reports.view',
    roleScope: ['library_librarian', 'owner_director', 'principal', 'system_admin'],
    columns: ['barcode', 'copyNumber', 'title', 'author', 'condition', 'shelfLocation', 'status']
  },
  {
    id: 'library-circulation', category: 'library', permission: 'library.reports.view',
    roleScope: ['library_librarian', 'owner_director', 'principal', 'system_admin'],
    columns: ['issuedOn', 'dueOn', 'returnedOn', 'title', 'member', 'status',
      'fineMinor', 'currencyCode']
  },
  {
    id: 'operations-placeholder', category: 'operations', permission: 'reports.operations.view',
    roleScope: ['owner_director', 'principal', 'system_admin'],
    columns: ['metric', 'value']
  },
  {
    id: 'syllabus-coverage', category: 'academics', permission: 'reports.academics.view',
    roleScope: ['owner_director', 'principal', 'academic_head', 'homeroom_teacher',
      'subject_teacher', 'system_admin'],
    columns: ['grade', 'section', 'subject', 'units', 'coveredUnits', 'coveragePercent']
  },
  {
    id: 'teacher-workload', category: 'academics', permission: 'reports.academics.view',
    roleScope: ['owner_director', 'principal', 'academic_head', 'system_admin'],
    columns: ['teacher', 'classes', 'periods', 'limit', 'warning']
  },
  {
    id: 'my-classes', category: 'academics', permission: 'reports.academics.view',
    roleScope: ['homeroom_teacher', 'subject_teacher'],
    columns: ['grade', 'section', 'subject', 'academicYear']
  }
].map((definition) => Object.freeze({
  ...definition,
  filters,
  csvExport: true,
  printView: true,
  pageSize: 50,
  maxPageSize: 100
}));

export const reportCatalog = Object.freeze(definitions);

export function reportsForPermissions(permissions) {
  const granted = new Set(permissions);
  return reportCatalog.filter((definition) => granted.has(definition.permission));
}

export function reportPage(
  definition, rows, page = 1, pageSize = definition.pageSize, allRows = false
) {
  if (!Number.isInteger(page) || page < 1 ||
      !Number.isInteger(pageSize) || pageSize < 1 ||
      (!allRows && pageSize > definition.maxPageSize) ||
      (allRows && (page !== 1 || rows.length > 10000))) {
    const error = new Error('Invalid report page or page size.');
    error.status = 400;
    error.code = 'REPORT_PAGINATION_INVALID';
    throw error;
  }
  const offset = (page - 1) * pageSize;
  return {
    report: definition.id,
    columns: definition.columns,
    rows: allRows ? rows : rows.slice(offset, offset + pageSize),
    summary: {},
    page,
    pageSize,
    total: rows.length,
    hasMore: !allRows && offset + pageSize < rows.length
  };
}
