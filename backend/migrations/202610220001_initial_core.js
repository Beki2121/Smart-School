export async function up(knex) {
  await knex.schema.createTable('organizations', (table) => {
    table.string('id', 36).primary();
    table.string('name', 180).notNullable();
    table.string('status', 24).notNullable().defaultTo('active');
    table.timestamps(true, true);
  });
  await knex.schema.createTable('campuses', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('name', 180).notNullable();
    table.string('address', 500).nullable();
    table.string('phone', 32).nullable();
    table.string('timezone', 64).notNullable().defaultTo('Africa/Addis_Ababa');
    table.string('default_calendar', 16).notNullable().defaultTo('ethiopian');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
    table.index(['organization_id', 'is_active']);
  });
  await knex.schema.createTable('users', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('name', 180).notNullable();
    table.string('email', 254).nullable().unique();
    table.string('phone', 32).nullable().unique();
    table.string('password_hash', 100).notNullable();
    table.string('role', 40).notNullable();
    table.string('preferred_locale', 8).notNullable().defaultTo('en');
    table.string('preferred_calendar', 16).notNullable().defaultTo('ethiopian');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
    table.index(['organization_id', 'role', 'is_active']);
  });
  await knex.schema.createTable('user_campuses', (table) => {
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('CASCADE');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.primary(['user_id', 'campus_id']);
  });
  await knex.schema.createTable('roles', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).nullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.string('key', 64).notNullable();
    table.string('name', 120).notNullable();
    table.boolean('is_system').notNullable().defaultTo(false);
    table.unique(['organization_id', 'key']);
  });
  await knex.schema.createTable('permissions', (table) => {
    table.string('key', 100).primary();
    table.string('description', 255).notNullable();
  });
  await knex.schema.createTable('role_permissions', (table) => {
    table.string('role_id', 36).notNullable().references('id').inTable('roles').onDelete('CASCADE');
    table.string('permission_key', 100).notNullable().references('key').inTable('permissions').onDelete('CASCADE');
    table.primary(['role_id', 'permission_key']);
  });
  await knex.schema.createTable('academic_years', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('label_ec', 24).notNullable();
    table.date('start_date').notNullable();
    table.date('end_date').notNullable();
    table.string('status', 24).notNullable().defaultTo('planned');
    table.unique(['campus_id', 'label_ec']);
    table.index(['campus_id', 'status']);
  });
  await knex.schema.createTable('terms', (table) => {
    table.string('id', 36).primary();
    table.string('academic_year_id', 36).notNullable().references('id').inTable('academic_years').onDelete('CASCADE');
    table.string('name', 80).notNullable();
    table.date('start_date').notNullable();
    table.date('end_date').notNullable();
    table.boolean('is_current').notNullable().defaultTo(false);
    table.unique(['academic_year_id', 'name']);
  });
  await knex.schema.createTable('grade_levels', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('code', 24).notNullable();
    table.string('name_en', 80).notNullable();
    table.string('name_am', 80).notNullable();
    table.string('band', 32).notNullable();
    table.integer('sort_order').notNullable();
    table.unique(['campus_id', 'code']);
  });
  await knex.schema.createTable('sections', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('academic_year_id', 36).notNullable().references('id').inTable('academic_years').onDelete('RESTRICT');
    table.string('grade_level_id', 36).notNullable().references('id').inTable('grade_levels').onDelete('RESTRICT');
    table.string('name', 60).notNullable();
    table.integer('capacity').nullable();
    table.unique(['campus_id', 'academic_year_id', 'grade_level_id', 'name']);
    table.index(['campus_id', 'academic_year_id']);
  });
  await knex.schema.createTable('subjects', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('code', 24).notNullable();
    table.string('name_en', 100).notNullable();
    table.string('name_am', 100).notNullable();
    table.unique(['campus_id', 'code']);
  });
  await knex.schema.createTable('students', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('student_no', 32).notNullable();
    table.string('given_name_am', 100).notNullable();
    table.string('father_name_am', 100).notNullable();
    table.string('grandfather_name_am', 100).notNullable();
    table.string('given_name_en', 100).notNullable();
    table.string('father_name_en', 100).notNullable();
    table.string('grandfather_name_en', 100).notNullable();
    table.enu('gender', ['female', 'male', 'other']).notNullable();
    table.date('date_of_birth').nullable();
    table.string('section_name', 80).nullable();
    table.enu('status', ['applicant', 'enrolled', 'transferred_out', 'withdrawn', 'graduated']).notNullable().defaultTo('enrolled');
    table.string('id_number_enc', 512).nullable();
    table.string('id_number_hash', 64).nullable();
    table.text('health_notes_enc').nullable();
    table.text('special_needs_enc').nullable();
    table.timestamp('archived_at').nullable();
    table.timestamps(true, true);
    table.unique(['campus_id', 'student_no']);
    table.index(['campus_id', 'status', 'section_name']);
    table.index(['campus_id', 'given_name_en', 'father_name_en']);
    table.index(['campus_id', 'given_name_am', 'father_name_am']);
  });
  await knex.schema.createTable('enrolments', (table) => {
    table.string('id', 36).primary();
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('academic_year_id', 36).notNullable().references('id').inTable('academic_years').onDelete('RESTRICT');
    table.string('section_id', 36).notNullable().references('id').inTable('sections').onDelete('RESTRICT');
    table.enu('status', ['active', 'completed', 'withdrawn']).notNullable().defaultTo('active');
    table.date('enrolled_on').notNullable();
    table.date('left_on').nullable();
    table.string('outcome', 24).nullable();
    table.timestamps(true, true);
    table.unique(['student_id', 'academic_year_id']);
    table.index(['section_id', 'academic_year_id', 'status']);
  });
  await knex.schema.createTable('guardians', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('given_name_am', 100).notNullable();
    table.string('father_name_am', 100).notNullable();
    table.string('grandfather_name_am', 100).notNullable();
    table.string('given_name_en', 100).notNullable();
    table.string('father_name_en', 100).notNullable();
    table.string('grandfather_name_en', 100).notNullable();
    table.string('phone', 32).notNullable();
    table.string('email', 254).nullable();
    table.string('national_id_enc', 512).nullable();
    table.string('national_id_hash', 64).nullable();
    table.timestamps(true, true);
  });
  await knex.schema.createTable('student_guardians', (table) => {
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('guardian_id', 36).notNullable().references('id').inTable('guardians').onDelete('RESTRICT');
    table.string('relationship', 40).notNullable();
    table.boolean('is_primary').notNullable().defaultTo(false);
    table.boolean('is_verified').notNullable().defaultTo(false);
    table.boolean('can_view_results').notNullable().defaultTo(false);
    table.boolean('can_view_fees').notNullable().defaultTo(false);
    table.primary(['student_id', 'guardian_id']);
  });
  await knex.schema.createTable('attendance_sessions', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('section_id', 36).notNullable().references('id').inTable('sections').onDelete('RESTRICT');
    table.date('attendance_date').notNullable();
    table.string('taken_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('client_uuid', 36).notNullable();
    table.timestamps(true, true);
    table.unique(['campus_id', 'client_uuid']);
    table.index(['campus_id', 'attendance_date', 'section_id']);
  });
  await knex.schema.createTable('attendance_records', (table) => {
    table.string('session_id', 36).notNullable().references('id').inTable('attendance_sessions').onDelete('RESTRICT');
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.enu('status', ['present', 'absent', 'late', 'excused']).notNullable();
    table.string('reason', 255).nullable();
    table.primary(['session_id', 'student_id']);
    table.index(['student_id', 'status']);
  });
  await knex.schema.createTable('marks', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('assessment_name', 100).notNullable();
    table.decimal('max_value', 7, 2).notNullable();
    table.decimal('value', 7, 2).notNullable();
    table.enu('state', ['draft', 'submitted', 'approved', 'locked']).notNullable().defaultTo('draft');
    table.string('entered_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('client_uuid', 36).notNullable();
    table.timestamps(true, true);
    table.unique(['campus_id', 'client_uuid']);
    table.index(['campus_id', 'student_id', 'state']);
  });
  await knex.schema.createTable('refresh_tokens', (table) => {
    table.string('id', 36).primary();
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('token_hash', 64).notNullable().unique();
    table.timestamp('expires_at').notNullable();
    table.timestamp('revoked_at').nullable();
    table.timestamps(true, true);
    table.index(['user_id', 'expires_at']);
  });
  await knex.schema.createTable('audit_log', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).nullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).nullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('actor_id', 36).nullable();
    table.string('action', 100).notNullable();
    table.string('entity_type', 80).notNullable();
    table.string('entity_id', 36).nullable();
    table.json('before_json').nullable();
    table.json('after_json').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['organization_id', 'campus_id', 'created_at']);
    table.index(['entity_type', 'entity_id']);
  });
}

export async function down(knex) {
  for (const table of [
    'audit_log', 'refresh_tokens', 'marks', 'attendance_records',
    'attendance_sessions', 'enrolments', 'student_guardians', 'guardians', 'students',
    'subjects', 'sections', 'grade_levels', 'terms', 'academic_years',
    'role_permissions', 'permissions', 'roles', 'user_campuses', 'users',
    'campuses', 'organizations'
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
