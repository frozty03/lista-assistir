// Storage for the shared list (the `titles` table).

const STATUSES = ['planned', 'watching', 'watched', 'dropped'];
const KINDS = { movie: ['movie', 'anime'], tv: ['series', 'anime'] };

const isInteger = (value, min) => Number.isInteger(value) && value >= min;

/** A database row as the app receives it. */
export const toJson = (row) => ({ ...row, seasons: JSON.parse(row.seasons) });

export async function list(db) {
  const { results } = await db.prepare('SELECT * FROM titles ORDER BY updated_at DESC, id DESC').all();
  return results.map(toJson);
}

export const find = (db, id) => db.prepare('SELECT * FROM titles WHERE id = ?').bind(id).first();

export const findByTmdb = (db, mediaType, tmdbId) =>
  db.prepare('SELECT * FROM titles WHERE media_type = ? AND tmdb_id = ?').bind(mediaType, tmdbId).first();

/** Inserts a new title; returns null if it was already on the list. */
export function insert(db, mediaType, tmdbId, info, now) {
  return db
    .prepare(
      `INSERT INTO titles (tmdb_id, media_type, kind, title, original_title, year, poster_path, backdrop_path,
                           overview, seasons, added_at, updated_at, refreshed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (media_type, tmdb_id) DO NOTHING
       RETURNING *`,
    )
    .bind(
      tmdbId,
      mediaType,
      info.kind,
      info.title,
      info.original_title,
      info.year,
      info.poster_path,
      info.backdrop_path,
      info.overview,
      JSON.stringify(info.seasons),
      now,
      now,
      now,
    )
    .first();
}

/** The columns a user edit changes, or null when the edit is invalid for this title. */
export function validEdit(row, body) {
  if (!isInteger(body.version, 1)) return null;
  const changes = {};
  if ('status' in body) {
    if (!STATUSES.includes(body.status)) return null;
    changes.status = body.status;
  }
  if ('kind' in body) {
    if (!KINDS[row.media_type].includes(body.kind)) return null;
    changes.kind = body.kind;
  }
  for (const [field, min] of [['season', 1], ['episode', 0]]) {
    if (!(field in body)) continue;
    if (row.media_type !== 'tv' || !isInteger(body[field], min)) return null;
    changes[field] = body[field];
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Applies validated changes if the title is still at `version`; returns the
 * updated row, or null when someone else changed it first.
 */
export function update(db, id, version, changes, now) {
  const columns = Object.keys(changes);
  return db
    .prepare(
      `UPDATE titles SET ${columns.map((c) => `${c} = ?`).join(', ')}, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?
       RETURNING *`,
    )
    .bind(...columns.map((c) => changes[c]), now, id, version)
    .first();
}

/** Stores fresh TMDB data. Progress, status and type are the couple's, so they stay. */
export function refresh(db, id, info, now) {
  return db
    .prepare(
      `UPDATE titles SET title = ?, original_title = ?, year = ?, poster_path = ?, backdrop_path = ?, overview = ?,
                         seasons = ?, refreshed_at = ?
       WHERE id = ?
       RETURNING *`,
    )
    .bind(
      info.title,
      info.original_title,
      info.year,
      info.poster_path,
      info.backdrop_path,
      info.overview,
      JSON.stringify(info.seasons),
      now,
      id,
    )
    .first();
}

export async function remove(db, id) {
  const { meta } = await db.prepare('DELETE FROM titles WHERE id = ?').bind(id).run();
  return meta.changes > 0;
}
