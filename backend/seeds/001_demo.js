import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { getGradeTemplate } from '../src/school-curriculum.js';

const ids = {
  org: '20000000-0000-4000-8000-000000000001',
  campus: '30000000-0000-4000-8000-000000000001',
  user: '10000000-0000-4000-8000-000000000001',
  year: '50000000-0000-4000-8000-000000000001',
  grade: '60000000-0000-4000-8000-000000000001',
  section: '70000000-0000-4000-8000-000000000001'
};
const platformOrganizationId = '00000000-0000-4000-8000-000000000001';

export async function seed(knex) {
  const environment = process.env.NODE_ENV;
  if (!['development', 'test', 'production'].includes(environment)) {
    throw new Error('Set NODE_ENV explicitly to development or production before seeding demo data.');
  }
  if (process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Demo seeding requires ALLOW_DEMO_SEED=true for this command.');
  }
  const production = environment === 'production';
  const email = process.env.DEMO_LOGIN_EMAIL ?? (production ? '' : 'admin@school.local');
  const password = process.env.DEMO_LOGIN_PASSWORD ?? (production ? '' : 'ChangeMe123!');
  if (!email.includes('@') || !password || (production && (password.length < 16 || /change.?me|password|123456/i.test(password)))) {
    throw new Error('Set a valid DEMO_LOGIN_EMAIL and a private DEMO_LOGIN_PASSWORD (at least 16 characters in production).');
  }
  if (production) {
    const existingSchool = await knex('organizations')
      .whereNot({ id: platformOrganizationId, status: 'platform' }).first('id');
    if (existingSchool) {
      throw new Error('Refusing to seed a production demo into a database that already contains a school. Use a dedicated demo database.');
    }
    for (const table of ['campuses', 'users', 'students']) {
      if (await knex(table).first('id')) {
        throw new Error(`Refusing to seed a production demo into a non-empty ${table} table. Use a dedicated empty demo database.`);
      }
    }
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await knex('organizations').insert({
    id: ids.org, name: 'SmartSchool Client Demo Organization', status: 'active'
  }).onConflict('id').merge();
  await knex('campuses').insert({
    id: ids.campus, organization_id: ids.org, name: 'Addis Learning Campus (Demo)',
    address: 'Bole Sub-City, Addis Ababa (fictional demonstration data)',
    timezone: 'Africa/Addis_Ababa', default_calendar: 'ethiopian', is_active: true
  }).onConflict('id').merge();
  await knex('users').insert({
    id: ids.user, organization_id: ids.org, name: 'SIMS Demo Administrator',
    email,
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
  const grades = [
    { id: ids.grade, code: 'G7', name_en: 'Grade 7', name_am: '7ኛ ክፍል', band: 'primary', sort_order: 7 },
    { id: '60000000-0000-4000-8000-000000000002', code: 'G8', name_en: 'Grade 8', name_am: '8ኛ ክፍል', band: 'primary', sort_order: 8 },
    { id: '60000000-0000-4000-8000-000000000003', code: 'G9', name_en: 'Grade 9', name_am: '9ኛ ክፍል', band: 'secondary', sort_order: 9 }
  ];
  for (const grade of grades) {
    await knex('grade_levels').insert({ ...grade, campus_id: ids.campus }).onConflict('id').merge();
  }
  const sections = [
    { id: ids.section, grade_level_id: ids.grade, name: 'Grade 7A' },
    { id: '70000000-0000-4000-8000-000000000002', grade_level_id: grades[1].id, name: 'Grade 8A' },
    { id: '70000000-0000-4000-8000-000000000003', grade_level_id: grades[2].id, name: 'Grade 9A' }
  ];
  for (const section of sections) {
    await knex('sections').insert({
      ...section, campus_id: ids.campus, academic_year_id: ids.year, capacity: 40
    }).onConflict('id').merge();
  }
  const students = [
    ['SIMS-001', 'ሳራ', 'አበበ', 'ተስፋዬ', 'Sara', 'Abebe', 'Tesfaye', 'female', 0],
    ['SIMS-002', 'ዳዊት', 'ከበደ', 'ገብረ', 'Dawit', 'Kebede', 'Ghere', 'male', 0],
    ['SIMS-003', 'ሚካኤል', 'ሀይሉ', 'ደሳለኝ', 'Mikael', 'Hailu', 'Desalegn', 'male', 0],
    ['SIMS-004', 'ህይወት', 'ገብረ', 'ማርያም', 'Hiwot', 'Gebre', 'Mariam', 'female', 0],
    ['SIMS-005', 'ናትናኤል', 'ተሾመ', 'ደረሰ', 'Natnael', 'Teshome', 'Derese', 'male', 1],
    ['SIMS-006', 'ሊዲያ', 'መኮንን', 'ጌታቸው', 'Lydia', 'Mekonnen', 'Getachew', 'female', 1],
    ['SIMS-007', 'ኤልያስ', 'ደሳለኝ', 'ግርማ', 'Elias', 'Desalegn', 'Girma', 'male', 1],
    ['SIMS-008', 'ሚሊዮን', 'በቀለ', 'ታደሰ', 'Million', 'Bekele', 'Tadesse', 'male', 1],
    ['SIMS-009', 'ሩት', 'አለሙ', 'ወልደ', 'Ruth', 'Alemu', 'Wolde', 'female', 2],
    ['SIMS-010', 'ዮሐንስ', 'ጌታቸው', 'ተክለ', 'Yohannes', 'Getachew', 'Tekle', 'male', 2],
    ['SIMS-011', 'ሰላማዊት', 'አሰፋ', 'ከበደ', 'Selamawit', 'Assefa', 'Kebede', 'female', 2],
    ['SIMS-012', 'ቢኒያም', 'ወልደ', 'ሚካኤል', 'Biniyam', 'Wolde', 'Mikael', 'male', 2]
  ];
  for (const [index, [student_no, given_name_am, father_name_am, grandfather_name_am,
    given_name_en, father_name_en, grandfather_name_en, gender, sectionIndex]] of students.entries()) {
    const studentId = `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    await knex('students').insert({
      id: studentId, campus_id: ids.campus, student_no, given_name_am, father_name_am,
      grandfather_name_am, given_name_en, father_name_en, grandfather_name_en, gender,
      section_name: sections[sectionIndex].name, previous_school: 'Demo Community School',
      guardian_phone: `+251900000${String(index + 1).padStart(3, '0')}`, status: 'enrolled'
    }).onConflict('id').merge();
    await knex('enrolments').insert({
      id: `80000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      student_id: studentId, academic_year_id: ids.year, section_id: sections[sectionIndex].id,
      status: 'active', enrolled_on: '2026-09-11'
    }).onConflict(['student_id', 'academic_year_id']).merge();
  }
  const subjects = [
    ['90000000-0000-4000-8000-000000000001', 'ENG', 'English', 'እንግሊዝኛ'],
    ['90000000-0000-4000-8000-000000000002', 'MAT', 'Mathematics', 'ሂሳብ'],
    ['90000000-0000-4000-8000-000000000003', 'SCI', 'General Science', 'አጠቃላይ ሳይንስ'],
    ['90000000-0000-4000-8000-000000000004', 'AMH', 'Amharic', 'አማርኛ'],
    ['90000000-0000-4000-8000-000000000005', 'ICT', 'Digital Literacy', 'ዲጂታል እውቀት'],
    ['90000000-0000-4000-8000-000000000006', 'SOC', 'Social Studies', 'ማህበራዊ ጥናት']
  ];
  for (const [id, code, name_en, name_am] of subjects) {
    await knex('subjects').insert({ id, campus_id: ids.campus, code, name_en, name_am })
      .onConflict('id').merge();
  }
  for (const grade of grades) {
    const template = getGradeTemplate(grade.code);
    for (const item of template.subjects) {
      let subject = await knex('subjects').where({ campus_id: ids.campus, code: item.code }).first('id');
      if (!subject) {
        const subjectId = randomUUID();
        await knex('subjects').insert({
          id: subjectId, campus_id: ids.campus, code: item.code,
          name_en: item.nameEn, name_am: item.nameAm
        });
        subject = { id: subjectId };
      }
      await knex('grade_subjects').insert({
        id: `92000000-0000-4000-8000-${String(grade.sort_order * 100 + template.subjects.indexOf(item) + 1).padStart(12, '0')}`,
        grade_level_id: grade.id, subject_id: subject.id, stream: item.stream,
        weekly_periods: item.weeklyPeriods, is_required: true
      }).onConflict(['grade_level_id', 'subject_id', 'stream']).merge();
    }
  }
  await knex('terms').insert([
    { id: '51000000-0000-4000-8000-000000000001', academic_year_id: ids.year, name: 'Term 1', start_date: '2026-09-11', end_date: '2026-12-31', is_current: true },
    { id: '51000000-0000-4000-8000-000000000002', academic_year_id: ids.year, name: 'Term 2', start_date: '2027-01-01', end_date: '2027-04-30', is_current: false },
    { id: '51000000-0000-4000-8000-000000000003', academic_year_id: ids.year, name: 'Term 3', start_date: '2027-05-01', end_date: '2027-09-10', is_current: false }
  ]).onConflict('id').merge();
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
