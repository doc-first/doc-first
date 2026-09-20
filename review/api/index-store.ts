import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * O índice da documentação no banco: quais trechos existem, de que tipo são, de quem dependem, e
 * o que falta em cada um.
 *
 * ⚠️ Isto NÃO é a verdade. A verdade é o arquivo, versionado no git — é ele que tem diff,
 * histórico e autoria, e é nele que a pessoa escreve. Esta tabela é um retrato, refeito por
 * `doc-first indexar`, e pode ser apagada sem perda.
 *
 * A separação importa: `eventos` é fato e o banco recusa apagar; `trechos` é derivado e o banco
 * deixa. Se as duas fossem verdade, um dia discordariam — e não haveria como saber qual acreditar.
 *
 * Existe porque arquivo responde mal a algumas perguntas: "todos os diagramas suspeitos do
 * projeto", "toda decisão sem dono", "o que quebra se eu mexer aqui". Essas são de banco.
 */

export interface TrechoIndexado {
  id: string; pagina: string; tipo: string; arquivo: string;
  cod: string | null; numerado: boolean; digital: string; texto: string | null;
  depende: string[]; falta: string[];
}

export class Indice {
  #db: DatabaseSync;

  constructor(caminho: string) {
    if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
    this.#db = new DatabaseSync(caminho);
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS trechos (
        id TEXT PRIMARY KEY, pagina TEXT NOT NULL, tipo TEXT NOT NULL, arquivo TEXT NOT NULL,
        cod TEXT, numerado INTEGER NOT NULL, digital TEXT NOT NULL, texto TEXT,
        ordem INTEGER NOT NULL, indexado TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS trechos_por_pagina ON trechos (pagina, ordem);
      CREATE INDEX IF NOT EXISTS trechos_por_tipo   ON trechos (tipo);
      CREATE TABLE IF NOT EXISTS dependencias (
        trecho TEXT NOT NULL, depende TEXT NOT NULL, PRIMARY KEY (trecho, depende));
      CREATE INDEX IF NOT EXISTS dependencias_inversa ON dependencias (depende);
      CREATE TABLE IF NOT EXISTS pendencias (trecho TEXT NOT NULL, falta TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS pendencias_por_trecho ON pendencias (trecho);
    `);
  }

  /**
   * Refaz o índice inteiro. Apaga e reescreve numa transação: um índice pela metade mentiria pior
   * que um índice velho — quem consultasse no meio veria uma documentação que nunca existiu.
   */
  reindexar(trechos: TrechoIndexado[]) {
    const agora = new Date().toISOString();
    this.#db.exec('BEGIN');
    try {
      this.#db.exec('DELETE FROM pendencias; DELETE FROM dependencias; DELETE FROM trechos');
      const t = this.#db.prepare(
        `INSERT INTO trechos (id, pagina, tipo, arquivo, cod, numerado, digital, texto, ordem, indexado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const d = this.#db.prepare('INSERT OR IGNORE INTO dependencias (trecho, depende) VALUES (?, ?)');
      const f = this.#db.prepare('INSERT INTO pendencias (trecho, falta) VALUES (?, ?)');

      trechos.forEach((x, ordem) => {
        t.run(x.id, x.pagina, x.tipo, x.arquivo, x.cod, x.numerado ? 1 : 0,
              x.digital, x.texto, ordem, agora);
        for (const dep of x.depende) d.run(x.id, dep);
        for (const falta of x.falta) f.run(x.id, falta);
      });
      this.#db.exec('COMMIT');
    } catch (e) {
      this.#db.exec('ROLLBACK');
      throw e;
    }
    return trechos.length;
  }

  /** Quantos trechos de cada tipo — a pergunta "do que esta documentação é feita?". */
  porTipo(): { tipo: string; quantos: number }[] {
    return this.#db.prepare(
      'SELECT tipo, COUNT(*) AS quantos FROM trechos GROUP BY tipo ORDER BY quantos DESC',
    ).all() as never;
  }

  /** O que falta, por tipo. A fila de quem está escrevendo. */
  pendencias(tipo?: string): { id: string; tipo: string; falta: string }[] {
    const sql = `SELECT t.id, t.tipo, p.falta FROM pendencias p
                 JOIN trechos t ON t.id = p.trecho
                 ${tipo ? 'WHERE t.tipo = ?' : ''} ORDER BY t.pagina, t.ordem`;
    return (tipo ? this.#db.prepare(sql).all(tipo) : this.#db.prepare(sql).all()) as never;
  }

  /** Quem depende deste trecho. A pergunta que se faz ANTES de editar. */
  dependentesDe(id: string): string[] {
    return (this.#db.prepare('SELECT trecho FROM dependencias WHERE depende = ? ORDER BY trecho')
      .all(id) as { trecho: string }[]).map((r) => r.trecho);
  }

  /** Dependência apontando para trecho que não existe. Quebra silenciosa: ninguém vê ao ler. */
  dependenciasQuebradas(): { trecho: string; depende: string }[] {
    return this.#db.prepare(
      `SELECT d.trecho, d.depende FROM dependencias d
       LEFT JOIN trechos t ON t.id = d.depende
       WHERE t.id IS NULL ORDER BY d.trecho`,
    ).all() as never;
  }

  /** Os trechos de um tipo. Para "me mostre todos os diagramas". */
  doTipo(tipo: string): { id: string; pagina: string; texto: string }[] {
    return this.#db.prepare(
      'SELECT id, pagina, texto FROM trechos WHERE tipo = ? ORDER BY pagina, ordem',
    ).all(tipo) as never;
  }

  quando(): string | null {
    const r = this.#db.prepare('SELECT MAX(indexado) AS q FROM trechos').get() as { q: string | null };
    return r?.q ?? null;
  }

  fechar() { this.#db.close(); }
}
