import { Pessoas, type Pessoa } from './users.ts';
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
  #pessoas: Pessoas;
  #seguro: boolean;

  constructor(pessoas: Pessoas, opcoes: { seguro?: boolean } = {}) {
    this.#pessoas = pessoas;
    this.#seguro = opcoes.seguro ?? true;
  }

  get pessoas() { return this.#pessoas; }

  /**
   * Creates the first access, if nobody exists yet. The password is generated and returned to be
   * shown ONCE, in the log of the first start.
   */
  async primeiroAcesso(email: string, nome = 'Administração'): Promise<string | null> {
    if (!this.#pessoas.vazio()) return null;
    return this.#pessoas.criar(email, nome);
  }

  async entrar(email: string, senha: string): Promise<{ pessoa: Pessoa; sessao: string } | null> {
    const pessoa = await this.#pessoas.conferir(email, senha);
    if (!pessoa) return null;
    return { pessoa, sessao: this.#pessoas.abrirSessao(pessoa.email) };
  }

  /** E-mail of the caller, taken from the cookie. Null = not authenticated. */
  daRequisicao(cabecalhos: Record<string, string | string[] | undefined>): Pessoa | null {
    return this.#pessoas.daSessao(this.#lerCookie(cabecalhos, COOKIE));
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
