import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { fingerprintOfText } from '../core/fingerprint.js';
import { lerTrechos, arquivosDeFolhas, acharArquivoDoTrecho, nomeCurto, type Trecho } from './pages.ts';
import { readConfig } from '../core/config.js';
import { trafficLight, dependentsOf, COLOURS } from '../core/validity.js';
import { Fonte } from './remote.ts';

/**
 * The validation lock: an approved block does not change without permission, and no approval mark
 * exists without a trail.
 *
 * The most critical piece of the method — it decides whether a human approval still holds.
 */

export interface Registro {
  [id: string]: { arquivo: string; data: string; digital_texto: string; digital?: string;
                  origem?: string; evento?: string; texto?: string; migrado_de?: string[];
                  /** The fingerprint EACH dependency had at the moment of the ✓. Without this there is
                   *  no way to tell later that the base moved — the block's own fingerprint stays silent. */
                  depende?: Record<string, string> };
}

/**
 * Where the approval registry lives. It comes from `doc-first.json` (`conteudo.registro`), not from
 * the code: `docs/validacoes.json` was a decision of the first project, written inside the engine.
 */
const caminhoRegistro = (raiz: string) =>
  join(raiz, ...readConfig(raiz, { readFile: (p: string) => readFileSync(p, 'utf8') }, process.env)
    .registry.split('/'));

