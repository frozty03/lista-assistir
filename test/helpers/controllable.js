const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Wraps an api object so a test can hold calls back (to act while a request is
 * still travelling) or make the next call fail like a network error or an
 * expired session would.
 */
export function controllable(api) {
  const held = [];
  const failures = new Map();
  let holding = null;

  const wrapped = {};
  for (const [name, fn] of Object.entries(api)) {
    wrapped[name] = (...args) => {
      const status = failures.get(name)?.shift();
      if (status !== undefined) return Promise.reject(Object.assign(new Error('request failed'), { status, code: null, body: null }));
      if (holding && (holding === 'all' || holding.has(name))) {
        return new Promise((resolve, reject) => held.push(() => fn(...args).then(resolve, reject)));
      }
      return fn(...args);
    };
  }

  return Object.assign(wrapped, {
    hold(...names) {
      holding = names.length ? new Set(names) : 'all';
    },
    /** Lets the oldest held call through (waiting briefly for one to arrive) and waits for its answer. */
    async releaseNext() {
      for (let i = 0; i < 100 && held.length === 0; i++) await tick();
      if (held.length === 0) throw new Error('No call was waiting to be released');
      await held.shift()();
      await tick();
    },
    async releaseAll() {
      holding = null;
      while (held.length) await held.shift()();
      await tick();
    },
    /** The next call to `name` fails with this HTTP status (0 = no connection). */
    failNext(name, status = 0) {
      if (!failures.has(name)) failures.set(name, []);
      failures.get(name).push(status);
    },
  });
}
