import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, login, sessionCookie, PASSWORD } from './helpers/app.js';
import { fakeTmdb } from './helpers/tmdb-fake.js';

const T0 = Date.UTC(2026, 9, 31, 20, 0, 0);
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const realFetch = globalThis.fetch;

let env;
beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now: T0 });
  globalThis.fetch = fakeTmdb().fetch;
  env = makeEnv();
});
afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
});

const tryPassword = (password, options = {}) => call(env, 'POST', '/api/login', { body: { password }, ...options });
const openList = (cookie) => call(env, 'GET', '/api/titles', { cookie });

describe('login', () => {
  test('the right password starts a session that opens the list', async () => {
    const res = await tryPassword(PASSWORD);
    assert.equal(res.status, 204);
    assert.equal((await openList(sessionCookie(res))).status, 200);
  });

  test('the session cookie is hidden from scripts, HTTPS-only, same-site and kept for a year', async () => {
    const header = (await tryPassword(PASSWORD)).headers.get('Set-Cookie');
    assert.match(header, /; HttpOnly(;|$)/);
    assert.match(header, /; Secure(;|$)/);
    assert.match(header, /; SameSite=Lax(;|$)/);
    assert.match(header, /; Path=\/(;|$)/);
    assert.match(header, /; Max-Age=31536000(;|$)/);
  });

  test('a wrong password is refused without a session', async () => {
    const res = await tryPassword('anakin123');
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'wrong_password' });
    assert.equal(res.headers.get('Set-Cookie'), null);
  });

  test('a request without a password is rejected', async () => {
    const res = await call(env, 'POST', '/api/login', { body: {} });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'invalid' });
  });

  test('nobody can log in until a password is configured', async () => {
    env = makeEnv({ APP_PASSWORD: undefined });
    const res = await tryPassword('');
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: 'not_configured' });
  });

  test('nobody can log in until the session secret is configured', async () => {
    env = makeEnv({ SESSION_SECRET: undefined });
    const res = await tryPassword(PASSWORD);
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: 'not_configured' });
  });

  test('logging out clears the session cookie', async () => {
    const cookie = await login(env);
    const res = await call(env, 'POST', '/api/logout', { cookie });
    assert.equal(res.status, 204);
    const header = res.headers.get('Set-Cookie');
    assert.ok(header.startsWith(`${cookie.split('=')[0]}=;`), header);
    assert.match(header, /; Max-Age=0(;|$)/);
  });
});

describe('sessions', () => {
  test('the list requires a session', async () => {
    const res = await openList();
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'unauthorized' });
  });

  test('a cookie that was tampered with is refused', async () => {
    const cookie = await login(env);
    const [name, value] = [cookie.slice(0, cookie.indexOf('=')), cookie.slice(cookie.indexOf('=') + 1)];
    const flip = (ch) => (ch === 'A' ? 'B' : 'A');
    const changedStart = `${name}=${flip(value[0])}${value.slice(1)}`;
    const changedEnd = `${name}=${value.slice(0, -1)}${flip(value.at(-1))}`;
    assert.equal((await openList(changedStart)).status, 401);
    assert.equal((await openList(changedEnd)).status, 401);
  });

  test('a session expires after a year', async () => {
    const cookie = await login(env);
    mock.timers.tick(364 * DAY);
    assert.equal((await openList(cookie)).status, 200);
    mock.timers.tick(2 * DAY);
    assert.equal((await openList(cookie)).status, 401);
  });

  test('a session in use is renewed once it is past half its life', async () => {
    const cookie = await login(env);
    mock.timers.tick(30 * DAY);
    assert.equal((await openList(cookie)).headers.get('Set-Cookie'), null);
    mock.timers.tick(170 * DAY);
    const renewed = sessionCookie(await openList(cookie));
    assert.ok(renewed, 'expected a renewed cookie on day 200');
    mock.timers.tick(300 * DAY);
    assert.equal((await openList(renewed)).status, 200);
  });

  test('changing the password signs every device out', async () => {
    const cookie = await login(env);
    env.APP_PASSWORD = 'uma senha nova';
    assert.equal((await openList(cookie)).status, 401);
  });
});

