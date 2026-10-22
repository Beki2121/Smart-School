export async function up(knex) {
  await createTableIfMissing(knex, 'departments', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('name', 100).notNullable();
    table.string('description', 500).nullable();
    table.timestamps(true, true);
    table.unique(['campus_id', 'name']);
  });
  await createTableIfMissing(knex, 'staff', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('user_id', 36).nullable().references('id').inTable('users').onDelete('SET NULL').unique();
    table.string('department_id', 36).nullable().references('id').inTable('departments').onDelete('SET NULL');
    table.string('given_name_en', 100).notNullable();
    table.string('father_name_en', 100).notNullable();
    table.string('grandfather_name_en', 100).notNullable();
    table.string('given_name_am', 100).notNullable();
    table.string('father_name_am', 100).notNullable();
    table.string('grandfather_name_am', 100).notNullable();
    table.string('job_title', 120).notNullable();
    table.string('qualification', 255).nullable();
    table.enu('employment_status', ['active', 'on_leave', 'terminated']).notNullable().defaultTo('active');
    table.date('hired_on').nullable();
    table.timestamp('archived_at').nullable();
    table.timestamps(true, true);
    table.index(['campus_id', 'department_id', 'employment_status']);
  });
  await createTableIfMissing(knex, 'teaching_assignments', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.string('section_id', 36).notNullable().references('id').inTable('sections').onDelete('RESTRICT');
    table.string('subject_id', 36).notNullable().references('id').inTable('subjects').onDelete('RESTRICT');
    table.integer('day_of_week').nullable();
    table.integer('period_number').nullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
    table.unique(['staff_id', 'section_id', 'subject_id']);
    table.unique(['staff_id', 'day_of_week', 'period_number']);
    table.unique(['section_id', 'day_of_week', 'period_number']);
    table.index(['campus_id', 'staff_id', 'day_of_week', 'period_number'], 'ta_campus_staff_period_idx');
    table.index(['campus_id', 'section_id', 'is_active'], 'ta_campus_section_active_idx');
  });
  await ensureIndex(knex, 'teaching_assignments', 'ta_campus_staff_period_idx', ['campus_id', 'staff_id', 'day_of_week', 'period_number']);
  await ensureIndex(knex, 'teaching_assignments', 'ta_campus_section_active_idx', ['campus_id', 'section_id', 'is_active']);
  await createTableIfMissing(knex, 'homeroom_assignments', (table) => {
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('section_id', 36).primary().references('id').inTable('sections').onDelete('CASCADE');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.timestamps(true, true);
    table.index(['campus_id', 'staff_id']);
  });
  await createTableIfMissing(knex, 'staff_attendance', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.date('attendance_date').notNullable();
    table.enu('status', ['present', 'absent', 'late', 'excused']).notNullable();
    table.time('clock_in').nullable();
    table.time('clock_out').nullable();
    table.string('recorded_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamps(true, true);
    table.unique(['campus_id', 'staff_id', 'attendance_date']);
    table.index(['campus_id', 'attendance_date', 'status']);
  });
  await createTableIfMissing(knex, 'leave_requests', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.date('start_date').notNullable();
    table.date('end_date').notNullable();
    table.string('reason', 1000).notNullable();
    table.enu('status', ['pending', 'approved', 'rejected']).notNullable().defaultTo('pending');
    table.string('reviewed_by', 36).nullable().references('id').inTable('users').onDelete('SET NULL');
    table.text('review_note').nullable();
    table.timestamp('reviewed_at').nullable();
    table.timestamps(true, true);
    table.index(['campus_id', 'status', 'start_date']);
    table.index(['staff_id', 'start_date', 'end_date']);
  });
  await createTableIfMissing(knex, 'staff_messages', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('department_id', 36).nullable().references('id').inTable('departments').onDelete('SET NULL');
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.enu('message_type', ['handover', 'announcement']).notNullable();
    table.string('title', 180).notNullable();
    table.text('body').notNullable();
    table.timestamps(true, true);
    table.index(['campus_id', 'department_id', 'created_at']);
  });
}

async function createTableIfMissing(knex, name, callback) {
  if (!await knex.schema.hasTable(name)) await knex.schema.createTable(name, callback);
}

async function ensureIndex(knex, tableName, indexName, columns) {
  const [indexes] = await knex.raw('SHOW INDEX FROM ??', [tableName]);
  if (!indexes.some((index) => index.Key_name === indexName)) {
    await knex.schema.alterTable(tableName, (table) => table.index(columns, indexName));
  }
}

export async function down(knex) {
  for (const table of [
    'staff_messages', 'leave_requests', 'staff_attendance', 'homeroom_assignments',
    'teaching_assignments', 'staff', 'departments'
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
