import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Who is using it comes from IAP: the `x-goog-iap-jwt-assertion` header is signed by Google
 * (ES256). Signature, issuer and audience all get validated — the e-mail header alone is NOT
 * trustworthy and is ignored on purpose.
 *
 * The development shortcut (`X-Dev-Email`) demands TWO conditions: development environment AND
 * `REVISAO_MODO=local`. The second one used to be enough, and that allowed turning it on in a
 * published service and becoming owner with one header, no JWT at all.
 *
 * jose's `createRemoteJWKSet` already solves what was hand-written in C#: key cache, a lock against
 * concurrent fetches, and a new fetch when an unknown `kid` shows up (Google rotation).
 */
export class Identidade {
  #jwks: ReturnType<typeof createRemoteJWKSet>;
  #audiencia: string;
  #local: boolean;
  #emailDeDev?: string;

  /** `urlJwks` exists so a test can start a local JWKS and prove that a VALID JWT is accepted —
   *  without it only refusal is testable, and an unconditional `return null` would pass everything. */
  constructor(cfg: { audiencia?: string; modo?: string; ambiente?: string; emailDeDev?: string; urlJwks?: string }) {
    this.#jwks = createRemoteJWKSet(
      new URL(cfg.urlJwks ?? 'https://www.gstatic.com/iap/verify/public_key-jwk'),
      { cacheMaxAge: 6 * 60 * 60 * 1000, timeoutDuration: 5000 });
    this.#audiencia = cfg.audiencia ?? '';
    const pediuLocal = cfg.modo === 'local';
    const ehDesenvolvimento = (cfg.ambiente ?? 'Production') === 'Development';
    this.#local = pediuLocal && ehDesenvolvimento;
    this.#emailDeDev = cfg.emailDeDev;

    if (pediuLocal && !this.#local) {
      console.warn(JSON.stringify({
        nivel: 'AVISO', evento: 'modo_local_ignorado', ambiente: cfg.ambiente,
        mensagem: 'REVISAO_MODO=local pedido fora de Development: IGNORADO. A identidade continua vindo do JWT do IAP.',
      }));
    }
    if (!this.#local && !this.#audiencia) {
      throw new Error(
        'REVISAO_AUDIENCIA é obrigatória fora de desenvolvimento: é ela que amarra o JWT do IAP a ESTE ' +
        'serviço. Formato: /projects/<numero>/locations/<regiao>/services/<servico>.');
    }
  }

  get modoLocal() { return this.#local; }

  /** E-mail of the caller, or null. Null = 401. */
  async email(cabecalhos: Record<string, string | string[] | undefined>): Promise<string | null> {
    if (this.#local) {
      const dev = cabecalhos['x-dev-email'];
      return (Array.isArray(dev) ? dev[0] : dev) ?? this.#emailDeDev ?? null;
    }
    const bruto = cabecalhos['x-goog-iap-jwt-assertion'];
    const jwt = Array.isArray(bruto) ? bruto[0] : bruto;
    if (!jwt) return null;

    try {
      const { payload } = await jwtVerify(jwt, this.#jwks, {
        issuer: 'https://cloud.google.com/iap',
        audience: this.#audiencia,
        algorithms: ['ES256'],
        clockTolerance: 30,
      });
      const email = payload.email;
      return typeof email === 'string' ? email.toLowerCase() : null;
    } catch (erro) {
      console.warn(JSON.stringify({
        nivel: 'AVISO', evento: 'jwt_recusado',
        motivo: erro instanceof Error ? erro.message : String(erro),
      }));
      return null;
    }
  }
}
