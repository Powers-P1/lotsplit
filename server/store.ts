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
    // Old credentials lack a collection/identity scope and deliberately fail
    // closed. The migration leaves every application/financial snapshot intact.
    for (const table of ['sessions', 'login_links']) {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some(column => column.name === 'subject_scope')) this.db.exec(`ALTER TABLE ${table} ADD COLUMN subject_scope TEXT`);
    }
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
    const scope = this.subjectScope(userId); if (!scope) throw new Error('SESSION_SUBJECT_MISSING');
    this.db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,subject_scope) VALUES (?,?,?,?)').run(hash(token), userId, now + 7 * 86400000, scope);
    return token;
  }
  sessionUser(token: string | undefined, now = Date.now()): UserId | undefined {
    if (!token) return undefined;
    const row = this.db.prepare('SELECT user_id,expires_at,subject_scope FROM sessions WHERE token_hash=?').get(hash(token)) as { user_id: UserId; expires_at: number; subject_scope: string | null } | undefined;
    return row && row.expires_at > now && row.subject_scope && row.subject_scope === this.subjectScope(row.user_id) ? row.user_id : undefined;
  }
  deleteSession(token: string | undefined): void { if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token)); }
  createLoginLink(userId: UserId, now = Date.now()): string {
    const token = randomBytes(32).toString('base64url');
    const scope = this.subjectScope(userId); if (!scope) throw new Error('SESSION_SUBJECT_MISSING');
    this.db.prepare('INSERT INTO login_links (token_hash,user_id,expires_at,consumed_at,subject_scope) VALUES (?,?,?,NULL,?)').run(hash(token), userId, now + 15 * 60000, scope);
    return token;
  }
  consumeLoginLink(token: string, now = Date.now()): UserId | undefined {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT user_id,expires_at,consumed_at,subject_scope FROM login_links WHERE token_hash=?').get(hash(token)) as { user_id: UserId; expires_at: number; consumed_at: number | null; subject_scope: string | null } | undefined;
      if (!row || row.expires_at <= now || row.consumed_at !== null || !row.subject_scope || row.subject_scope !== this.subjectScope(row.user_id)) { this.db.exec('COMMIT'); return undefined; }
      this.db.prepare('UPDATE login_links SET consumed_at=? WHERE token_hash=?').run(now, hash(token));
      this.db.exec('COMMIT');
      return row.user_id;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private subjectScope(userId: UserId): string | undefined {
    // The seller is the configured workspace owner. Buyer slots are reused by
    // new lots; neither a cookie nor an unused link may follow that slot.
    if (userId === 'kasia') return 'configured-organizer-v1';
    const state = this.load() as (T & { collection?: { id?: string; protocolVersion?: number }; participants?: { id: string; email?: string }[] }) | undefined;
    const participant = state?.participants?.find(person => person.id === userId);
    if (!participant?.email) return undefined;
    const collection = state?.collection?.protocolVersion === 2 ? state.collection.id : 'legacy-rehearsal';
    if (!collection) return undefined;
    return hash(JSON.stringify([collection, userId, participant.email.toLowerCase()]));
  }
  close() { this.db.close(); }
}
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
