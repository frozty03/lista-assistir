import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, login } from './helpers/app.js';
import { fakeTmdb } from './helpers/tmdb-fake.js';
import * as fx from './fixtures/tmdb.js';

const T0 = Date.UTC(2026, 9, 31, 20, 0, 0);
const MINUTE = 60 * 1000;
const realFetch = globalThis.fetch;

let env, cookie, tmdb;
beforeEach(async () => {
  mock.timers.enable({ apis: ['Date'], now: T0 });
  tmdb = fakeTmdb();
  globalThis.fetch = tmdb.fetch;
  env = makeEnv();
  cookie = await login(env);
});
afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
});

const add = (tmdb_id, media_type) => call(env, 'POST', '/api/titles', { cookie, body: { tmdb_id, media_type } });
const edit = (id, body) => call(env, 'PATCH', `/api/titles/${id}`, { cookie, body });
const remove = (id) => call(env, 'DELETE', `/api/titles/${id}`, { cookie });
const refresh = (id) => call(env, 'POST', `/api/titles/${id}/refresh`, { cookie });
const list = async () => (await call(env, 'GET', '/api/titles', { cookie })).body.titles;

describe('adding', () => {
  test('a series is added from TMDB in Portuguese, waiting to be watched', async () => {
    const res = await add(83867, 'tv');
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.title, {
      id: 1,
      tmdb_id: 83867,
      media_type: 'tv',
      kind: 'series',
      title: 'Andor',
      original_title: 'Andor',
      year: 2022,
      poster_path: '/yX8c3bXKzAquEKQ75eQslnodskK.jpg',
      backdrop_path: '/quCeAmVQHfsdcYkicbxZWVauCVb.jpg',
      overview:
        'Numa era repleta de perigos, enganos e intriga, Cassian Andor vai descobrir a diferença que pode fazer na luta contra o tirânico Império Galático.',
      seasons: [
        { number: 1, episodes: 12 },
        { number: 2, episodes: 12 },
      ],
      status: 'planned',
      season: null,
      episode: null,
      version: 1,
      added_at: T0,
      updated_at: T0,
      refreshed_at: T0,
    });
  });

  test('a Japanese animated series is filed as anime, without its specials season', async () => {
    const { body } = await add(209867, 'tv');
    assert.equal(body.title.kind, 'anime');
    assert.deepEqual(body.title.seasons, [{ number: 1, episodes: 28 }]);
  });

  test('a missing Portuguese synopsis falls back to the English one', async () => {
    const { body } = await add(209867, 'tv');
    assert.equal(body.title.title, 'Frieren e a Jornada para o Além');
    assert.equal(body.title.overview, 'After the party of heroes defeated the Demon King, they restored peace to the land.');
  });

  test('a movie is added without seasons', async () => {
    const { status, body } = await add(1894, 'movie');
    assert.equal(status, 201);
    assert.equal(body.title.kind, 'movie');
    assert.equal(body.title.title, 'Star Wars: Episódio II - Ataque dos Clones');
    assert.equal(body.title.original_title, 'Star Wars: Episode II - Attack of the Clones');
    assert.equal(body.title.year, 2002);
    assert.deepEqual(body.title.seasons, []);
  });

  test('a Japanese animated movie is filed as anime', async () => {
    const { body } = await add(372058, 'movie');
    assert.equal(body.title.kind, 'anime');
    assert.equal(body.title.media_type, 'movie');
  });

  test('adding something already on the list returns the existing entry untouched', async () => {
    const first = (await add(83867, 'tv')).body.title;
    await edit(first.id, { version: 1, status: 'watching', season: 1, episode: 3 });
    const again = await add(83867, 'tv');
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already_listed');
    assert.equal(again.body.title.id, first.id);
    assert.equal(again.body.title.episode, 3);
    assert.equal((await list()).length, 1);
  });

  test('requests that do not name a movie or series are rejected without asking TMDB', async () => {
    const bodies = [
      { tmdb_id: 2, media_type: 'person' },
      { tmdb_id: 'abc', media_type: 'tv' },
      { tmdb_id: -5, media_type: 'tv' },
      { tmdb_id: 1.5, media_type: 'movie' },
      { media_type: 'tv' },
    ];
    for (const body of bodies) {
      const res = await call(env, 'POST', '/api/titles', { cookie, body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(res.body, { error: 'invalid' });
    }
    assert.equal(tmdb.requests.length, 0);
  });

  test('a title TMDB does not know is reported as not found', async () => {
    const res = await add(999999, 'tv');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'not_found' });
    assert.deepEqual(await list(), []);
  });

  test('when TMDB is down nothing is added', async () => {
    tmdb.fail();
    const res = await add(83867, 'tv');
    assert.equal(res.status, 502);
    assert.deepEqual(res.body, { error: 'tmdb_unavailable' });
    assert.deepEqual(await list(), []);
  });
});

describe('listing', () => {
  test('the list starts empty', async () => {
    assert.deepEqual(await list(), []);
  });

  test('the list returns every title with its seasons', async () => {
    await add(83867, 'tv');
    await add(1894, 'movie');
    const summary = (await list()).map((t) => [t.title, t.seasons.length]).sort();
    assert.deepEqual(summary, [
      ['Andor', 2],
      ['Star Wars: Episódio II - Ataque dos Clones', 0],
    ]);
  });
});

