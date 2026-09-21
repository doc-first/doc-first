import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comoONucleoVe } from '../cli/validation.ts';
import { trafficLight, dependentsOf } from '../core/validity.js';

/**
 * The regression that pays for this whole file.
 *
 * `review/core/` speaks English (`fingerprint`, `dependsOn`); the CLI's own type speaks Portuguese
 * (`digital`, `depende`). They were bridged by `as never`, which type-checks and then hands the
 * core an object whose `fingerprint` is `undefined`.
 *
 * Nothing failed. `npm test` was green, `tsc` was green, the contract was green — and on a real
 * repository `semaforo` called all 17 approvals 🟡 while `conferir` called the same 17 intact.
 * The tool contradicted itself about the one thing it exists to say.
 */

/** A block shaped the way the CLI reads it off disk. */
const trecho = (id, digital, depende = []) => [id, {
  id, pagina: id.split('.')[0], arquivo: 'x.html', caminho: '/x.html',
  texto: 'whatever', digital, validado: null, depende,
  tipo: 'text', falta: [], cod: '1.1', numerado: true,
}];

test('a validated block whose text did not change is GREEN, not stale', () => {
  const trechos = new Map([trecho('A.1.1', 'abc123')]);
  const registro = { 'A.1.1': { digital_texto: 'abc123', data: '2026-09-16' } };

  const { tally } = trafficLight(comoONucleoVe(trechos), registro);

  assert.equal(tally.valid, 1, 'the approval still holds — this is the bug that hid behind `as never`');
  assert.equal(tally.stale, 0);
});

test('the adapter carries the fingerprint over, and does not leave it undefined', () => {
  const [[, bloco]] = comoONucleoVe(new Map([trecho('A.1.1', 'abc123')]));
  assert.equal(bloco.fingerprint, 'abc123');
  assert.notEqual(bloco.fingerprint, undefined);
});

test('the adapter carries the declared dependencies over', () => {
  // `se-eu-mexer` read `dependsOn` off an object that only had `depende`, so it always answered
  // "nothing depends on this" — the answer you get right before you break something.
  const trechos = new Map([
    trecho('A.1.1', 'aaa'),
    trecho('B.2.1', 'bbb', ['A.1.1']),
  ]);
  assert.deepEqual(dependentsOf('A.1.1', comoONucleoVe(trechos)), ['B.2.1']);
});

test('a text that really changed is still stale', () => {
  const trechos = new Map([trecho('A.1.1', 'NOVO')]);
  const registro = { 'A.1.1': { digital_texto: 'abc123' } };
  assert.equal(trafficLight(comoONucleoVe(trechos), registro).tally.stale, 1);
});
