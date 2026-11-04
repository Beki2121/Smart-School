export const permissionRoles = {
  'dashboard.view': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin'],
  'account.view': ['super_admin', 'owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin', 'student', 'parent_guardian', 'auditor'],
  'accounts.manage': ['owner_director', 'principal', 'registrar', 'hr_admin', 'system_admin'],
  'portal.view': ['student', 'parent_guardian'],
  'platform.view': ['super_admin'],
  'platform.manage': ['super_admin'],
  'audit.view': ['super_admin', 'owner_director', 'system_admin'],
  'session.manage': ['super_admin', 'owner_director', 'system_admin'],
  'school.branches.manage': ['owner_director'],
  'school.export': ['owner_director'],
  'school.close': ['owner_director'],
  'students.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'counsellor', 'system_admin'],
  'students.alumni.view': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.progression.override': ['owner_director', 'principal', 'system_admin'],
  'students.edit': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.sensitive.view': ['owner_director', 'principal', 'registrar', 'counsellor', 'system_admin'],
  'students.sensitive.manage': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.discipline.view': ['owner_director', 'principal', 'registrar', 'counsellor', 'system_admin'],
  'students.discipline.manage': ['owner_director', 'principal', 'counsellor', 'system_admin'],
  'students.transfer.approve': ['owner_director', 'principal', 'system_admin'],
  'students.emergency.view': ['owner_director', 'principal', 'registrar', 'counsellor', 'system_admin'],
  'students.emergency.manage': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.guardians.view': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.guardians.manage': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.commendations.view': ['owner_director', 'principal', 'counsellor', 'system_admin'],
  'students.commendations.manage': ['owner_director', 'principal', 'counsellor', 'system_admin'],
  'admissions.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'],
  'admissions.manage': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'school.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'],
  'school.edit': ['owner_director', 'principal', 'system_admin'],
  'lesson_plans.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'lesson_plans.manage': ['owner_director', 'principal', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'attendance.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'attendance.take': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'attendance.edit': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'attendance.corrections.review': ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'],
  'marks.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'marks.enter': ['owner_director', 'principal', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'marks.approve': ['owner_director', 'principal', 'academic_head', 'system_admin'],
  'marks.publish': ['owner_director', 'principal', 'system_admin'],
  'marks.amend': ['owner_director', 'principal', 'system_admin'],
  'exams.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'student', 'parent_guardian'],
  'exams.manage': ['owner_director', 'principal', 'academic_head'],
  'exams.schedule.manage': ['owner_director', 'principal', 'academic_head'],
  'exams.monitor': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher'],
  'assignments.view': ['owner_director', 'principal', 'academic_head', 'system_admin'],
  'assignments.submit': ['student'],
  'assignments.view_child': ['parent_guardian'],
  'fees.view': ['owner_director', 'principal', 'registrar', 'accountant_cashier', 'system_admin'],
  'fees.manage': ['owner_director', 'principal', 'system_admin'],
  'fees.collect': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.reverse': ['owner_director', 'principal', 'system_admin'],
  'fees.shifts': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.expenses.view': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.expenses.manage': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.reports.view': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.portal.view': ['student', 'parent_guardian'],
  'fees.structure.manage': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.discount.request': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.discount.approve': ['principal'],
  'fees.refund.request': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.refund.approve': ['principal'],
  'fees.adjustment.request': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.adjustment.approve': ['principal'],
  'fees.arrears.view': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.cashbook.manage': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'staff.view': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'staff.manage': ['owner_director', 'principal', 'hr_admin', 'system_admin'],
  'assignments.manage': ['owner_director', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'reports.students.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'reports.admissions.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'],
  'reports.attendance.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'reports.academics.view': ['owner_director', 'principal', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'reports.finance.view': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'reports.hr.view': ['owner_director', 'principal', 'hr_admin', 'system_admin'],
  'reports.operations.view': ['owner_director', 'principal', 'system_admin'],
  'portal.calendar.view': ['student', 'parent_guardian'],
  'portal.requests.create': ['student', 'parent_guardian'],
  'portal.requests.view': ['student', 'parent_guardian', 'owner_director', 'principal', 'registrar', 'system_admin'],
  'portal.requests.manage': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'portal.support.create': ['student'],
  'portal.support.view': ['student', 'owner_director', 'principal', 'academic_head', 'registrar', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'portal.support.manage': ['owner_director', 'principal', 'academic_head', 'registrar', 'system_admin'],
  'portal.messaging.view': ['parent_guardian', 'homeroom_teacher', 'subject_teacher', 'owner_director', 'principal', 'academic_head', 'registrar', 'system_admin'],
  'portal.messaging.send': ['parent_guardian', 'homeroom_teacher', 'subject_teacher', 'owner_director', 'principal', 'academic_head', 'registrar', 'system_admin'],
  'portal.messaging.moderate': ['owner_director', 'principal', 'system_admin'],
  'portal.messaging.configure': ['owner_director', 'principal', 'system_admin'],
  'staff.attendance': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'leave.request': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'leave.approve': ['owner_director', 'principal', 'hr_admin', 'system_admin'],
  'staff.messages': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'communications.view': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin'],
  'communications.manage': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'system_admin'],
  'notifications.view': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin', 'student', 'parent_guardian']
};
const permissionCacheByRepository = new WeakMap();
const permissionCacheTtlMs = 5_000;

