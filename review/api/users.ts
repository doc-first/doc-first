import { DatabaseSync } from 'node:sqlite';
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const derivar = promisify(scrypt) as (s: string, salt: Buffer, len: number) => Promise<Buffer>;

/**
 * Authentication of its own: who gets in, with user and password, depending on no provider.
 *
 * It exists so Doc First can be used the way Keycloak is: start the image, log in as admin, get to
 * work. Until here identity came from Google IAP, and that tied the method to one specific cloud —
 * anyone outside GCP had no way to use it.
 *
 * About the passwords:
 * - stored with **scrypt** (Node ships it), one salt per person, never in plain text;
 * - comparison in **constant time**, so the response time does not reveal how many characters match;
 * - the admin's initial password is **randomly generated** and shown ONCE in the log of the first
 *   start. "admin/admin" is inviting, but whoever starts it and forgets leaves the door open — and
 *   an internal documentation tool tends to stay up for years with nobody looking;
 * - changing the initial password is **mandatory**: until it changes, the person reaches only the
 *   change screen.
 */
export interface Pessoa {
  email: string;
  nome: string;
  precisaTrocarSenha: boolean;
  criadaEm: string;
}

export class Pessoas {
  #db: DatabaseSync;

  constructor(caminho: string) {
    if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
    this.#db = new DatabaseSync(caminho);
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS pessoas (
        email     TEXT PRIMARY KEY,
        nome      TEXT NOT NULL,
        sal       BLOB NOT NULL,
        hash      BLOB NOT NULL,
        trocar    INTEGER NOT NULL DEFAULT 0,
        criada_em TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessoes (
        id      TEXT PRIMARY KEY,
        email   TEXT NOT NULL REFERENCES pessoas(email),
        criada  TEXT NOT NULL,
        expira  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessoes_por_expiracao ON sessoes (expira);
    `);
  }

  async #hash(senha: string, sal: Buffer): Promise<Buffer> {
    return derivar(senha.normalize('NFKC'), sal, 64);
  }

  /** Creates the person. Returns the generated password when none is given. */
  async criar(email: string, nome: string, senha?: string, precisaTrocar = true): Promise<string> {
    const senhaFinal = senha ?? randomBytes(12).toString('base64url');
    const sal = randomBytes(16);
    const hash = await this.#hash(senhaFinal, sal);
    this.#db.prepare(
      'INSERT INTO pessoas (email, nome, sal, hash, trocar, criada_em) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(email.toLowerCase().trim(), nome, sal, hash, precisaTrocar ? 1 : 0, new Date().toISOString());
    return senhaFinal;
  }

  /** Checks the password. Returns the person, or null — without saying whether the e-mail exists. */
  async conferir(email: string, senha: string): Promise<Pessoa | null> {
    const l = this.#db.prepare('SELECT * FROM pessoas WHERE email = ?')
      .get(email.toLowerCase().trim()) as Record<string, any> | undefined;

    // Derive a hash even with no person: without this, the response time would tell whether the e-mail exists.
    const sal = l ? Buffer.from(l.sal) : randomBytes(16);
    const calculado = await this.#hash(senha, sal);
    if (!l) return null;

    const guardado = Buffer.from(l.hash);
    if (calculado.length !== guardado.length || !timingSafeEqual(calculado, guardado)) return null;
    return { email: l.email, nome: l.nome, precisaTrocarSenha: !!l.trocar, criadaEm: l.criada_em };
  }

  async trocarSenha(email: string, nova: string): Promise<void> {
    if (nova.length < 12) throw new Error('a senha precisa de pelo menos 12 caracteres');
    const sal = randomBytes(16);
    const hash = await this.#hash(nova, sal);
    this.#db.prepare('UPDATE pessoas SET sal = ?, hash = ?, trocar = 0 WHERE email = ?')
      .run(sal, hash, email.toLowerCase().trim());
  }

  achar(email: string): Pessoa | null {
    const l = this.#db.prepare('SELECT email, nome, trocar, criada_em FROM pessoas WHERE email = ?')
      .get(email.toLowerCase().trim()) as Record<string, any> | undefined;
    return l ? { email: l.email, nome: l.nome, precisaTrocarSenha: !!l.trocar, criadaEm: l.criada_em } : null;
  }

  vazio(): boolean {
    return (this.#db.prepare('SELECT COUNT(*) c FROM pessoas').get() as any).c === 0;
  }

  // --------------------------------------------------------------- sessions
  abrirSessao(email: string, horas = 12): string {
    const id = randomBytes(32).toString('base64url');
    const agora = new Date();
    this.#db.prepare('INSERT INTO sessoes (id, email, criada, expira) VALUES (?, ?, ?, ?)').run(
      id, email.toLowerCase().trim(), agora.toISOString(),
      new Date(agora.getTime() + horas * 3600_000).toISOString());
    return id;
  }

  daSessao(id: string | undefined): Pessoa | null {
    if (!id) return null;
    const l = this.#db.prepare('SELECT email, expira FROM sessoes WHERE id = ?').get(id) as any;
    if (!l || l.expira < new Date().toISOString()) return null;
    return this.achar(l.email);
  }

  fecharSessao(id: string | undefined) {
    if (id) this.#db.prepare('DELETE FROM sessoes WHERE id = ?').run(id);
  }

  limparSessoesVencidas() {
    this.#db.prepare('DELETE FROM sessoes WHERE expira < ?').run(new Date().toISOString());
  }

  fechar() { this.#db.close(); }
}
