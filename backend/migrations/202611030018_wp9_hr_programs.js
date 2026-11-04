async function createTableIfMissing(knex, name, define) {
  if (!await knex.schema.hasTable(name)) await knex.schema.createTable(name, define);
}

export async function up(knex) {
  await createTableIfMissing(knex, 'hr_vacancies', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('department_id', 36).nullable().references('id').inTable('departments').onDelete('RESTRICT');
    table.string('title', 160).notNullable();
    table.text('description').notNullable();
    table.string('status', 20).notNullable().defaultTo('open');
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('updated_at').nullable().defaultTo(null);
    table.index(['organization_id', 'campus_id', 'status'], 'wp9_vacancy_tenant_status_idx');
  });

  await createTableIfMissing(knex, 'hr_applicants', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('vacancy_id', 36).notNullable().references('id').inTable('hr_vacancies').onDelete('RESTRICT');
    table.string('given_name', 100).notNullable();
    table.string('father_name', 100).notNullable();
    table.string('grandfather_name', 100).notNullable();
    table.string('email', 254).notNullable();
    table.string('phone', 40).notNullable();
    table.string('status', 20).notNullable().defaultTo('received');
    table.string('staff_id', 36).nullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('updated_at').nullable().defaultTo(null);
    table.unique(['organization_id', 'campus_id', 'vacancy_id', 'email'], 'wp9_applicant_email_uq');
    table.index(['organization_id', 'campus_id', 'status'], 'wp9_applicant_status_idx');
  });

  await createTableIfMissing(knex, 'hr_interviews', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('applicant_id', 36).notNullable().references('id').inTable('hr_applicants').onDelete('RESTRICT');
    table.dateTime('scheduled_at').notNullable();
    table.text('notes').notNullable();
    table.string('status', 20).notNullable().defaultTo('scheduled');
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['organization_id', 'campus_id', 'scheduled_at'], 'wp9_interview_schedule_idx');
    table.index(['organization_id', 'campus_id', 'applicant_id'], 'wp9_interview_applicant_idx');
  });

  await createTableIfMissing(knex, 'hr_applicant_documents', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('applicant_id', 36).notNullable().references('id').inTable('hr_applicants').onDelete('RESTRICT');
    table.string('category', 40).notNullable();
    table.string('original_name', 180).notNullable();
    table.string('mime_type', 100).notNullable();
    table.integer('size_bytes').unsigned().notNullable();
    table.string('storage_key', 36).notNullable().unique();
    table.string('sha256', 64).notNullable();
    table.string('uploaded_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['organization_id', 'campus_id', 'applicant_id'], 'wp9_applicant_document_idx');
  });

  await createTableIfMissing(knex, 'hr_performance_cycles', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('name', 120).notNullable();
    table.date('starts_on').notNullable();
    table.date('ends_on').notNullable();
    table.string('status', 20).notNullable().defaultTo('open');
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('updated_at').nullable().defaultTo(null);
    table.unique(['organization_id', 'campus_id', 'name'], 'wp9_performance_cycle_name_uq');
    table.index(['organization_id', 'campus_id', 'status'], 'wp9_performance_cycle_status_idx');
  });

  await createTableIfMissing(knex, 'hr_performance_goals', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.string('cycle_id', 36).notNullable().references('id').inTable('hr_performance_cycles').onDelete('RESTRICT');
    table.string('title', 180).notNullable();
    table.text('details').notNullable();
    table.string('status', 20).notNullable().defaultTo('open');
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('updated_at').nullable().defaultTo(null);
    table.index(['organization_id', 'campus_id', 'staff_id', 'status'], 'wp9_goal_staff_status_idx');
  });

  await createTableIfMissing(knex, 'hr_performance_evaluations', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.string('cycle_id', 36).notNullable().references('id').inTable('hr_performance_cycles').onDelete('RESTRICT');
    table.integer('rating').unsigned().notNullable();
    table.text('feedback').notNullable();
    table.string('evaluated_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('updated_at').nullable().defaultTo(null);
    table.unique(['organization_id', 'campus_id', 'staff_id', 'cycle_id'], 'wp9_evaluation_staff_cycle_uq');
    table.index(['organization_id', 'campus_id', 'cycle_id'], 'wp9_evaluation_cycle_idx');
  });

  await createTableIfMissing(knex, 'hr_training_courses', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('title', 180).notNullable();
    table.text('description').notNullable();
    table.date('starts_on').notNullable();
    table.date('ends_on').notNullable();
    table.string('status', 20).notNullable().defaultTo('open');
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('updated_at').nullable().defaultTo(null);
    table.index(['organization_id', 'campus_id', 'status'], 'wp9_training_course_status_idx');
  });

  await createTableIfMissing(knex, 'hr_training_enrollments', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('course_id', 36).notNullable().references('id').inTable('hr_training_courses').onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.string('status', 20).notNullable().defaultTo('enrolled');
    table.string('certificate_name', 180).nullable();
    table.string('certificate_mime_type', 100).nullable();
    table.integer('certificate_size_bytes').unsigned().nullable();
    table.string('certificate_storage_key', 36).nullable().unique();
    table.string('certificate_sha256', 64).nullable();
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('updated_at').nullable().defaultTo(null);
    table.unique(['organization_id', 'campus_id', 'course_id', 'staff_id'], 'wp9_training_enrollment_uq');
    table.index(['organization_id', 'campus_id', 'staff_id', 'status'], 'wp9_training_staff_status_idx');
  });
}

export async function down() {
  throw new Error('WP9 HR migrations are forward-only.');
}
