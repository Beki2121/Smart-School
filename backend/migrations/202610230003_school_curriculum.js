import { randomUUID } from 'node:crypto';
import { DEFAULT_GRADING_BANDS, getGradeTemplate } from '../src/school-curriculum.js';

export async function up(knex) {
  if (await knex.schema.hasTable('sections') && !await knex.schema.hasColumn('sections', 'stream')) {
    await knex.schema.alterTable('sections', (table) => {
      table.string('stream', 24).nullable();
    });
  }
  if (!await knex.schema.hasTable('grade_subjects')) {
    await knex.schema.createTable('grade_subjects', (table) => {
      table.string('id', 36).primary();
      table.string('grade_level_id', 36).notNullable()
        .references('id').inTable('grade_levels').onDelete('CASCADE');
      table.string('subject_id', 36).notNullable()
        .references('id').inTable('subjects').onDelete('RESTRICT');
      table.string('stream', 24).notNullable().defaultTo('all');
      table.integer('weekly_periods').unsigned().notNullable().defaultTo(1);
      table.boolean('is_required').notNullable().defaultTo(true);
      table.unique(['grade_level_id', 'subject_id', 'stream'], 'grade_subject_stream_uq');
      table.index(['grade_level_id', 'stream'], 'grade_subject_grade_stream_idx');
    });
  }

  const grades = await knex('grade_levels').select('id', 'campus_id', 'code');
  for (const grade of grades) {
    const template = getGradeTemplate(grade.code);
    if (!template) continue;
    const subjectIds = new Map();
    for (const item of template.subjects) {
      let subject = await knex('subjects').where({
        campus_id: grade.campus_id, code: item.code
      }).first('id');
      if (!subject) {
        const id = randomUUID();
        await knex('subjects').insert({
          id, campus_id: grade.campus_id, code: item.code,
          name_en: item.nameEn, name_am: item.nameAm
        });
        subject = { id };
      }
      subjectIds.set(item.code, subject.id);
    }
    const mappings = template.subjects.map((item) => ({
      id: randomUUID(), grade_level_id: grade.id, subject_id: subjectIds.get(item.code),
      stream: item.stream, weekly_periods: item.weeklyPeriods, is_required: true
    }));
    await knex('grade_subjects').insert(mappings)
      .onConflict(['grade_level_id', 'subject_id', 'stream']).ignore();
  }

  const campuses = await knex('campuses').whereIn(
    'id', knex('grade_levels').select('campus_id').groupBy('campus_id')
  ).select('id');
  for (const campus of campuses) {
    const count = await knex('grading_bands').where({ campus_id: campus.id }).count({ total: '*' }).first();
    if (Number(count.total) === 0) {
      await knex('grading_bands').insert(DEFAULT_GRADING_BANDS.map((band) => ({
        id: randomUUID(), campus_id: campus.id, code: band.code,
        name_en: band.nameEn, name_am: band.nameAm, min_percent: band.minPercent
      })));
    }
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('grade_subjects');
  if (await knex.schema.hasColumn('sections', 'stream')) {
    await knex.schema.alterTable('sections', (table) => table.dropColumn('stream'));
  }
}
