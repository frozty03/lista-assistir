import worker from '../../src/worker.js';
import { createD1 } from './d1.js';
import { V4_TOKEN } from './tmdb-fake.js';

export const ORIGIN = 'https://lista.test';
export const PASSWORD = 'padme e anakin para sempre';

export function makeEnv(overrides = {}) {
  return {
    DB: createD1(),
    ASSETS: { fetch: async () => new Response('static asset') },
    APP_PASSWORD: PASSWORD,
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    TMDB_TOKEN: V4_TOKEN,
    ...overrides,
  };
}

/** Sends a request through the worker the way the browser app would. */
export async function call(env, method, path, { body, cookie, origin = ORIGIN, ip = '203.0.113.7' } = {}) {
  const headers = new Headers({ 'CF-Connecting-IP': ip });
  if (cookie) headers.set('Cookie', cookie);
  if (origin && method !== 'GET') headers.set('Origin', origin);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const request = new Request(ORIGIN + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await worker.fetch(request, env, { waitUntil() {}, passThroughOnException() {} });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, headers: response.headers, body: json };
}

/** The "name=value" part of the session cookie a response sets, or null. */
export function sessionCookie(response) {
  const header = response.headers.get('Set-Cookie');
  return header ? header.split(';')[0] : null;
}

export async function login(env, password = PASSWORD) {
  const response = await call(env, 'POST', '/api/login', { body: { password } });
  return sessionCookie(response);
}

/**
 * The browser app's api object (public/js/api.js) talking to the real worker:
 * same methods, same answers, and the same error shape ({ status, code, body }).
 */
export function apiFor(env, cookie) {
  const send = async (method, path, body) => {
    const res = await call(env, method, path, { cookie, body });
    if (res.status >= 400) throw Object.assign(new Error(res.body?.error), { status: res.status, code: res.body?.error ?? null, body: res.body });
    return res.body;
  };
  return {
    list: () => send('GET', '/api/titles'),
    add: (tmdb_id, media_type) => send('POST', '/api/titles', { tmdb_id, media_type }),
    edit: (id, changes) => send('PATCH', `/api/titles/${id}`, changes),
    remove: (id) => send('DELETE', `/api/titles/${id}`),
    refresh: (id) => send('POST', `/api/titles/${id}/refresh`),
  };
}
