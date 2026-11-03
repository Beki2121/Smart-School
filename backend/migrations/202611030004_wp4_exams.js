import { randomUUID } from 'node:crypto';

async function addColumn(knex, tableName, columnName, addColumn) {
  if (!await knex.schema.hasColumn(tableName, columnName)) {
    await knex.schema.alterTable(tableName, addColumn);
  }
}

async function createTableIfMissing(knex, name, create) {
  if (!await knex.schema.hasTable(name)) await knex.schema.createTable(name, create);
}

async function hasIndex(knex, table, name) {
  const [rows] = await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [table, name]);
  return rows.length > 0;
}

async function hasForeignKey(knex, table, column, referencedTable) {
  const [rows] = await knex.raw(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
       AND REFERENCED_TABLE_NAME = ?`,
    [table, column, referencedTable]
  );
  return rows.length > 0;
}

async function isNullable(knex, table, column) {
  const [rows] = await knex.raw(
    `SELECT IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0]?.IS_NULLABLE === 'YES';
}

function legacyStatus(marks) {
  if (marks.every((mark) => mark.state === 'locked')) return 'published';
  if (marks.every((mark) => ['approved', 'locked'].includes(mark.state))) return 'approved';
  if (marks.every((mark) => ['submitted', 'approved', 'locked'].includes(mark.state))) return 'submitted';
  return 'draft';
}

