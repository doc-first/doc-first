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

/** Flags what changed after being validated, and what is marked without a registry entry. */
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
  console.log(`${Object.keys(reg).length} validados · ${problemas ? `${problemas} problema(s)` : 'tudo intacto'}`);
  return problemas;
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
export async function mostrarSemaforo(raiz: string, opcoes: { so?: string } = {}) {
  const trechos = await lerTrechos(raiz);
  const reg = carregar(raiz);
  const { byBlock, tally } = trafficLight(trechos as never, reg as never);

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

/** What else do I have to look at if I touch this? The question to ask BEFORE editing. */
export async function seEuMexer(raiz: string, id: string) {
  const trechos = await lerTrechos(raiz);
  if (!trechos.has(id)) { console.log(`✗ não achei o trecho ${id}`); return 1; }

  const dependentes = dependentsOf(id, trechos as never);
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
  const banco = caminhoDoBanco ?? process.env.REVISAO_SQLITE ?? join(raiz, 'dados', 'events.db');
  const trechos = await lerTrechos(raiz);

  const idx = new Index(banco);
  try {
    const quantos = idx.rebuild([...trechos.values()].map((t) => ({
      id: t.id, page: t.pagina, kind: t.tipo, file: t.arquivo, code: t.cod || null,
      numbered: t.numerado, fingerprint: t.digital, text: t.texto.slice(0, 400),
      dependsOn: t.depende, missing: t.falta,
    })));

    console.log(`\nIndexados ${quantos} trecho(s) em ${banco}\n`);
    for (const { kind, count } of idx.byKind()) {
      console.log(`  ${String(count).padStart(4)}  ${kind}`);
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
    return { quantos, faltas: faltas.length, quebradas: quebradas.length };
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
