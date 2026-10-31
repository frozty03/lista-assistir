import * as fx from '../fixtures/tmdb.js';

export const V4_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.dGVzdA.c2lnbmF0dXJl';
export const V3_KEY = '0123456789abcdef0123456789abcdef';

// Normalised "path?sorted-params" so routes don't depend on parameter order.
function routeKey(url) {
  const params = [...url.searchParams].filter(([k]) => k !== 'api_key').sort(([a], [b]) => a.localeCompare(b));
  return params.length ? `${url.pathname}?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : url.pathname;
}

// Stands in for api.themoviedb.org. Like the real API it answers 401 without
// valid credentials and 404 for anything it doesn't know, so a request with the
// wrong path, language or credentials fails the way it would in production.
export function fakeTmdb() {
  const routes = new Map([
    ['/3/tv/83867?language=pt-BR', fx.andorPtBr],
    ['/3/tv/209867?language=pt-BR', fx.frierenPtBr],
    ['/3/tv/209867?language=en-US', fx.frierenEnUs],
    ['/3/movie/1894?language=pt-BR', fx.attackOfTheClonesPtBr],
    ['/3/movie/372058?language=pt-BR', fx.yourNamePtBr],
    ['/3/search/multi?include_adult=false&language=pt-BR&query=star wars', fx.searchStarWars],
    ['/3/search/multi?include_adult=false&language=pt-BR&query=frieren', fx.searchFrieren],
  ]);
  const requests = [];
  let failing = false;

  async function fetch(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== 'https://api.themoviedb.org') throw new Error(`Unexpected fetch to ${url}`);
    requests.push(url);
    if (failing) return Response.json({ success: false, status_code: 11, status_message: 'Internal error.' }, { status: 500 });

    const bearer = request.headers.get('Authorization') === `Bearer ${V4_TOKEN}`;
    const apiKey = url.searchParams.get('api_key') === V3_KEY;
    if (!bearer && !apiKey) return Response.json(fx.invalidKeyError, { status: 401 });

    const body = routes.get(routeKey(url));
    if (body) return Response.json(body);
    // Like TMDB: a search with no matches is an empty page, an unknown id is a 404.
    if (url.pathname.startsWith('/3/search/')) return Response.json({ page: 1, results: [], total_pages: 0, total_results: 0 });
    return Response.json(fx.notFoundError, { status: 404 });
  }

  return {
    fetch,
    requests,
    respond(key, body) {
      routes.set(key, body);
    },
    fail() {
      failing = true;
    },
  };
}
