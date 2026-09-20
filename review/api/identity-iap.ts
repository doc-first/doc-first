import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Quem está usando vem do IAP: o cabeçalho `x-goog-iap-jwt-assertion` é assinado pelo Google (ES256).
 * Validamos assinatura, emissor e audiência — o cabeçalho de e-mail sozinho NÃO é confiável e é
 * ignorado de propósito.
 *
 * O atalho de desenvolvimento (`X-Dev-Email`) exige DUAS condições: ambiente de desenvolvimento E
 * `REVISAO_MODO=local`. Antes bastava a segunda, e dava para ligá-lo num serviço publicado e virar
 * owner com um cabeçalho, sem JWT nenhum.
 *
 * O `createRemoteJWKSet` do jose já resolve o que era feito à mão no C#: cache das chaves, trava
 * contra busca concorrente, e nova busca quando aparece um `kid` desconhecido (rotação do Google).
 */
export class Identidade {
  #jwks: ReturnType<typeof createRemoteJWKSet>;
  #audiencia: string;
  #local: boolean;
  #emailDeDev?: string;

  /** `urlJwks` existe para o teste poder subir um JWKS local e provar que um JWT VÁLIDO é aceito —
   *  sem isso, só dá para testar recusa, e um `return null` incondicional passaria em tudo. */
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

  /** E-mail de quem chamou, ou null. Null = 401. */
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
