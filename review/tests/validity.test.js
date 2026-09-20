/**
 * O semáforo. O caso que mais importa é o VERMELHO: o texto do trecho não mudou, e mesmo assim a
 * validação dele deixou de ser confiável porque a base mudou. Nenhuma digital deste trecho
 * denuncia isso — é preciso guardar o que as dependências eram no momento do ✓.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateOf, trafficLight, dependentsOf } from '../core/validity.js';

const trecho = (id, fingerprint, dependsOn = []) => [id, { id, fingerprint, dependsOn }];

test('white: nobody has validated it yet', () => {
  const r = stateOf({ id: 'A.1.1', fingerprint: 'aaa' }, undefined, new Map());
  assert.equal(r.state, 'none');
});

test('green: validated and nothing changed', () => {
  const r = stateOf({ id: 'A.1.1', fingerprint: 'aaa' }, { digital_texto: 'aaa' }, new Map());
  assert.equal(r.state, 'valid');
});

test("yellow: the block's own text changed after the ✓", () => {
  const r = stateOf({ id: 'A.1.1', fingerprint: 'NOVO' }, { digital_texto: 'aaa' }, new Map());
  assert.equal(r.state, 'stale');
  assert.match(r.why, /nobody approved the new text/);
});

test('RED: the text is unchanged, but the ground moved', () => {
  // Este é o caso que justifica o módulo existir. A digital do trecho bate — ele está idêntico ao
  // que foi aprovado. O que mudou foi a regra em que ele se apoia.
  const agora = new Map([['B.2.1', 'MUDOU']]);
  const r = stateOf(
    { id: 'A.1.1', fingerprint: 'aaa', dependsOn: ['B.2.1'] },
    { digital_texto: 'aaa', depende: { 'B.2.1': 'era-assim' } },
    agora,
  );
  assert.equal(r.state, 'broken');
  assert.deepEqual(r.blame, ['B.2.1']);
});

test('red when the dependency VANISHES, too', () => {
  // Apontar para um trecho que não existe mais é tão quebrado quanto apontar para um que mudou —
  // e é mais fácil de acontecer, porque apagar não deixa rastro no texto de quem dependia.
  const r = stateOf(
    { id: 'A.1.1', fingerprint: 'aaa', dependsOn: ['SUMIU.1.1'] },
    { digital_texto: 'aaa', depende: { 'SUMIU.1.1': 'existia' } },
    new Map(),
  );
  assert.equal(r.state, 'broken');
  assert.deepEqual(r.blame, ['SUMIU.1.1']);
});

test("yellow beats red: if the block's own text changed, that is the problem to fix", () => {
  // Ordem importa. Dizer "a base mudou" para quem também reescreveu o próprio texto manda a pessoa
  // olhar o lugar errado — primeiro se reaprova o que está na frente dos olhos.
  const r = stateOf(
    { id: 'A.1.1', fingerprint: 'NOVO', dependsOn: ['B.2.1'] },
    { digital_texto: 'aaa', depende: { 'B.2.1': 'era-assim' } },
    new Map([['B.2.1', 'MUDOU']]),
  );
  assert.equal(r.state, 'stale');
});

test('the tally for the whole documentation', () => {
  const trechos = new Map([
    trecho('A.1.1', 'aaa'),                     // validado, intacto  → verde
    trecho('A.1.2', 'NOVO'),                    // texto mudou        → amarelo
    trecho('A.1.3', 'ccc', ['A.1.4']),          // base mudou         → vermelho
    trecho('A.1.4', 'MUDOU'),                   // nunca validado     → branco
    trecho('A.1.5', 'eee'),                     // nunca validado     → branco
  ]);
  const registro = {
    'A.1.1': { digital_texto: 'aaa' },
    'A.1.2': { digital_texto: 'antigo' },
    'A.1.3': { digital_texto: 'ccc', depende: { 'A.1.4': 'era-assim' } },
  };
  const { tally, byBlock } = trafficLight(trechos, registro);
  assert.deepEqual(tally, { none: 2, valid: 1, stale: 1, broken: 1 });
  assert.equal(byBlock.get('A.1.3').state, 'broken');
});

test('what depends on a block — the question people ask before editing', () => {
  const trechos = new Map([
    trecho('A.1.1', 'aaa'),
    trecho('A.2.1', 'bbb', ['A.1.1']),
    trecho('A.3.1', 'ccc', ['A.1.1', 'A.2.1']),
    trecho('A.4.1', 'ddd'),
  ]);
  assert.deepEqual(dependentsOf('A.1.1', trechos).sort(), ['A.2.1', 'A.3.1']);
  assert.deepEqual(dependentsOf('A.4.1', trechos), []);
});
