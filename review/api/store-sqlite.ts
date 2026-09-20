import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Evento, NovoEvento, Registro } from './types.ts';

/**
 * SQLite persistence on the built-in `node:sqlite` — **no external dependency**.
 *
 * It is what lets someone start Doc First and use it with no database, no cloud, no account
 * anywhere: one file on disk. For a team, swap in Postgres/MySQL by implementing the same
 * `Registro` interface — five methods.
 *
 * INSERT ONLY, as the method demands: there is no UPDATE and no DELETE in this file. The trail is
 * the product.
 */
export class RegistroSqlite implements Registro {
  #db: DatabaseSync;

  constructor(caminho: string) {
    try {
      if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
      this.#db = new DatabaseSync(caminho);
    } catch (e) {
      // The raw SQLite error is "unable to open database file", which says neither where nor why.
      // In a container it is almost always permission: the process runs as `node`, and a volume
      // mounted from the host arrives owned by the host user — the image chown never reaches a
      // bind mount.
      const causa = (e as NodeJS.ErrnoException).code === 'EACCES' || /unable to open/i.test(String(e))
        ? `sem permissão de escrita em ${dirname(caminho)}`
        : String((e as Error).message ?? e);
      throw new Error(
        `não consegui abrir o banco em ${caminho}: ${causa}.\n` +
        '  Em contêiner, prefira um volume nomeado (-v dados:/dados), que herda o dono da imagem.\n' +
        '  Com pasta do host, dê o dono a quem roda:  mkdir -p dados && sudo chown 1000:1000 dados');
    }

    // WAL: a read does not block a write. In a review tool, several tabs read at the same time.
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA foreign_keys = ON');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id           TEXT PRIMARY KEY,
        type         TEXT NOT NULL,
        page         TEXT NOT NULL,
        block        TEXT,
        fingerprint  TEXT,
        text         TEXT,
        snapshot     TEXT,
        author       TEXT NOT NULL,
        happened_at  TEXT NOT NULL,
        data         TEXT
      );
      CREATE INDEX IF NOT EXISTS events_by_page ON events (page, happened_at);

      -- The documentation INDEX (blocks, dependencies, issues) does NOT live here: it is derived
      -- and rebuilt on every "doc-first index", while this table is fact and the database refuses
      -- to erase it. See review/api/index-store.ts — one definition, and the difference explicit.
    `);

    this.#migrarDoPortugues();

    // Triggers that REFUSE to alter and to delete. "Nothing is erased" stops depending on the code
    // never calling UPDATE: the database refuses, even for someone opening the file with another
    // program.
    this.#db.exec(`
      CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
        BEGIN SELECT RAISE(ABORT, 'an event is not altered: the trail is the product'); END;
      CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
        BEGIN SELECT RAISE(ABORT, 'an event is not deleted: the trail is the product'); END;
    `);
  }

  /**
   * Carries over a database written before 2026-09-20, when the table was `eventos` and the
   * columns were in Portuguese.
   *
   * ⚠️ It COPIES, it does not move: the old table stays where it is. Renaming a table that holds
   * human approvals is the kind of migration you only get to run wrong once — and the old triggers
   * would refuse a DELETE anyway.
   *
   * Runs before the new triggers exist, because INSERT into a table guarded by them is fine but
   * there is no reason to make the migration fight the guard.
   */
  #migrarDoPortugues() {
    const velha = this.#db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='eventos'").get();
    if (!velha) return;

    const quantos = this.#db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number };
    if (quantos.n > 0) return;                       // already migrated: do not duplicate

    const linhas = this.#db.prepare('SELECT COUNT(*) AS n FROM eventos').get() as { n: number };
    if (linhas.n === 0) return;

    this.#db.exec(`
      INSERT INTO events (id, type, page, block, fingerprint, text, snapshot, author, happened_at, data)
      SELECT id, tipo, pagina, caixa, digital, texto, foto, autor, quando, dados FROM eventos;
    `);
    console.warn(JSON.stringify({
      nivel: 'AVISO', evento: 'banco_migrado', de: 'eventos', para: 'events', linhas: linhas.n,
      mensagem: 'A tabela antiga foi COPIADA, não movida. Ela continua no arquivo — confira os '
        + 'dados e só então apague à mão, se quiser.',
    }));
  }

  async incluir(novo: NovoEvento, autor: string): Promise<Evento> {
    const e: Evento = {
      ...novo, id: crypto.randomUUID().replace(/-/g, ''), autor, quando: new Date().toISOString(),
    };
    // The column names are English; the `Evento` object is still the API contract, in Portuguese.
    // The seam lives here, in one place, and dies when review/api/ is translated.
    this.#db.prepare(
      `INSERT INTO events (id, type, page, block, fingerprint, text, snapshot, author, happened_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(e.id, e.tipo, e.pagina, e.caixa ?? null, e.digital ?? null, e.texto ?? null,
          e.foto ?? null, e.autor, e.quando, e.dados ? JSON.stringify(e.dados) : null);
    return e;
  }

  async listar(pagina?: string | null): Promise<Evento[]> {
    const linhas = pagina == null
      ? this.#db.prepare('SELECT * FROM events ORDER BY happened_at').all()
      : this.#db.prepare('SELECT * FROM events WHERE page = ? ORDER BY happened_at').all(pagina);
    return (linhas as Record<string, string | null>[]).map((l) => ({
      id: l.id!, tipo: l.type!, pagina: l.page!, caixa: l.block, digital: l.fingerprint,
      texto: l.text, foto: l.snapshot, autor: l.author!, quando: l.happened_at!,
      dados: l.data ? JSON.parse(l.data) : null,
    }));
  }

  fechar() { this.#db.close(); }
}
