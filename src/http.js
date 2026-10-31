// The list changes from two devices, so API answers must never come from a cache.
const NO_STORE = { 'Cache-Control': 'no-store' };

export const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { ...NO_STORE, ...headers } });

export const error = (code, status, headers = {}) => json({ error: code }, status, headers);

export const noContent = (headers = {}) => new Response(null, { status: 204, headers: { ...NO_STORE, ...headers } });

/** The request's JSON object body, or null when it is missing or not an object. */
export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
