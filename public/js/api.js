// Calls to the worker's /api. Failures throw an ApiError carrying the HTTP
// status (0 when the server couldn't be reached) and the error body.

export class ApiError extends Error {
  constructor(status, body, retryAfter = null) {
    super(body?.error ?? `HTTP ${status}`);
    this.status = status;
    this.code = body?.error ?? null;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

async function request(method, path, body, signal) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, null);
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data, Number(response.headers.get('Retry-After')) || null);
  return data;
}

export const api = {
  login: (password) => request('POST', '/api/login', { password }),
  logout: () => request('POST', '/api/logout'),
  list: () => request('GET', '/api/titles'),
  add: (tmdb_id, media_type) => request('POST', '/api/titles', { tmdb_id, media_type }),
  edit: (id, changes) => request('PATCH', `/api/titles/${id}`, changes),
  remove: (id) => request('DELETE', `/api/titles/${id}`),
  refresh: (id) => request('POST', `/api/titles/${id}/refresh`),
  search: (query, signal) => request('GET', `/api/search?q=${encodeURIComponent(query)}`, undefined, signal),
};
