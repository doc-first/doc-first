import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { UserStoreBase, type StoredSession, type StoredUser } from './users.ts';

/**
 * People and sessions in SQLite, on the built-in `node:sqlite` — **no external dependency**.
 *
 * This is the "start the image and use it" mode: one file on disk, no cloud account, no database
 * to provision. It is the right answer on a laptop, in a container with a real volume, and on any
 * host whose disk survives a restart.
 *
 * ⚠️ It is the WRONG answer on Cloud Run, and silently so: the disk there is ephemeral and lives
 * inside the instance, so an access created today is gone when the platform recycles the instance,
 * with no error anywhere. Use `REVISAO_USERS=postgres://…` or `firestore` there. The reasoning is
 * written out in `users.ts`.
 *
 * The English column names are not the ones this file was born with. A database written before
 * 2026-09-20 has `pessoas`/`sessoes`, and `#migrateFromPortuguese` below carries it over.
 */
export class UsersSqlite extends UserStoreBase {
  #db: DatabaseSync;

  constructor(path: string) {
    super();
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    // WAL: a read does not block a write. Every page load checks a session.
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        email       TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        salt        BLOB NOT NULL,
        hash        BLOB NOT NULL,
        must_change INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        email      TEXT NOT NULL REFERENCES users(email),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions (expires_at);
    `);
    this.#migrateFromPortuguese();
  }

  /**
   * Carries over a database written before 2026-09-20, when the tables were `pessoas`/`sessoes`
   * and the columns were in Portuguese.
   *
   * It COPIES the people, and it does NOT copy the sessions. A session is worth twelve hours and
   * costs one login to replace; a password hash is not recoverable, so that one has to travel. The
   * old tables stay in the file: whoever wants them gone deletes them by hand, after checking.
   */
  #migrateFromPortuguese() {
    const old = this.#db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pessoas'").get();
    if (!old) return;

    const already = this.#db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    if (already.n > 0) return;                       // already migrated: do not duplicate

    const rows = this.#db.prepare('SELECT COUNT(*) AS n FROM pessoas').get() as { n: number };
    if (rows.n === 0) return;

    this.#db.exec(`
      INSERT INTO users (email, name, salt, hash, must_change, created_at)
      SELECT email, nome, sal, hash, trocar, criada_em FROM pessoas;
    `);
    console.warn(JSON.stringify({
      severity: 'WARNING', evento: 'users_table_migrated', from: 'pessoas', to: 'users', rows: rows.n,
      message: 'The old table was COPIED, not moved. Sessions were not carried over: everyone logs '
        + 'in once more.',
    }));
  }

  protected async insertUser(row: StoredUser): Promise<void> {
    this.#db.prepare(
      'INSERT INTO users (email, name, salt, hash, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(row.email, row.name, row.salt, row.hash, row.mustChangePassword ? 1 : 0, row.createdAt);
  }

  protected async readUser(email: string): Promise<StoredUser | null> {
    const r = this.#db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
      Record<string, string | number | Uint8Array> | undefined;
    if (!r) return null;
    return {
      email: r.email as string, name: r.name as string,
      salt: Buffer.from(r.salt as Uint8Array), hash: Buffer.from(r.hash as Uint8Array),
      mustChangePassword: !!r.must_change, createdAt: r.created_at as string,
    };
  }

  protected async writeCredential(email: string, salt: Buffer, hash: Buffer): Promise<void> {
    this.#db.prepare('UPDATE users SET salt = ?, hash = ?, must_change = 0 WHERE email = ?')
      .run(salt, hash, email);
  }

  protected async countUsers(): Promise<number> {
    return (this.#db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  protected async insertSession(id: string, email: string, createdAt: string, expiresAt: string): Promise<void> {
    this.#db.prepare('INSERT INTO sessions (id, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(id, email, createdAt, expiresAt);
  }

  protected async readSession(id: string): Promise<StoredSession | null> {
    const r = this.#db.prepare('SELECT email, expires_at FROM sessions WHERE id = ?').get(id) as
      { email: string; expires_at: string } | undefined;
    return r ? { email: r.email, expiresAt: r.expires_at } : null;
  }

  protected async deleteSession(id: string): Promise<void> {
    this.#db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  protected async deleteSessionsExpiredBefore(instant: string): Promise<void> {
    this.#db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(instant);
  }

  async close(): Promise<void> {
    this.#db.close();
  }
}
