/**
 * Os tipos de conteúdo. Duas coisas se provam aqui: que a dedução acerta em documentação que já
 * existe (senão o método começaria cobrando reescrita), e que cada tipo cobra o que é dele.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tipoDe, oQueFalta, TIPOS, catalogo } from '../core/kinds.js';

const t = (o) => ({ atributos: {}, classes: [], tag: 'div', html: '', texto: '', ...o });

test('tipo declarado manda', () => {
  assert.equal(tipoDe(t({ atributos: { 'data-tipo': 'diagram' }, html: '<p>x</p>' })), 'diagram');
});

test('tipo inventado cai no padrão em vez de quebrar', () => {
  // Errar o nome do tipo não pode derrubar a página de quem escreve. O lint acusa; a página abre.
  assert.equal(tipoDe(t({ atributos: { 'data-tipo': 'inventado' } })), 'text');
});

test('dedução: documentação que já existe ganha tipo sem ser reescrita', () => {
  assert.equal(tipoDe(t({ atributos: { 'data-cod': '0.titulo' } })), 'title');
  assert.equal(tipoDe(t({ atributos: { 'data-cod': '1.sub' } })), 'subtitle');
  assert.equal(tipoDe(t({ classes: ['lead-secao'] })), 'subtitle');
  assert.equal(tipoDe(t({ html: '<pre><code class="mermaid">flowchart</code></pre>' })), 'diagram');
  assert.equal(tipoDe(t({ html: '<table><tr><th>a</th></tr></table>' })), 'table');
  assert.equal(tipoDe(t({ html: '<img src="x.png" alt="y">' })), 'image');
  assert.equal(tipoDe(t({ html: '<ul><li>a</li><li>b</li></ul>' })), 'list');
  assert.equal(tipoDe(t({ classes: ['caixa--info'] })), 'box');
  assert.equal(tipoDe(t({ html: '<p>um parágrafo comum</p>' })), 'text');
});

test('imagem sem alt é acusada — é a única parte dela que entra na trava', () => {
  // O texto DENTRO de uma imagem não entra na digital: trocar a figura não muda a digital do
  // trecho. Por isso o alt não é acessibilidade só; é o que torna a imagem revisável.
  assert.deepEqual(oQueFalta('image', t({ html: '<img src="a.png">' })).length, 1);
  assert.deepEqual(oQueFalta('image', t({ html: '<img src="a.png" alt="o fluxo de entrada">' })), []);
});

test('diagrama como imagem é recusado', () => {
  assert.match(oQueFalta('diagram', t({ html: '<img src="fluxo.png" alt="fluxo">' }))[0], /Mermaid/);
  assert.deepEqual(oQueFalta('diagram', t({ html: '<pre><code>flowchart TD</code></pre>' })), []);
});

test('tabela sem cabeçalho é acusada', () => {
  assert.equal(oQueFalta('table', t({ html: '<table><tr><td>a</td></tr></table>' })).length, 1);
  assert.deepEqual(oQueFalta('table', t({ html: '<table><tr><th>a</th></tr></table>' })), []);
});

test('decisão sem dono e sem prazo não é pendência, é decisão perdida', () => {
  assert.equal(oQueFalta('decision', t({})).length, 2);
  assert.deepEqual(oQueFalta('decision', t({ atributos: { 'data-dono': 'ana', 'data-prazo': '2026-10-01' } })), []);
});

test('paleta sem valor de cor é acusada', () => {
  assert.equal(oQueFalta('colors', t({ texto: 'azul primário e cinza' })).length, 1);
  assert.deepEqual(oQueFalta('colors', t({ texto: 'azul #0883C5' })), []);
});

test('lista de um item só é parágrafo mal vestido', () => {
  assert.equal(oQueFalta('list', t({ html: '<ul><li>só um</li></ul>' })).length, 1);
  assert.deepEqual(oQueFalta('list', t({ html: '<ul><li>um</li><li>dois</li></ul>' })), []);
});

test('título longo demais é parágrafo disfarçado', () => {
  assert.equal(oQueFalta('title', t({ texto: 'x'.repeat(81) })).length, 1);
  assert.deepEqual(oQueFalta('title', t({ texto: 'Quem usa, e para quem' })), []);
});

test('todo tipo do catálogo tem nome e descrição — é o que a pessoa lê para escolher', () => {
  for (const [id, tipo] of Object.entries(TIPOS)) {
    assert.ok(tipo.nome, `${id} sem nome`);
    assert.ok(tipo.descricao.length > 40, `${id} com descrição curta demais para ajudar alguém`);
    assert.equal(typeof tipo.numerado, 'boolean', `${id} precisa dizer se mostra número`);
  }
  assert.ok(catalogo().length >= 12, 'o catálogo precisa cobrir o que a documentação tem');
});
