const fs = require('node:fs');
const path = require('node:path');

const rootDir = process.cwd();
const envPath = path.join(rootDir, '.env');
const examplePath = path.join(rootDir, '.env.example');
const requiredKeys = ['NODE_ENV', 'PORT', 'WEB_ORIGIN', 'JWT_ACCESS_SECRET', 'JWT_ACCESS_TTL', 'STORAGE_MODE'];

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, 'utf8');
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) continue;
    const key = trimmed.slice(0, equalIndex).trim();
    const value = trimmed.slice(equalIndex + 1).trim();
    values[key] = value.replace(/^['"]|['"]$/g, '');
  }
  return values;
}

const env = readEnv(envPath);
const templateEnv = readEnv(examplePath);
const merged = { ...templateEnv, ...env, ...process.env };

const issues = [];
for (const key of requiredKeys) {
  if (!merged[key]) {
    issues.push(`${key} is missing from .env/.env.example.`);
  }
}

if (merged.JWT_ACCESS_SECRET && merged.JWT_ACCESS_SECRET.length < 32) {
  issues.push('JWT_ACCESS_SECRET should be at least 32 characters long.');
}

const nodeEnv = (merged.NODE_ENV ?? 'development').toLowerCase();
const webOrigins = [
  merged.WEB_ORIGIN,
  ...(merged.WEB_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)
];
for (const origin of webOrigins) {
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
      issues.push(`Browser origin is not a valid origin: ${origin}`);
    }
  } catch {
    issues.push(`Browser origin is not a valid URL: ${origin}`);
  }
}

const storageMode = (merged.STORAGE_MODE ?? '').toLowerCase();
if (!['memory', 'mysql'].includes(storageMode)) {
  issues.push('STORAGE_MODE must be either memory or mysql.');
}

if (storageMode === 'mysql') {
  for (const key of ['DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (!merged[key]) issues.push(`${key} is required when STORAGE_MODE=mysql.`);
  }
  if (!merged.DB_SOCKET_PATH && !merged.DB_HOST) {
    issues.push('DB_HOST is required when DB_SOCKET_PATH is not configured.');
  }
  if (!merged.DB_SOCKET_PATH && merged.DB_PORT && Number.isNaN(Number(merged.DB_PORT))) {
    issues.push('DB_PORT must be numeric.');
  }
}

if (nodeEnv === 'production') {
  if (storageMode !== 'mysql') issues.push('Production requires STORAGE_MODE=mysql.');
  if (/(replace-with|development-only|change-me|changeme)/i.test(merged.JWT_ACCESS_SECRET ?? '')) {
    issues.push('Production requires a unique JWT_ACCESS_SECRET; replace the example placeholder.');
  }
  if (merged.DB_USER?.toLowerCase() === 'root') {
    issues.push('Production must use a dedicated MySQL user instead of root.');
  }
  if (merged.DB_PASSWORD?.toLowerCase() === 'root') {
    issues.push('Production must use a non-default MySQL password.');
  }
  const sensitiveKey = merged.SENSITIVE_DATA_KEY ?? '';
  if (!sensitiveKey) {
    issues.push('Production requires a dedicated SENSITIVE_DATA_KEY.');
  } else if (!/^[A-Za-z0-9_-]{43}$/.test(sensitiveKey) ||
      Buffer.from(sensitiveKey, 'base64url').length !== 32) {
    issues.push('SENSITIVE_DATA_KEY must be a dedicated base64url-encoded 32-byte key.');
  }
  if (!merged.WEB_ORIGIN?.startsWith('https://')) {
    issues.push('Production WEB_ORIGIN must use HTTPS.');
  }
  for (const origin of (merged.WEB_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean)) {
    let url;
    try { url = new URL(origin); }
    catch { continue; }
    if (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)) {
      issues.push('Production WEB_ALLOWED_ORIGINS must contain only HTTPS public origins.');
      break;
    }
  }
}

if (merged.VITE_API_BASE_URL) {
  try {
    const apiUrl = new URL(merged.VITE_API_BASE_URL);
    if (!['http:', 'https:'].includes(apiUrl.protocol)) issues.push('VITE_API_BASE_URL must use HTTP or HTTPS.');
    if (nodeEnv === 'production' && apiUrl.protocol !== 'https:') {
      issues.push('Production VITE_API_BASE_URL must use HTTPS.');
    }
  } catch {
    issues.push('VITE_API_BASE_URL must be a valid absolute URL.');
  }
}

const demoCreds = merged.DEMO_LOGIN_EMAIL || merged.DEMO_LOGIN_PASSWORD;
if (!demoCreds && storageMode === 'memory') {
  issues.push('Memory mode should include DEMO_LOGIN_EMAIL and DEMO_LOGIN_PASSWORD.');
}

const envSource = fs.existsSync(envPath) ? '.env' : (fs.existsSync(examplePath) ? '.env.example' : 'none');
console.log(`Checking local install configuration using ${envSource}.`);

if (issues.length > 0) {
  console.error('Installation readiness check failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log('Local install configuration looks ready.');
console.log(`- Storage mode: ${merged.STORAGE_MODE}`);
console.log(`- Backend: http://localhost:${merged.PORT || 4000}`);
console.log(`- Frontend API: ${merged.VITE_API_BASE_URL || 'Vite development proxy'}`);
console.log(`- Web origin: ${merged.WEB_ORIGIN || 'http://localhost:5174'}`);
console.log('- Next step: run npm install and then npm run dev');
