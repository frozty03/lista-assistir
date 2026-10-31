// Episode progress for series and anime. A show's position is the last episode
// watched, as (season, episode). Season lengths come from TMDB; a season that is
// missing or listed with zero episodes (not aired yet) has an unknown length,
// and progress through it is never capped.

const position = (item) => ({ season: item.season ?? 1, episode: item.episode ?? 0 });

const listedSeasons = (item) => (item.seasons ?? []).map((s) => s.number).sort((a, b) => a - b);

/** Episodes in a season, or null when unknown. */
export function seasonLength(item, season) {
  const found = (item.seasons ?? []).find((s) => s.number === season);
  return found && found.episodes > 0 ? found.episodes : null;
}

/** The episode after the current position, or null when the show is complete. */
export function upNext(item) {
  const { season, episode } = position(item);
  const length = seasonLength(item, season);
  if (length === null || episode < length) return { season, episode: episode + 1 };
  const later = listedSeasons(item).find((n) => n > season);
  return later === undefined ? null : { season: later, episode: 1 };
}

/** What "+1 EP" does: watch the next episode, finishing the show on its last one. */
export function nextEpisode(item) {
  const next = upNext(item);
  if (!next) return { ...position(item), status: 'watched' };
  const finished = upNext({ ...item, ...next }) === null;
  return { ...next, status: finished ? 'watched' : 'watching' };
}

export function progressLabel(item) {
  const { season, episode } = position(item);
  const length = seasonLength(item, season);
  const label = `T${season} · E${episode}`;
  return length === null ? label : `${label} de ${length}`;
}

/** Share of the current season watched, 0–100, or null if its length is unknown. */
export function seasonPercent(item) {
  const { season, episode } = position(item);
  const length = seasonLength(item, season);
  return length === null ? null : Math.round((Math.min(episode, length) / length) * 100);
}

/** Season arrows: move to the neighbouring listed season, starting it from episode 0. */
export function stepSeason(item, delta) {
  const current = position(item);
  const listed = listedSeasons(item);
  let target;
  if (listed.length === 0) target = Math.max(1, current.season + delta);
  else if (delta > 0) target = listed.find((n) => n > current.season);
  else target = listed.findLast((n) => n < current.season);
  if (target === undefined || target === current.season) return current;
  return { season: target, episode: 0 };
}

/** A typed season number, kept within the listed seasons. */
export function setSeason(item, number) {
  const current = position(item);
  if (!Number.isFinite(number)) return current;
  const listed = listedSeasons(item);
  const min = listed.length ? listed[0] : 1;
  const max = listed.length ? listed[listed.length - 1] : Infinity;
  const season = Math.min(max, Math.max(min, Math.trunc(number)));
  return season === current.season ? current : { season, episode: 0 };
}

/** A typed or stepped episode number, kept within the current season. */
export function setEpisode(item, number) {
  const current = position(item);
  if (!Number.isFinite(number)) return current;
  const length = seasonLength(item, current.season) ?? Infinity;
  return { season: current.season, episode: Math.min(length, Math.max(0, Math.trunc(number))) };
}
