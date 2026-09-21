import type { User, UserStore } from './users.ts';
import { randomBytes } from 'node:crypto';

/**
 * Identity by user and password, inside the service itself — the alternative to Google IAP.
 *
 * It is what lets Doc First be used the way Keycloak is: start it, log in, work. No cloud account
 * anywhere, no external provider.
 *
 * The session lives in a `httpOnly` + `SameSite=Strict` cookie: page JavaScript cannot read it (so
 * an XSS does not steal the session) and it does not travel on a request coming from another site
 * (so there is no CSRF by navigation). `Secure` stays on outside development.
 */
export const COOKIE = 'docfirst_sessao';

export class IdentidadeSenha {
  #users: UserStore;
  #seguro: boolean;

  constructor(users: UserStore, opcoes: { seguro?: boolean } = {}) {
    this.#users = users;
    this.#seguro = opcoes.seguro ?? true;
  }

  get users() { return this.#users; }

  /**
   * Creates the first access, if nobody exists yet. The password is generated and returned to be
   * shown ONCE, in the log of the first start.
   */
  async primeiroAcesso(email: string, nome = 'Administration'): Promise<string | null> {
    if (!(await this.#users.isEmpty())) return null;
    return this.#users.create(email, nome);
  }

  async entrar(email: string, senha: string): Promise<{ pessoa: User; sessao: string } | null> {
    const pessoa = await this.#users.check(email, senha);
    if (!pessoa) return null;
    return { pessoa, sessao: await this.#users.openSession(pessoa.email) };
  }

  /**
   * E-mail of the caller, taken from the cookie. Null = not authenticated.
   *
   * A promise even though SQLite could answer right away: the store may be Postgres or Firestore,
   * over the network, and a caller written against the synchronous version would silently pass a
   * pending promise around as if it were a person.
   */
  async daRequisicao(cabecalhos: Record<string, string | string[] | undefined>): Promise<User | null> {
    return this.#users.fromSession(this.#lerCookie(cabecalhos, COOKIE));
  }

  cabecalhoDeSessao(id: string, horas = 12): string {
    const partes = [
      `${COOKIE}=${id}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${horas * 3600}`,
    ];
    if (this.#seguro) partes.push('Secure');
    return partes.join('; ');
  }

  cabecalhoDeSaida(): string {
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
  }

  #lerCookie(cabecalhos: Record<string, string | string[] | undefined>, nome: string): string | undefined {
    const bruto = cabecalhos.cookie;
    const texto = Array.isArray(bruto) ? bruto[0] : bruto;
    if (!texto) return undefined;
    for (const parte of texto.split(';')) {
      const [k, ...v] = parte.trim().split('=');
      if (k === nome) return v.join('=');
    }
    return undefined;
  }

  /** Single-use token for forms, against CSRF on POST. */
  novoToken(): string { return randomBytes(24).toString('base64url'); }
}
