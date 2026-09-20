import { Pessoas, type Pessoa } from './users.ts';
import { randomBytes } from 'node:crypto';

/**
 * Identidade por usuário e senha, no próprio serviço — a alternativa ao IAP do Google.
 *
 * É o que permite o Doc First ser usado como o Keycloak é: sobe, entra, trabalha. Sem conta em nuvem
 * nenhuma, sem provedor externo.
 *
 * A sessão vive num cookie `httpOnly` + `SameSite=Strict`: JavaScript da página não o lê (então um
 * XSS não rouba a sessão) e ele não viaja em requisição vinda de outro site (então não há CSRF por
 * navegação). `Secure` fica ligado fora de desenvolvimento.
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
   * Cria o primeiro acesso, se não houver ninguém. A senha é gerada e devolvida para ser mostrada
   * UMA vez, no log da primeira subida.
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

  /** E-mail de quem chamou, a partir do cookie. Null = não autenticado. */
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

  /** Token de uso único para formulários, contra CSRF em POST. */
  novoToken(): string { return randomBytes(24).toString('base64url'); }
}
