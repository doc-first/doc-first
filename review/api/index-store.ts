import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The documentation index: which blocks exist, what kind they are, what they depend on, and what
 * each one is still missing.
 *
 * ⚠️ This is NOT the truth. The truth is the file, versioned in git — that is what has diffs,
 * history and authorship, and that is where people write. This is a snapshot, rebuilt by
 * `doc-first index`, and it can be deleted without loss.
 *
 * The distinction matters, and the database itself enforces it: `events` is fact, and triggers
 * refuse UPDATE and DELETE; `blocks` is derived, and the whole index is wiped on every rebuild.
 * If both were truth, one day they would disagree — and there would be no way to know which to
 * believe.
 *
 * It exists because files answer some questions badly: "every suspect diagram in the project",
 * "every decision with no owner", "what breaks if I touch this". Those are database questions.
 */

export interface IndexedBlock {
  id: string; page: string; kind: string; file: string;
  code: string | null; numbered: boolean; fingerprint: string; text: string | null;
  dependsOn: string[]; missing: string[];
}

export class Index {
  #db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY, page TEXT NOT NULL, kind TEXT NOT NULL, file TEXT NOT NULL,
        code TEXT, numbered INTEGER NOT NULL, fingerprint TEXT NOT NULL, text TEXT,
        position INTEGER NOT NULL, indexed_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS blocks_by_page ON blocks (page, position);
      CREATE INDEX IF NOT EXISTS blocks_by_kind ON blocks (kind);

      -- Its own table, not a comma-separated column: the question people ask most is the REVERSE
      -- one — "if I change this, what breaks?" — and that needs an index on both sides.
      CREATE TABLE IF NOT EXISTS dependencies (
        block TEXT NOT NULL, depends_on TEXT NOT NULL, PRIMARY KEY (block, depends_on));
      CREATE INDEX IF NOT EXISTS dependencies_reverse ON dependencies (depends_on);

      CREATE TABLE IF NOT EXISTS issues (block TEXT NOT NULL, missing TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS issues_by_block ON issues (block);
    `);
  }

  /**
   * Rebuilds the whole index. Wipes and rewrites inside a transaction: a half-written index would
   * lie worse than a stale one — anyone reading mid-rebuild would see documentation that never
   * existed.
   */
  rebuild(blocks: IndexedBlock[]) {
    const now = new Date().toISOString();
    this.#db.exec('BEGIN');
    try {
      this.#db.exec('DELETE FROM issues; DELETE FROM dependencies; DELETE FROM blocks');
      const b = this.#db.prepare(
        `INSERT INTO blocks (id, page, kind, file, code, numbered, fingerprint, text, position, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const d = this.#db.prepare('INSERT OR IGNORE INTO dependencies (block, depends_on) VALUES (?, ?)');
      const i = this.#db.prepare('INSERT INTO issues (block, missing) VALUES (?, ?)');

      blocks.forEach((x, position) => {
        b.run(x.id, x.page, x.kind, x.file, x.code, x.numbered ? 1 : 0,
              x.fingerprint, x.text, position, now);
        for (const dep of x.dependsOn) d.run(x.id, dep);
        for (const missing of x.missing) i.run(x.id, missing);
      });
      this.#db.exec('COMMIT');
    } catch (e) {
      this.#db.exec('ROLLBACK');
      throw e;
    }
    return blocks.length;
  }

  /** How many blocks of each kind — the "what is this documentation made of?" question. */
  byKind(): { kind: string; count: number }[] {
    return this.#db.prepare(
      'SELECT kind, COUNT(*) AS count FROM blocks GROUP BY kind ORDER BY count DESC',
    ).all() as never;
  }

  /** What is missing, optionally per kind. The queue for whoever is writing. */
  issues(kind?: string): { id: string; kind: string; missing: string }[] {
    const sql = `SELECT b.id, b.kind, i.missing FROM issues i
                 JOIN blocks b ON b.id = i.block
                 ${kind ? 'WHERE b.kind = ?' : ''} ORDER BY b.page, b.position`;
    return (kind ? this.#db.prepare(sql).all(kind) : this.#db.prepare(sql).all()) as never;
  }

  /** What depends on this block. The question you ask BEFORE editing. */
  dependentsOf(id: string): string[] {
    return (this.#db.prepare('SELECT block FROM dependencies WHERE depends_on = ? ORDER BY block')
      .all(id) as { block: string }[]).map((r) => r.block);
  }

  /** A dependency pointing at a block that no longer exists. Silent break: invisible when reading. */
  brokenDependencies(): { block: string; dependsOn: string }[] {
    return this.#db.prepare(
      `SELECT d.block, d.depends_on AS dependsOn FROM dependencies d
       LEFT JOIN blocks b ON b.id = d.depends_on
       WHERE b.id IS NULL ORDER BY d.block`,
    ).all() as never;
  }

  /** Blocks of a given kind. For "show me every diagram". */
  ofKind(kind: string): { id: string; page: string; text: string }[] {
    return this.#db.prepare(
      'SELECT id, page, text FROM blocks WHERE kind = ? ORDER BY page, position',
    ).all(kind) as never;
  }

  indexedAt(): string | null {
    const r = this.#db.prepare('SELECT MAX(indexed_at) AS at FROM blocks').get() as { at: string | null };
    return r?.at ?? null;
  }

  close() { this.#db.close(); }
}
