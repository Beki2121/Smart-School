import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import knexFactory from 'knex';
import knexConfig from '../knexfile.js';

const platformOrganizationId = '00000000-0000-4000-8000-000000000001';
const { PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_NAME, PLATFORM_ADMIN_PASSWORD } = process.env;

if (process.env.ALLOW_PLATFORM_ADMIN_BOOTSTRAP !== 'true') {
  throw new Error('Set ALLOW_PLATFORM_ADMIN_BOOTSTRAP=true to explicitly bootstrap a platform administrator.');
}
if (!PLATFORM_ADMIN_EMAIL || PLATFORM_ADMIN_EMAIL.trim().length > 254 ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(PLATFORM_ADMIN_EMAIL.trim()) ||
  !PLATFORM_ADMIN_NAME?.trim() || PLATFORM_ADMIN_NAME.trim().length > 180 ||
  !PLATFORM_ADMIN_PASSWORD || PLATFORM_ADMIN_PASSWORD.length < 16) {
  throw new Error('Set a valid platform admin name/email and a private password of at least 16 characters.');
}

const email = PLATFORM_ADMIN_EMAIL.trim().toLowerCase();
const passwordHash = await bcrypt.hash(PLATFORM_ADMIN_PASSWORD, 12);
const db = knexFactory(knexConfig.development);
try {
  await db.transaction(async (trx) => {
    const organization = await trx('organizations').where({ id: platformOrganizationId }).first('id');
    if (!organization) throw new Error('Run the SaaS platform migration before bootstrapping its administrator.');
    const existing = await trx('users').whereRaw('LOWER(email) = ?', [email]).first('id');
    if (existing) throw new Error('An account already uses this email address.');
    const id = randomUUID();
    await trx('users').insert({
      id, organization_id: platformOrganizationId, name: PLATFORM_ADMIN_NAME.trim(),
      email, password_hash: passwordHash, role: 'super_admin', is_active: true
    });
    await trx('audit_log').insert({
      id: randomUUID(), organization_id: platformOrganizationId, campus_id: null,
      actor_id: id, action: 'platform_admin.bootstrapped',
      entity_type: 'user', entity_id: id, before_json: null,
      after_json: JSON.stringify({ email, role: 'super_admin' })
    });
  });
  console.log('Platform administrator created. Remove the bootstrap environment variables now.');
} finally {
  await db.destroy();
}
