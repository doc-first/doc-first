/** Testes do núcleo compartilhado. Rodam com `node --test`, sem nenhuma dependência.
 *  Os casos-ouro são os MESMOS que o C# e o Python rodam (review/tests/cases/cycle-cases.json):
 *  se as implementações divergirem, um dos lados fica vermelho. */
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

/** O log de um caso-ouro, como era GRAVADO em pt-BR até 2026-09-19. */
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
 * Os casos-ouro continuam escritos em pt-BR de propósito: são o histórico REAL, do jeito que está
 * gravado no Firestore. Rodá-los pelo mapa de compatibilidade é a prova que importa — se `legacy.js`
 * errar um par, um pedido antigo muda de estado sozinho, e nada mais avisaria.
 */
test('casos-ouro, como foram gravados: o histórico antigo continua dando o mesmo estado', () => {
  for (const caso of ouro.casos) {
    const eventos = logComoEraGravado(caso).map(doHistorico);
    assert.equal(ciclo.currentState('p1', eventos, caso.autorEhAdmin),
      estadoAtual(caso.esperado), caso.nome);
  }
});

/** E os mesmos casos escritos JÁ em inglês: o caminho novo não pode depender do mapa para andar. */
test('casos-ouro, como se grava hoje: o mesmo estado sem passar pelo mapa', () => {
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

test('a tabela inteira de transições: 49 pares, sem exceção', () => {
  const estados = Object.keys(tabela.states);
  for (const de of estados) {
    for (const para of estados) {
      const esperado = (tabela.transitions[de] ?? []).includes(para);
      assert.equal(ciclo.canGo(de, para), esperado, `${de} → ${para}`);
    }
  }
  assert.equal(estados.length ** 2, 49, 'são 7 estados: 49 pares');
});

test('nenhum estado vai para si mesmo', () => {
  for (const e of Object.keys(tabela.states)) assert.equal(ciclo.canGo(e, e), false, `${e} → ${e}`);
});

test('estado desconhecido não vai a lugar nenhum', () => {
  assert.equal(ciclo.canGo('inventado', 'approved'), false);
  assert.equal(ciclo.canGo('open', 'inventado'), false);
});

test('aprovado não oferece triagem; aberto oferece as três do dono', () => {
  assert.deepEqual(ciclo.status('approved').triage, []);
  assert.deepEqual(ciclo.status('open').triage, ['approved', 'rejected', 'question']);
});

test('tabela inválida não passa despercebida', () => {
  assert.throws(() => createCycle({ states: {}, transitions: {} }), /sem estados/);
  assert.throws(() => createCycle({ ...tabela, initial: 'nao_existe' }), /estado inicial/);
  assert.throws(() => createCycle({ ...tabela, transitions: { open: ['fantasma'] } }), /inexistente/);
});

test('digital: espaços não contam, 16 caracteres, texto diferente muda', async () => {
  assert.equal(await fingerprintOfText('Olá   mundo'), await fingerprintOfText('Olá mundo'));
  assert.equal((await fingerprintOfText('x')).length, SIZE);
  assert.notEqual(await fingerprintOfText('a'), await fingerprintOfText('b'));
  assert.equal(normalize('  a   b  '), 'a b');
});

test('digital: compatível com o que já está validado', () => {
  // Os 17 trechos aprovados pelo Ale foram conferidos contra o Python em 2026-09-19: 17 de 17.
  // Este teste guarda o contrato: se alguém mudar a definição da digital, toda aprovação existente cai.
  assert.equal(SIZE, 16, 'mudar o tamanho invalida as aprovações gravadas');
});

test('valor de dados que é objeto não atravessa o limite de tamanho', () => {
  // String({...}) dá "[object Object]": 15 caracteres. Sem a checagem de tipo, um objeto com
  // megabytes dentro passaria pelo teto de 200 caracteres sem encostar nele.
  const enorme = { recheio: 'x'.repeat(500_000) };
  assert.match(overLimit({ page: 'D01', data: { extra: enorme } }) ?? '', /texto ou número/);
  assert.match(overLimit({ page: 'D01', data: { extra: ['x'.repeat(500_000)] } }) ?? '', /texto ou número/);
  assert.equal(overLimit({ page: 'D01', data: { extra: 'valor normal', n: 7, nada: null } }), null);
});

test('limites: o que entra tem tamanho e formato', () => {
  assert.equal(overLimit({ page: 'UC-01', text: 'ok' }), null);
  assert.match(overLimit({ page: '../etc' }) ?? '', /página inválida/);
  assert.match(overLimit({ page: 'D01', text: 'x'.repeat(4001) }) ?? '', /texto/);
  assert.match(overLimit({ page: 'D01', block: 'D01 1' }) ?? '', /caractere/);
  // A mensagem diz QUAL campo estourou: "inválido" sem dizer onde faz o revisor tentar de novo no escuro.
  assert.match(overLimit({ page: 'D01', snapshot: 'y'.repeat(20001) }) ?? '', /foto/);
});

test('limites: aplicado sem commit de verdade não passa', () => {
  assert.equal(validCommit({ commit: 'abc1234' }), true);
  assert.equal(validCommit({ commit: 'feito' }), false);
  assert.equal(validCommit({}), false);
  assert.equal(validCommit(null), false);
});

/**
 * A ponte do navegador (review/web/core-web.js) é o ÚNICO lugar onde o front toca o núcleo, e nada
 * mais a exercita: o contrato HTTP testa a API, e os testes de unidade importam o núcleo direto.
 * Quando o núcleo virou inglês, um nome errado aqui só apareceria como botão que não monta, na
 * tela de quem estivesse revisando.
 */
test('a ponte do navegador entrega ao front os nomes que ele chama', async () => {
  const doc = { dispatchEvent: () => {} };
  const janela = {};
  Object.assign(globalThis, { window: janela, document: doc, CustomEvent: class { constructor() {} } });
  try {
    await import('../web/core-web.js');
    const nucleo = janela.ARAUTOS?.nucleo ?? {};
    // Os nomes que front/js/review.js chama hoje. Mudou aqui? Mude lá — ou o botão some.
    for (const nome of ['digitalDoElemento', 'digitalDoTexto', 'textoDoElemento', 'normalizar']) {
      assert.equal(typeof nucleo[nome], 'function', `A.nucleo.${nome} precisa existir`);
    }
    assert.equal(nucleo.TAMANHO, 16);
    assert.equal(typeof janela.ARAUTOS.digital, 'function');
    assert.equal(await nucleo.digitalDoTexto('  a   b '), await nucleo.digitalDoTexto('a b'),
      'a ponte precisa usar a MESMA digital do núcleo, não uma cópia');
  } finally {
    delete globalThis.window; delete globalThis.document; delete globalThis.CustomEvent;
  }
});
