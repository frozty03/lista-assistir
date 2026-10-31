import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, login } from './helpers/app.js';
import { fakeTmdb, V3_KEY } from './helpers/tmdb-fake.js';

const realFetch = globalThis.fetch;

let env, cookie, tmdb;
beforeEach(async () => {
  tmdb = fakeTmdb();
  globalThis.fetch = tmdb.fetch;
  env = makeEnv();
  cookie = await login(env);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const search = (q) => call(env, 'GET', `/api/search?q=${encodeURIComponent(q)}`, { cookie });

test('finds movies and series in Portuguese and leaves out people', async () => {
  const res = await search('star wars');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, [
    {
      tmdb_id: 1894,
      media_type: 'movie',
      kind: 'movie',
      title: 'Star Wars: Episódio II - Ataque dos Clones',
      year: 2002,
      poster_path: '/9m1nJ2MfTG5QEmjOCg0b4YCo4W8.jpg',
    },
    {
      tmdb_id: 4194,
      media_type: 'tv',
      kind: 'series',
      title: 'Star Wars: The Clone Wars',
      year: 2008,
      poster_path: '/pvDFqSHSdyWiPu0ihJJkDXxnBM9.jpg',
    },
    {
      tmdb_id: 1361789,
      media_type: 'movie',
      kind: 'movie',
      title: 'Star Wars: Starfighter',
      year: null,
      poster_path: null,
    },
  ]);
});

test('Japanese animation is labelled as anime', async () => {
  const res = await search('frieren');
  assert.equal(res.body.results[0].kind, 'anime');
});

test('spaces around the query are ignored', async () => {
  const res = await search('  frieren  ');
  assert.equal(res.body.results.length, 1);
});

test('a one-letter query returns nothing without asking TMDB', async () => {
  const res = await search('a');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { results: [] });
  assert.equal(tmdb.requests.length, 0);
});

test('a v3 API key works as well as a read access token', async () => {
  env.TMDB_TOKEN = V3_KEY;
  const res = await search('frieren');
  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 1);
});

test('TMDB being down is reported', async () => {
  tmdb.fail();
  const res = await search('star wars');
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: 'tmdb_unavailable' });
});

test('a network failure reaching TMDB is reported the same way', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  const res = await search('star wars');
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: 'tmdb_unavailable' });
});

test('a token TMDB rejects is reported as unavailable', async () => {
  env.TMDB_TOKEN = 'eyJ-not-a-real-token';
  const res = await search('star wars');
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: 'tmdb_unavailable' });
});

test('a missing TMDB token is reported', async () => {
  env.TMDB_TOKEN = undefined;
  const res = await search('star wars');
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: 'tmdb_not_configured' });
});

test('searching requires a session', async () => {
  const res = await call(env, 'GET', '/api/search?q=star%20wars');
  assert.equal(res.status, 401);
  assert.equal(tmdb.requests.length, 0);
});
