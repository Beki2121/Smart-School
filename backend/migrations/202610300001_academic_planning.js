export async function up(knex) {
  if (!await knex.schema.hasColumn('terms', 'period_type')) {
    await knex.schema.alterTable('terms', (table) => {
      table.enu('period_type', ['term', 'semester']).notNullable().defaultTo('term');
    });
  }
  if (!await knex.schema.hasColumn('subjects', 'category')) {
    await knex.schema.alterTable('subjects', (table) => {
      table.string('category', 32).notNullable().defaultTo('core');
    });
  }
  if (!await knex.schema.hasTable('school_calendar_entries')) {
    await knex.schema.createTable('school_calendar_entries', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable()
        .references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('academic_year_id', 36).nullable()
        .references('id').inTable('academic_years').onDelete('RESTRICT');
      table.enu('entry_type', ['holiday', 'event', 'exam', 'closure']).notNullable();
      table.string('title_en', 160).notNullable();
      table.string('title_am', 160).notNullable();
      table.date('start_date').notNullable();
      table.date('end_date').notNullable();
      table.boolean('is_non_instructional_day').notNullable().defaultTo(false);
      table.string('notes_en', 500).notNullable().defaultTo('');
      table.string('notes_am', 500).notNullable().defaultTo('');
      table.string('created_by', 36).notNullable()
        .references('id').inTable('users').onDelete('RESTRICT');
      table.timestamps(true, true);
      table.index(['campus_id', 'start_date', 'end_date'], 'school_calendar_scope_date_idx');
    });
  }
  if (!await knex.schema.hasTable('curriculum_units')) {
    await knex.schema.createTable('curriculum_units', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable()
        .references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('academic_year_id', 36).notNullable()
        .references('id').inTable('academic_years').onDelete('RESTRICT');
      table.string('grade_level_id', 36).notNullable()
        .references('id').inTable('grade_levels').onDelete('RESTRICT');
      table.string('subject_id', 36).notNullable()
        .references('id').inTable('subjects').onDelete('RESTRICT');
      table.string('stream', 24).notNullable().defaultTo('all');
      table.integer('unit_number').unsigned().notNullable();
      table.string('title_en', 160).notNullable();
      table.string('title_am', 160).notNullable();
      table.text('learning_outcomes_en').notNullable();
      table.text('learning_outcomes_am').notNullable();
      table.date('planned_start').nullable();
      table.date('planned_end').nullable();
      table.string('created_by', 36).notNullable()
        .references('id').inTable('users').onDelete('RESTRICT');
      table.timestamps(true, true);
      table.unique(
        ['academic_year_id', 'grade_level_id', 'subject_id', 'stream', 'unit_number'],
        'curriculum_unit_number_uq'
      );
      table.index(['campus_id', 'grade_level_id', 'subject_id'], 'curriculum_unit_scope_idx');
    });
  }
  if (!await knex.schema.hasTable('lesson_plans')) {
    await knex.schema.createTable('lesson_plans', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable()
        .references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('academic_year_id', 36).notNullable()
        .references('id').inTable('academic_years').onDelete('RESTRICT');
      table.string('teaching_assignment_id', 36).notNullable()
        .references('id').inTable('teaching_assignments').onDelete('RESTRICT');
      table.string('curriculum_unit_id', 36).nullable()
        .references('id').inTable('curriculum_units').onDelete('SET NULL');
      table.date('planned_on').notNullable();
      table.string('title_en', 160).notNullable();
      table.string('title_am', 160).notNullable();
      table.text('objectives_en').notNullable();
      table.text('objectives_am').notNullable();
      table.text('activities_en').notNullable();
      table.text('activities_am').notNullable();
      table.text('resources').notNullable().defaultTo('');
      table.enu('status', ['planned', 'completed', 'cancelled']).notNullable().defaultTo('planned');
      table.string('created_by', 36).notNullable()
        .references('id').inTable('users').onDelete('RESTRICT');
      table.timestamp('completed_at').nullable();
      table.timestamps(true, true);
      table.index(['campus_id', 'planned_on', 'status'], 'lesson_plan_scope_date_idx');
      table.index(['teaching_assignment_id', 'planned_on'], 'lesson_plan_assignment_date_idx');
    });
  }
  if (!await knex.schema.hasTable('promotion_rules')) {
    await knex.schema.createTable('promotion_rules', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable()
        .references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('academic_year_id', 36).notNullable()
        .references('id').inTable('academic_years').onDelete('RESTRICT');
      table.string('grade_level_id', 36).notNullable()
        .references('id').inTable('grade_levels').onDelete('RESTRICT');
      table.decimal('minimum_annual_percent', 5, 2).notNullable();
      table.integer('maximum_failed_required_subjects').unsigned().notNullable().defaultTo(0);
      table.string('updated_by', 36).notNullable()
        .references('id').inTable('users').onDelete('RESTRICT');
      table.timestamps(true, true);
      table.unique(['academic_year_id', 'grade_level_id'], 'promotion_rule_year_grade_uq');
      table.index(['campus_id', 'academic_year_id'], 'promotion_rule_scope_idx');
    });
  }
}

export async function down(knex) {
  for (const table of ['promotion_rules', 'lesson_plans', 'curriculum_units', 'school_calendar_entries']) {
    await knex.schema.dropTableIfExists(table);
  }
  if (await knex.schema.hasColumn('subjects', 'category')) {
    await knex.schema.alterTable('subjects', (table) => table.dropColumn('category'));
  }
  if (await knex.schema.hasColumn('terms', 'period_type')) {
    await knex.schema.alterTable('terms', (table) => table.dropColumn('period_type'));
  }
}