export async function up(knex) {
  await addColumn(knex, 'marks', 'organization_id', (table) =>
    table.string('organization_id').nullable());
  await addColumn(knex, 'marks', 'exam_id', (table) => table.string('exam_id', 36).nullable());

  await createTableIfMissing(knex, 'exam_types', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable()
      .references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('code', 32).notNullable();
    table.string('name', 100).notNullable();
    table.integer('weight_basis_points').unsigned().notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
    table.unique(['organization_id', 'code'], 'exam_type_org_code_uq');
    table.index(['organization_id', 'is_active'], 'exam_type_org_active_idx');
  });

  await createTableIfMissing(knex, 'exams', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable()
      .references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable()
      .references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('academic_year_id', 36).nullable()
      .references('id').inTable('academic_years').onDelete('RESTRICT');
    table.string('term_id', 36).nullable().references('id').inTable('terms').onDelete('RESTRICT');
    table.string('grade_level_id', 36).nullable()
      .references('id').inTable('grade_levels').onDelete('RESTRICT');
    table.string('subject_id', 36).nullable().references('id').inTable('subjects').onDelete('RESTRICT');
    table.string('exam_type_id', 36).notNullable()
      .references('id').inTable('exam_types').onDelete('RESTRICT');
    table.string('title', 120).notNullable();
    table.integer('weight_basis_points').unsigned().notNullable();
    table.decimal('max_value', 7, 2).unsigned().notNullable().defaultTo(100);
    table.string('status', 24).notNullable().defaultTo('draft');
    table.boolean('is_legacy').notNullable().defaultTo(false);
    table.string('created_by', 36).nullable().references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('schedule_published_at').nullable();
    table.timestamp('marks_opened_at').nullable();
    table.timestamps(true, true);
    table.unique(
      ['campus_id', 'term_id', 'grade_level_id', 'subject_id', 'exam_type_id'],
      'exam_context_type_uq'
    );
    table.index(['organization_id', 'campus_id', 'status'], 'exam_org_campus_status_idx');
    table.index(['campus_id', 'academic_year_id', 'term_id'], 'exam_term_filter_idx');
    table.index(['campus_id', 'grade_level_id', 'subject_id'], 'exam_grade_subject_idx');
  });

  await createTableIfMissing(knex, 'exam_schedule_entries', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable()
      .references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable()
      .references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('exam_id', 36).notNullable().references('id').inTable('exams').onDelete('RESTRICT');
    table.string('section_id', 36).notNullable()
      .references('id').inTable('sections').onDelete('RESTRICT');
    table.date('exam_date').notNullable();
    table.time('starts_at').notNullable();
    table.time('ends_at').notNullable();
    table.string('room_id', 36).nullable().references('id').inTable('rooms').onDelete('RESTRICT');
    table.timestamps(true, true);
    table.unique(['exam_id', 'section_id', 'exam_date'], 'exam_schedule_exam_section_date_uq');
    table.index(['organization_id', 'campus_id', 'exam_date'], 'exam_schedule_date_filter_idx');
    table.index(['campus_id', 'section_id', 'exam_date'], 'exam_schedule_section_date_idx');
    table.index(['campus_id', 'room_id', 'exam_date'], 'exam_schedule_room_date_idx');
  });

  await createTableIfMissing(knex, 'exam_schedule_invigilators', (table) => {
    table.string('organization_id', 36).notNullable()
      .references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable()
      .references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('schedule_entry_id', 36).notNullable()
      .references('id').inTable('exam_schedule_entries').onDelete('CASCADE');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.primary(['schedule_entry_id', 'staff_id']);
    table.index(['campus_id', 'staff_id'], 'exam_invigilator_staff_idx');
  });

  await createTableIfMissing(knex, 'exam_notifications', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable()
      .references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable()
      .references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('exam_id', 36).notNullable().references('id').inTable('exams').onDelete('RESTRICT');
    table.string('recipient_id', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('notification_type', 32).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['exam_id', 'recipient_id', 'notification_type'], 'exam_notice_recipient_type_uq');
    table.index(['organization_id', 'campus_id', 'exam_id'], 'exam_notice_scope_idx');
  });

  const campuses = await knex('campuses').select('id', 'organization_id');
  const legacyTypeIds = new Map();
  for (const campus of campuses) {
    await knex('marks').where({ campus_id: campus.id })
      .whereNull('organization_id').update({ organization_id: campus.organization_id });
    let legacyType = await knex('exam_types').where({
      organization_id: campus.organization_id, code: 'legacy'
    }).first('id');
    if (!legacyType) {
      const id = randomUUID();
      await knex('exam_types').insert({
        id, organization_id: campus.organization_id,
        code: 'legacy', name: 'Legacy', weight_basis_points: 10000, is_active: false
      });
      legacyType = { id };
    }
    legacyTypeIds.set(campus.id, legacyType.id);
  }

  const marks = await knex('marks as m')
    .join('campuses as c', 'c.id', 'm.campus_id')
    .leftJoin('terms as t', 't.id', 'm.term_id')
    .select(
      'm.id', 'm.campus_id', 'm.student_id', 'm.term_id', 'm.subject_id',
      'm.state', 'c.organization_id', 't.academic_year_id'
    )
    .whereNull('m.exam_id')
    .orderBy('m.created_at').orderBy('m.id');
  const groups = new Map();
  for (const mark of marks) {
    let gradeLevelId = null;
    if (mark.academic_year_id) {
      const enrollment = await knex('enrolments as e')
        .join('sections as s', 's.id', 'e.section_id')
        .where({
          'e.student_id': mark.student_id,
          'e.academic_year_id': mark.academic_year_id,
          'e.status': 'active',
          's.campus_id': mark.campus_id
        }).orderBy('e.created_at').first('s.grade_level_id');
      gradeLevelId = enrollment?.grade_level_id ?? null;
    }
    const key = [
      mark.campus_id, mark.term_id ?? '', gradeLevelId ?? '', mark.subject_id ?? ''
    ].join(':');
    const group = groups.get(key) ?? {
      campusId: mark.campus_id, organizationId: mark.organization_id,
      academicYearId: mark.academic_year_id, termId: mark.term_id,
      gradeLevelId, subjectId: mark.subject_id, marks: []
    };
    group.marks.push(mark);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const examId = randomUUID();
    await knex('exams').insert({
      id: examId,
      organization_id: group.organizationId,
      campus_id: group.campusId,
      academic_year_id: group.academicYearId,
      term_id: group.termId,
      grade_level_id: group.gradeLevelId,
      subject_id: group.subjectId,
      exam_type_id: legacyTypeIds.get(group.campusId),
      title: 'Legacy results',
      weight_basis_points: 10000,
      max_value: 100,
      status: legacyStatus(group.marks),
      is_legacy: true
    });
    await knex('marks').whereIn('id', group.marks.map((mark) => mark.id))
      .update({ exam_id: examId });
  }

  const orphanedMarks = await knex('marks').whereNull('exam_id').count({ total: '*' }).first();
  if (Number(orphanedMarks.total)) {
    throw new Error('WP4 migration could not link every existing mark to a legacy exam.');
  }
  const nullableOrganization = await isNullable(knex, 'marks', 'organization_id');
  const nullableExam = await isNullable(knex, 'marks', 'exam_id');
  if (nullableOrganization || nullableExam) {
    await knex.schema.alterTable('marks', (table) => {
      if (nullableOrganization) table.string('organization_id', 36).notNullable().alter();
      if (nullableExam) table.string('exam_id', 36).notNullable().alter();
    });
  }
  if (!await hasForeignKey(knex, 'marks', 'exam_id', 'exams')) {
    await knex.schema.alterTable('marks', (table) =>
      table.foreign('exam_id').references('id').inTable('exams').onDelete('RESTRICT'));
  }
  if (!await hasIndex(knex, 'marks', 'marks_exam_scope_idx')) {
    await knex.schema.alterTable('marks', (table) =>
      table.index(['organization_id', 'campus_id', 'exam_id'], 'marks_exam_scope_idx'));
  }
}

export async function down() {
  throw new Error('WP4 exam migration is irreversible because it preserves and links historical marks.');
}
