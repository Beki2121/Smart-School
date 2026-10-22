export async function up(knex) {
  await knex.schema.alterTable('campuses', (table) => {
    table.string('student_id_pattern', 80).notNullable().defaultTo('{CAMPUS}-{YEAR}-{SEQ}');
  });
  await knex.schema.alterTable('students', (table) => {
    table.string('previous_school', 180).nullable();
    table.string('guardian_phone', 32).nullable();
  });
  await knex.schema.createTable('admissions', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('academic_year_id', 36).notNullable().references('id').inTable('academic_years').onDelete('RESTRICT');
    table.string('given_name_am', 100).notNullable();
    table.string('father_name_am', 100).notNullable();
    table.string('grandfather_name_am', 100).notNullable();
    table.string('given_name_en', 100).notNullable();
    table.string('father_name_en', 100).notNullable();
    table.string('grandfather_name_en', 100).notNullable();
    table.enu('gender', ['female', 'male', 'other']).notNullable();
    table.date('date_of_birth').nullable();
    table.string('guardian_name', 180).notNullable();
    table.string('guardian_phone', 32).notNullable();
    table.string('guardian_email', 254).nullable();
    table.string('grade_level_id', 36).notNullable().references('id').inTable('grade_levels').onDelete('RESTRICT');
    table.string('previous_school', 180).nullable();
    table.enu('status', [
      'enquiry', 'application', 'interview', 'accepted', 'waitlisted',
      'rejected', 'enrolled', 'withdrawn', 'transferred_out'
    ]).notNullable().defaultTo('enquiry');
    table.json('required_documents').notNullable();
    table.dateTime('interview_at').nullable();
    table.string('interview_result', 24).nullable();
    table.text('decision_note').nullable();
    table.string('section_id', 36).nullable().references('id').inTable('sections').onDelete('RESTRICT');
    table.string('student_id', 36).nullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('sibling_student_id', 36).nullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('created_by', 36).notNullable();
    table.timestamps(true, true);
    table.index(['campus_id', 'academic_year_id', 'status']);
    table.index(['campus_id', 'guardian_phone']);
    table.index(['campus_id', 'given_name_en', 'father_name_en']);
    table.index(['campus_id', 'given_name_am', 'father_name_am']);
  });
  await knex.schema.createTable('admission_documents', (table) => {
    table.string('id', 36).primary();
    table.string('admission_id', 36).notNullable().references('id').inTable('admissions').onDelete('RESTRICT');
    table.string('document_type', 48).notNullable();
    table.string('original_name', 180).notNullable();
    table.string('mime_type', 80).notNullable();
    table.integer('size_bytes').unsigned().notNullable();
    table.string('storage_key', 80).notNullable().unique();
    table.string('sha256', 64).notNullable();
    table.string('uploaded_by', 36).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['admission_id', 'document_type']);
  });
  await knex.schema.createTable('admission_counters', (table) => {
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('academic_year_id', 36).notNullable().references('id').inTable('academic_years').onDelete('RESTRICT');
    table.integer('last_value').unsigned().notNullable().defaultTo(0);
    table.primary(['campus_id', 'academic_year_id']);
  });
  await knex.schema.createTable('student_status_history', (table) => {
    table.string('id', 36).primary();
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('status', 24).notNullable();
    table.string('reason', 500).nullable();
    table.string('recorded_by', 36).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['student_id', 'created_at']);
  });
  await knex.schema.createTable('student_siblings', (table) => {
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('sibling_student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('relationship', 40).notNullable().defaultTo('sibling');
    table.primary(['student_id', 'sibling_student_id']);
  });
}

export async function down(knex) {
  for (const table of [
    'student_siblings', 'student_status_history', 'admission_counters',
    'admission_documents', 'admissions'
  ]) await knex.schema.dropTableIfExists(table);
  await knex.schema.alterTable('students', (table) => {
    table.dropColumn('guardian_phone');
    table.dropColumn('previous_school');
  });
  await knex.schema.alterTable('campuses', (table) => table.dropColumn('student_id_pattern'));
}
