/**
 * O semáforo. O caso que mais importa é o VERMELHO: o texto do trecho não mudou, e mesmo assim a
 * validação dele deixou de ser confiável porque a base mudou. Nenhuma digital deste trecho
 * denuncia isso — é preciso guardar o que as dependências eram no momento do ✓.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoDoTrecho, semaforo, quemDependeDe } from '../core/validity.js';

const trecho = (id, digital, depende = []) => [id, { id, digital, depende }];

test('branco: ninguém validou ainda', () => {
  const r = estadoDoTrecho({ id: 'A.1.1', digital: 'aaa' }, undefined, new Map());
  assert.equal(r.estado, 'none');
});

test('verde: validado e nada mudou', () => {
  const r = estadoDoTrecho({ id: 'A.1.1', digital: 'aaa' }, { digital_texto: 'aaa' }, new Map());
  assert.equal(r.estado, 'valid');
});

test('amarelo: o texto do próprio trecho mudou depois do ✓', () => {
  const r = estadoDoTrecho({ id: 'A.1.1', digital: 'NOVO' }, { digital_texto: 'aaa' }, new Map());
  assert.equal(r.estado, 'stale');
  assert.match(r.porque, /ninguém aprovou o texto novo/);
});

test('VERMELHO: o texto está igual, mas a base mudou', () => {
  // Este é o caso que justifica o módulo existir. A digital do trecho bate — ele está idêntico ao
  // que foi aprovado. O que mudou foi a regra em que ele se apoia.
  const agora = new Map([['B.2.1', 'MUDOU']]);
  const r = estadoDoTrecho(
    { id: 'A.1.1', digital: 'aaa', depende: ['B.2.1'] },
    { digital_texto: 'aaa', depende: { 'B.2.1': 'era-assim' } },
    agora,
  );
  assert.equal(r.estado, 'broken');
  assert.deepEqual(r.culpados, ['B.2.1']);
});

test('vermelho também quando a dependência SOME', () => {
  // Apontar para um trecho que não existe mais é tão quebrado quanto apontar para um que mudou —
  // e é mais fácil de acontecer, porque apagar não deixa rastro no texto de quem dependia.
  const r = estadoDoTrecho(
    { id: 'A.1.1', digital: 'aaa', depende: ['SUMIU.1.1'] },
    { digital_texto: 'aaa', depende: { 'SUMIU.1.1': 'existia' } },
    new Map(),
  );
  assert.equal(r.estado, 'broken');
  assert.deepEqual(r.culpados, ['SUMIU.1.1']);
});

test('amarelo vence vermelho: se o próprio texto mudou, é esse o problema a resolver', () => {
  // Ordem importa. Dizer "a base mudou" para quem também reescreveu o próprio texto manda a pessoa
  // olhar o lugar errado — primeiro se reaprova o que está na frente dos olhos.
  const r = estadoDoTrecho(
    { id: 'A.1.1', digital: 'NOVO', depende: ['B.2.1'] },
    { digital_texto: 'aaa', depende: { 'B.2.1': 'era-assim' } },
    new Map([['B.2.1', 'MUDOU']]),
  );
  assert.equal(r.estado, 'stale');
});

test('o placar da documentação inteira', () => {
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
  const { placar, porTrecho } = semaforo(trechos, registro);
  assert.deepEqual(placar, { none: 2, valid: 1, stale: 1, broken: 1 });
  assert.equal(porTrecho.get('A.1.3').estado, 'broken');
});

test('quem depende de um trecho — a pergunta que a pessoa faz antes de mexer', () => {
  const trechos = new Map([
    trecho('A.1.1', 'aaa'),
    trecho('A.2.1', 'bbb', ['A.1.1']),
    trecho('A.3.1', 'ccc', ['A.1.1', 'A.2.1']),
    trecho('A.4.1', 'ddd'),
  ]);
  assert.deepEqual(quemDependeDe('A.1.1', trechos).sort(), ['A.2.1', 'A.3.1']);
  assert.deepEqual(quemDependeDe('A.4.1', trechos), []);
});
