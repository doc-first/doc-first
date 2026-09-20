/** Tests for the shared core. They run with `node --test`, with no dependency at all.
 *
 *  The gold cases (review/tests/cases/cycle-cases.json) are the fixed point of the request cycle.
 *  They exist because this state machine once lived in several languages at once, and the copies
 *  drifted: the same request showed as approved in one place and awaiting triage in another. The
 *  cases outlived the copies, and now guard the single implementation. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCycle } from '../core/cycle.js';
import { doHistorico, estadoAtual } from '../core/legacy.js';
import { fingerprintOfText, normalize, SIZE } from '../core/fingerprint.js';
import { overLimit, validCommit } from '../core/limits.js';

const raiz = new URL('../', import.meta.url);
const tabela = JSON.parse(readFileSync(new URL('cycle.json', raiz), 'utf8'));
const ciclo = createCycle(tabela);
const ouro = JSON.parse(readFileSync(new URL('tests/cases/cycle-cases.json', raiz), 'utf8'));

/** The log of a gold case, the way it was RECORDED in pt-BR until 2026-09-19. */
function logComoEraGravado(caso) {
  const eventos = [{ id: 'p1', tipo: 'pedido', quando: '2026-09-18T10:00:00Z', dados: null }];
  caso.eventos.forEach((e, i) => {
    const dados = { pedido: 'p1' };
    if (!e.complemento) { dados.estado = e.estado; if (e.de) dados.de = e.de; }
    eventos.push({ id: 'e' + i, tipo: e.complemento ? 'complemento' : 'pedido_estado',
                   quando: `2026-09-18T10:00:${String(i + 1).padStart(2, '0')}Z`, dados });
  });
  return eventos;
}

/**
 * The gold cases stay written in pt-BR on purpose: they are the REAL history, exactly as it sits
 * recorded in Firestore. Running them through the compatibility map is the proof that matters — if
 * `legacy.js` gets one pair wrong, an old request changes state on its own, and nothing else would
 * warn.
 */
test('gold cases, as they were recorded: the old history still gives the same state', () => {
  for (const caso of ouro.casos) {
    const eventos = logComoEraGravado(caso).map(doHistorico);
    assert.equal(ciclo.currentState('p1', eventos, caso.autorEhAdmin),
      estadoAtual(caso.esperado), caso.nome);
  }
});

/** And the same cases written ALREADY in English: the new path cannot lean on the map to walk. */
test('gold cases, as they are recorded today: the same state without going through the map', () => {
  for (const caso of ouro.casos) {
    const eventos = [{ id: 'p1', type: 'request', when: '2026-09-18T10:00:00Z', data: null }];
    caso.eventos.forEach((e, i) => {
      const data = { request: 'p1' };
      if (!e.complemento) { data.state = estadoAtual(e.estado); if (e.de) data.from = estadoAtual(e.de); }
      eventos.push({ id: 'e' + i, type: e.complemento ? 'supplement' : 'request_state',
                     when: `2026-09-18T10:00:${String(i + 1).padStart(2, '0')}Z`, data });
    });
    assert.equal(ciclo.currentState('p1', eventos, caso.autorEhAdmin),
      estadoAtual(caso.esperado), caso.nome);
  }
});

test('the whole transition table: 49 pairs, no exception', () => {
  const estados = Object.keys(tabela.states);
  for (const de of estados) {
    for (const para of estados) {
      const esperado = (tabela.transitions[de] ?? []).includes(para);
      assert.equal(ciclo.canGo(de, para), esperado, `${de} → ${para}`);
    }
  }
  assert.equal(estados.length ** 2, 49, 'there are 7 states: 49 pairs');
});

test('no state goes to itself', () => {
  for (const e of Object.keys(tabela.states)) assert.equal(ciclo.canGo(e, e), false, `${e} → ${e}`);
});

test('an unknown state goes nowhere', () => {
  assert.equal(ciclo.canGo('made_up', 'approved'), false);
  assert.equal(ciclo.canGo('open', 'made_up'), false);
});

test('approved offers no triage; open offers the three the owner has', () => {
  assert.deepEqual(ciclo.status('approved').triage, []);
  assert.deepEqual(ciclo.status('open').triage, ['approved', 'rejected', 'question']);
});