describe('login throttling', () => {
  test('after 10 wrong passwords even the right one is refused for 15 minutes', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await tryPassword(`chute ${i}`)).status, 401);
    const res = await tryPassword(PASSWORD);
    assert.equal(res.status, 429);
    assert.deepEqual(res.body, { error: 'too_many_attempts' });
    assert.equal(res.headers.get('Retry-After'), '900');
  });

  test('the block lifts 15 minutes after the first failure', async () => {
    for (let i = 0; i < 10; i++) await tryPassword('errada');
    mock.timers.tick(15 * MINUTE);
    assert.equal((await tryPassword(PASSWORD)).status, 204);
  });

  test('blocking one address does not block another', async () => {
    for (let i = 0; i < 10; i++) await tryPassword('errada', { ip: '198.51.100.1' });
    assert.equal((await tryPassword(PASSWORD, { ip: '198.51.100.2' })).status, 204);
  });

  test('a successful login forgets earlier failures', async () => {
    for (let i = 0; i < 9; i++) await tryPassword('errada');
    await login(env);
    for (let i = 0; i < 9; i++) await tryPassword('errada');
    assert.equal((await tryPassword(PASSWORD)).status, 204);
  });

  test('a burst of simultaneous guesses from one address still only gets 10 tries', async () => {
    const burst = await Promise.all(Array.from({ length: 30 }, (_, i) => tryPassword(`chute ${i}`)));
    const statuses = burst.map((res) => res.status);
    assert.equal(statuses.filter((s) => s === 401).length, 10);
    assert.equal(statuses.filter((s) => s === 429).length, 20);
  });

  test('addresses in the same IPv6 /64 network share one limit', async () => {
    for (let i = 1; i <= 10; i++) await tryPassword('errada', { ip: `2001:db8:1:2::${i}` });
    assert.equal((await tryPassword(PASSWORD, { ip: '2001:0DB8:0001:0002:0:0:0:abcd' })).status, 429);
    assert.equal((await tryPassword(PASSWORD, { ip: '2001:db8:1:3::1' })).status, 204);
  });

  test('wrong passwords spread over many addresses pause new logins for 15 minutes', async () => {
    for (let i = 0; i < 50; i++) await tryPassword('errada', { ip: `198.51.100.${i}` });
    const res = await tryPassword(PASSWORD, { ip: '203.0.113.200' });
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('Retry-After'), '900');
    mock.timers.tick(15 * MINUTE);
    assert.equal((await tryPassword(PASSWORD, { ip: '203.0.113.200' })).status, 204);
  });

  test('devices already signed in keep working while new logins are paused', async () => {
    const cookie = await login(env);
    for (let i = 0; i < 50; i++) await tryPassword('errada', { ip: `198.51.100.${i}` });
    assert.equal((await tryPassword(PASSWORD, { ip: '203.0.113.200' })).status, 429);
    assert.equal((await openList(cookie)).status, 200);
  });
});

describe('requests from other sites', () => {
  test('changes sent from another site are refused', async () => {
    const cookie = await login(env);
    const res = await call(env, 'POST', '/api/titles', {
      cookie,
      origin: 'https://evil.example',
      body: { tmdb_id: 1894, media_type: 'movie' },
    });
    assert.equal(res.status, 403);
    assert.deepEqual((await openList(cookie)).body.titles, []);
  });

  test('a login posted from another site is refused', async () => {
    const res = await tryPassword(PASSWORD, { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('Set-Cookie'), null);
  });
});

test('API answers are never stored by the browser cache', async () => {
  const cookie = await login(env);
  const responses = [await openList(cookie), await openList(), await tryPassword('errada')];
  for (const res of responses) assert.equal(res.headers.get('Cache-Control'), 'no-store', `status ${res.status}`);
});

test('unknown API paths answer 404', async () => {
  const cookie = await login(env);
  assert.equal((await call(env, 'GET', '/api/nada', { cookie })).status, 404);
});
