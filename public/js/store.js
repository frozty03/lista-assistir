// The shared list as this device sees it.
//
// Edits show up at once and are sent one at a time per title, each based on the
// version the server last confirmed, so quick taps never trip over each other.
// When the other device changed a title first, its version wins: the screen
// shows it, a 'conflict' notice goes out, and taps still queued for that title
// are dropped rather than overwriting it.

const TMDB_FIELDS = ['title', 'original_title', 'year', 'poster_path', 'backdrop_path', 'overview', 'seasons', 'refreshed_at'];

const newer = (a, b) => (!b || a.version >= b.version ? a : b);

export function createStore(api) {
  let titles = [];
  const listeners = new Set();
  const confirmed = new Map(); // id → latest row the server confirmed
  const pending = new Map(); // id → edits queued or in flight
  const queues = new Map(); // id → promise of the last queued edit
  const generations = new Map(); // id → bumped to drop queued edits after a failed one

  const emit = (event) => listeners.forEach((listener) => listener(event));
  const notice = (code, title) => emit({ type: 'notice', code, title });
  const find = (id) => titles.find((t) => t.id === id) ?? null;

  function put(row) {
    titles = find(row.id) ? titles.map((t) => (t.id === row.id ? row : t)) : [...titles, row];
    emit({ type: 'change' });
  }

  function drop(id) {
    titles = titles.filter((t) => t.id !== id);
    confirmed.delete(id);
    emit({ type: 'change' });
  }

  function confirm(row) {
    confirmed.set(row.id, newer(row, confirmed.get(row.id)));
    return confirmed.get(row.id);
  }

  function edit(id, changes) {
    const local = find(id);
    if (!local) return Promise.resolve(null);
    if (!confirmed.has(id)) confirmed.set(id, local);
    put({ ...local, ...changes, updated_at: Date.now() });
    pending.set(id, (pending.get(id) ?? 0) + 1);
    const generation = generations.get(id) ?? 0;

    async function send() {
      try {
        if ((generations.get(id) ?? 0) !== generation || !confirmed.has(id)) return null;
        const { title } = await api.edit(id, { version: confirmed.get(id).version, ...changes });
        confirm(title);
        // Later taps are still on their way: keep showing them instead of this step.
        if (pending.get(id) === 1 && find(id)) put(title);
        return title;
      } catch (err) {
        generations.set(id, generation + 1);
        if (err.status === 409 && err.body?.title) {
          const latest = confirm(err.body.title);
          if (find(id)) put(latest);
          notice('conflict', latest);
        } else if (err.status === 404) {
          drop(id);
          notice('gone', local);
        } else {
          if (find(id)) put(confirmed.get(id));
          notice(err.status === 401 ? 'signed_out' : 'save_failed', local);
        }
        return null;
      } finally {
        const left = pending.get(id) - 1;
        if (left > 0) pending.set(id, left);
        else pending.delete(id);
      }
    }

    const queued = (queues.get(id) ?? Promise.resolve()).then(send);
    queues.set(id, queued);
    queued.then(() => queues.get(id) === queued && queues.delete(id));
    return queued;
  }

  return {
    get list() {
      return titles;
    },
    find,
    edit,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async load() {
      const { titles: rows } = await api.list();
      const onServer = new Set(rows.map((row) => row.id));
      for (const id of confirmed.keys()) if (!onServer.has(id)) confirmed.delete(id);
      titles = rows.map((row) => {
        const latest = confirm(row);
        return pending.has(row.id) ? (find(row.id) ?? latest) : latest;
      });
      emit({ type: 'change' });
    },

    async add({ tmdb_id, media_type }) {
      try {
        const { title } = await api.add(tmdb_id, media_type);
        put(confirm(title));
        return { title, existed: false };
      } catch (err) {
        if (err.status !== 409 || !err.body?.title) throw err;
        const latest = confirm(err.body.title);
        if (!pending.has(latest.id)) put(latest);
        return { title: find(latest.id), existed: true };
      }
    },

    async remove(id) {
      const local = find(id);
      if (!local) return false;
      const saved = confirmed.get(id);
      drop(id);
      try {
        await api.remove(id);
        return true;
      } catch (err) {
        if (err.status === 404) return true;
        if (saved) confirmed.set(id, saved);
        put(local);
        notice(err.status === 401 ? 'signed_out' : 'save_failed', local);
        return false;
      }
    },

    /** Fetches fresh TMDB data (seasons, artwork) for a title; never touches progress. */
    async refresh(id) {
      try {
        const { title } = await api.refresh(id);
        const fresh = Object.fromEntries(TMDB_FIELDS.map((field) => [field, title[field]]));
        if (confirmed.has(id)) confirmed.set(id, { ...confirmed.get(id), ...fresh });
        const local = find(id);
        if (local) put({ ...local, ...fresh });
        return find(id);
      } catch (err) {
        if (err.status === 404 && find(id)) {
          const local = find(id);
          drop(id);
          notice('gone', local);
        }
        return null;
      }
    },
  };
}
