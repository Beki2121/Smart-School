import bcrypt from 'bcrypt';

const ids = {
  org: '20000000-0000-4000-8000-000000000001',
  campus: '30000000-0000-4000-8000-000000000001',
  user: '10000000-0000-4000-8000-000000000001',
  year: '50000000-0000-4000-8000-000000000001',
  grade: '60000000-0000-4000-8000-000000000001',
  section: '70000000-0000-4000-8000-000000000001'
};

export async function seed(knex) {
  const password = process.env.DEMO_LOGIN_PASSWORD ?? 'ChangeMe123!';
  const passwordHash = await bcrypt.hash(password, 12);
  await knex('organizations').insert({
    id: ids.org, name: 'SmartSchool Demo Organization', status: 'active'
  }).onConflict('id').merge();
  await knex('campuses').insert({
    id: ids.campus, organization_id: ids.org, name: 'Addis Learning Campus',
    timezone: 'Africa/Addis_Ababa', default_calendar: 'ethiopian', is_active: true
  }).onConflict('id').merge();
  await knex('users').insert({
    id: ids.user, organization_id: ids.org, name: 'SIMS Demo Administrator',
    email: process.env.DEMO_LOGIN_EMAIL ?? 'admin@school.local',
    password_hash: passwordHash, role: 'owner_director',
    preferred_locale: 'en', preferred_calendar: 'ethiopian', is_active: true
  }).onConflict('id').merge();
  await knex('user_campuses').insert({
    user_id: ids.user, campus_id: ids.campus, is_active: true
  }).onConflict(['user_id', 'campus_id']).merge();
  await knex('academic_years').insert({
    id: ids.year, campus_id: ids.campus, label_ec: '2019 E.C.',
    start_date: '2026-09-11', end_date: '2027-09-10', status: 'active'
  }).onConflict('id').merge();
  await knex('grade_levels').insert({
    id: ids.grade, campus_id: ids.campus, code: 'G7', name_en: 'Grade 7',
    name_am: '7ኛ ክፍል', band: 'primary', sort_order: 7
  }).onConflict('id').merge();
  await knex('sections').insert({
    id: ids.section, campus_id: ids.campus, academic_year_id: ids.year,
    grade_level_id: ids.grade, name: 'Grade 7A', capacity: 40
  }).onConflict('id').merge();
  const students = [
    ['40000000-0000-4000-8000-000000000001', 'SIMS-001', 'ሳራ', 'አበበ', 'ተስፋዬ', 'Sara', 'Abebe', 'Tesfaye', 'female'],
    ['40000000-0000-4000-8000-000000000002', 'SIMS-002', 'ዳዊት', 'ከበደ', 'ገብረ', 'Dawit', 'Kebede', 'Ghere', 'male'],
    ['40000000-0000-4000-8000-000000000003', 'SIMS-003', 'ሚካኤል', 'ሀይሉ', 'ደሳለኝ', 'Mikael', 'Hailu', 'Desalegn', 'male']
  ];
  for (const [index, [id, student_no, given_name_am, father_name_am, grandfather_name_am,
    given_name_en, father_name_en, grandfather_name_en, gender]] of students.entries()) {
    await knex('students').insert({
      id, campus_id: ids.campus, student_no, given_name_am, father_name_am,
      grandfather_name_am, given_name_en, father_name_en, grandfather_name_en,
      gender, section_name: 'Grade 7A', status: 'enrolled'
    }).onConflict('id').merge();
    await knex('enrolments').insert({
      id: `80000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      student_id: id, academic_year_id: ids.year, section_id: ids.section,
      status: 'active', enrolled_on: '2026-09-11'
    }).onConflict(['student_id', 'academic_year_id']).merge();
  }
  const roles = [
    ['students.view', 'View student records'], ['students.edit', 'Create and edit students'],
    ['attendance.view', 'View attendance'], ['attendance.take', 'Record attendance'],
    ['marks.view', 'View marks'], ['marks.enter', 'Enter marks'],
    ['dashboard.view', 'View dashboards'], ['school.view', 'View campus setup']
  ];
  for (const [key, description] of roles) {
    await knex('permissions').insert({ key, description }).onConflict('key').merge();
  }
}
