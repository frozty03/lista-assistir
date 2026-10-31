// Client for the TMDB v3 API. Titles and synopses are requested in Brazilian
// Portuguese; TMDB falls back to the original title when there's no translation.

const API = 'https://api.themoviedb.org/3';
const ANIMATION_GENRE = 16;

export class TmdbError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function get(env, path, params) {
  const token = env.TMDB_TOKEN;
  if (!token) throw new TmdbError('tmdb_not_configured', 503);

  const url = new URL(API + path);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const headers = { Accept: 'application/json' };
  // A v4 "API Read Access Token" is a JWT; a v3 "API Key" goes in the query string.
  if (token.startsWith('eyJ')) headers.Authorization = `Bearer ${token}`;
  else url.searchParams.set('api_key', token);

  let response;
  try {
    response = await fetch(url, { headers });
  } catch {
    throw new TmdbError('tmdb_unavailable', 502);
  }
  if (response.status === 404) throw new TmdbError('not_found', 404);
  if (!response.ok) throw new TmdbError('tmdb_unavailable', 502);
  return response.json();
}

// TMDB has no anime category: Japanese-language animation is the usual rule.
const kindOf = (mediaType, genreIds, language) =>
  genreIds.includes(ANIMATION_GENRE) && language === 'ja' ? 'anime' : mediaType === 'movie' ? 'movie' : 'series';

const yearOf = (date) => (date ? Number(date.slice(0, 4)) : null);

export async function search(env, query) {
  const data = await get(env, '/search/multi', { query, language: 'pt-BR', include_adult: 'false' });
  return data.results
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .map((r) => ({
      tmdb_id: r.id,
      media_type: r.media_type,
      kind: kindOf(r.media_type, r.genre_ids ?? [], r.original_language),
      title: r.media_type === 'movie' ? r.title : r.name,
      year: yearOf(r.media_type === 'movie' ? r.release_date : r.first_air_date),
      poster_path: r.poster_path ?? null,
    }));
}

/** Everything the list stores about a movie or series. */
export async function details(env, mediaType, id) {
  const path = `/${mediaType}/${id}`;
  const data = await get(env, path, { language: 'pt-BR' });
  const movie = mediaType === 'movie';

  let overview = data.overview || null;
  if (!overview) {
    try {
      overview = (await get(env, path, { language: 'en-US' })).overview || null;
    } catch {
      // The synopsis is optional; keep the title even if this second call fails.
    }
  }

  return {
    kind: kindOf(mediaType, (data.genres ?? []).map((g) => g.id), data.original_language),
    title: (movie ? data.title : data.name) ?? '',
    original_title: (movie ? data.original_title : data.original_name) ?? null,
    year: yearOf(movie ? data.release_date : data.first_air_date),
    poster_path: data.poster_path ?? null,
    backdrop_path: data.backdrop_path ?? null,
    overview,
    seasons: movie
      ? []
      : (data.seasons ?? [])
          .filter((s) => s.season_number > 0)
          .map((s) => ({ number: s.season_number, episodes: s.episode_count ?? 0 }))
          .sort((a, b) => a.number - b.number),
  };
}
