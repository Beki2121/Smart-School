import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5174'),
  WEB_ALLOWED_ORIGINS: z.string().default('http://127.0.0.1:5174')
    .transform((value) => [...new Set(value.split(',').map((origin) => origin.trim()).filter(Boolean))]),
  JWT_ACCESS_SECRET: z.string().min(32).default('development-only-change-this-secret-32'),
  SENSITIVE_DATA_KEY: z.string().default('').refine((value) =>
    value === '' || (/^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, 'base64url').length === 32),
  'SENSITIVE_DATA_KEY must be a base64url-encoded 32-byte key.'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  STORAGE_MODE: z.enum(['memory', 'mysql']).default('memory'),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().default(3306),
  DB_SOCKET_PATH: z.string().default(''),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default('root'),
  DB_NAME: z.string().default('smartschool_sims'),
  PRIVATE_DOCUMENTS_DIR: z.string().default('.private/admissions'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().email().default('noreply@smartschool.local'),
  DEMO_LOGIN_EMAIL: z.string().email().default('admin@school.local'),
  DEMO_LOGIN_PASSWORD: z.string().min(12).default('ChangeMe123!')
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
for (const origin of [parsed.data.WEB_ORIGIN, ...parsed.data.WEB_ALLOWED_ORIGINS]) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`Invalid browser origin: ${origin}`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Invalid browser origin: ${origin}`);
  }
  if (parsed.data.NODE_ENV === 'production' &&
      (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error(`Production browser origins must use HTTPS and a public hostname: ${origin}`);
  }
}
if (parsed.data.NODE_ENV === 'production' && parsed.data.STORAGE_MODE !== 'mysql') {
  throw new Error('Production requires STORAGE_MODE=mysql.');
}
if (parsed.data.NODE_ENV === 'production' && !parsed.data.SENSITIVE_DATA_KEY) {
  throw new Error('Production requires a dedicated SENSITIVE_DATA_KEY for protected student data.');
}
if (parsed.data.NODE_ENV === 'production' &&
    /(replace-with|development-only|change-me|changeme)/i.test(parsed.data.JWT_ACCESS_SECRET)) {
  throw new Error('Replace the JWT_ACCESS_SECRET placeholder with a unique random secret in production.');
}
if (parsed.data.NODE_ENV === 'production' && new URL(parsed.data.WEB_ORIGIN).protocol !== 'https:') {
  throw new Error('Production WEB_ORIGIN must use HTTPS.');
}
if (parsed.data.NODE_ENV === 'production' && parsed.data.DB_USER.toLowerCase() === 'root') {
  throw new Error('Production must use a dedicated MySQL user instead of root.');
}
if (parsed.data.NODE_ENV === 'production' && parsed.data.DB_PASSWORD.toLowerCase() === 'root') {
  throw new Error('Production must use a non-default MySQL password.');
}
if (parsed.data.NODE_ENV === 'production' &&
    (!parsed.data.SMTP_HOST || !parsed.data.SMTP_USER || !parsed.data.SMTP_PASSWORD ||
      parsed.data.SMTP_FROM.endsWith('.local'))) {
  throw new Error('Production requires SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and a public SMTP_FROM address.');
}

export const config = parsed.data;
