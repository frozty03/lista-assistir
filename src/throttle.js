// Login throttling.
//
// Every attempt is counted before the password is checked, in one atomic
// statement, so a burst of simultaneous requests can't slip past the limit.
// Two counters apply: one per address (IPv6 addresses are grouped by their /64
// network, which normally belongs to a single customer) and one shared by all
// addresses, which stops guessing spread across many machines. Each counter's
// window starts at its first attempt and lasts WINDOW_MS. Only new logins are
// refused; devices that are already signed in keep working.

const WINDOW_MS = 15 * 60 * 1000;
const PER_ADDRESS = 10;
const EVERYONE = 50;
const ALL = '*';

/** The throttle key for an IP address: IPv4 as is, IPv6 reduced to its /64 network. */
function addressKey(ip) {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(':')}::/64`;
}

function count(db, key, now) {
  return db
    .prepare(
      `INSERT INTO login_attempts (ip, window_start, failures) VALUES (?1, ?2, 1)
       ON CONFLICT (ip) DO UPDATE SET
         failures = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE failures + 1 END,
         window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END
       RETURNING failures, window_start`,
    )
    .bind(key, now, WINDOW_MS)
    .first();
}

/**
 * Counts a login attempt before its password is checked. Returns the seconds
 * to wait when a limit has been passed, or 0 when the attempt may go ahead.
 */
export async function attempt(db, ip, now) {
  const counters = [
    [await count(db, addressKey(ip), now), PER_ADDRESS],
    [await count(db, ALL, now), EVERYONE],
  ];
  const waits = counters
    .filter(([row, limit]) => row.failures > limit)
    .map(([row]) => Math.ceil((row.window_start + WINDOW_MS - now) / 1000));
  return waits.length ? Math.max(...waits) : 0;
}

/** After the right password: clear this address and take the attempt back off the shared count. */
export async function succeeded(db, ip) {
  await db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(addressKey(ip)).run();
  await db.prepare('UPDATE login_attempts SET failures = MAX(failures - 1, 0) WHERE ip = ?').bind(ALL).run();
}
