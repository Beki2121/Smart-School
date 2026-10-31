import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateLicenceKeyPair, issueLicenceDocument } from '../backend/src/licence.js';

const outputDir = join(process.cwd(), 'tools', 'generated');
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

const { privateKey, publicKey } = generateLicenceKeyPair();
const payload = {
  organization: 'SmartSchool Ethiopia',
  installationId: 'demo-installation-001',
  expiry: '2035-12-31T23:59:59.000Z',
  limits: { maxStudents: 500, maxCampuses: 5 },
  modules: ['academic_setup', 'attendance', 'marks', 'fees', 'communications']
};
const licenceJson = issueLicenceDocument({ ...payload, privateKey });
writeFileSync(join(outputDir, 'licence.json'), licenceJson, 'utf8');
writeFileSync(join(outputDir, 'licence-public.pem'), publicKey.export({ type: 'spki', format: 'pem' }), 'utf8');
console.log(`Licence file written to ${join(outputDir, 'licence.json')}`);
console.log(`Public key written to ${join(outputDir, 'licence-public.pem')}`);
