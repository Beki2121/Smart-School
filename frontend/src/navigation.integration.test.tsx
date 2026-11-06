import { describe, expect, it } from 'vitest';
import { getSchoolNavigation } from './navigation';
import routeTitle from './utils/routeTitle';

const t = (key: string) => key;
const schoolRoles = [
  'owner_director', 'group_executive', 'principal', 'academic_head', 'hr_admin',
  'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor',
  'system_admin', 'registrar', 'library_librarian', 'store_keeper', 'receptionist',
  'support_staff', 'payroll_officer', 'parent_guardian', 'student'
];

const activeMenuRoutes = [...new Set(schoolRoles.flatMap((role) =>
  getSchoolNavigation(role, t)
    .flatMap((group) => group.items)
    .filter((item) => item.to?.startsWith('/'))
    .map((item) => item.to!)))].sort();

describe('school menu system integration', () => {
  it(`resolves page titles for all ${activeMenuRoutes.length} active menu destinations`, () => {
    expect(activeMenuRoutes.length).toBeGreaterThan(0);
    for (const path of activeMenuRoutes) {
      expect(routeTitle(path, t), `${path} has a page title`).not.toBe('overview');
    }
  });
});
