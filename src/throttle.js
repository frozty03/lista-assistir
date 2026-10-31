// Login throttling.
//
// Every attempt is counted before the password is checked, in one atomic
// statement, so a burst of simultaneous requests can't slip past the limit.
// Two counters apply, each over a window that starts at its first attempt:
//
// - one per address (IPv6 addresses are grouped by their /64 network, which
//   normally belongs to a single customer);
// - one shared by all addresses, which stops guessing spread across many
//   machines. Only attempts within their own address's limit reach it, so a
//   single source can't keep everyone out, and addresses that signed in before
//   skip it, so a flood elsewhere can't lock you out at home.
//
// Only new logins are ever refused; devices already signed in keep working.

const WINDOW_MS = 15 * 60 * 1000;
const TRUSTED_FOR_MS = 365 * 24 * 60 * 60 * 1000;
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

const secondsLeft = (row, now) => Math.ceil((row.window_start + WINDOW_MS - now) / 1000);

/**
 * Counts a login attempt before its password is checked. Returns the seconds
 * to wait when a limit has been passed, or 0 when the attempt may go ahead.
 */
export async function attempt(db, ip, now) {
  const address = addressKey(ip);
  const mine = await count(db, address, now);
  if (mine.failures > PER_ADDRESS) return secondsLeft(mine, now);

  const known = await db.prepare('SELECT last_login FROM trusted_addresses WHERE address = ?').bind(address).first();
  if (known && now - known.last_login < TRUSTED_FOR_MS) return 0;

  const everyone = await count(db, ALL, now);
  return everyone.failures > EVERYONE ? secondsLeft(everyone, now) : 0;
}

/** After the right password: clear this address's failures and remember it as trusted. */
export async function succeeded(db, ip, now) {
  const address = addressKey(ip);
  await db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(address).run();
  await db
    .prepare(
      `INSERT INTO trusted_addresses (address, last_login) VALUES (?, ?)
       ON CONFLICT (address) DO UPDATE SET last_login = excluded.last_login`,
    )
    .bind(address, now)
    .run();
}
