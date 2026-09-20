import { DatabaseSync } from 'node:sqlite';
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const derivar = promisify(scrypt) as (s: string, salt: Buffer, len: number) => Promise<Buffer>;

/**
 * Autenticação própria: quem entra, com usuário e senha, sem depender de provedor nenhum.
 *
 * Existe para o Doc First poder ser usado como o Keycloak é: sobe a imagem, entra com admin, começa
 * a trabalhar. Até aqui a identidade era o IAP do Google, e isso amarrava o método a uma nuvem
 * específica — quem não estivesse no GCP não tinha como usar.
 *
 * Sobre as senhas:
 * - guardadas com **scrypt** (o Node traz nativo), sal por pessoa, nunca em texto;
 * - comparação em **tempo constante**, para o tempo de resposta não revelar quantos caracteres batem;
 * - a senha inicial do admin é **gerada aleatoriamente** e mostrada UMA VEZ no log da primeira
 *   subida. "admin/admin" é convidativo, mas quem sobe e esquece fica com a porta aberta — e
 *   ferramenta de documentação interna costuma ficar anos no ar sem ninguém olhar;
 * - trocar a senha inicial é **obrigatório**: enquanto não trocar, a pessoa só acessa a troca.
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

  /** Cria a pessoa. Devolve a senha gerada quando nenhuma é informada. */
  async criar(email: string, nome: string, senha?: string, precisaTrocar = true): Promise<string> {
    const senhaFinal = senha ?? randomBytes(12).toString('base64url');
    const sal = randomBytes(16);
    const hash = await this.#hash(senhaFinal, sal);
    this.#db.prepare(
      'INSERT INTO pessoas (email, nome, sal, hash, trocar, criada_em) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(email.toLowerCase().trim(), nome, sal, hash, precisaTrocar ? 1 : 0, new Date().toISOString());
    return senhaFinal;
  }

  /** Confere a senha. Devolve a pessoa, ou null — sem dizer se o e-mail existe. */
  async conferir(email: string, senha: string): Promise<Pessoa | null> {
    const l = this.#db.prepare('SELECT * FROM pessoas WHERE email = ?')
      .get(email.toLowerCase().trim()) as Record<string, any> | undefined;

    // Mesmo sem a pessoa, derivamos um hash: sem isto, o tempo de resposta diria se o e-mail existe.
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

  // ---------------------------------------------------------------- sessões
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