export function invalidatePermissionCache(repo, organizationId, roleKey) {
  const cache = permissionCacheByRepository.get(repo);
  if (!cache) return;
  for (const key of cache.keys()) {
    const [cachedOrganizationId, cachedRoleKey] = key.split('\u0000');
    if ((!organizationId || cachedOrganizationId === organizationId) &&
        (!roleKey || cachedRoleKey === roleKey)) {
      cache.delete(key);
    }
  }
}

async function permissionsFor(repo, organizationId, roleKey) {
  if (roleKey.startsWith('custom_')) {
    return repo.getRolePermissions(organizationId, roleKey);
  }
  let cache = permissionCacheByRepository.get(repo);
  if (!cache) {
    cache = new Map();
    permissionCacheByRepository.set(repo, cache);
  }
  const key = `${organizationId}\u0000${roleKey}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.permissions;
  const permissions = await repo.getRolePermissions(organizationId, roleKey);
  cache.set(key, { permissions, expiresAt: Date.now() + permissionCacheTtlMs });
  return permissions;
}

export function requirePermission(permission, repo) {
  const middleware = (request, response, next) => {
    if (!repo) return next(new Error('Permission middleware requires a repository.'));
    void (async () => {
      if (!request.user || !await permissionsFor(
        repo, request.user.orgId, request.user.role
      ).then((permissions) => permissions.includes(permission))) {
        return response.status(403).json({
          error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' }
        });
      }
      if (request.user.role === 'super_admin') return next();
      const campusIds = Array.isArray(request.user.campusIds) ? request.user.campusIds : [];
      if (!campusIds.includes(request.user.activeCampusId)) {
        return response.status(403).json({
          error: { code: 'CAMPUS_SCOPE_DENIED', message: 'Campus access is not granted.' }
        });
      }
      return next();
    })().catch(next);
  };
  middleware.permission = permission;
  return middleware;
}

export function requireAnyPermission(permissions, repo) {
  const middleware = (request, response, next) => {
    if (!repo) return next(new Error('Permission middleware requires a repository.'));
    void (async () => {
      const granted = request.user && await permissionsFor(
        repo, request.user.orgId, request.user.role
      );
      if (!granted || !permissions.some((permission) => granted.includes(permission))) {
        return response.status(403).json({
          error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' }
        });
      }
      if (request.user.role === 'super_admin') return next();
      const campusIds = Array.isArray(request.user.campusIds) ? request.user.campusIds : [];
      if (!campusIds.includes(request.user.activeCampusId)) {
        return response.status(403).json({
          error: { code: 'CAMPUS_SCOPE_DENIED', message: 'Campus access is not granted.' }
        });
      }
      return next();
    })().catch(next);
  };
  middleware.permissions = permissions;
  middleware.permission = permissions.join('|');
  return middleware;
}
