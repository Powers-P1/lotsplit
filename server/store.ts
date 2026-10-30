import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { UserId } from '../shared/types.js';

export interface Revisioned { revision: number }
/** One SQLite transaction commits a complete, mutually consistent collection snapshot. */
export class SqliteStore<T extends Revisioned> {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_links (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER);`);
  }
  load(): T | undefined {
    const row = this.db.prepare('SELECT data FROM app_state WHERE id=1').get() as { data: string } | undefined;
    return row ? JSON.parse(row.data) as T : undefined;
  }
  initialize(state: T): T {
    this.db.prepare('INSERT OR IGNORE INTO app_state (id,revision,data) VALUES (1,?,?)').run(state.revision, JSON.stringify(state));
    return this.load()!;
  }
  save(state: T, expectedRevision: number): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare('UPDATE app_state SET revision=?,data=? WHERE id=1 AND revision=?').run(state.revision, JSON.stringify(state), expectedRevision);
      if (result.changes !== 1) throw new Error('STATE_CONFLICT');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  createSession(userId: UserId, now = Date.now()): string {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token), userId, now + 7 * 86400000);
    return token;
  }
  sessionUser(token: string | undefined, now = Date.now()): UserId | undefined {
    if (!token) return undefined;
    const row = this.db.prepare('SELECT user_id,expires_at FROM sessions WHERE token_hash=?').get(hash(token)) as { user_id: UserId; expires_at: number } | undefined;
    return row && row.expires_at > now ? row.user_id : undefined;
  }
  deleteSession(token: string | undefined): void { if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token)); }
  createLoginLink(userId: UserId, now = Date.now()): string {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO login_links VALUES (?,?,?,NULL)').run(hash(token), userId, now + 15 * 60000);
    return token;
  }
  consumeLoginLink(token: string, now = Date.now()): UserId | undefined {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT user_id,expires_at,consumed_at FROM login_links WHERE token_hash=?').get(hash(token)) as { user_id: UserId; expires_at: number; consumed_at: number | null } | undefined;
      if (!row || row.expires_at <= now || row.consumed_at !== null) { this.db.exec('COMMIT'); return undefined; }
      this.db.prepare('UPDATE login_links SET consumed_at=? WHERE token_hash=?').run(now, hash(token));
      this.db.exec('COMMIT');
      return row.user_id;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
