async function hasIndex(knex, table, name) {
  const [rows] = await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [table, name]);
  return rows.length > 0;
}

export async function up(knex) {
  if (await knex.schema.hasTable('sections') && !await knex.schema.hasColumn('sections', 'shift')) {
    await knex.schema.alterTable('sections', (table) => {
      table.string('shift', 24).notNullable().defaultTo('morning');
    });
  }
  if (!await knex.schema.hasTable('timetable_periods')) {
    await knex.schema.createTable('timetable_periods', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('shift', 24).notNullable();
      table.integer('period_number').unsigned().notNullable();
      table.time('starts_at').notNullable();
      table.time('ends_at').notNullable();
      table.timestamps(true, true);
      table.unique(['campus_id', 'shift', 'period_number']);
      table.index(['campus_id', 'shift', 'period_number'], 'tt_period_campus_shift_idx');
    });
  }
  if (!await knex.schema.hasTable('rooms')) {
    await knex.schema.createTable('rooms', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('name', 100).notNullable();
      table.integer('capacity').unsigned().nullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamps(true, true);
      table.unique(['campus_id', 'name']);
      table.index(['campus_id', 'is_active']);
    });
  }
  if (!await knex.schema.hasColumn('teaching_assignments', 'room_id')) {
    await knex.schema.alterTable('teaching_assignments', (table) => {
      table.string('room_id', 36).nullable().references('id').inTable('rooms').onDelete('RESTRICT');
      table.unique(['room_id', 'day_of_week', 'period_number'], 'ta_room_period_unique');
    });
  }
  if (!await knex.schema.hasTable('timetable_substitutions')) {
    await knex.schema.createTable('timetable_substitutions', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('teaching_assignment_id', 36).notNullable()
        .references('id').inTable('teaching_assignments').onDelete('RESTRICT');
      table.string('substitute_staff_id', 36).notNullable().references('id').inTable('staff').onDelete('RESTRICT');
      table.date('substitution_date').notNullable();
      table.string('leave_request_id', 36).notNullable().references('id').inTable('leave_requests').onDelete('RESTRICT');
      table.string('reason', 500).notNullable();
      table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['teaching_assignment_id', 'substitution_date'], 'tt_sub_assignment_date_uq');
    });
  }
  if (!await hasIndex(knex, 'timetable_substitutions', 'tt_sub_assignment_date_uq')) {
    await knex.schema.alterTable('timetable_substitutions', (table) => {
      table.unique(['teaching_assignment_id', 'substitution_date'], 'tt_sub_assignment_date_uq');
    });
  }
  if (!await hasIndex(knex, 'timetable_substitutions', 'tt_substitute_staff_date_idx')) {
    await knex.schema.alterTable('timetable_substitutions', (table) => {
      table.index(['campus_id', 'substitute_staff_id', 'substitution_date'], 'tt_substitute_staff_date_idx');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('timetable_substitutions');
  if (await knex.schema.hasColumn('teaching_assignments', 'room_id')) {
    await knex.schema.alterTable('teaching_assignments', (table) => {
      table.dropUnique(['room_id', 'day_of_week', 'period_number'], 'ta_room_period_unique');
      table.dropForeign(['room_id']);
      table.dropColumn('room_id');
    });
  }
  await knex.schema.dropTableIfExists('rooms');
  await knex.schema.dropTableIfExists('timetable_periods');
  if (await knex.schema.hasColumn('sections', 'shift')) {
    await knex.schema.alterTable('sections', (table) => table.dropColumn('shift'));
  }
}
