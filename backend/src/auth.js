import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

const refreshCookie = 'sims_refresh';
const refreshTtlMs = 30 * 24 * 60 * 60 * 1000;

export function issueAccessToken(user, config) {
  const claims = {
    orgId: user.orgId,
    role: user.role,
    campusIds: user.campusIds,
    activeCampusId: user.activeCampusId
  };
  return jwt.sign(claims, config.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: config.JWT_ACCESS_TTL,
    issuer: 'smartschool-sims',
    audience: 'smartschool-sims-web'
  });
}

export function verifyAccessToken(token, config) {
  return jwt.verify(token, config.JWT_ACCESS_SECRET, {
    issuer: 'smartschool-sims',
    audience: 'smartschool-sims-web'
  });
}

export function createRefreshSecret() {
  const value = randomBytes(48).toString('base64url');
  return { value, hash: hashRefreshSecret(value) };
}

export function hashRefreshSecret(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function getRefreshCookie(request) {
  const cookies = (request.headers.cookie ?? '').split(';');
  const pair = cookies.map((part) => part.trim()).find((part) => part.startsWith(`${refreshCookie}=`));
  return pair ? decodeURIComponent(pair.slice(refreshCookie.length + 1)) : null;
}

export function setRefreshCookie(response, value, production) {
  const flags = ['HttpOnly', 'SameSite=Strict', 'Path=/api/auth', `Max-Age=${refreshTtlMs / 1000}`];
  if (production) flags.push('Secure');
  response.setHeader('Set-Cookie', `${refreshCookie}=${encodeURIComponent(value)}; ${flags.join('; ')}`);
}

export function clearRefreshCookie(response, production) {
  const flags = ['HttpOnly', 'SameSite=Strict', 'Path=/api/auth', 'Max-Age=0'];
  if (production) flags.push('Secure');
  response.setHeader('Set-Cookie', `${refreshCookie}=; ${flags.join('; ')}`);
}

export function refreshExpiresAt() {
  return new Date(Date.now() + refreshTtlMs);
}
