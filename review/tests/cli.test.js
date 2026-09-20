/**
 * Testes da ferramenta do agente — do MOTOR, contra `examples/ola-mundo`.
 *
 * Eles rodavam contra as folhas do Arautos, e por isso só passavam dentro deste projeto: um teste
 * que exige `D01.0.titulo` não é teste de motor, é teste de conteúdo. O que prova o conteúdo do
 * Arautos mudou para `content.test.js`, que se ausenta sozinho onde não há conteúdo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerTrechos } from '../cli/pages.ts';
import { orfaos, carregar } from '../cli/validation.ts';

const RAIZ = new URL('../../', import.meta.url).pathname;
const EXEMPLO = join(RAIZ, 'examples', 'ola-mundo');

test('lê os trechos de um projeto qualquer, pelas pastas que ele declarar', async () => {
  const t = await lerTrechos(EXEMPLO);
  assert.equal(t.size, 8, 'o olá mundo tem 8 trechos');
  assert.ok(t.has('A01.1.1'));
  assert.equal(t.get('A01.1.1')?.pagina, 'A01', 'a página sai do código do trecho');
  assert.equal(t.get('A01.1.1')?.arquivo, 'A01.html', 'o nome curto respeita `recortar`');
  assert.equal(t.get('A02.1.2')?.numerado, true);
});

test('a digital ignora o que estiver marcado como interface da revisão', async () => {
  // É a regra mais fácil de esquecer ao montar uma página, e a que derruba todas as aprovações
  // dela de uma vez. Ver examples/ola-mundo/paginas/A01.html, trecho A01.1.4.
  const tmp = mkdtempSync(join(tmpdir(), 'docfirst-ui-'));
  try {
    mkdirSync(join(tmp, 'p'));
    writeFileSync(join(tmp, 'doc-first.json'),
      JSON.stringify({ owner: 'x@y.org', conteudo: { pastas: ['p'], registro: 'r.json' } }));
    const folha = join(tmp, 'p', 'X01.html');

    writeFileSync(folha, '<main><div data-id="X01.1.1" data-cod="1.1">texto</div></main>');
    const limpo = (await lerTrechos(tmp)).get('X01.1.1').digital;

    writeFileSync(folha, '<main><div data-id="X01.1.1" data-cod="1.1">texto' +
      '<button data-revisao-ui>1.1</button></div></main>');
    assert.equal((await lerTrechos(tmp)).get('X01.1.1').digital, limpo,
      'botão marcado NÃO pode entrar na digital');

    writeFileSync(folha, '<main><div data-id="X01.1.1" data-cod="1.1">texto' +
      '<button>1.1</button></div></main>');
    assert.notEqual((await lerTrechos(tmp)).get('X01.1.1').digital, limpo,
      'botão sem marca ENTRA na digital — é este o acidente que o contrato evita');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('conferir acusa aprovação forjada', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'docfirst-'));
  try {
    mkdirSync(join(tmp, 'front', 'telas'), { recursive: true });
    const folha = join(tmp, 'front', 'telas', 'X01.html');
    const reg = { 'A.1.1': { arquivo: 'telas/X01.html', data: '2026-09-16', digital_texto: 'x' } };

    writeFileSync(folha, '<main><div data-id="A.1.1" data-validado="2026-09-16">x</div></main>');
    assert.equal(await orfaos(tmp, reg, [folha]), 0, 'selo com registro e data certa passa');

    writeFileSync(folha, '<main><div data-id="A.9.9" data-validado="2026-09-18">x</div></main>');
    assert.equal(await orfaos(tmp, reg, [folha]), 1, 'selo SEM registro é pego');

    writeFileSync(folha, '<main><div data-id="A.1.1" data-validado="2026-09-18">x</div></main>');
    assert.equal(await orfaos(tmp, reg, [folha]), 1, 'data adulterada é pega');

    writeFileSync(folha, '<main><div data-validado="2026-09-18">x</div></main>');
    assert.equal(await orfaos(tmp, reg, [folha]), 1, 'marca sem data-id é pega');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

/**
 * A retomada não pode depender da nuvem. Estes dois casos nasceram de uma sessão real: o
 * `sincronizar` montava a Fonte sem projeto, a URL saía `projects//databases/…`, e a nuvem
 * devolvia um 400 que não dizia nada — com a sessão abrindo cega, sem placar.
 */
test('sincronizar segue com o registro local quando a nuvem falha', async () => {
  const { sincronizar } = await import('../cli/validation.ts');
  const fonteQueCai = { eventos: async () => { throw new Error('nuvem fora do ar'); } };
  const antes = Object.keys(carregar(RAIZ)).length;

  const r = await sincronizar(RAIZ, fonteQueCai, { dono: 'quem@exemplo.org' });

  assert.equal(r.offline, true, 'precisa dizer que leu um retrato parado');
  assert.equal(r.novos, 0);
  assert.equal(Object.keys(carregar(RAIZ)).length, antes, 'não pode mexer no registro');
});

test('a Fonte recusa a nuvem sem projeto, em vez de mandar URL inválida', async () => {
  const { Fonte } = await import('../cli/remote.ts');
  await assert.rejects(() => new Fonte({}).eventos(), /nuvem.projeto|REVISAO_PROJETO/);
});
