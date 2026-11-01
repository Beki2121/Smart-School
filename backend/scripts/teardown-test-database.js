import { connectTestDatabaseAdmin, getTestDatabaseConfig } from './database-admin.js';

const config = getTestDatabaseConfig();
const connection = await connectTestDatabaseAdmin();
const quoteString = (value) => connection.escape(value);

try {
  await connection.query(`DROP DATABASE IF EXISTS \`${config.databaseName}\``);
  await connection.query(
    `DROP USER IF EXISTS ${quoteString(config.testUser)}@'localhost', ${quoteString(config.testUser)}@'%'`
  );
  console.log(`Dropped ${config.databaseName} and its dedicated test account.`);
} catch (error) {
  console.error(`Test database teardown failed (${error.code ?? error.message}).`);
  process.exitCode = 1;
} finally {
  await connection.end();
}
