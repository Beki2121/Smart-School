export async function up(knex) {
  if (!await knex.schema.hasTable('attendance_correction_requests')) {
    await knex.schema.createTable('attendance_correction_requests', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('session_id', 36).notNullable().references('id').inTable('attendance_sessions').onDelete('RESTRICT');
      table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
      table.string('original_status', 16).notNullable();
      table.string('requested_status', 16).notNullable();
      table.string('reason', 500).notNullable();
      table.string('requested_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.enu('status', ['pending', 'approved', 'rejected']).notNullable().defaultTo('pending');
      table.string('reviewed_by', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
      table.string('review_note', 500).nullable();
      table.timestamp('reviewed_at').nullable();
      table.timestamps(true, true);
      table.index(['campus_id', 'status', 'created_at'], 'attendance_correction_queue_idx');
      table.index(['session_id', 'student_id', 'status'], 'attendance_correction_record_idx');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('attendance_correction_requests');
}
