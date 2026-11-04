function tenant(table) {
  table.string('organization_id', 36).notNullable()
    .references('id').inTable('organizations').onDelete('RESTRICT');
  table.string('campus_id', 36).notNullable()
    .references('id').inTable('campuses').onDelete('RESTRICT');
}

function timestamps(table, knex) {
  table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
}

async function createIfMissing(knex, name, define) {
  if (!await knex.schema.hasTable(name)) await knex.schema.createTable(name, define);
}

export async function up(knex) {
  await createIfMissing(knex, 'frontdesk_visitors', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('visitor_name', 180).notNullable();
    table.string('purpose', 500).notNullable();
    table.string('host_staff_id', 36).nullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.string('status', 20).notNullable().defaultTo('checked_in');
    table.dateTime('checked_in_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.dateTime('checked_out_at', { useTz: false }).nullable();
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamp('archived_at').nullable();
    timestamps(table, knex);
    table.index(['organization_id', 'campus_id', 'status', 'checked_in_at'], 'frontdesk_visitor_status_idx');
    table.index(['organization_id', 'campus_id', 'host_staff_id'], 'frontdesk_visitor_host_idx');
  });
  await createIfMissing(knex, 'frontdesk_appointments', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('parent_name', 180).notNullable();
    table.string('student_id', 36).nullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.dateTime('appointment_at', { useTz: false }).notNullable();
    table.string('purpose', 500).notNullable();
    table.string('status', 20).notNullable().defaultTo('scheduled');
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamp('archived_at').nullable();
    timestamps(table, knex);
    table.index(['organization_id', 'campus_id', 'staff_id', 'appointment_at'], 'frontdesk_appointment_staff_date_idx');
    table.index(['organization_id', 'campus_id', 'status', 'appointment_at'], 'frontdesk_appointment_status_date_idx');
    table.index(['campus_id', 'student_id'], 'frontdesk_appointment_student_idx');
  });
  await createIfMissing(knex, 'frontdesk_messages', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('sender_name', 180).notNullable();
    table.string('recipient_staff_id', 36).notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.string('subject', 180).notNullable();
    table.text('message').notNullable();
    table.string('status', 20).notNullable().defaultTo('new');
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamp('archived_at').nullable();
    timestamps(table, knex);
    table.index(['organization_id', 'campus_id', 'recipient_staff_id', 'status'], 'frontdesk_message_recipient_status_idx');
    table.index(['organization_id', 'campus_id', 'created_at'], 'frontdesk_message_created_idx');
  });
  await createIfMissing(knex, 'frontdesk_pickup_authorizations', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('guardian_name', 180).notNullable();
    table.string('relationship', 80).notNullable();
    table.string('phone', 40).notNullable().defaultTo('');
    table.string('authorization_type', 20).notNullable().defaultTo('regular');
    table.boolean('one_time').notNullable().defaultTo(false);
    table.dateTime('expires_at', { useTz: false }).nullable();
    table.dateTime('used_at', { useTz: false }).nullable();
    table.string('status', 20).notNullable().defaultTo('active');
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('updated_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    timestamps(table, knex);
    table.index(['organization_id', 'campus_id', 'student_id', 'status'], 'frontdesk_pickup_auth_student_idx');
    table.index(['organization_id', 'campus_id', 'expires_at'], 'frontdesk_pickup_auth_expiry_idx');
  });
  await createIfMissing(knex, 'frontdesk_pickup_events', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('event_type', 20).notNullable();
    table.string('picked_up_by', 180).nullable();
    table.string('authorization_id', 36).nullable().references('id')
      .inTable('frontdesk_pickup_authorizations').onDelete('RESTRICT');
    table.string('released_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.dateTime('released_at', { useTz: false }).notNullable();
    table.date('release_date').notNullable();
    table.string('occasion_key', 100).notNullable();
    table.string('active_release_key', 220).nullable();
    table.string('correction_of', 36).nullable().references('id')
      .inTable('frontdesk_pickup_events').onDelete('RESTRICT');
    table.string('note', 200).notNullable().defaultTo('');
    table.string('correction_reason', 500).nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['organization_id', 'campus_id', 'active_release_key'], 'frontdesk_pickup_active_release_uq');
    table.unique(['organization_id', 'campus_id', 'occasion_key'], 'frontdesk_pickup_occasion_uq');
    table.index(['organization_id', 'campus_id', 'student_id', 'released_at'], 'frontdesk_pickup_student_date_idx');
  });
  await createIfMissing(knex, 'frontdesk_pickup_attempts', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('person_name', 180).notNullable();
    table.string('attempted_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.dateTime('attempted_at', { useTz: false }).notNullable();
    table.string('reason', 200).notNullable();
    table.string('verification_note', 200).notNullable().defaultTo('');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['organization_id', 'campus_id', 'student_id', 'attempted_at'], 'frontdesk_pickup_attempt_student_date_idx');
  });
  await createIfMissing(knex, 'frontdesk_deliveries', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('recipient_staff_id', 36).nullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.string('recipient_name', 180).notNullable();
    table.string('description', 500).notNullable();
    table.string('status', 20).notNullable().defaultTo('received');
    table.dateTime('received_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.dateTime('collected_at', { useTz: false }).nullable();
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamp('archived_at').nullable();
    timestamps(table, knex);
    table.index(['organization_id', 'campus_id', 'status', 'received_at'], 'frontdesk_delivery_status_date_idx');
  });
  await createIfMissing(knex, 'frontdesk_lost_found', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('description', 500).notNullable();
    table.string('location_found', 180).notNullable();
    table.string('status', 20).notNullable().defaultTo('unclaimed');
    table.string('claimed_by', 180).nullable();
    table.dateTime('found_at', { useTz: false }).notNullable();
    table.dateTime('claimed_at', { useTz: false }).nullable();
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamp('archived_at').nullable();
    timestamps(table, knex);
    table.index(['organization_id', 'campus_id', 'status', 'found_at'], 'frontdesk_lost_found_status_date_idx');
  });
  await createIfMissing(knex, 'frontdesk_settings', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.boolean('block_absent_pickup').notNullable().defaultTo(false);
    table.boolean('block_released_today').notNullable().defaultTo(true);
    table.string('security_role_key', 80).nullable();
    timestamps(table, knex);
    table.unique(['organization_id', 'campus_id'], 'frontdesk_settings_tenant_uq');
  });
}

export async function down() {
  throw new Error('WP13 front desk schema migration is forward-only.');
}
