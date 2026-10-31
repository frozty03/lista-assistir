import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, login, apiFor } from './helpers/app.js';
import { fakeTmdb } from './helpers/tmdb-fake.js';
import { controllable } from './helpers/controllable.js';
import * as fx from './fixtures/tmdb.js';
import { createStore } from '../public/js/store.js';

const ANDOR = { tmdb_id: 83867, media_type: 'tv' };
const realFetch = globalThis.fetch;

let env, tmdb, api, store, notices, otherDevice;
beforeEach(async () => {
  tmdb = fakeTmdb();
  globalThis.fetch = tmdb.fetch;
  env = makeEnv();
  api = controllable(apiFor(env, await login(env)));
  store = createStore(api);
  notices = [];
  store.subscribe((event) => event.type === 'notice' && notices.push(event.code));
  const otherCookie = await login(env);
  otherDevice = (method, path, body) => call(env, method, path, { cookie: otherCookie, body });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const onServer = async (id) => (await otherDevice('GET', '/api/titles')).body.titles.find((t) => t.id === id);

async function addAndor() {
  const { title } = await store.add(ANDOR);
  return title.id;
}

describe('loading', () => {
  test('brings in titles added on the other device', async () => {
    await otherDevice('POST', '/api/titles', ANDOR);
    await store.load();
    assert.deepEqual(store.list.map((t) => t.title), ['Andor']);
  });

  test('shows changes made on the other device', async () => {
    const id = await addAndor();
    await otherDevice('PATCH', `/api/titles/${id}`, { version: 1, status: 'watching', season: 1, episode: 4 });
    await store.load();
    assert.equal(store.find(id).episode, 4);
  });

  test('drops titles removed on the other device', async () => {
    const id = await addAndor();
    await otherDevice('DELETE', `/api/titles/${id}`);
    await store.load();
    assert.equal(store.find(id), null);
  });

  test('keeps an edit that is still being saved', async () => {
    const id = await addAndor();
    api.hold('edit');
    const saving = store.edit(id, { status: 'watching', season: 1, episode: 3 });
    await store.load();
    assert.equal(store.find(id).episode, 3);
    await api.releaseAll();
    await saving;
    assert.equal(store.find(id).episode, 3);
  });
});

describe('adding', () => {
  test('adds the title to the list', async () => {
    const { title, existed } = await store.add(ANDOR);
    assert.equal(existed, false);
    assert.equal(store.find(title.id).title, 'Andor');
  });

  test('something the other device already added comes back as the existing entry', async () => {
    await otherDevice('POST', '/api/titles', ANDOR);
    const { title, existed } = await store.add(ANDOR);
    assert.equal(existed, true);
    assert.equal(title.title, 'Andor');
    assert.equal(store.list.length, 1);
  });
});

describe('editing', () => {
  test('the change shows right away, before the server answers', async () => {
    const id = await addAndor();
    api.hold('edit');
    const saving = store.edit(id, { status: 'watching', season: 1, episode: 3 });
    assert.equal(store.find(id).episode, 3);
    assert.equal(store.find(id).status, 'watching');
    await api.releaseAll();
    await saving;
    assert.equal((await onServer(id)).episode, 3);
  });

  test('two quick taps are both saved, in order, without a conflict', async () => {
    const id = await addAndor();
    api.hold('edit');
    const first = store.edit(id, { status: 'watching', season: 1, episode: 1 });
    const second = store.edit(id, { episode: 2 });
    await api.releaseAll();
    await Promise.all([first, second]);
    const saved = await onServer(id);
    assert.equal(saved.episode, 2);
    assert.equal(saved.version, 3);
    assert.deepEqual(notices, []);
  });

  test('the screen does not jump back while a later tap is still saving', async () => {
    const id = await addAndor();
    api.hold('edit');
    const first = store.edit(id, { status: 'watching', season: 1, episode: 1 });
    const second = store.edit(id, { episode: 2 });
    await api.releaseNext();
    await first;
    assert.equal(store.find(id).episode, 2);
    await api.releaseNext();
    await second;
    assert.equal(store.find(id).episode, 2);
    assert.equal(store.find(id).version, 3);
  });

  test('an edit made over a change from the other device shows the latest state and says so', async () => {
    const id = await addAndor();
    await otherDevice('PATCH', `/api/titles/${id}`, { version: 1, status: 'watching', season: 1, episode: 4 });
    await store.edit(id, { status: 'watching', season: 1, episode: 9 });
    assert.equal(store.find(id).episode, 4);
    assert.deepEqual(notices, ['conflict']);
    assert.equal((await onServer(id)).episode, 4);
  });

  test('taps queued behind a conflict are dropped instead of overwriting the other device', async () => {
    const id = await addAndor();
    await otherDevice('PATCH', `/api/titles/${id}`, { version: 1, status: 'watching', season: 1, episode: 4 });
    api.hold('edit');
    const first = store.edit(id, { status: 'watching', season: 1, episode: 9 });
    const second = store.edit(id, { episode: 10 });
    await api.releaseAll();
    await Promise.all([first, second]);
    assert.equal(store.find(id).episode, 4);
    assert.equal((await onServer(id)).episode, 4);
    assert.deepEqual(notices, ['conflict']);
  });

  test('a save that fails puts back the last saved state', async () => {
    const id = await addAndor();
    api.failNext('edit');
    const result = await store.edit(id, { status: 'watching', season: 1, episode: 5 });
    assert.equal(result, null);
    assert.equal(store.find(id).status, 'planned');
    assert.equal(store.find(id).episode, null);
    assert.deepEqual(notices, ['save_failed']);
  });

  test('an expired session is reported and the edit is undone', async () => {
    const id = await addAndor();
    api.failNext('edit', 401);
    await store.edit(id, { status: 'watching', season: 1, episode: 5 });
    assert.equal(store.find(id).status, 'planned');
    assert.deepEqual(notices, ['signed_out']);
  });

  test('editing a title the other device removed takes it off the list', async () => {
    const id = await addAndor();
    await otherDevice('DELETE', `/api/titles/${id}`);
    await store.edit(id, { status: 'watching', season: 1, episode: 1 });
    assert.equal(store.find(id), null);
    assert.deepEqual(notices, ['gone']);
  });
});

describe('removing', () => {
  test('takes the title off the list', async () => {
    const id = await addAndor();
    assert.equal(await store.remove(id), true);
    assert.equal(store.find(id), null);
    assert.equal(await onServer(id), undefined);
  });

  test('a remove that fails puts the title back', async () => {
    const id = await addAndor();
    api.failNext('remove');
    assert.equal(await store.remove(id), false);
    assert.equal(store.find(id).title, 'Andor');
    assert.deepEqual(notices, ['save_failed']);
  });
});

describe('refreshing', () => {
  test('new artwork and seasons arrive without undoing an edit that is still saving', async () => {
    const id = await addAndor();
    tmdb.respond('/3/tv/83867?language=pt-BR', {
      ...fx.andorPtBr,
      poster_path: '/novo-poster.jpg',
      seasons: [...fx.andorPtBr.seasons, { ...fx.andorPtBr.seasons[1], id: 999001, name: 'Temporada 3', season_number: 3, episode_count: 10 }],
    });
    api.hold('edit');
    const saving = store.edit(id, { status: 'watching', season: 2, episode: 12 });
    await store.refresh(id);
    assert.equal(store.find(id).poster_path, '/novo-poster.jpg');
    assert.equal(store.find(id).seasons.length, 3);
    assert.equal(store.find(id).episode, 12);
    await api.releaseAll();
    await saving;
    assert.equal(store.find(id).seasons.length, 3);
    assert.equal(store.find(id).episode, 12);
  });
});

test('subscribers hear about every change to the list', async () => {
  let changes = 0;
  store.subscribe((event) => event.type === 'change' && changes++);
  const id = await addAndor();
  const afterAdd = changes;
  await store.edit(id, { status: 'watching', season: 1, episode: 1 });
  assert.ok(afterAdd >= 1, 'adding notifies');
  assert.ok(changes > afterAdd, 'editing notifies');
});
