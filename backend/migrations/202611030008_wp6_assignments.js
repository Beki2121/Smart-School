async function createTableIfMissing(knex, name, define) {
  if (!await knex.schema.hasTable(name)) {
    await knex.schema.createTable(name, (table) => {
      table.collate('utf8mb4_general_ci');
      define(table);
    });
  }
}

export async function up(knex) {
  await createTableIfMissing(knex, 'assignments', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable()
      .references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable()
      .references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('academic_year_id', 36).notNullable()
      .references('id').inTable('academic_years').onDelete('RESTRICT');
    table.string('term_id', 36).notNullable()
      .references('id').inTable('terms').onDelete('RESTRICT');
    table.string('grade_level_id', 36).notNullable()
      .references('id').inTable('grade_levels').onDelete('RESTRICT');
    table.string('section_id', 36).notNullable()
      .references('id').inTable('sections').onDelete('RESTRICT');
    table.string('subject_id', 36).notNullable()
      .references('id').inTable('subjects').onDelete('RESTRICT');
    table.string('title', 180).notNullable();
    table.text('instructions').notNullable();
    table.timestamp('due_at').notNullable();
    table.enu('status', ['draft', 'published', 'closed', 'archived']).notNullable().defaultTo('draft');
    table.string('created_by', 36).notNullable()
      .references('id').inTable('users').onDelete('RESTRICT');
    table.timestamp('published_at').nullable();
    table.timestamp('closed_at').nullable();
    table.timestamp('archived_at').nullable();
    table.timestamps(true, true);
    table.index(['organization_id', 'campus_id', 'status', 'due_at'], 'assignment_scope_status_due_idx');
    table.index(['section_id', 'academic_year_id', 'term_id'], 'assignment_class_period_idx');
  });

  await createTableIfMissing(knex, 'assignment_submissions', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable()
      .references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable()
      .references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('assignment_id', 36).notNullable()
      .references('id').inTable('assignments').onDelete('RESTRICT');
    table.string('student_id', 36).notNullable()
      .references('id').inTable('students').onDelete('RESTRICT');
    table.text('text').nullable();
    table.timestamp('submitted_at').notNullable();
    table.boolean('is_late').notNullable().defaultTo(false);
    table.decimal('grade', 7, 2).unsigned().nullable();
    table.text('feedback').nullable();
    table.string('graded_by', 36).nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('graded_at').nullable();
    table.enu('status', ['submitted', 'graded']).notNullable().defaultTo('submitted');
    table.timestamps(true, true);
    table.unique(['assignment_id', 'student_id'], 'assignment_student_submission_uq');
    table.index(['organization_id', 'campus_id', 'assignment_id', 'status'], 'assignment_submission_scope_idx');
  });

  await createTableIfMissing(knex, 'assignment_attachments', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable()
      .references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable()
      .references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('assignment_id', 36).notNullable()
      .references('id').inTable('assignments').onDelete('RESTRICT');
    table.string('submission_id', 36).nullable()
      .references('id').inTable('assignment_submissions').onDelete('RESTRICT');
    table.enu('attachment_type', ['assignment', 'submission']).notNullable();
    table.string('original_name', 255).notNullable();
    table.string('mime_type', 120).notNullable();
    table.integer('size_bytes').unsigned().notNullable();
    table.string('storage_key', 512).notNullable().unique();
    table.string('sha256', 64).notNullable();
    table.string('uploaded_by', 36).notNullable()
      .references('id').inTable('users').onDelete('RESTRICT');
    table.timestamps(true, true);
    table.index(['organization_id', 'campus_id', 'assignment_id', 'attachment_type'],
      'assignment_attachment_scope_idx');
    table.index(['submission_id'], 'assignment_attachment_submission_idx');
  });
}

export async function down() {
  throw new Error('WP6 assignments migration is forward-only.');
}