export function carregar(raiz: string): Registro {
  const p = caminhoRegistro(raiz);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

export function salvar(raiz: string, reg: Registro) {
  const ordenado: Registro = {};
  for (const k of Object.keys(reg).sort()) ordenado[k] = reg[k];
  writeFileSync(caminhoRegistro(raiz), JSON.stringify(ordenado, null, 1) + '\n', 'utf8');
}

/**
 * Flags what changed after being validated, what is marked without a registry entry, and what
 * claims a proof that is no longer on disk.
 */
export async function conferir(raiz: string): Promise<number> {
  const reg = carregar(raiz);
  const trechos = await lerTrechos(raiz);
  let problemas = 0;

  for (const [id, info] of Object.entries(reg).sort()) {
    const t = trechos.get(id);
    if (!t) { console.log(`  ✗ ${id}: elemento sumiu (${info.arquivo})`); problemas++; continue; }
    if (!t.validado) { console.log(`  ✗ ${id}: perdeu a marca de validado`); problemas++; }
    if (t.digital !== info.digital_texto) {
      console.log(`  ✗ ${id}: o TEXTO mudou depois de validado em ${info.data} — precisa de permissão do dono`);
      problemas++;
    }
  }
  problemas += await orfaos(raiz, reg);
  problemas += missingProofs(raiz, trechos);
  console.log(`${Object.keys(reg).length} validados · ${problemas ? `${problemas} problema(s)` : 'tudo intacto'}`);
  return problemas;
}

/**
 * A `data-prova` pointing at a file that is not there.
 *
 * Why this is an issue and not a shrug: `data-prova` is the one attribute in the whole catalogue
 * that points OUTSIDE the documentation. Every other demand — an `alt`, a `<th>`, an owner, a
 * deadline — is satisfied by something the block carries, so the block alone can be trusted to
 * answer for it. This one names a file in the code, and files move, get renamed and get deleted by
 * people who never open the documentation. The attribute survives all three, and a rule whose
 * proof was deleted still LOOKS defended: the kind is `rule`, the demand is satisfied, the page
 * shows nothing amiss. A stale path silently proves nothing, and silence is exactly the failure
 * this engine exists to remove.
 *
 * The value is read as `path/to/file.test.js::name of the test`. Only the PATH is checked here.
 * The name after `::` is informative for now — confirming that a test by that name exists inside
 * the file means running or parsing a test runner, which is a different tool with a different
 * failure mode, and a check that half-works is worse than one that says what it covers.
 *
 * ⚠️ The path is relative to the CONTENT project root — the folder holding `doc-first.json` — not
 * to wherever the CLI was invoked from, and not to the page's own file. Anything else would make
 * the same attribute mean different things depending on which directory somebody was standing in.
 * A project whose tests live outside that root cannot be pointed at from here, and should say so
 * out loud rather than have this check quietly guess a second base directory.
 *
 * ⚠️ It does NOT answer the other half of the question — "the rule changed and its proof did not".
 * That one needs to compare two commits, and the git-diff layer does not exist yet. See
 * `docs/BUGS.md`, "The bridge to the code".
 */
export function missingProofs(raiz: string, trechos: Map<string, Trecho>): number {
  let achados = 0;
  for (const [id, t] of [...trechos].sort(([a], [b]) => a.localeCompare(b))) {
    if (t.prova === null) continue;
    const caminho = t.prova.split('::')[0].trim();
    if (!caminho) {
      console.log(`  ✗ ${id}: data-prova names no file — write it as `
        + `path/to/file.test.js::name of the test`);
      achados++;
      continue;
    }
    if (existsSync(join(raiz, ...caminho.split('/')))) continue;
    console.log(`  ✗ ${id}: data-prova points at ${caminho}, and there is no such file — `
      + `point it at the test that defends this rule, or the rule is not defended`);
    achados++;
  }
  return achados;
}

/**
 * A validated mark in the HTML with NO matching registry entry.
 *
 * Proved on 2026-09-18: without this sweep, a hand-written `data-validado` created an approval out of
 * nothing — and the site shows it, because the seal comes from the attribute. Approval with no trail,
 * in a method whose thesis is traceable approval.
 */
export async function orfaos(raiz: string, reg: Registro, arquivos?: string[]): Promise<number> {
  let achados = 0;
  for (const caminho of arquivos ?? arquivosDeFolhas(raiz)) {
    const { document } = parseHTML(readFileSync(caminho, 'utf8'));
    for (const el of document.querySelectorAll('[data-validado]')) {
      const id = el.getAttribute('data-id');
      const data = el.getAttribute('data-validado');
      if (!id) {
        console.log(`  ✗ ${caminho}: marca de validado num elemento SEM data-id`); achados++;
      } else if (!reg[id]) {
        console.log(`  ✗ ${id}: marcado como validado em ${data}, e NÃO existe registro — aprovação sem rastro`);
        achados++;
      } else if (reg[id].data !== data) {
        console.log(`  ✗ ${id}: a data no HTML (${data}) não bate com a do registro (${reg[id].data})`);
        achados++;
      }
    }
  }
  return achados;
}

/** Writes a block's lock: marks the HTML and records the fingerprint. */
export async function marcar(raiz: string, reg: Registro, id: string, quando: string,
                             origem: string, evento?: string,
                             digitaisAgora?: Map<string, string>): Promise<string | null> {
  const achado = acharArquivoDoTrecho(raiz, id);
  if (!achado) { console.log(`  ✗ ${id}: não encontrado`); return null; }

  const comMarca = achado.html.replace(
    new RegExp(`(data-id="${id.replace(/\./g, '\\.')}")(?! data-validado)`),
    `$1 data-validado="${quando}"`);
  if (comMarca !== achado.html) writeFileSync(achado.caminho, comMarca, 'utf8');

  const { document } = parseHTML(comMarca);
  const el = document.querySelector(`[data-id="${id}"]`)!;
  const copia = el.cloneNode(true) as Element;
  copia.querySelectorAll('[data-revisao-ui]').forEach((x: Element) => x.remove());
  const texto = copia.textContent ?? '';
  const digital = await fingerprintOfText(texto);

  // What this block depends on, and how each dependency looked RIGHT NOW. Keeping the snapshot of the
  // dependencies is what allows saying, months later, "the text is still the same but the base moved".
  // Without it the red light would have nothing to compare against.
  const declaradas = (el.getAttribute('data-depende') ?? '').split(/\s+/).filter(Boolean);
  const depende: Record<string, string> = {};
  for (const outro of declaradas) {
    const d = digitaisAgora?.get(outro);
    if (d) depende[outro] = d;
    else console.log(`  ⚠ ${id} declara depender de ${outro}, que não existe`);
  }

  // The browser needs two snapshots to paint the traffic light without asking the server:
  //   data-digital-validada  the text that was approved  → without it there is no 🟡
  //   data-dependia-de       the ground at that moment   → without it there is no 🔴
  // The JSON is the truth; these attributes are the copy that travels with the page.
  const atributos: Record<string, string> = { 'data-digital-validada': digital };
  if (Object.keys(depende).length) {
    atributos['data-dependia-de'] = JSON.stringify(depende).replace(/"/g, '&quot;');
  }
  let html = readFileSync(achado.caminho, 'utf8');
  for (const [attr, valor] of Object.entries(atributos)) {
    const alvo = new RegExp(`(data-id="${id.replace(/\./g, '\\.')}")((?:(?!${attr})[^>])*?)>`);
    html = html.replace(alvo, `$1$2 ${attr}="${valor}">`);
  }
  writeFileSync(achado.caminho, html, 'utf8');

  const antigo = reg[id];
  reg[id] = {
    arquivo: nomeCurto(raiz, achado.caminho),
    data: quando, digital_texto: digital, origem,
    texto: texto.replace(/\s+/g, ' ').trim().slice(0, 120),
    ...(Object.keys(depende).length ? { depende } : {}),
    ...(evento ? { evento } : {}),
    ...(antigo?.migrado_de ? { migrado_de: antigo.migrado_de } : {}),
    ...(antigo?.digital ? { digital: antigo.digital } : {}),
  };
  return digital;
}

/** Brings into the repository the ✓ the owner gave on the site. Only his: a reviewer's approval does not lock. */
export async function sincronizar(raiz: string, fonte: Fonte, opcoes: { dono?: string } = {}) {
  const dono = (opcoes.dono ?? process.env.REVISAO_OWNER ?? '').toLowerCase();
  if (!dono) throw new Error('defina REVISAO_OWNER: é o ✓ dele que vira trava.');

  // The cloud being down must not take the whole session down with it. The registry in the repository
  // is the source of what is already validated; the cloud only adds what came from the site. Without
  // it the local score still holds — what must NOT happen is the session going on unaware it read a
  // frozen snapshot.
  let eventos: Awaited<ReturnType<typeof fonte.eventos>>;
  try {
    eventos = await fonte.eventos();
  } catch (e) {
    const reg = carregar(raiz);
    console.log(`⚠ não consegui falar com a nuvem, então nenhum ✓ novo do site entrou:\n  ${(e as Error).message}`);
    console.log(`  Seguindo com o registro do repositório: ${Object.keys(reg).length} validados (retrato parado).`);
    return { novos: 0, iguais: 0, vencidas: 0, offline: true };
  }
  const aprovacoes = eventos.filter((e) => e.tipo === 'aprovacao');
  const doDono = aprovacoes.filter((e) => (e.autor ?? '').toLowerCase() === dono);
  if (aprovacoes.length !== doDono.length) {
    console.log(`  · ${aprovacoes.length - doDono.length} aprovação(ões) de outra pessoa ignorada(s): só o ✓ do dono trava`);
  }

  const reg = carregar(raiz);
  const trechos = await lerTrechos(raiz);
  const digitaisAgora = new Map([...trechos].map(([id, t]) => [id, t.digital]));
  let novos = 0, iguais = 0, vencidas = 0;

  for (const e of doDono.sort((a, b) => a.quando.localeCompare(b.quando))) {
    const id = e.caixa;
    if (!id) continue;
    const quando = (e.quando || '').slice(0, 10);
    const t = trechos.get(id);
    if (!t) { console.log(`  ✗ ${id}: aprovado no site, não existe no repositório`); continue; }
    if (e.digital !== t.digital) {
      console.log(`  ⚠ ${id}: o ✓ de ${quando} é de uma versão anterior do texto — não vale mais`);
      vencidas++; continue;
    }
    if (reg[id]?.digital_texto === t.digital) { iguais++; continue; }
    if (await marcar(raiz, reg, id, quando, 'site', e.id, digitaisAgora)) {
      console.log(`  ✓ ${id} validado por você no site em ${quando}`);
      novos++;
    }
  }
  salvar(raiz, reg);
  console.log(`${novos} novo(s) · ${iguais} já estavam · ${vencidas} ✓ vencido(s) · ${Object.keys(reg).length} validados no total`);
  return { novos, iguais, vencidas, offline: false };
}

/**
 * The documentation traffic light: where each block stands, and what needs a human eye.
 *
 * This is the command that answers "can I trust this documentation today?". `conferir` answers a
 * smaller and older question — whether someone tampered with a mark. This one answers today's question.
 */
/**
 * A `Trecho` as the traffic light sees it.
 *
 * ⚠️ This function exists because of a bug that hid for days behind `as never`. `review/core/`
 * speaks English — `fingerprint`, `dependsOn` — and the CLI's own type speaks Portuguese —
 * `digital`, `depende`. Passing one where the other was expected type-checks ONLY because the cast
 * erases the mismatch, and then `block.fingerprint` is `undefined` at run time.
 *
 * What it cost: `semaforo` reported EVERY validated block as 🟡 forever, because `undefined` never
 * equals a recorded fingerprint — while `conferir`, which reads the right field, said "17 ·
 * everything intact" on the same repository. Two commands of the same tool, one lock, opposite
 * answers. And `se-eu-mexer` always replied "nothing depends on this", which is worse: it is the
 * answer you get right before you break something.
 *
 * The lesson is not "be careful with casts". It is that the translation between the two vocabularies
 * has to live in ONE named place that a test can point at — which is this one.
 */
export function comoONucleoVe(trechos: Map<string, Trecho>) {
  return new Map([...trechos].map(([id, t]) =>
    [id, { id, fingerprint: t.digital, dependsOn: t.depende }]));
}

export async function mostrarSemaforo(raiz: string, opcoes: { so?: string } = {}) {
  const trechos = await lerTrechos(raiz);
  const reg = carregar(raiz);
  const { byBlock, tally } = trafficLight(comoONucleoVe(trechos), reg as never);

  const total = trechos.size;
  const linha = (e: 'valid' | 'stale' | 'broken' | 'none', nome: string) =>
    `  ${COLOURS[e]} ${String(tally[e]).padStart(4)}  ${nome}`;

  console.log(`\nDocumentação: ${total} trecho(s)\n`);
  console.log(linha('valid',  'validados, e nada mudou desde então'));
  console.log(linha('stale',  'o texto mudou depois do ✓ — reaprovar'));
  console.log(linha('broken', 'o texto está igual, mas a base mudou — CONFERIR'));
  console.log(linha('none',   'ninguém validou ainda'));

  // Red comes first, and named: it is the only state nobody spots on their own by reading the page,
  // because nothing on the page changed.
  const vermelhos = [...byBlock].filter(([, r]) => r.state === 'broken');
  if (vermelhos.length) {
    console.log(`\n🔴 Precisam de conferência — mudou o chão, não o texto:\n`);
    for (const [id, r] of vermelhos) {
      console.log(`  ${id}`);
      console.log(`     depende de: ${r.blame.join(', ')} — e isso mudou desde o ✓`);
    }
  }

  const amarelos = [...byBlock].filter(([, r]) => r.state === 'stale');
  if (amarelos.length && opcoes.so !== 'vermelho') {
    console.log(`\n🟡 Reaprovar (o texto mudou):\n  ${amarelos.map(([id]) => id).join('  ')}`);
  }

  if (!vermelhos.length && !amarelos.length) {
    console.log(`\n✓ nada pendente de conferência.`);
  }
  console.log('');
  return tally;
}

/**
 * Writes into the HTML what the approvals registry already knows.
 *
 * Why this has to exist: the registry (`digital_texto`) is the truth, but the BROWSER cannot read
 * it — the page is static and the panel has no server to ask. It paints the traffic light from
 * three attributes that travel with the page, and `marcar()` only writes them at the moment an
 * approval arrives. Any approval recorded before those attributes existed has `data-validado` and
 * nothing else.
 *
 * ⚠️ What that costs is exactly the thing this project is about: `review/web/src/estado.js` says it
 * in one line — without `data-digital-validada`, a rewritten block STAYS GREEN in the browser. The
 * seal shows, and the page never warns that the text drifted. Documentation that lies about being
 * checked is worse than documentation nobody checked.
 *
 * ⚠️ It writes the fingerprint FROM THE REGISTRY, never the one computed from the text on disk now.
 * Recomputing would be a silent re-approval: a block whose text changed after the ✓ would be
 * stamped with its new text and turn green, and the drift this exists to reveal would be erased by
 * the very command meant to reveal it. So a block that drifted gets stamped with the OLD
 * fingerprint and correctly shows 🟡.
 */
export async function restamp(raiz: string) {
  const reg = carregar(raiz);
  const trechos = await lerTrechos(raiz);
  let escritos = 0, jaTinham = 0, semTrecho = 0;
  const vaoFicarAmarelos: string[] = [];

  for (const [id, r] of Object.entries(reg)) {
    const gravada = (r as { digital_texto?: string }).digital_texto;
    if (!gravada) continue;
    const achado = acharArquivoDoTrecho(raiz, id);
    if (!achado) { semTrecho++; continue; }

    const atual = trechos.get(id)?.digital;
    if (atual && atual !== gravada) vaoFicarAmarelos.push(id);

    const escapado = id.replace(/\./g, '\\.');
    if (new RegExp(`data-id="${escapado}"[^>]*data-digital-validada`).test(achado.html)) {
      jaTinham++; continue;
    }

    const atributos: Record<string, string> = { 'data-digital-validada': gravada };
    const dependia = (r as { depende?: Record<string, string> }).depende;
    if (dependia && Object.keys(dependia).length) {
      atributos['data-dependia-de'] = JSON.stringify(dependia).replace(/"/g, '&quot;');
    }

    let html = readFileSync(achado.caminho, 'utf8');
    for (const [attr, valor] of Object.entries(atributos)) {
      html = html.replace(new RegExp(`(data-id="${escapado}")((?:(?!${attr})[^>])*?)>`),
                          `$1$2 ${attr}="${valor}">`);
    }
    writeFileSync(achado.caminho, html, 'utf8');
    escritos++;
  }

  console.log(`\n${escritos} trecho(s) receberam a marca que faltava · ${jaTinham} já tinham`);
  if (semTrecho) console.log(`⚠ ${semTrecho} do registro não existem mais nas folhas`);
  if (vaoFicarAmarelos.length) {
    console.log(`\n🟡 ${vaoFicarAmarelos.length} vão aparecer AMARELOS no site, e é o certo —`);
    console.log(`   o texto mudou depois do ✓:\n   ${vaoFicarAmarelos.join('  ')}`);
  }
  console.log('');
  return escritos;
}

/** What else do I have to look at if I touch this? The question to ask BEFORE editing. */
export async function seEuMexer(raiz: string, id: string) {
  const trechos = await lerTrechos(raiz);
  if (!trechos.has(id)) { console.log(`✗ não achei o trecho ${id}`); return 1; }

  const dependentes = dependentsOf(id, comoONucleoVe(trechos));
  const reg = carregar(raiz);

  console.log(`\nSe você mexer em ${id}:\n`);
  if (!dependentes.length) {
    console.log('  nada declara depender deste trecho.');
    console.log('  (o que não quer dizer que nada dependa — só que ninguém declarou)\n');
    return 0;
  }
  console.log(`  ${dependentes.length} trecho(s) vão ficar 🔴 e precisar de conferência:\n`);
  for (const d of dependentes) {
    const validado = reg[d] ? `✓ validado em ${reg[d].data}` : 'nunca validado';
    console.log(`  ${d.padEnd(14)} ${validado}`);
  }
  console.log('');
  return 0;
}

// ---------------------------------------------------------------- the index in the database

/**
 * Rebuilds the documentation index in the database: which blocks exist, of what kind, what they depend
 * on, and what is missing in each one.
 *
 * ⚠️ The database does not become the truth. The truth stays in the file, versioned — the file is what
 * has diff and authorship. This is a snapshot, and it exists for the questions a file answers badly:
 * "every diagram in the project", "every decision without an owner", "what breaks if I touch this".
 */
export async function indexar(raiz: string, caminhoDoBanco?: string) {
  const { Index } = await import('../api/index-store.ts');
  const { currentCommit } = await import('../core/git.js');
  const banco = caminhoDoBanco ?? process.env.REVISAO_SQLITE ?? join(raiz, 'dados', 'events.db');
  const trechos = await lerTrechos(raiz);

  // Which commit the content was sitting on, so that a later run can ask git which files changed
  // instead of reparsing all of them. ⚠️ null when the content is not in a git repository — a
  // plain folder is a legitimate way to use this tool — and that is not an error: the index is
  // merely less useful, and indexing proceeds exactly the same.
  const commit = currentCommit(raiz);

  const idx = new Index(banco);
  try {
    const quantos = idx.rebuild([...trechos.values()].map((t) => ({
      id: t.id, page: t.pagina, kind: t.tipo, file: t.arquivo, code: t.cod || null,
      numbered: t.numerado, fingerprint: t.digital, text: t.texto.slice(0, 400),
      dependsOn: t.depende, missing: t.falta,
    })), commit);

    console.log(`\nIndexados ${quantos} trecho(s) em ${banco}\n`);
    for (const { kind, count } of idx.byKind()) {
      console.log(`  ${String(count).padStart(4)}  ${kind}`);
    }

    // The summary of where the dependencies landed, and not the list of them: the funnel is judged
    // by how little reaches a person, and that is a number you can read in one glance and compare
    // with the last run. ⚠️ Matrix only — no "before" text exists at index time, so these are the
    // levels the kinds alone produce; see the note in `rebuild`.
    const levels = idx.bySeverity();
    const pairs = levels.reduce((sum, l) => sum + l.count, 0);
    if (pairs) {
      console.log(`\n${pairs} dependency pair(s), by severity (kinds only, no edit signals):`);
      for (const { severity, count } of levels) {
        console.log(`  ${String(count).padStart(4)}  ${severity}`);
      }
      const needsAPerson = idx.needsAPerson();
      for (const p of needsAPerson.slice(0, 10)) {
        console.log(`    person: ${p.block} (${p.kind}) → ${p.dependsOn} (${p.dependsOnKind ?? '?'})`);
      }
      if (needsAPerson.length > 10) console.log(`    … and ${needsAPerson.length - 10} more`);
    }

    const quebradas = idx.brokenDependencies();
    if (quebradas.length) {
      console.log(`\n✗ ${quebradas.length} dependência(s) apontam para trecho que não existe:`);
      for (const q of quebradas) console.log(`    ${q.block} → ${q.dependsOn}`);
    }

    const faltas = idx.issues();
    if (faltas.length) {
      console.log(`\n⚠ ${faltas.length} pendência(s) de tipo:\n`);
      for (const f of faltas.slice(0, 20)) console.log(`  ${f.id.padEnd(14)} ${f.missing}`);
      if (faltas.length > 20) console.log(`  … e mais ${faltas.length - 20}`);
    } else {
      console.log('\n✓ nenhuma pendência de tipo.');
    }
    console.log('');
    return {
      quantos, commit, faltas: faltas.length, quebradas: quebradas.length,
      severities: Object.fromEntries(levels.map((l) => [l.severity, l.count])),
    };
  } finally {
    idx.close();
  }
}

/** The catalogue of kinds, for whoever is writing and wants to know what exists. */
export async function tipos() {
  const { catalogue } = await import('../core/kinds.js');
  console.log('\nTipos de conteúdo — todo trecho validável é de um destes:\n');
  for (const t of catalogue()) {
    console.log(`  ${t.id.padEnd(11)} ${t.name}${t.numbered ? '' : '   (sem número na página)'}`);
    console.log(`  ${''.padEnd(11)} ${t.description.replace(/\s+/g, ' ')}\n`);
  }
}
