import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTitles, findListed } from '../public/js/list.js';

const title = (id, kind, status, added_at, updated_at) => ({ id, kind, status, added_at, updated_at });

const TITLES = [
  title(1, 'series', 'watching', 100, 500),
  title(2, 'anime', 'watching', 200, 900),
  title(3, 'movie', 'planned', 300, 300),
  title(4, 'anime', 'planned', 400, 400),
  title(5, 'movie', 'watched', 50, 700),
  title(6, 'series', 'watched', 60, 800),
  title(7, 'series', 'dropped', 70, 600),
];

const ids = (group) => group.map((t) => t.id);

test('titles are grouped by status, most recently watched first', () => {
  const groups = groupTitles(TITLES, 'all');
  assert.deepEqual(ids(groups.watching), [2, 1]);
  assert.deepEqual(ids(groups.watched), [6, 5]);
  assert.deepEqual(ids(groups.dropped), [7]);
});

test('the "to watch" group shows the most recently added first', () => {
  assert.deepEqual(ids(groupTitles(TITLES, 'all').planned), [4, 3]);
});

test('a type filter keeps only titles of that type', () => {
  const groups = groupTitles(TITLES, 'anime');
  assert.deepEqual(ids(groups.watching), [2]);
  assert.deepEqual(ids(groups.planned), [4]);
  assert.deepEqual(ids(groups.watched), []);
  assert.deepEqual(ids(groups.dropped), []);
});

test('a search result is matched to the list by media type and TMDB id together', () => {
  const listed = [{ id: 9, media_type: 'tv', tmdb_id: 1894 }];
  assert.equal(findListed(listed, { media_type: 'movie', tmdb_id: 1894 }), null);
  assert.equal(findListed(listed, { media_type: 'tv', tmdb_id: 1894 }).id, 9);
});
