import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from 'node:crypto';

export const DEFAULT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAQ1CBuSMmbOBHbFnWk2mYhLi2EA1YlFT+1hUZie4ahjY=
-----END PUBLIC KEY-----`;

function parseJsonObject(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return null;
}

function canonicalPayload(payload) {
  return {
    organization: payload.organization,
    installationId: payload.installationId,
    expiry: payload.expiry,
    limits: payload.limits ?? {},
    modules: payload.modules ?? []
  };
}

export function issueLicenceDocument({
  organization,
  installationId,
  expiry,
  limits = {},
  modules = [],
  privateKey
}) {
  if (!privateKey) {
    throw new Error('A private key is required to issue a licence document.');
  }
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
  const payload = canonicalPayload({ organization, installationId, expiry, limits, modules });
  const signature = sign(null, Buffer.from(JSON.stringify(payload), 'utf8'), key).toString('base64');
  return JSON.stringify({ ...payload, signature });
}

export function generateLicenceKeyPair() {
  return generateKeyPairSync('ed25519');
}

export function verifyLicenceDocument(rawLicence, { publicKey = DEFAULT_PUBLIC_KEY } = {}) {
  if (rawLicence == null || (typeof rawLicence === 'string' && !rawLicence.trim())) {
    return { valid: false, reason: 'LICENCE_MISSING' };
  }
  const payload = parseJsonObject(rawLicence);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, reason: 'LICENCE_INVALID_JSON' };
  }
  const signature = payload.signature ?? payload.license;
  if (!signature || typeof signature !== 'string') {
    return { valid: false, reason: 'LICENCE_MISSING_SIGNATURE' };
  }
  if (!payload.organization || !payload.installationId || !payload.expiry) {
    return { valid: false, reason: 'LICENCE_MISSING_REQUIRED_FIELDS' };
  }

  const signingInput = JSON.stringify(canonicalPayload(payload));
  let key;
  try {
    key = typeof publicKey === 'string' ? createPublicKey(publicKey) : createPublicKey(publicKey);
  } catch {
    return { valid: false, reason: 'LICENCE_PUBLIC_KEY_INVALID' };
  }

  try {
    const ok = verify(null, Buffer.from(signingInput, 'utf8'), key, Buffer.from(signature, 'base64'));
    if (!ok) {
      return { valid: false, reason: 'LICENCE_SIGNATURE_INVALID' };
    }
  } catch {
    return { valid: false, reason: 'LICENCE_SIGNATURE_INVALID' };
  }

  const expiryDate = new Date(payload.expiry);
  if (Number.isNaN(expiryDate.getTime())) {
    return { valid: false, reason: 'LICENCE_INVALID_EXPIRY' };
  }
  if (new Date() > expiryDate) {
    return { valid: false, reason: 'LICENCE_EXPIRED' };
  }

  return { valid: true, data: payload };
}
