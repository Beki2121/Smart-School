async function createIfMissing(knex, name, define) {
  if (!await knex.schema.hasTable(name)) await knex.schema.createTable(name, define);
}

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

export async function up(knex) {
  await createIfMissing(knex, 'library_settings', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.integer('loan_period_days').unsigned().notNullable().defaultTo(14);
    table.integer('max_active_loans').unsigned().notNullable().defaultTo(5);
    table.integer('max_renewals').unsigned().notNullable().defaultTo(2);
    table.bigInteger('fine_minor_per_day').unsigned().notNullable().defaultTo(100);
    table.string('currency_code', 3).notNullable().defaultTo('ETB');
    timestamps(table, knex);
    table.unique(['organization_id', 'campus_id'], 'library_settings_tenant_uq');
  });
  await createIfMissing(knex, 'library_categories', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('name', 120).notNullable();
    table.string('status', 20).notNullable().defaultTo('active');
    table.timestamp('archived_at').nullable();
    timestamps(table, knex);
    table.unique(['organization_id', 'campus_id', 'name'], 'library_category_name_uq');
    table.index(['organization_id', 'campus_id', 'status'], 'library_category_tenant_status_idx');
  });
  await createIfMissing(knex, 'library_books', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('category_id', 36).nullable().references('id').inTable('library_categories')
      .onDelete('RESTRICT');
    table.string('title', 240).notNullable();
    table.string('author', 200).notNullable();
    table.string('isbn', 32).nullable();
    table.string('publisher', 200).notNullable().defaultTo('');
    table.text('description').notNullable();
    table.string('status', 20).notNullable().defaultTo('active');
    table.timestamp('archived_at').nullable();
    timestamps(table, knex);
    table.unique(['organization_id', 'isbn'], 'library_book_isbn_uq');
    table.index(['organization_id', 'campus_id', 'category_id', 'status'], 'library_book_category_idx');
    table.index(['organization_id', 'campus_id', 'title'], 'library_book_title_idx');
  });
  await createIfMissing(knex, 'library_copies', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('book_id', 36).notNullable().references('id').inTable('library_books')
      .onDelete('RESTRICT');
    table.string('copy_number', 60).notNullable();
    table.string('barcode', 100).notNullable();
    table.string('condition', 32).notNullable().defaultTo('good');
    table.string('shelf_location', 120).notNullable().defaultTo('');
    table.string('status', 20).notNullable().defaultTo('available');
    table.timestamp('archived_at').nullable();
    timestamps(table, knex);
    table.unique(['organization_id', 'barcode'], 'library_copy_barcode_uq');
    table.unique(['organization_id', 'campus_id', 'book_id', 'copy_number'], 'library_copy_number_uq');
    table.index(['organization_id', 'campus_id', 'book_id', 'status'], 'library_copy_book_status_idx');
  });
  await createIfMissing(knex, 'library_members', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('member_type', 16).notNullable();
    table.string('student_id', 36).nullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('staff_id', 36).nullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.string('status', 20).notNullable().defaultTo('active');
    table.timestamp('archived_at').nullable();
    timestamps(table, knex);
    table.unique(['organization_id', 'campus_id', 'student_id'], 'library_member_student_uq');
    table.unique(['organization_id', 'campus_id', 'staff_id'], 'library_member_staff_uq');
    table.index(['organization_id', 'campus_id', 'member_type', 'status'], 'library_member_type_status_idx');
  });
  await createIfMissing(knex, 'library_loans', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('book_id', 36).notNullable().references('id').inTable('library_books').onDelete('RESTRICT');
    table.string('copy_id', 36).notNullable().references('id').inTable('library_copies').onDelete('RESTRICT');
    table.string('active_copy_id', 36).nullable();
    table.string('member_id', 36).notNullable().references('id').inTable('library_members').onDelete('RESTRICT');
    table.date('issued_on').notNullable();
    table.date('due_on').notNullable();
    table.date('returned_on').nullable();
    table.string('status', 20).notNullable().defaultTo('active');
    table.integer('renewal_count').unsigned().notNullable().defaultTo(0);
    table.string('return_condition', 32).nullable();
    table.string('issued_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('returned_by', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('idempotency_key', 100).notNullable();
    timestamps(table, knex);
    table.unique(['organization_id', 'campus_id', 'active_copy_id'], 'library_loan_active_copy_uq');
    table.unique(['organization_id', 'campus_id', 'idempotency_key'],
      'library_loan_idempotency_uq');
    table.index(['organization_id', 'campus_id', 'member_id', 'status'], 'library_loan_member_status_idx');
    table.index(['organization_id', 'campus_id', 'due_on', 'status'], 'library_loan_due_status_idx');
  });
  await createIfMissing(knex, 'library_reservations', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('book_id', 36).notNullable().references('id').inTable('library_books').onDelete('RESTRICT');
    table.string('member_id', 36).notNullable().references('id').inTable('library_members').onDelete('RESTRICT');
    table.string('idempotency_key', 100).notNullable();
    table.integer('queue_position').unsigned().notNullable();
    table.string('status', 20).notNullable().defaultTo('queued');
    table.string('ready_copy_id', 36).nullable().references('id').inTable('library_copies')
      .onDelete('RESTRICT');
    table.date('ready_until').nullable();
    table.timestamp('ready_at').nullable();
    table.timestamp('fulfilled_at').nullable();
    table.timestamp('cancelled_at').nullable();
    timestamps(table, knex);
    table.index(['organization_id', 'campus_id', 'book_id', 'status', 'queue_position'],
      'library_reservation_queue_idx');
    table.unique(['organization_id', 'campus_id', 'idempotency_key'],
      'library_reservation_idempotency_uq');
    table.index(['organization_id', 'campus_id', 'member_id', 'status'],
      'library_reservation_member_idx');
  });
  await createIfMissing(knex, 'library_fines', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('loan_id', 36).notNullable().references('id').inTable('library_loans').onDelete('RESTRICT');
    table.string('member_id', 36).notNullable().references('id').inTable('library_members').onDelete('RESTRICT');
    table.bigInteger('amount_minor').unsigned().notNullable();
    table.string('currency_code', 3).notNullable();
    table.integer('overdue_days').unsigned().notNullable();
    table.string('status', 20).notNullable().defaultTo('unpaid');
    table.string('reason', 500).notNullable().defaultTo('');
    table.string('waived_by', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('paid_by', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
    table.date('paid_on').nullable();
    table.timestamp('waived_at').nullable();
    timestamps(table, knex);
    table.unique(['organization_id', 'campus_id', 'loan_id'], 'library_fine_loan_uq');
    table.index(['organization_id', 'campus_id', 'member_id', 'status'], 'library_fine_member_status_idx');
  });
}

export async function down() {
  throw new Error('WP11 library schema migration is forward-only.');
}
