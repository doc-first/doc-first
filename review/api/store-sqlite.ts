import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Evento, NovoEvento, Registro } from './types.ts';

/**
 * Persistência em SQLite, usando o `node:sqlite` embutido — **nenhuma dependência externa**.
 *
 * É o que permite subir o Doc First e usar, sem banco, sem nuvem, sem conta em lugar nenhum: um
 * arquivo no disco. Para valer em equipe, troque por Postgres/MySQL implementando a mesma interface
 * `Registro` — são cinco métodos.
 *
 * SÓ INCLUI, como manda o método: não existe UPDATE nem DELETE neste arquivo. O rastro é o produto.
 */
export class RegistroSqlite implements Registro {
  #db: DatabaseSync;

  constructor(caminho: string) {
    try {
      if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
      this.#db = new DatabaseSync(caminho);
    } catch (e) {
      // O erro cru do SQLite é "unable to open database file", que não diz onde nem por quê. Num
      // contêiner isso é quase sempre permissão: o processo roda como `node`, e um volume montado
      // do host chega com o dono do host — o chown da imagem não alcança bind mount.
      const causa = (e as NodeJS.ErrnoException).code === 'EACCES' || /unable to open/i.test(String(e))
        ? `sem permissão de escrita em ${dirname(caminho)}`
        : String((e as Error).message ?? e);
      throw new Error(
        `não consegui abrir o banco em ${caminho}: ${causa}.\n` +
        '  Em contêiner, prefira um volume nomeado (-v dados:/dados), que herda o dono da imagem.\n' +
        '  Com pasta do host, dê o dono a quem roda:  mkdir -p dados && sudo chown 1000:1000 dados');
    }

    // WAL: leitura não bloqueia escrita. Numa ferramenta de revisão, várias abas leem ao mesmo tempo.
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA foreign_keys = ON');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS eventos (
        id       TEXT PRIMARY KEY,
        tipo     TEXT NOT NULL,
        pagina   TEXT NOT NULL,
        caixa    TEXT,
        digital  TEXT,
        texto    TEXT,
        foto     TEXT,
        autor    TEXT NOT NULL,
        quando   TEXT NOT NULL,
        dados    TEXT
      );
      CREATE INDEX IF NOT EXISTS eventos_por_pagina ON eventos (pagina, quando);

      -- O ÍNDICE da documentação (trechos, dependências, pendências) NÃO mora aqui: ele é
      -- derivado e refeito a cada "doc-first indexar", enquanto esta tabela é fato e o banco
      -- recusa apagar. Ver review/api/index-store.ts — uma definição só, e a diferença explícita.
    `);

    // Um gatilho que RECUSA alterar e apagar. A regra "nada se apaga" deixa de depender de o código
    // nunca chamar UPDATE: o banco recusa, inclusive para quem abrir o arquivo com outro programa.
    this.#db.exec(`
      CREATE TRIGGER IF NOT EXISTS eventos_sem_update BEFORE UPDATE ON eventos
        BEGIN SELECT RAISE(ABORT, 'evento nao se altera: o rastro e o produto'); END;
      CREATE TRIGGER IF NOT EXISTS eventos_sem_delete BEFORE DELETE ON eventos
        BEGIN SELECT RAISE(ABORT, 'evento nao se apaga: o rastro e o produto'); END;
    `);
  }

  async incluir(novo: NovoEvento, autor: string): Promise<Evento> {
    const e: Evento = {
      ...novo, id: crypto.randomUUID().replace(/-/g, ''), autor, quando: new Date().toISOString(),
    };
    this.#db.prepare(
      `INSERT INTO eventos (id, tipo, pagina, caixa, digital, texto, foto, autor, quando, dados)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(e.id, e.tipo, e.pagina, e.caixa ?? null, e.digital ?? null, e.texto ?? null,
          e.foto ?? null, e.autor, e.quando, e.dados ? JSON.stringify(e.dados) : null);
    return e;
  }

  async listar(pagina?: string | null): Promise<Evento[]> {
    const linhas = pagina == null
      ? this.#db.prepare('SELECT * FROM eventos ORDER BY quando').all()
      : this.#db.prepare('SELECT * FROM eventos WHERE pagina = ? ORDER BY quando').all(pagina);
    return (linhas as Record<string, string | null>[]).map((l) => ({
      id: l.id!, tipo: l.tipo!, pagina: l.pagina!, caixa: l.caixa, digital: l.digital,
      texto: l.texto, foto: l.foto, autor: l.autor!, quando: l.quando!,
      dados: l.dados ? JSON.parse(l.dados) : null,
    }));
  }

  fechar() { this.#db.close(); }
}
