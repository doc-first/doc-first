/**
 * Tests for the agent's tool — for the ENGINE, against `examples/ola-mundo`.
 *
 * They used to run against the sheets of the project they came from, and so only passed inside it:
 * a test that demands a specific block code is not an engine test, it is a content test. The proof
 * of the content lives in the project that has content, and stays away where there is none.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerTrechos, arquivosDeFolhas } from '../cli/pages.ts';
import { orphanMarks, loadRegistry, missingProofs, upwardDependencies } from '../cli/validation.ts';

const RAIZ = new URL('../../', import.meta.url).pathname;
const EXEMPLO = join(RAIZ, 'examples', 'ola-mundo');

test('reads the blocks of any project, from the folders it declares', async () => {
  const t = await lerTrechos(EXEMPLO);
  assert.equal(t.size, 8, 'the hello world has 8 blocks');
  assert.ok(t.has('A01.1.1'));
  assert.equal(t.get('A01.1.1')?.pagina, 'A01', 'the page comes out of the block code');
  assert.equal(t.get('A01.1.1')?.arquivo, 'A01.html', 'the short name honours `recortar`');
  assert.equal(t.get('A02.1.2')?.numerado, true);
});

test('the fingerprint ignores whatever is marked as review interface', async () => {
  // It is the easiest rule to forget while building a page, and the one that drops every approval
  // on it at once. See examples/ola-mundo/paginas/A01.html, block A01.1.4.
  const tmp = mkdtempSync(join(tmpdir(), 'docfirst-ui-'));
  try {
    mkdirSync(join(tmp, 'p'));
    writeFileSync(join(tmp, 'doc-first.json'),
      JSON.stringify({ owner: 'x@y.org', conteudo: { pastas: ['p'], registro: 'r.json' } }));
    const folha = join(tmp, 'p', 'X01.html');

    writeFileSync(folha, '<main><div data-id="X01.1.1" data-cod="1.1">text</div></main>');
    const limpo = (await lerTrechos(tmp)).get('X01.1.1').digital;

    writeFileSync(folha, '<main><div data-id="X01.1.1" data-cod="1.1">text' +
      '<button data-revisao-ui>1.1</button></div></main>');
    assert.equal((await lerTrechos(tmp)).get('X01.1.1').digital, limpo,
      'a marked button must NOT enter the fingerprint');

    writeFileSync(folha, '<main><div data-id="X01.1.1" data-cod="1.1">text' +
      '<button>1.1</button></div></main>');
    assert.notEqual((await lerTrechos(tmp)).get('X01.1.1').digital, limpo,
      'an unmarked button DOES enter the fingerprint — this is the accident the contract prevents');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('conferir catches a forged approval', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'docfirst-'));
  try {
    mkdirSync(join(tmp, 'front', 'telas'), { recursive: true });
    const folha = join(tmp, 'front', 'telas', 'X01.html');
    const reg = { 'A.1.1': { arquivo: 'telas/X01.html', data: '2026-09-16', digital_texto: 'x' } };

    writeFileSync(folha, '<main><div data-id="A.1.1" data-validado="2026-09-16">x</div></main>');
    assert.equal(await orphanMarks(tmp, reg, [folha]), 0, 'a seal with a record and the right date passes');

    writeFileSync(folha, '<main><div data-id="A.9.9" data-validado="2026-09-18">x</div></main>');
    assert.equal(await orphanMarks(tmp, reg, [folha]), 1, 'a seal with NO record gets caught');

    writeFileSync(folha, '<main><div data-id="A.1.1" data-validado="2026-09-18">x</div></main>');
    assert.equal(await orphanMarks(tmp, reg, [folha]), 1, 'a tampered date gets caught');

    writeFileSync(folha, '<main><div data-validado="2026-09-18">x</div></main>');
    assert.equal(await orphanMarks(tmp, reg, [folha]), 1, 'a mark with no data-id gets caught');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

/**
 * The rule's proof is the only demand satisfied by something OUTSIDE the documentation, so it is
 * the only one that can stop being true without anybody touching the page. Deleting a test is the
 * ordinary way it happens, and the block goes on looking defended.
 */
