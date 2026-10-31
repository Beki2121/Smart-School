import { randomBytes } from 'node:crypto';

async function hasIndex(knex, table, name) {
  const [rows] = await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [table, name]);
  return rows.length > 0;
}

export async function up(knex) {
  if (!await knex.schema.hasColumn('campuses', 'admissions_public_token')) {
    await knex.schema.alterTable('campuses', (table) => {
      table.string('admissions_public_token', 64).nullable().unique();
    });
  }
  const campuses = await knex('campuses').select('id');
  for (const campus of campuses) {
    await knex('campuses').where({ id: campus.id }).update({
      admissions_public_token: randomBytes(32).toString('hex')
    });
  }
  if (!await knex.schema.hasColumn('students', 'allergies_enc')) {
    await knex.schema.alterTable('students', (table) => {
      table.text('allergies_enc').nullable();
    });
  }
  if (!await knex.schema.hasTable('student_documents')) {
    await knex.schema.createTable('student_documents', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.enu('document_type', ['photo', 'birth_certificate', 'previous_school_record', 'transfer_consent', 'other']).notNullable();
    table.string('original_name', 180).notNullable();
    table.string('mime_type', 80).notNullable();
    table.integer('size_bytes').unsigned().notNullable();
    table.string('storage_key', 80).notNullable().unique();
    table.string('sha256', 64).notNullable();
    table.string('uploaded_by', 36).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.index(['campus_id', 'student_id', 'document_type'], 'student_documents_scope_idx');
    });
  }
  if (!await knex.schema.hasTable('student_section_transfers')) {
    await knex.schema.createTable('student_section_transfers', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('academic_year_id', 36).notNullable().references('id').inTable('academic_years').onDelete('RESTRICT');
    table.string('from_section_id', 36).notNullable().references('id').inTable('sections').onDelete('RESTRICT');
    table.string('to_section_id', 36).notNullable().references('id').inTable('sections').onDelete('RESTRICT');
    table.string('reason', 500).notNullable();
    table.string('recorded_by', 36).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.index(['campus_id', 'student_id', 'created_at'], 'student_section_transfers_scope_idx');
    });
  }
  if (!await knex.schema.hasTable('student_discipline_records')) {
    await knex.schema.createTable('student_discipline_records', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.date('recorded_on').notNullable();
    table.string('category', 80).notNullable();
    table.text('details_enc').notNullable();
    table.text('action_taken_enc').nullable();
    table.string('recorded_by', 36).notNullable();
    table.timestamps(true, true);
      table.index(['campus_id', 'student_id', 'recorded_on'], 'student_discipline_records_scope_idx');
    });
  }
  if (!await hasIndex(knex, 'student_discipline_records', 'student_discipline_records_scope_idx')) {
    await knex.schema.alterTable('student_discipline_records', (table) => {
      table.index(['campus_id', 'student_id', 'recorded_on'], 'student_discipline_records_scope_idx');
    });
  }
  if (!await knex.schema.hasTable('student_transfer_packages')) {
    await knex.schema.createTable('student_transfer_packages', (table) => {
    table.string('id', 36).primary();
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('recipient_school', 180).notNullable();
    table.string('guardian_name', 180).notNullable();
    table.string('guardian_relationship', 60).notNullable();
    table.date('consent_recorded_on').notNullable();
    table.string('consent_document_id', 36).notNullable().references('id').inTable('student_documents').onDelete('RESTRICT');
    table.enu('status', ['pending', 'approved', 'rejected']).notNullable().defaultTo('pending');
    table.string('share_token_hash', 64).nullable().unique();
    table.timestamp('expires_at').nullable();
    table.string('approved_by', 36).nullable();
    table.timestamp('approved_at').nullable();
    table.string('created_by', 36).notNullable();
    table.timestamps(true, true);
      table.index(['campus_id', 'student_id', 'status'], 'student_transfer_packages_scope_idx');
    });
  }
  if (!await knex.schema.hasColumn('admissions', 'public_submission')) {
    await knex.schema.alterTable('admissions', (table) => {
      table.boolean('public_submission').notNullable().defaultTo(false);
    });
  }
  if (!await knex.schema.hasColumn('admissions', 'privacy_consent_at')) {
    await knex.schema.alterTable('admissions', (table) => {
      table.dateTime('privacy_consent_at').nullable();
    });
  }
}

export async function down(knex) {
  for (const table of [
    'student_discipline_records', 'student_transfer_packages',
    'student_section_transfers', 'student_documents'
  ]) await knex.schema.dropTableIfExists(table);
  if (await knex.schema.hasColumn('admissions', 'privacy_consent_at')) {
    await knex.schema.alterTable('admissions', (table) => table.dropColumn('privacy_consent_at'));
  }
  if (await knex.schema.hasColumn('admissions', 'public_submission')) {
    await knex.schema.alterTable('admissions', (table) => table.dropColumn('public_submission'));
  }
  if (await knex.schema.hasColumn('students', 'allergies_enc')) {
    await knex.schema.alterTable('students', (table) => table.dropColumn('allergies_enc'));
  }
  if (await knex.schema.hasColumn('campuses', 'admissions_public_token')) {
    await knex.schema.alterTable('campuses', (table) => table.dropColumn('admissions_public_token'));
  }
}
