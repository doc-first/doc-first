/**
 * IAP JWT validation.
 *
 * Why this file exists: the contract suite tests IAP with three assertions that expect 401, 401 and
 * 401 — no JWT, forged e-mail, forged JWT. **An unconditional `return 401` passes all three**, and
 * would take down 100% of the legitimate access in production. There was not a single assertion
 * that a VALID JWT is accepted, and that is the most expensive case to break.
 *
 * Here a legitimate ES256 JWT is generated and signed on the spot, against a local JWKS, and what
 * gets checked is that it is ACCEPTED — and that every deviation from it (wrong issuer, wrong
 * audience, expired, swapped algorithm, signed by another key) is refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Identidade } from '../api/identity-iap.ts';

const AUDIENCIA = '/projects/1/locations/x/services/y';
const EMISSOR = 'https://cloud.google.com/iap';

/** Starts a local JWKS and returns what it takes to sign and to validate. */
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

test('a valid IAP JWT is ACCEPTED — the assertion that was missing', async () => {
  const c = await comChaves();
  try {
    const id = new Identidade({ audiencia: AUDIENCIA, ambiente: 'Production', urlJwks: c.url });
    const jwt = await assinar(c.privateKey);
    assert.equal(await id.email({ 'x-goog-iap-jwt-assertion': jwt }), 'pessoa@exemplo.org');
  } finally { c.fechar(); }
});

test('the e-mail comes out lowercase', async () => {
  const c = await comChaves();
  try {
    const id = new Identidade({ audiencia: AUDIENCIA, ambiente: 'Production', urlJwks: c.url });
    const jwt = await assinar(c.privateKey, { claims: { email: 'Pessoa@Exemplo.ORG' } });
    assert.equal(await id.email({ 'x-goog-iap-jwt-assertion': jwt }), 'pessoa@exemplo.org');
  } finally { c.fechar(); }
});

test('every deviation from the legitimate JWT is refused', async () => {
  const c = await comChaves();
  try {
    const id = new Identidade({ audiencia: AUDIENCIA, ambiente: 'Production', urlJwks: c.url });
    const casos = {
      'wrong issuer': await assinar(c.privateKey, { issuer: 'https://malicioso.example' }),
      'audience of another service': await assinar(c.privateKey, { audience: '/projects/9/services/z' }),
      'expired': await assinar(c.privateKey, { exp: Math.floor(Date.now() / 1000) - 3600 }),
      'signed by another key': await assinar(c.outraChave),
    };
    for (const [nome, jwt] of Object.entries(casos)) {
      assert.equal(await id.email({ 'x-goog-iap-jwt-assertion': jwt }), null, nome + ' should be refused');
    }
    assert.equal(await id.email({}), null, 'no header');
    assert.equal(await id.email({ 'x-goog-authenticated-user-email': 'accounts.google.com:x@y' }), null,
      'the e-mail header on its own is NEVER trustworthy');
  } finally { c.fechar(); }
});

test('with no audience, outside development, it does not even construct', () => {
  assert.throws(() => new Identidade({ ambiente: 'Production' }), /REVISAO_AUDIENCIA/);
});

test('the development shortcut demands BOTH conditions', async () => {
  const soModo = new Identidade({ audiencia: AUDIENCIA, modo: 'local', ambiente: 'Production' });
  assert.equal(soModo.modoLocal, false, 'local mode asked for in Production has to be ignored');
  assert.equal(await soModo.email({ 'x-dev-email': 'quem@quiser.org' }), null);

  const osDois = new Identidade({ modo: 'local', ambiente: 'Development' });
  assert.equal(osDois.modoLocal, true);
  assert.equal(await osDois.email({ 'x-dev-email': 'quem@quiser.org' }), 'quem@quiser.org');
});
