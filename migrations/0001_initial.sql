-- One row per movie/series/anime on the shared list.
CREATE TABLE titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'series', 'anime')),
  title TEXT NOT NULL,
  original_title TEXT,
  year INTEGER,
  poster_path TEXT,
  backdrop_path TEXT,
  overview TEXT,
  -- JSON array of {"number": n, "episodes": count}, specials (season 0) excluded.
  seasons TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'watching', 'watched', 'dropped')),
  -- Last episode watched: (season, episode). Null until a series is started; always null for movies.
  season INTEGER,
  episode INTEGER,
  -- Bumped on every user edit so two devices can't silently overwrite each other.
  version INTEGER NOT NULL DEFAULT 1,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  refreshed_at INTEGER NOT NULL,
  UNIQUE (media_type, tmdb_id)
);

-- Failed password attempts per IP, for throttling the login.
CREATE TABLE login_attempts (
  ip TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  failures INTEGER NOT NULL
);
