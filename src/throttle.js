// Login throttling per IP address: after MAX_FAILURES wrong passwords, that
// address is refused until WINDOW_MS has passed since its first failure.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

/** Seconds until this address may try again, or 0 when it isn't blocked. */
export async function blockedFor(db, ip, now) {
  const row = await db.prepare('SELECT window_start, failures FROM login_attempts WHERE ip = ?').bind(ip).first();
  if (!row || row.failures < MAX_FAILURES || now - row.window_start >= WINDOW_MS) return 0;
  return Math.ceil((row.window_start + WINDOW_MS - now) / 1000);
}

export async function recordFailure(db, ip, now) {
  await db
    .prepare(
      `INSERT INTO login_attempts (ip, window_start, failures) VALUES (?1, ?2, 1)
       ON CONFLICT (ip) DO UPDATE SET
         failures = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE failures + 1 END,
         window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END`,
    )
    .bind(ip, now, WINDOW_MS)
    .run();
}

export async function clearFailures(db, ip) {
  await db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
}
