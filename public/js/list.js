const newestFirst = (field) => (a, b) => b[field] - a[field];

/**
 * Splits the list into the home page sections. `filter` is 'all' or a kind
 * ('movie', 'series', 'anime'). Watching, watched and dropped are ordered by
 * the latest activity; "to watch" by when it was added.
 */
export function groupTitles(titles, filter) {
  const shown = filter === 'all' ? titles : titles.filter((t) => t.kind === filter);
  const having = (status, order) => shown.filter((t) => t.status === status).sort(newestFirst(order));
  return {
    watching: having('watching', 'updated_at'),
    planned: having('planned', 'added_at'),
    watched: having('watched', 'updated_at'),
    dropped: having('dropped', 'updated_at'),
  };
}

/** The list entry for a TMDB search result, or null when it isn't on the list. */
export function findListed(titles, result) {
  return titles.find((t) => t.media_type === result.media_type && t.tmdb_id === result.tmdb_id) ?? null;
}
