import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));

// A stand-in for a Cloudflare D1 binding backed by an in-memory node:sqlite
// database with the real migrations applied. Covers the D1 calls the worker
// uses: prepare().bind().first()/all()/run().
export function createD1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(MIGRATIONS + file, 'utf8'));
  }

  const statement = (sql, args) => ({
    bind: (...values) => statement(sql, values),
    async first(column) {
      const row = db.prepare(sql).get(...args);
      if (!row) return null;
      return column === undefined ? { ...row } : row[column];
    },
    async all() {
      const results = db.prepare(sql).all(...args).map((row) => ({ ...row }));
      return { success: true, results, meta: {} };
    },
    async run() {
      const info = db.prepare(sql).run(...args);
      return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
  });

  return { prepare: (sql) => statement(sql, []) };
}
