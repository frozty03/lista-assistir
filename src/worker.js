import { json, error, noContent, readJson } from './http.js';
import * as session from './session.js';
import * as throttle from './throttle.js';
import * as tmdb from './tmdb.js';
import * as titles from './titles.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Static files are served before the worker runs; anything else outside /api is a 404 page.
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, url);
    } catch (err) {
      if (err instanceof tmdb.TmdbError) return error(err.code, err.status);
      console.error(err);
      return error('internal', 500);
    }
  },
};

async function api(request, env, url) {
  const { method } = request;

  // Browsers send Origin on every POST/PATCH/DELETE; refuse ones from other sites.
  const origin = request.headers.get('Origin');
  if (method !== 'GET' && method !== 'HEAD' && origin && origin !== url.origin) return error('forbidden', 403);

  if (url.pathname === '/api/login' && method === 'POST') return login(request, env);
  if (url.pathname === '/api/logout' && method === 'POST') return noContent({ 'Set-Cookie': session.clearedCookie() });

  const now = Date.now();
  const current = await session.check(request, env, now);
  if (!current.valid) return error('unauthorized', 401);

  const response = await route(request, env, url, now);
  if (current.renew) response.headers.append('Set-Cookie', await session.cookie(env, now));
  return response;
}

async function route(request, env, url, now) {
  const { method } = request;
  const { pathname } = url;

  if (pathname === '/api/titles') {
    if (method === 'GET') return json({ titles: await titles.list(env.DB) });
    if (method === 'POST') return addTitle(request, env, now);
  }

  if (pathname === '/api/search' && method === 'GET') {
    const query = (url.searchParams.get('q') ?? '').trim();
    return json({ results: query.length < 2 ? [] : await tmdb.search(env, query) });
  }

  const match = pathname.match(/^\/api\/titles\/(\d+)(\/refresh)?$/);
  if (match) {
    const id = Number(match[1]);
    if (match[2] && method === 'POST') return refreshTitle(env, id, now);
    if (!match[2] && method === 'PATCH') return editTitle(request, env, id, now);
    if (!match[2] && method === 'DELETE') return removeTitle(env, id);
  }

  return error('not_found', 404);
}

async function login(request, env) {
  if (!session.isConfigured(env)) return error('not_configured', 503);
  const body = await readJson(request);
  if (typeof body?.password !== 'string') return error('invalid', 400);

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const now = Date.now();
  const wait = await throttle.blockedFor(env.DB, ip, now);
  if (wait > 0) return error('too_many_attempts', 429, { 'Retry-After': String(wait) });

  if (!(await session.passwordMatches(env, body.password))) {
    await throttle.recordFailure(env.DB, ip, now);
    return error('wrong_password', 401);
  }
  await throttle.clearFailures(env.DB, ip);
  return noContent({ 'Set-Cookie': await session.cookie(env, now) });
}

async function addTitle(request, env, now) {
  const body = await readJson(request);
  const mediaType = body?.media_type;
  const tmdbId = body?.tmdb_id;
  if ((mediaType !== 'movie' && mediaType !== 'tv') || !Number.isInteger(tmdbId) || tmdbId < 1) {
    return error('invalid', 400);
  }

  const existing = await titles.findByTmdb(env.DB, mediaType, tmdbId);
  if (existing) return json({ error: 'already_listed', title: titles.toJson(existing) }, 409);

  const info = await tmdb.details(env, mediaType, tmdbId);
  const inserted = await titles.insert(env.DB, mediaType, tmdbId, info, now);
  if (inserted) return json({ title: titles.toJson(inserted) }, 201);

  // Both of you added it at the same moment: the other request won.
  const winner = await titles.findByTmdb(env.DB, mediaType, tmdbId);
  return json({ error: 'already_listed', title: titles.toJson(winner) }, 409);
}

async function editTitle(request, env, id, now) {
  const row = await titles.find(env.DB, id);
  if (!row) return error('not_found', 404);

  const body = await readJson(request);
  const changes = body && titles.validEdit(row, body);
  if (!changes) return error('invalid', 400);

  const updated = await titles.update(env.DB, id, body.version, changes, now);
  if (updated) return json({ title: titles.toJson(updated) });

  const latest = await titles.find(env.DB, id);
  if (!latest) return error('not_found', 404);
  return json({ error: 'conflict', title: titles.toJson(latest) }, 409);
}

async function removeTitle(env, id) {
  return (await titles.remove(env.DB, id)) ? noContent() : error('not_found', 404);
}

async function refreshTitle(env, id, now) {
  const row = await titles.find(env.DB, id);
  if (!row) return error('not_found', 404);
  const info = await tmdb.details(env, row.media_type, row.tmdb_id);
  const updated = await titles.refresh(env.DB, id, info, now);
  return updated ? json({ title: titles.toJson(updated) }) : error('not_found', 404);
}