describe('editing', () => {
  test('progress and status are saved, with a new version and edit time', async () => {
    const { id } = (await add(83867, 'tv')).body.title;
    mock.timers.tick(5 * MINUTE);
    const res = await edit(id, { version: 1, status: 'watching', season: 2, episode: 6 });
    assert.equal(res.status, 200);
    const { status, season, episode, version, updated_at, added_at } = res.body.title;
    assert.deepEqual(
      { status, season, episode, version, updated_at, added_at },
      { status: 'watching', season: 2, episode: 6, version: 2, updated_at: T0 + 5 * MINUTE, added_at: T0 },
    );
    assert.equal((await list())[0].episode, 6);
  });

  test('fields that are not sent stay as they were', async () => {
    const { id } = (await add(83867, 'tv')).body.title;
    await edit(id, { version: 1, status: 'watching', season: 1, episode: 4 });
    const res = await edit(id, { version: 2, episode: 5 });
    assert.equal(res.body.title.status, 'watching');
    assert.equal(res.body.title.season, 1);
    assert.equal(res.body.title.episode, 5);
  });

  test('an edit made from an outdated copy is refused and gets the current state back', async () => {
    const { id } = (await add(83867, 'tv')).body.title;
    await edit(id, { version: 1, status: 'watching', season: 1, episode: 4 });
    const stale = await edit(id, { version: 1, status: 'watching', season: 1, episode: 5 });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'conflict');
    assert.equal(stale.body.title.version, 2);
    assert.equal(stale.body.title.episode, 4);
    assert.equal((await list())[0].episode, 4);
  });

  test('a title can be moved to another type filter', async () => {
    const { id } = (await add(83867, 'tv')).body.title;
    const res = await edit(id, { version: 1, kind: 'anime' });
    assert.equal(res.status, 200);
    assert.equal(res.body.title.kind, 'anime');
  });

  test('invalid edits are rejected and change nothing', async () => {
    const series = (await add(83867, 'tv')).body.title;
    const movie = (await add(1894, 'movie')).body.title;
    const cases = [
      [series.id, { version: 1, status: 'paused' }],
      [series.id, { version: 1, season: 0 }],
      [series.id, { version: 1, episode: -1 }],
      [series.id, { version: 1, episode: 2.5 }],
      [series.id, { version: 1, episode: null }],
      [series.id, { version: 1, kind: 'movie' }],
      [series.id, { status: 'watching' }],
      [series.id, { version: 1 }],
      [movie.id, { version: 1, season: 1 }],
      [movie.id, { version: 1, episode: 3 }],
      [movie.id, { version: 1, kind: 'series' }],
    ];
    for (const [id, body] of cases) {
      const res = await edit(id, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(res.body, { error: 'invalid' });
    }
    assert.ok((await list()).every((t) => t.version === 1 && t.status === 'planned'));
  });

  test('editing a title that is not on the list answers 404', async () => {
    const res = await edit(42, { version: 1, status: 'watching' });
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'not_found' });
  });
});

describe('removing', () => {
  test('a removed title disappears from the list', async () => {
    const { id } = (await add(83867, 'tv')).body.title;
    assert.equal((await remove(id)).status, 204);
    assert.deepEqual(await list(), []);
  });

  test('removing a title that is not there answers 404', async () => {
    assert.equal((await remove(42)).status, 404);
  });

  test('a removed title can be added again', async () => {
    const { id } = (await add(83867, 'tv')).body.title;
    await remove(id);
    assert.equal((await add(83867, 'tv')).status, 201);
  });
});

describe('refreshing from TMDB', () => {
  test('picks up new seasons and artwork but keeps progress, status and type', async () => {
    const { id } = (await add(83867, 'tv')).body.title;
    const before = (await edit(id, { version: 1, status: 'watching', season: 2, episode: 12, kind: 'anime' })).body.title;
    tmdb.respond('/3/tv/83867?language=pt-BR', {
      ...fx.andorPtBr,
      poster_path: '/novo-poster.jpg',
      seasons: [
        ...fx.andorPtBr.seasons,
        { air_date: '2027-05-01', episode_count: 10, id: 999001, name: 'Temporada 3', overview: '', poster_path: null, season_number: 3, vote_average: 0 },
      ],
    });
    mock.timers.tick(60 * MINUTE);
    const res = await refresh(id);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.title, {
      ...before,
      poster_path: '/novo-poster.jpg',
      seasons: [
        { number: 1, episodes: 12 },
        { number: 2, episodes: 12 },
        { number: 3, episodes: 10 },
      ],
      refreshed_at: T0 + 60 * MINUTE,
    });
  });

  test('refreshing a title that is not on the list answers 404', async () => {
    assert.equal((await refresh(42)).status, 404);
  });

  test('when TMDB is down the title keeps its current data', async () => {
    const { id } = (await add(83867, 'tv')).body.title;
    tmdb.fail();
    assert.equal((await refresh(id)).status, 502);
    assert.equal((await list())[0].seasons.length, 2);
  });
});
