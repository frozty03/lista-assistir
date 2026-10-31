import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextEpisode,
  upNext,
  progressLabel,
  seasonPercent,
  stepSeason,
  setSeason,
  setEpisode,
} from '../public/js/progress.js';

// Season 1 has 10 episodes and season 2 has 12, so a mix-up between seasons shows up.
const TWO_SEASONS = [
  { number: 1, episodes: 10 },
  { number: 2, episodes: 12 },
];

const show = (season, episode, status = 'watching', seasons = TWO_SEASONS) => ({
  media_type: 'tv',
  status,
  season,
  episode,
  seasons,
});

test('nextEpisode advances within the current season', () => {
  assert.deepEqual(nextEpisode(show(2, 5)), { season: 2, episode: 6, status: 'watching' });
});

test('nextEpisode uses the current season length, not another season', () => {
  assert.deepEqual(nextEpisode(show(2, 10)), { season: 2, episode: 11, status: 'watching' });
});

test('nextEpisode moves to episode 1 of the next season after a finale', () => {
  assert.deepEqual(nextEpisode(show(1, 10)), { season: 2, episode: 1, status: 'watching' });
});

test('nextEpisode marks the show watched on the last episode of the last season', () => {
  assert.deepEqual(nextEpisode(show(2, 11)), { season: 2, episode: 12, status: 'watched' });
});

test('nextEpisode finishes right away when the last season has a single episode', () => {
  const s = show(1, 10, 'watching', [{ number: 1, episodes: 10 }, { number: 2, episodes: 1 }]);
  assert.deepEqual(nextEpisode(s), { season: 2, episode: 1, status: 'watched' });
});

test('nextEpisode starts a show that was never started at S1E1', () => {
  assert.deepEqual(nextEpisode(show(null, null, 'planned')), { season: 1, episode: 1, status: 'watching' });
});

test('nextEpisode resumes a dropped show as watching', () => {
  assert.deepEqual(nextEpisode(show(1, 3, 'dropped')), { season: 1, episode: 4, status: 'watching' });
});

test('nextEpisode keeps counting when the season is missing from the data', () => {
  assert.deepEqual(nextEpisode(show(3, 4)), { season: 3, episode: 5, status: 'watching' });
});

test('nextEpisode treats a season listed with zero episodes as unknown length', () => {
  const s = show(2, 3, 'watching', [{ number: 1, episodes: 10 }, { number: 2, episodes: 0 }]);
  assert.deepEqual(nextEpisode(s), { season: 2, episode: 4, status: 'watching' });
});

test('nextEpisode skips season numbers that are not listed', () => {
  const s = show(1, 10, 'watching', [{ number: 1, episodes: 10 }, { number: 3, episodes: 8 }]);
  assert.deepEqual(nextEpisode(s), { season: 3, episode: 1, status: 'watching' });
});

test('nextEpisode leaves a finished show where it is', () => {
  assert.deepEqual(nextEpisode(show(2, 12, 'watched')), { season: 2, episode: 12, status: 'watched' });
});

test('nextEpisode with no season data counts up from S1E1', () => {
  assert.deepEqual(nextEpisode(show(null, null, 'planned', [])), { season: 1, episode: 1, status: 'watching' });
});

test('upNext is the following episode in the same season', () => {
  assert.deepEqual(upNext(show(2, 5)), { season: 2, episode: 6 });
});

test('upNext crosses into the next season after a finale', () => {
  assert.deepEqual(upNext(show(1, 10)), { season: 2, episode: 1 });
});

test('upNext is null once the last episode has been watched', () => {
  assert.equal(upNext(show(2, 12)), null);
});

test('progressLabel shows season, episode and season length', () => {
  assert.equal(progressLabel(show(2, 5)), 'T2 · E5 de 12');
});

test('progressLabel leaves out the season length when it is unknown', () => {
  assert.equal(progressLabel(show(3, 4)), 'T3 · E4');
});

test('progressLabel shows a show that was never started as T1 · E0', () => {
  assert.equal(progressLabel(show(null, null, 'planned')), 'T1 · E0 de 10');
});

test('seasonPercent is the rounded share of the current season watched', () => {
  assert.equal(seasonPercent(show(2, 5)), 42);
  assert.equal(seasonPercent(show(1, 10)), 100);
  assert.equal(seasonPercent(show(1, 0)), 0);
});

test('seasonPercent is null when the season length is unknown', () => {
  assert.equal(seasonPercent(show(3, 4)), null);
});

test('stepSeason moves to the next listed season and resets the episode', () => {
  assert.deepEqual(stepSeason(show(1, 7), +1), { season: 2, episode: 0 });
});

test('stepSeason goes back to the previous listed season', () => {
  assert.deepEqual(stepSeason(show(2, 3), -1), { season: 1, episode: 0 });
});

test('stepSeason stays put past the last or the first season', () => {
  assert.deepEqual(stepSeason(show(2, 5), +1), { season: 2, episode: 5 });
  assert.deepEqual(stepSeason(show(1, 5), -1), { season: 1, episode: 5 });
});

test('stepSeason jumps over season numbers that are not listed', () => {
  const s = show(1, 4, 'watching', [{ number: 1, episodes: 10 }, { number: 3, episodes: 8 }]);
  assert.deepEqual(stepSeason(s, +1), { season: 3, episode: 0 });
});

test('stepSeason counts freely when there is no season data', () => {
  assert.deepEqual(stepSeason(show(4, 2, 'watching', []), +1), { season: 5, episode: 0 });
  assert.deepEqual(stepSeason(show(1, 2, 'watching', []), -1), { season: 1, episode: 2 });
});

test('setSeason clamps a typed season to the listed range', () => {
  assert.deepEqual(setSeason(show(1, 4), 7), { season: 2, episode: 0 });
  assert.deepEqual(setSeason(show(2, 4), 0), { season: 1, episode: 0 });
});

test('setSeason keeps the episode when the season does not change', () => {
  assert.deepEqual(setSeason(show(2, 4), 2), { season: 2, episode: 4 });
});

test('setSeason ignores input that is not a number', () => {
  assert.deepEqual(setSeason(show(2, 4), NaN), { season: 2, episode: 4 });
});

test('setEpisode clamps to the length of the current season', () => {
  assert.deepEqual(setEpisode(show(1, 4), 15), { season: 1, episode: 10 });
  assert.deepEqual(setEpisode(show(2, 4), 15), { season: 2, episode: 12 });
  assert.deepEqual(setEpisode(show(2, 4), -1), { season: 2, episode: 0 });
});

test('setEpisode allows any count when the season length is unknown', () => {
  assert.deepEqual(setEpisode(show(3, 4), 40), { season: 3, episode: 40 });
});

test('setEpisode drops the fractional part of a typed number', () => {
  assert.deepEqual(setEpisode(show(2, 4), 7.8), { season: 2, episode: 7 });
});

test('setEpisode ignores input that is not a number', () => {
  assert.deepEqual(setEpisode(show(2, 4), NaN), { season: 2, episode: 4 });
});

test('setEpisode on a show that was never started puts it in season 1', () => {
  assert.deepEqual(setEpisode(show(null, null, 'planned'), 3), { season: 1, episode: 3 });
});
