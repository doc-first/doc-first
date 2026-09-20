/**
 * Os tipos de conteúdo. Duas coisas se provam aqui: que a dedução acerta em documentação que já
 * existe (senão o método começaria cobrando reescrita), e que cada tipo cobra o que é dele.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, whatIsMissing, KINDS, catalogue } from '../core/kinds.js';

const t = (o) => ({ attributes: {}, classes: [], tag: 'div', html: '', text: '', ...o });

test('tipo declarado manda', () => {
  assert.equal(kindOf(t({ attributes: { 'data-tipo': 'diagram' }, html: '<p>x</p>' })), 'diagram');
});

test('tipo inventado cai no padrão em vez de quebrar', () => {
  // Errar o nome do tipo não pode derrubar a página de quem escreve. O lint acusa; a página abre.
  assert.equal(kindOf(t({ attributes: { 'data-tipo': 'inventado' } })), 'text');
});

test('dedução: documentação que já existe ganha tipo sem ser reescrita', () => {
  assert.equal(kindOf(t({ attributes: { 'data-cod': '0.titulo' } })), 'title');
  assert.equal(kindOf(t({ attributes: { 'data-cod': '1.sub' } })), 'subtitle');
  assert.equal(kindOf(t({ classes: ['lead-secao'] })), 'subtitle');
  assert.equal(kindOf(t({ html: '<pre><code class="mermaid">flowchart</code></pre>' })), 'diagram');
  assert.equal(kindOf(t({ html: '<table><tr><th>a</th></tr></table>' })), 'table');
  assert.equal(kindOf(t({ html: '<img src="x.png" alt="y">' })), 'image');
  assert.equal(kindOf(t({ html: '<ul><li>a</li><li>b</li></ul>' })), 'list');
  assert.equal(kindOf(t({ classes: ['caixa--info'] })), 'box');
  assert.equal(kindOf(t({ html: '<p>um parágrafo comum</p>' })), 'text');
});

test('imagem sem alt é acusada — é a única parte dela que entra na trava', () => {
  // O texto DENTRO de uma imagem não entra na digital: trocar a figura não muda a digital do
  // trecho. Por isso o alt não é acessibilidade só; é o que torna a imagem revisável.
  assert.deepEqual(whatIsMissing('image', t({ html: '<img src="a.png">' })).length, 1);
  assert.deepEqual(whatIsMissing('image', t({ html: '<img src="a.png" alt="o fluxo de entrada">' })), []);
});

test('diagrama como imagem é recusado', () => {
  assert.match(whatIsMissing('diagram', t({ html: '<img src="fluxo.png" alt="fluxo">' }))[0], /Mermaid/);
  assert.deepEqual(whatIsMissing('diagram', t({ html: '<pre><code>flowchart TD</code></pre>' })), []);
});

test('tabela sem cabeçalho é acusada', () => {
  assert.equal(whatIsMissing('table', t({ html: '<table><tr><td>a</td></tr></table>' })).length, 1);
  assert.deepEqual(whatIsMissing('table', t({ html: '<table><tr><th>a</th></tr></table>' })), []);
});

test('decisão sem dono e sem prazo não é pendência, é decisão perdida', () => {
  assert.equal(whatIsMissing('decision', t({})).length, 2);
  assert.deepEqual(whatIsMissing('decision', t({ attributes: { 'data-dono': 'ana', 'data-prazo': '2026-10-01' } })), []);
});

test('paleta sem valor de cor é acusada', () => {
  assert.equal(whatIsMissing('colors', t({ text: 'azul primário e cinza' })).length, 1);
  assert.deepEqual(whatIsMissing('colors', t({ text: 'azul #0883C5' })), []);
});

test('lista de um item só é parágrafo mal vestido', () => {
  assert.equal(whatIsMissing('list', t({ html: '<ul><li>só um</li></ul>' })).length, 1);
  assert.deepEqual(whatIsMissing('list', t({ html: '<ul><li>um</li><li>dois</li></ul>' })), []);
});

test('título longo demais é parágrafo disfarçado', () => {
  assert.equal(whatIsMissing('title', t({ text: 'x'.repeat(81) })).length, 1);
  assert.deepEqual(whatIsMissing('title', t({ text: 'Quem usa, e para quem' })), []);
});

test('todo tipo do catálogo tem nome e descrição — é o que a pessoa lê para escolher', () => {
  for (const [id, kind] of Object.entries(KINDS)) {
    assert.ok(kind.name, `${id} sem nome`);
    assert.ok(kind.description.length > 40, `${id} com descrição curta demais para ajudar alguém`);
    assert.equal(typeof kind.numbered, 'boolean', `${id} precisa dizer se mostra número`);
  }
  assert.ok(catalogue().length >= 12, 'o catálogo precisa cobrir o que a documentação tem');
});
