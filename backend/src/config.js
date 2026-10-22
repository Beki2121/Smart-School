import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5174'),
  JWT_ACCESS_SECRET: z.string().min(32).default('development-only-change-this-secret-32'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  STORAGE_MODE: z.enum(['memory', 'mysql']).default('memory'),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().default(8889),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default('root'),
  DB_NAME: z.string().default('smartschool_sims'),
  DEMO_LOGIN_EMAIL: z.string().email().default('admin@school.local'),
  DEMO_LOGIN_PASSWORD: z.string().min(12).default('ChangeMe123!')
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
if (parsed.data.NODE_ENV === 'production' && parsed.data.STORAGE_MODE !== 'mysql') {
  throw new Error('Production requires STORAGE_MODE=mysql.');
}
if (parsed.data.NODE_ENV === 'production' &&
    parsed.data.JWT_ACCESS_SECRET.startsWith('development-only')) {
  throw new Error('Set a unique JWT_ACCESS_SECRET in production.');
}

export const config = parsed.data;
