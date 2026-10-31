// Stateless sessions: the cookie holds its expiry time and an HMAC of it. The
// signing key mixes SESSION_SECRET with APP_PASSWORD, so changing the password
// signs every device out.

const COOKIE = 'sessao';
const LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;
const ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/';

const encoder = new TextEncoder();

const base64Url = (buffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

/** Compares two strings in time that depends only on their length. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const sha256 = async (text) => base64Url(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

async function sign(env, payload) {
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(`${env.SESSION_SECRET}\n${env.APP_PASSWORD}`));
  const key = await crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

export const isConfigured = (env) => Boolean(env.APP_PASSWORD && env.SESSION_SECRET);

export async function passwordMatches(env, attempt) {
  const [given, expected] = await Promise.all([sha256(attempt), sha256(env.APP_PASSWORD)]);
  return timingSafeEqual(given, expected);
}

/** A Set-Cookie value for a new session that lasts a year. */
export async function cookie(env, now) {
  const expires = String(now + LIFETIME_MS);
  return `${COOKIE}=${expires}.${await sign(env, expires)}; ${ATTRIBUTES}; Max-Age=${LIFETIME_MS / 1000}`;
}

export const clearedCookie = () => `${COOKIE}=; ${ATTRIBUTES}; Max-Age=0`;

function readCookie(request) {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator !== -1 && part.slice(0, separator).trim() === COOKIE) return part.slice(separator + 1).trim();
  }
  return null;
}

/**
 * Checks the request's session cookie. `renew` is set once the session is past
 * half its life, so devices in regular use never get logged out.
 */
export async function check(request, env, now) {
  if (!isConfigured(env)) return { valid: false };
  const match = readCookie(request)?.match(/^(\d+)\.([\w-]+)$/);
  if (!match) return { valid: false };
  const [, expires, signature] = match;
  if (Number(expires) <= now) return { valid: false };
  if (!timingSafeEqual(signature, await sign(env, expires))) return { valid: false };
  return { valid: true, renew: Number(expires) - now < LIFETIME_MS / 2 };
}