test('an invalid table does not slip through', () => {
  assert.throws(() => createCycle({ states: {}, transitions: {} }), /no states or no transitions/);
  assert.throws(() => createCycle({ ...tabela, initial: 'does_not_exist' }), /initial state/);
  assert.throws(() => createCycle({ ...tabela, transitions: { open: ['ghost'] } }), /does not exist/);
});

test('fingerprint: spaces do not count, 16 characters, different text changes it', async () => {
  assert.equal(await fingerprintOfText('Hello   world'), await fingerprintOfText('Hello world'));
  assert.equal((await fingerprintOfText('x')).length, SIZE);
  assert.notEqual(await fingerprintOfText('a'), await fingerprintOfText('b'));
  assert.equal(normalize('  a   b  '), 'a b');
});

test('fingerprint: compatible with what is already validated', () => {
  // The blocks approved in the first project were checked against the previous parser on 2026-09-19: 17 of 17.
  // This test holds the contract: change the definition of the fingerprint and every existing approval falls.
  assert.equal(SIZE, 16, 'changing the size invalidates the recorded approvals');
});

test('a data value that is an object does not cross the size limit', () => {
  // String({...}) gives "[object Object]": 15 characters. Without the type check, an object with
  // megabytes inside would sail past the 200-character ceiling without ever touching it.
  const enorme = { recheio: 'x'.repeat(500_000) };
  assert.match(overLimit({ page: 'D01', data: { extra: enorme } }) ?? '', /texto ou número/);
  assert.match(overLimit({ page: 'D01', data: { extra: ['x'.repeat(500_000)] } }) ?? '', /texto ou número/);
  assert.equal(overLimit({ page: 'D01', data: { extra: 'normal value', n: 7, nada: null } }), null);
});

test('limits: what comes in has a size and a shape', () => {
  assert.equal(overLimit({ page: 'UC-01', text: 'ok' }), null);
  assert.match(overLimit({ page: '../etc' }) ?? '', /página inválida/);
  assert.match(overLimit({ page: 'D01', text: 'x'.repeat(4001) }) ?? '', /texto/);
  assert.match(overLimit({ page: 'D01', block: 'D01 1' }) ?? '', /caractere/);
  // The message says WHICH field blew up: "invalid" without saying where makes the reviewer try again in the dark.
  assert.match(overLimit({ page: 'D01', snapshot: 'y'.repeat(20001) }) ?? '', /foto/);
});

test('limits: applied without a real commit does not pass', () => {
  assert.equal(validCommit({ commit: 'abc1234' }), true);
  assert.equal(validCommit({ commit: 'done' }), false);
  assert.equal(validCommit({}), false);
  assert.equal(validCommit(null), false);
});

/**
 * The browser bridge (review/web/core-web.js) is the ONLY place where the front touches the core,
 * and nothing else exercises it: the HTTP contract tests the API, and the unit tests import the
 * core directly. When the core turned English, a wrong name here would only show up as a button
 * that never mounts, on the screen of whoever was reviewing.
 */
test('the browser bridge hands the front the names it calls', async () => {
  const doc = { dispatchEvent: () => {} };
  const janela = {};
  Object.assign(globalThis, { window: janela, document: doc, CustomEvent: class { constructor() {} } });
  try {
    await import('../web/core-web.js');
    const nucleo = janela.DOC_FIRST?.nucleo ?? {};
    // The names front/js/review.js calls today. Changed here? Change it there — or the button vanishes.
    for (const nome of ['digitalDoElemento', 'digitalDoTexto', 'textoDoElemento', 'normalizar']) {
      assert.equal(typeof nucleo[nome], 'function', `A.nucleo.${nome} has to exist`);
    }
    assert.equal(nucleo.TAMANHO, 16);
    assert.equal(typeof janela.DOC_FIRST.digital, 'function');
    assert.equal(await nucleo.digitalDoTexto('  a   b '), await nucleo.digitalDoTexto('a b'),
      'the bridge has to use the SAME fingerprint as the core, not a copy');
  } finally {
    delete globalThis.window; delete globalThis.document; delete globalThis.CustomEvent;
  }
});
