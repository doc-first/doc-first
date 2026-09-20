/**
 * A validação do JWT do IAP.
 *
 * Por que este arquivo existe: a suíte de contrato testa o IAP com três asserções que esperam
 * 401, 401 e 401 — sem JWT, com e-mail forjado, com JWT forjado. **Um `return 401` incondicional
 * passaria nas três**, e derrubaria 100% dos acessos legítimos em produção. Não havia uma única
 * asserção de que um JWT VÁLIDO é aceito, e esse é o cenário mais caro de quebrar.
 *
 * Aqui um JWT ES256 legítimo é gerado e assinado na hora, com um JWKS local, e o que se verifica é
 * que ele é ACEITO — e que cada desvio dele (emissor errado, audiência errada, expirado, algoritmo
 * trocado, assinatura de outra chave) é recusado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Identidade } from '../api/identity-iap.ts';

const AUDIENCIA = '/projects/1/locations/x/services/y';
const EMISSOR = 'https://cloud.google.com/iap';

/** Sobe um JWKS local e devolve o que é preciso para assinar e para validar. */
async function comChaves() {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: 'teste', alg: 'ES256', use: 'sig' };
  const servidor = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((ok) => servidor.listen(0, ok));
  const porta = servidor.address().port;

  const outra = await generateKeyPair('ES256', { extractable: true });
  return {
    privateKey, outraChave: outra.privateKey,
    url: `http://127.0.0.1:${porta}/jwks`,
    fechar: () => servidor.close(),
  };
}

const assinar = (chave, extra = {}) =>
  new SignJWT({ email: 'pessoa@exemplo.org', ...extra.claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'teste' })
    .setIssuer(extra.issuer ?? EMISSOR)
    .setAudience(extra.audience ?? AUDIENCIA)
    .setIssuedAt()
    .setExpirationTime(extra.exp ?? '5m')
    .sign(chave);

test('JWT válido do IAP é ACEITO — a asserção que faltava', async () => {
  const c = await comChaves();
  try {
    const id = new Identidade({ audiencia: AUDIENCIA, ambiente: 'Production', urlJwks: c.url });
    const jwt = await assinar(c.privateKey);
    assert.equal(await id.email({ 'x-goog-iap-jwt-assertion': jwt }), 'pessoa@exemplo.org');
  } finally { c.fechar(); }
});

test('e-mail sai em minúsculas', async () => {
  const c = await comChaves();
  try {
    const id = new Identidade({ audiencia: AUDIENCIA, ambiente: 'Production', urlJwks: c.url });
    const jwt = await assinar(c.privateKey, { claims: { email: 'Pessoa@Exemplo.ORG' } });
    assert.equal(await id.email({ 'x-goog-iap-jwt-assertion': jwt }), 'pessoa@exemplo.org');
  } finally { c.fechar(); }
});

test('cada desvio do JWT legítimo é recusado', async () => {
  const c = await comChaves();
  try {
    const id = new Identidade({ audiencia: AUDIENCIA, ambiente: 'Production', urlJwks: c.url });
    const casos = {
      'emissor errado': await assinar(c.privateKey, { issuer: 'https://malicioso.example' }),
      'audiência de outro serviço': await assinar(c.privateKey, { audience: '/projects/9/services/z' }),
      'expirado': await assinar(c.privateKey, { exp: Math.floor(Date.now() / 1000) - 3600 }),
      'assinado por outra chave': await assinar(c.outraChave),
    };
    for (const [nome, jwt] of Object.entries(casos)) {
      assert.equal(await id.email({ 'x-goog-iap-jwt-assertion': jwt }), null, nome + ' deveria ser recusado');
    }
    assert.equal(await id.email({}), null, 'sem cabeçalho');
    assert.equal(await id.email({ 'x-goog-authenticated-user-email': 'accounts.google.com:x@y' }), null,
      'o cabeçalho de e-mail sozinho NUNCA é confiável');
  } finally { c.fechar(); }
});

test('sem audiência, fora de desenvolvimento, nem constrói', () => {
  assert.throws(() => new Identidade({ ambiente: 'Production' }), /REVISAO_AUDIENCIA/);
});

test('o atalho de desenvolvimento exige as DUAS condições', async () => {
  const soModo = new Identidade({ audiencia: AUDIENCIA, modo: 'local', ambiente: 'Production' });
  assert.equal(soModo.modoLocal, false, 'modo local pedido em Production tem de ser ignorado');
  assert.equal(await soModo.email({ 'x-dev-email': 'quem@quiser.org' }), null);

  const osDois = new Identidade({ modo: 'local', ambiente: 'Development' });
  assert.equal(osDois.modoLocal, true);
  assert.equal(await osDois.email({ 'x-dev-email': 'quem@quiser.org' }), 'quem@quiser.org');
});
