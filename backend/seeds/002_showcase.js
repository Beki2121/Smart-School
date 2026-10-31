const ids = {
  org: '20000000-0000-4000-8000-000000000001',
  campus: '30000000-0000-4000-8000-000000000001',
  user: '10000000-0000-4000-8000-000000000001',
  year: '50000000-0000-4000-8000-000000000001',
  term: '51000000-0000-4000-8000-000000000001',
  grades: [
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000003'
  ],
  sections: [
    '70000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000003'
  ],
  students: Array.from({ length: 12 }, (_, index) =>
    `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
  subjects: Array.from({ length: 6 }, (_, index) =>
    `90000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
  guardians: Array.from({ length: 12 }, (_, index) =>
    `af000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
};
const demoOrganizationName = 'SmartSchool Client Demo Organization';
const demoCampusName = 'Addis Learning Campus (Demo)';

async function upsert(knex, table, rows) {
  if (rows.length) await knex(table).insert(rows).onConflict('id').merge();
}

export async function seed(knex) {
  const environment = process.env.NODE_ENV;
  if (!['development', 'test', 'production'].includes(environment)) {
    throw new Error('Set NODE_ENV explicitly before seeding showcase data.');
  }
  if (process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Showcase seeding requires ALLOW_DEMO_SEED=true for this command.');
  }
  const organization = await knex('organizations')
    .where({ id: ids.org, name: demoOrganizationName }).first('id');
  const campus = organization && await knex('campuses')
    .where({
      id: ids.campus, organization_id: ids.org, name: demoCampusName
    }).first('id');
  if (!organization || !campus) {
    throw new Error('Showcase data may only be seeded into the dedicated demo organization and campus.');
  }

  const departments = [
    { id: 'a1000000-0000-4000-8000-000000000001', campus_id: ids.campus, name: 'Academic Affairs', description: 'Teaching, learning and assessment' },
    { id: 'a1000000-0000-4000-8000-000000000002', campus_id: ids.campus, name: 'Student Services', description: 'Registration, wellbeing and family support' }
  ];
  await upsert(knex, 'departments', departments);

  const staff = [
    { id: 'a2000000-0000-4000-8000-000000000001', campus_id: ids.campus, department_id: departments[0].id, given_name_en: 'Martha', father_name_en: 'Bekele', grandfather_name_en: 'Tadesse', given_name_am: 'ማርታ', father_name_am: 'በቀለ', grandfather_name_am: 'ታደሰ', job_title: 'Academic Head', qualification: 'M.Ed. Curriculum and Instruction', employment_status: 'active', hired_on: '2019-09-01' },
    { id: 'a2000000-0000-4000-8000-000000000002', campus_id: ids.campus, department_id: departments[0].id, given_name_en: 'Samuel', father_name_en: 'Kebede', grandfather_name_en: 'Alemu', given_name_am: 'ሳሙኤል', father_name_am: 'ከበደ', grandfather_name_am: 'አለሙ', job_title: 'Mathematics Teacher', qualification: 'B.Sc. Mathematics Education', employment_status: 'active', hired_on: '2021-10-15' },
    { id: 'a2000000-0000-4000-8000-000000000003', campus_id: ids.campus, department_id: departments[0].id, given_name_en: 'Hana', father_name_en: 'Tesfaye', grandfather_name_en: 'Girma', given_name_am: 'ሀና', father_name_am: 'ተስፋዬ', grandfather_name_am: 'ግርማ', job_title: 'English Teacher', qualification: 'B.A. English Language and Literature', employment_status: 'active', hired_on: '2022-09-01' },
    { id: 'a2000000-0000-4000-8000-000000000004', campus_id: ids.campus, department_id: departments[1].id, given_name_en: 'Dawit', father_name_en: 'Mekonnen', grandfather_name_en: 'Assefa', given_name_am: 'ዳዊት', father_name_am: 'መኮንን', grandfather_name_am: 'አሰፋ', job_title: 'Registrar', qualification: 'B.A. Management', employment_status: 'active', hired_on: '2020-01-10' }
  ];
  await upsert(knex, 'staff', staff);
  const guardians = ids.students.map((studentId, index) => ({
    id: ids.guardians[index], organization_id: ids.org,
    given_name_am: 'ወላጅ', father_name_am: 'የማሳያ', grandfather_name_am: `ቤተሰብ ${index + 1}`,
    given_name_en: 'Demo', father_name_en: 'Guardian', grandfather_name_en: `Family ${index + 1}`,
    phone: `+251900001${String(index + 1).padStart(3, '0')}`,
    email: `guardian${index + 1}@example.test`
  }));
  await upsert(knex, 'guardians', guardians);
  await knex('student_guardians').insert(ids.students.map((studentId, index) => ({
    student_id: studentId, guardian_id: ids.guardians[index], relationship: 'parent',
    is_primary: true, is_verified: true, can_view_results: true, can_view_fees: true
  }))).onConflict(['student_id', 'guardian_id']).merge();

  await upsert(knex, 'rooms', [
    { id: 'a3000000-0000-4000-8000-000000000001', campus_id: ids.campus, name: 'Main Hall', capacity: 45, is_active: true },
    { id: 'a3000000-0000-4000-8000-000000000002', campus_id: ids.campus, name: 'Science Room', capacity: 32, is_active: true },
    { id: 'a3000000-0000-4000-8000-000000000003', campus_id: ids.campus, name: 'ICT Lab', capacity: 28, is_active: true }
  ]);
  await knex('timetable_periods').insert([
    { id: 'a3100000-0000-4000-8000-000000000001', campus_id: ids.campus, shift: 'morning', period_number: 1, starts_at: '08:00:00', ends_at: '08:45:00' },
    { id: 'a3100000-0000-4000-8000-000000000002', campus_id: ids.campus, shift: 'morning', period_number: 2, starts_at: '08:50:00', ends_at: '09:35:00' },
    { id: 'a3100000-0000-4000-8000-000000000003', campus_id: ids.campus, shift: 'morning', period_number: 3, starts_at: '09:55:00', ends_at: '10:40:00' },
    { id: 'a3100000-0000-4000-8000-000000000004', campus_id: ids.campus, shift: 'morning', period_number: 4, starts_at: '10:45:00', ends_at: '11:30:00' }
  ]).onConflict('id').merge();
  const assignments = [
    { id: 'a3200000-0000-4000-8000-000000000001', staff_id: staff[1].id, section_id: ids.sections[0], subject_id: ids.subjects[1], room_id: 'a3000000-0000-4000-8000-000000000001', day_of_week: 1, period_number: 1 },
    { id: 'a3200000-0000-4000-8000-000000000002', staff_id: staff[2].id, section_id: ids.sections[0], subject_id: ids.subjects[0], room_id: 'a3000000-0000-4000-8000-000000000001', day_of_week: 1, period_number: 2 },
    { id: 'a3200000-0000-4000-8000-000000000003', staff_id: staff[1].id, section_id: ids.sections[1], subject_id: ids.subjects[1], room_id: 'a3000000-0000-4000-8000-000000000002', day_of_week: 1, period_number: 3 },
    { id: 'a3200000-0000-4000-8000-000000000004', staff_id: staff[2].id, section_id: ids.sections[2], subject_id: ids.subjects[0], room_id: 'a3000000-0000-4000-8000-000000000001', day_of_week: 2, period_number: 1 }
  ].map((assignment) => ({ ...assignment, campus_id: ids.campus, is_active: true }));
  await upsert(knex, 'teaching_assignments', assignments);
  await knex('homeroom_assignments').insert({
    campus_id: ids.campus, section_id: ids.sections[0], staff_id: staff[2].id
  }).onConflict('section_id').merge();
  await upsert(knex, 'staff_attendance', staff.slice(0, 3).map((person, index) => ({
    id: `a3300000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    campus_id: ids.campus, staff_id: person.id, attendance_date: '2026-10-22',
    status: index === 2 ? 'late' : 'present',
    clock_in: index === 2 ? '08:12:00' : '07:50:00',
    clock_out: '16:00:00', recorded_by: ids.user
  })));
  await upsert(knex, 'leave_requests', [{
    id: 'a3400000-0000-4000-8000-000000000001', campus_id: ids.campus,
    staff_id: staff[2].id, start_date: '2026-11-02', end_date: '2026-11-03',
    reason: 'Demo personal leave request', status: 'pending'
  }]);
  await upsert(knex, 'staff_messages', [
    { id: 'a3500000-0000-4000-8000-000000000001', campus_id: ids.campus, department_id: departments[0].id, created_by: ids.user, message_type: 'announcement', title: 'Term 1 assessment schedule', body: 'Please review the shared assessment calendar and confirm subject coverage.' },
    { id: 'a3500000-0000-4000-8000-000000000002', campus_id: ids.campus, department_id: departments[1].id, created_by: ids.user, message_type: 'handover', title: 'Registrar desk handover', body: 'Demo handover note: follow up the two sample admission applications this week.' }
  ]);

  const gradingBands = [
    ['A', 'Excellent', 'በጣም ጥሩ', 90],
    ['B', 'Very Good', 'በጣም ጥሩ', 80],
    ['C', 'Good', 'ጥሩ', 70],
    ['D', 'Satisfactory', 'የሚያረካ', 50],
    ['F', 'Needs Support', 'ተጨማሪ ድጋፍ ያስፈልጋል', 0]
  ].map(([code, name_en, name_am, min_percent], index) => ({
    id: `a4000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    campus_id: ids.campus, code, name_en, name_am, min_percent
  }));
  await upsert(knex, 'grading_bands', gradingBands);
  const marks = [];
  for (let student = 0; student < 12; student += 1) {
    for (let subject = 0; subject < 3; subject += 1) {
      const index = student * 3 + subject + 1;
      marks.push({
        id: `a5000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        campus_id: ids.campus, student_id: ids.students[student],
        assessment_name: 'Term 1 assessment', max_value: 100,
        value: 58 + ((student * 7 + subject * 9) % 41), state: 'approved',
        entered_by: ids.user,
        client_uuid: `a6000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        term_id: ids.term, subject_id: ids.subjects[subject]
      });
    }
  }
  await upsert(knex, 'marks', marks);

  const attendanceSession = {
    id: 'a7000000-0000-4000-8000-000000000001',
    campus_id: ids.campus, section_id: ids.sections[0],
    attendance_date: '2026-10-22', taken_by: ids.user,
    client_uuid: 'a7100000-0000-4000-8000-000000000001'
  };
  await upsert(knex, 'attendance_sessions', [attendanceSession]);
  const attendanceStatuses = ['present', 'present', 'late', 'absent'];
  await knex('attendance_records').insert(ids.students.slice(0, 4).map((studentId, index) => ({
    session_id: attendanceSession.id, student_id: studentId,
    status: attendanceStatuses[index], reason: index === 3 ? 'Demo absence' : null
  }))).onConflict(['session_id', 'student_id']).merge();

  await upsert(knex, 'fee_items', [
    { id: 'a8000000-0000-4000-8000-000000000001', campus_id: ids.campus, code: 'TUITION', name_en: 'Term tuition', name_am: 'የትምህርት ክፍያ', amount: 8500, currency_code: 'ETB', is_active: true },
    { id: 'a8000000-0000-4000-8000-000000000002', campus_id: ids.campus, code: 'BOOKS', name_en: 'Books and learning materials', name_am: 'መጽሐፍትና የትምህርት ዕቃዎች', amount: 1200, currency_code: 'ETB', is_active: true },
    { id: 'a8000000-0000-4000-8000-000000000003', campus_id: ids.campus, code: 'TRANSPORT', name_en: 'School transport', name_am: 'የትራንስፖርት አገልግሎት', amount: 2500, currency_code: 'ETB', is_active: true }
  ]);
  const invoices = [
    { id: 'ac000000-0000-4000-8000-000000000001', campus_id: ids.campus, student_id: ids.students[0], invoice_number: 'DEMO-2019-001', currency_code: 'ETB', total_amount: 9700, due_date: '2026-11-15', status: 'paid', issued_by: ids.user },
    { id: 'ac000000-0000-4000-8000-000000000002', campus_id: ids.campus, student_id: ids.students[1], invoice_number: 'DEMO-2019-002', currency_code: 'ETB', total_amount: 9700, due_date: '2026-11-15', status: 'partially_paid', issued_by: ids.user },
    { id: 'ac000000-0000-4000-8000-000000000003', campus_id: ids.campus, student_id: ids.students[2], invoice_number: 'DEMO-2019-003', currency_code: 'ETB', total_amount: 9700, due_date: '2026-11-15', status: 'issued', issued_by: ids.user }
  ];
  await upsert(knex, 'invoices', invoices);
  const invoiceLines = [];
  for (const [index, invoice] of invoices.entries()) {
    invoiceLines.push(
      { id: `ad000000-0000-4000-8000-${String(index * 2 + 1).padStart(12, '0')}`, invoice_id: invoice.id, fee_item_id: 'a8000000-0000-4000-8000-000000000001', description_en: 'Term tuition', description_am: 'የትምህርት ክፍያ', unit_amount: 8500, quantity: 1, line_total: 8500 },
      { id: `ad000000-0000-4000-8000-${String(index * 2 + 2).padStart(12, '0')}`, invoice_id: invoice.id, fee_item_id: 'a8000000-0000-4000-8000-000000000002', description_en: 'Books and learning materials', description_am: 'መጽሐፍትና የትምህርት ዕቃዎች', unit_amount: 1200, quantity: 1, line_total: 1200 }
    );
  }
  await upsert(knex, 'invoice_lines', invoiceLines);
  await upsert(knex, 'fee_payments', [
    { id: 'ae000000-0000-4000-8000-000000000001', campus_id: ids.campus, invoice_id: invoices[0].id, receipt_number: 'DEMO-RCPT-001', entry_type: 'payment', amount: 9700, method: 'cash', reference: 'Demo payment', recorded_by: ids.user, recorded_on: '2026-10-15' },
    { id: 'ae000000-0000-4000-8000-000000000002', campus_id: ids.campus, invoice_id: invoices[1].id, receipt_number: 'DEMO-RCPT-002', entry_type: 'payment', amount: 4000, method: 'mobile_money', reference: 'Demo partial payment', recorded_by: ids.user, recorded_on: '2026-10-18' }
  ]);

  await upsert(knex, 'admissions', [
    { id: 'a9000000-0000-4000-8000-000000000001', organization_id: ids.org, campus_id: ids.campus, academic_year_id: ids.year, given_name_am: 'ማህሌት', father_name_am: 'ግርማ', grandfather_name_am: 'አለሙ', given_name_en: 'Mahlet', father_name_en: 'Girma', grandfather_name_en: 'Alemu', gender: 'female', date_of_birth: '2017-03-12', guardian_name: 'Demo Guardian One', guardian_phone: '+251900000101', guardian_email: 'guardian1@example.test', grade_level_id: ids.grades[0], previous_school: 'Demo Community School', status: 'application', required_documents: JSON.stringify(['birth_certificate', 'previous_report']), interview_at: null, interview_result: null, decision_note: null, section_id: null, student_id: null, sibling_student_id: null, created_by: ids.user },
    { id: 'a9000000-0000-4000-8000-000000000002', organization_id: ids.org, campus_id: ids.campus, academic_year_id: ids.year, given_name_am: 'አቤል', father_name_am: 'አስራት', grandfather_name_am: 'ተክለ', given_name_en: 'Abel', father_name_en: 'Asrat', grandfather_name_en: 'Tekle', gender: 'male', date_of_birth: '2016-11-08', guardian_name: 'Demo Guardian Two', guardian_phone: '+251900000102', guardian_email: 'guardian2@example.test', grade_level_id: ids.grades[1], previous_school: 'Demo Preparatory School', status: 'interview', required_documents: JSON.stringify(['birth_certificate']), interview_at: '2026-10-28 09:00:00', interview_result: null, decision_note: null, section_id: null, student_id: null, sibling_student_id: null, created_by: ids.user }
  ]);

  await upsert(knex, 'campus_announcements', [
    { id: 'aa000000-0000-4000-8000-000000000001', campus_id: ids.campus, title_en: 'Welcome to the new academic year', title_am: 'ወደ አዲሱ የትምህርት ዘመን እንኳን በደህና መጡ', body_en: 'We welcome our students and families. Please review the term calendar and keep contact details up to date.', body_am: 'ተማሪዎቻችንንና ቤተሰቦቻቸውን በደስታ እንቀበላለን። የትምህርት ዘመኑን የጊዜ ሰሌዳ ይመልከቱ።', created_by: ids.user, published_at: '2026-09-11 08:00:00' },
    { id: 'aa000000-0000-4000-8000-000000000002', campus_id: ids.campus, title_en: 'Family learning day', title_am: 'የቤተሰብ የትምህርት ቀን', body_en: 'Families are invited to meet teachers, explore student projects and discuss learning goals.', body_am: 'ቤተሰቦች ከመምህራን ጋር እንዲገናኙና የተማሪዎችን ስራዎች እንዲመለከቱ ተጋብዘዋል።', created_by: ids.user, published_at: '2026-10-01 08:00:00' }
  ]);
  await upsert(knex, 'campus_events', [
    { id: 'ab000000-0000-4000-8000-000000000001', campus_id: ids.campus, title_en: 'Science and Innovation Exhibition', title_am: 'የሳይንስና ፈጠራ ኤግዚቢሽን', description_en: 'Students present classroom experiments and practical projects.', description_am: 'ተማሪዎች የክፍል ሙከራዎቻቸውንና ተግባራዊ ፕሮጀክቶቻቸውን ያቀርባሉ።', starts_on: '2026-11-14', ends_on: '2026-11-14', starts_at: '09:00:00', ends_at: '13:00:00', location: 'Main Hall', created_by: ids.user },
    { id: 'ab000000-0000-4000-8000-000000000002', campus_id: ids.campus, title_en: 'Parent-teacher conferences', title_am: 'የወላጅና መምህር ውይይት', description_en: 'A scheduled opportunity to review progress and agree on student support.', description_am: 'የተማሪዎችን እድገት ለመገምገምና ድጋፍ ለመወሰን የተዘጋጀ ውይይት።', starts_on: '2026-12-05', ends_on: '2026-12-05', starts_at: '08:30:00', ends_at: '15:00:00', location: 'Classrooms', created_by: ids.user }
  ]);
  await upsert(knex, 'student_commendations', [
    { id: 'ac100000-0000-4000-8000-000000000001', campus_id: ids.campus, student_id: ids.students[0], recorded_on: '2026-10-10', title_en: 'Curiosity in Science', title_am: 'በሳይንስ ያሳየችው ጉጉት', description_en: 'Recognized for thoughtful questions and a careful science observation journal.', description_am: 'በጥልቅ ጥያቄዎችና በጥንቃቄ የተዘጋጀ የሳይንስ ማስታወሻ እውቅና ተሰጥቷታል።', created_by: ids.user },
    { id: 'ac100000-0000-4000-8000-000000000002', campus_id: ids.campus, student_id: ids.students[4], recorded_on: '2026-10-17', title_en: 'Community Helper', title_am: 'የማህበረሰብ አጋዥ', description_en: 'Recognized for respectful teamwork during the campus reading day.', description_am: 'በንባብ ቀን በትብብር ለሰራውና ለአክብሮት ባህሪው እውቅና ተሰጥቶታል።', created_by: ids.user }
  ]);
}
