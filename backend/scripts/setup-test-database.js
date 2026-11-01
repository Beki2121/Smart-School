import { connectTestDatabaseAdmin, getTestDatabaseConfig } from './database-admin.js';

const config = getTestDatabaseConfig();
const connection = await connectTestDatabaseAdmin();
const quoteString = (value) => connection.escape(value);
const quoteDatabase = (value) => `\`${value}\``;

try {
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS ${quoteDatabase(config.databaseName)} CHARACTER SET utf8mb4`
  );
  await connection.query(
    `DROP USER IF EXISTS ${quoteString(config.testUser)}@'localhost', ${quoteString(config.testUser)}@'%'`
  );
  await connection.query(
    `CREATE USER ${quoteString(config.testUser)}@'localhost' IDENTIFIED BY ${quoteString(config.testPassword)}`
  );
  await connection.query(
    `GRANT ALL PRIVILEGES ON ${quoteDatabase(config.databaseName)}.* ` +
    `TO ${quoteString(config.testUser)}@'localhost'`
  );
  console.log(`Created ${config.testUser}@localhost with access limited to ${config.databaseName}.`);
} catch (error) {
  console.error(`Test database setup failed (${error.code ?? error.message}).`);
  process.exitCode = 1;
} finally {
  await connection.end();
}
