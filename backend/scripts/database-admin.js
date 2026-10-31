import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

dotenv.config({ path: fileURLToPath(new URL('../../.env.mysql-test', import.meta.url)) });

export function getTestDatabaseConfig() {
  const { DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_NAME || !/^[A-Za-z0-9_]+_test$/.test(DB_NAME)) {
    throw new Error('Test database operations require a DB_NAME ending in "_test".');
  }
  if (!DB_USER || !/^[A-Za-z0-9_]+$/.test(DB_USER)) {
    throw new Error('Test database operations require a simple DB_USER name.');
  }
  if (!DB_PASSWORD) throw new Error('Test database operations require DB_PASSWORD.');
  return {
    databaseName: DB_NAME,
    testUser: DB_USER,
    testPassword: DB_PASSWORD
  };
}

export async function connectTestDatabaseAdmin() {
  if (!process.env.TEST_DB_ADMIN_USER || !process.env.TEST_DB_ADMIN_PASSWORD) {
    throw new Error('Set TEST_DB_ADMIN_USER and TEST_DB_ADMIN_PASSWORD locally to use MySQL admin scripts.');
  }
  const connection = process.env.DB_SOCKET_PATH
    ? { socketPath: process.env.DB_SOCKET_PATH }
    : {
      host: process.env.TEST_DB_ADMIN_HOST ?? process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306)
    };
  return mysql.createConnection({
    ...connection, user: process.env.TEST_DB_ADMIN_USER,
    password: process.env.TEST_DB_ADMIN_PASSWORD
  });
}
