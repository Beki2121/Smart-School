import knexFactory from 'knex';
import { getTestDatabaseConfig } from './database-admin.js';

getTestDatabaseConfig();
const knexfile = (await import('../knexfile.js')).default;
const db = knexFactory(knexfile.test);

try {
  const [batch, migrations] = await db.migrate.latest();
  console.log(`Applied ${migrations.length} migration(s) in batch ${batch}.`);
} catch (error) {
  console.error(`Test database migration failed (${error.code ?? error.message}).`);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