test('check catches a data-prova whose file is gone', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'docfirst-prova-'));
  try {
    mkdirSync(join(tmp, 'p'));
    mkdirSync(join(tmp, 'tests'));
    writeFileSync(join(tmp, 'doc-first.json'),
      JSON.stringify({ owner: 'x@y.org', conteudo: { pastas: ['p'], registro: 'r.json' } }));
    const prova = join(tmp, 'tests', 'deadline.test.js');
    writeFileSync(prova, '// the test that defends the rule\n');

    const folha = join(tmp, 'p', 'X01.html');
    const rule = (caminho) => '<main><div data-id="X01.1.1" data-cod="1.1" data-tipo="rule"'
      + ` data-prova="${caminho}">an answer is owed within 24 hours</div></main>`;

    writeFileSync(folha, rule('tests/deadline.test.js::responds within 24h'));
    const comProva = await lerTrechos(tmp);
    assert.deepEqual(comProva.get('X01.1.1').falta, [], 'the kind is satisfied: the attribute is there');
    assert.equal(missingProofs(tmp, comProva), 0, 'a proof that is on disk is not accused');

    rmSync(prova);
    assert.equal(missingProofs(tmp, await lerTrechos(tmp)), 1,
      'delete the test and the rule stops being defended — that is the whole point of the check');

    // The `::` and everything after it are informative for now, so a path with no test name is
    // still a path that has to exist.
    writeFileSync(folha, rule('tests/nowhere.test.js'));
    assert.equal(missingProofs(tmp, await lerTrechos(tmp)), 1, 'no `::` does not mean no check');

    writeFileSync(folha, rule('::responds within 24h'));
    assert.equal(missingProofs(tmp, await lerTrechos(tmp)), 1, 'a test name with no file is not a proof');

    // Blocks that declare nothing are none of this check's business: a `rule` with no `data-prova`
    // is already reported by the kind, and any other kind never had a proof to lose.
    writeFileSync(folha, '<main><div data-id="X01.1.1" data-cod="1.1">plain text</div></main>');
    assert.equal(missingProofs(tmp, await lerTrechos(tmp)), 0, 'no data-prova, nothing to check');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

/**
 * The Fundamental is the bottom an agent reads down to when it implements. An edge pointing the
 * other way — a rule depending on a screen — means there is no bottom, and nothing else catches
 * it: the fingerprint and the traffic light both compute fine on either endpoint alone.
 */
test('check catches a Fundamental block depending on an Application one', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'docfirst-layers-'));
  try {
    mkdirSync(join(tmp, 'p'));
    writeFileSync(join(tmp, 'doc-first.json'),
      JSON.stringify({ owner: 'x@y.org', conteudo: { pastas: ['p'], registro: 'r.json' } }));
    const folha = join(tmp, 'p', 'X01.html');
    const block = (id, kind, dependsOn) => `<div data-id="${id}" data-cod="1.1" data-tipo="${kind}"`
      + (dependsOn ? ` data-depende="${dependsOn}"` : '') + `>text of ${id}</div>`;

    // Fundamental (rule) depending on Application (text): the violation this check exists for.
    writeFileSync(folha, '<main>'
      + block('F01.1.1', 'rule', 'A01.1.1')
      + block('A01.1.1', 'text')
      + '</main>');
    let blocks = await lerTrechos(tmp);
    assert.equal(upwardDependencies(blocks), 1,
      'a Fundamental block depending on an Application one is a defect');

    // Application (decision) depending on Fundamental (config): the allowed direction, silent.
    writeFileSync(folha, '<main>'
      + block('A01.1.1', 'decision', 'F01.1.1')
      + block('F01.1.1', 'config')
      + '</main>');
    blocks = await lerTrechos(tmp);
    assert.equal(upwardDependencies(blocks), 0,
      'the Application may depend on the Fundamental — that is the whole point of the layers');

    // Within the same layer, either direction, is fine.
    writeFileSync(folha, '<main>'
      + block('F01.1.1', 'contract', 'F02.1.1')
      + block('F02.1.1', 'model')
      + '</main>');
    blocks = await lerTrechos(tmp);
    assert.equal(upwardDependencies(blocks), 0, 'a within-layer edge is nobody\'s business here');

    // A dangling data-depende — the target does not exist at all — is missingProofs'/orphanMarks'
    // kind of defect elsewhere in the funnel, reported once, not accused twice here.
    writeFileSync(folha, '<main>'
      + block('F01.1.1', 'rule', 'GHOST.1.1')
      + '</main>');
    blocks = await lerTrechos(tmp);
    assert.equal(upwardDependencies(blocks), 0, 'a dangling target is not this function\'s business');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

/**
 * Picking the work back up cannot depend on the cloud. These two cases were born in a real session:
 * `sync` built the Source with no project, the URL came out as `projects//databases/…`, and
 * the cloud answered with a 400 that said nothing — with the session opening blind, no scoreboard.
 */
test('sync carries on with the local record when the cloud fails', async () => {
  const { sync } = await import('../cli/validation.ts');
  const sourceThatFails = { events: async () => { throw new Error('cloud is down'); } };
  const before = Object.keys(loadRegistry(RAIZ)).length;

  const r = await sync(RAIZ, sourceThatFails, { owner: 'who@example.org' });

  assert.equal(r.offline, true, 'it has to say it read a frozen snapshot');
  assert.equal(r.added, 0);
  assert.equal(Object.keys(loadRegistry(RAIZ)).length, before, 'it must not touch the record');
});

test('the Source refuses a cloud with no project, instead of sending an invalid URL', async () => {
  const { Source } = await import('../cli/remote.ts');
  await assert.rejects(() => new Source({}).events(), /nuvem.projeto|REVISAO_PROJETO/);
});

/**
 * Two blocks with the same `data-id` is the quietest bug a sheet can carry: the second overwrites
 * the first in the record, and a human approval starts standing for the wrong block. Nothing warns
 * — not the browser, not the server.
 *
 * It happened for real in the template: the sheet's lead and the first block of section 1 were both
 * born as `1.1`.
 */
test('a repeated block code on the same page gets caught', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'docfirst-dup-'));
  try {
    mkdirSync(join(tmp, 'p'));
    writeFileSync(join(tmp, 'doc-first.json'),
      JSON.stringify({ owner: 'x@y.org', conteudo: { pastas: ['p'], registro: 'r.json' } }));
    writeFileSync(join(tmp, 'p', 'X01.html'),
      '<main>' +
      '<div data-id="X01.1.1" data-cod="1.1">one</div>' +
      '<div data-id="X01.1.1" data-cod="1.1">another</div>' +
      '</main>');

    // lerTrechos returns a Map: the repeat disappears, and the count gives it away.
    const lidos = await lerTrechos(tmp);
    const noArquivo = (readFileSync(join(tmp, 'p', 'X01.html'), 'utf8').match(/data-id="/g) ?? []).length;
    assert.equal(noArquivo, 2, 'the file has two');
    assert.equal(lidos.size, 1, 'and the engine only sees one — this is the loss this test exists to show');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

/** The template is what every adopter copies. It cannot carry the defect just described. */
test('the template has no repeated block code', async () => {
  const gabarito = join(RAIZ, 'examples', 'gabarito');
  const trechos = await lerTrechos(gabarito);
  const noDisco = arquivosDeFolhas(gabarito)
    .flatMap((f) => readFileSync(f, 'utf8').match(/data-id="[^"]+"/g) ?? []);
  assert.equal(trechos.size, noDisco.length,
    `${noDisco.length} data-id on disk, ${trechos.size} read: there is a repeated code`);
  assert.ok(trechos.size >= 20, 'the template needs real content');
});
