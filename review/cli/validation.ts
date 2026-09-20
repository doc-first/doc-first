import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { fingerprintOfText } from '../core/fingerprint.js';
import { lerTrechos, arquivosDeFolhas, acharArquivoDoTrecho, nomeCurto, type Trecho } from './pages.ts';
import { readConfig } from '../core/config.js';
import { trafficLight, dependentsOf, COLOURS } from '../core/validity.js';
import { Fonte } from './remote.ts';

/**
 * A trava de validação: um trecho aprovado não muda sem permissão, e não existe marca de aprovação
 * sem rastro.
 *
 * É a peça mais crítica do método — decide se uma aprovação humana ainda vale.
 */

export interface Registro {
  [id: string]: { arquivo: string; data: string; digital_texto: string; digital?: string;
                  origem?: string; evento?: string; texto?: string; migrado_de?: string[];
                  /** A digital que CADA dependência tinha no momento do ✓. Sem isto não há como
                   *  saber depois que a base mudou — a digital do próprio trecho não denuncia. */
                  depende?: Record<string, string> };
}

/**
 * Onde o registro de aprovações mora. Vem do `doc-first.json` (`conteudo.registro`), não do código:
 * `docs/validacoes.json` era uma decisão do projeto de origem, escrita dentro do motor.
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

/** Acusa o que mudou depois de validado, e o que está marcado sem registro. */
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
 * Marca de validado no HTML que NÃO tem registro correspondente.
 *
 * Provado em 2026-09-18: sem esta varredura, um `data-validado` escrito à mão criava uma aprovação do
 * nada — e o site a exibe, porque o selo vem do atributo. Aprovação sem rastro, num método cuja tese
 * é aprovação rastreável.
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

/** Grava a trava de um trecho: marca o HTML e registra a digital. */
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

  // De que este trecho depende, e como cada dependência estava AGORA. Guardar a foto das
  // dependências é o que permite, meses depois, dizer "o texto continua igual mas a base mudou".
  // Sem isto o vermelho do semáforo não teria com o que comparar.
  const declaradas = (el.getAttribute('data-depende') ?? '').split(/\s+/).filter(Boolean);
  const depende: Record<string, string> = {};
  for (const outro of declaradas) {
    const d = digitaisAgora?.get(outro);
    if (d) depende[outro] = d;
    else console.log(`  ⚠ ${id} declara depender de ${outro}, que não existe`);
  }

  // O navegador precisa de duas fotos para pintar o semáforo sem consultar o servidor:
  //   data-digital-validada  o texto que foi aprovado  → sem ela não há 🟡
  //   data-dependia-de       o chão naquele momento    → sem ela não há 🔴
  // O JSON é a verdade; estes atributos são a cópia que viaja com a página.
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

/** Traz para o repositório os ✓ que o dono deu no site. Só os dele: aprovação de revisor não trava. */
export async function sincronizar(raiz: string, fonte: Fonte, opcoes: { dono?: string } = {}) {
  const dono = (opcoes.dono ?? process.env.REVISAO_OWNER ?? '').toLowerCase();
  if (!dono) throw new Error('defina REVISAO_OWNER: é o ✓ dele que vira trava.');

  // A nuvem fora do ar não pode derrubar a retomada. O registro no repositório é a fonte do que já
  // está validado; a nuvem só acrescenta o que veio do site. Sem ela, o placar local ainda vale —
  // e o que NÃO pode acontecer é a sessão seguir sem saber que leu um retrato parado.
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
 * O semáforo da documentação: onde cada trecho está, e o que precisa de olho humano.
 *
 * É o comando que responde "posso confiar nesta documentação hoje?". `conferir` responde uma
 * pergunta menor e mais antiga — se alguém adulterou uma marca. Este responde a pergunta do dia.
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

  // O vermelho vem primeiro e com nome: é o único estado que ninguém descobre sozinho lendo a
  // página, porque nada nela mudou.
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

/** O que mais preciso olhar se eu mexer aqui? A pergunta que se faz ANTES de editar. */
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

// ---------------------------------------------------------------- o índice no banco

/**
 * Refaz o índice da documentação no banco: quais trechos existem, de que tipo, de quem dependem,
 * e o que falta em cada um.
 *
 * ⚠️ O banco não vira a verdade. A verdade continua no arquivo, versionado — é ele que tem diff e
 * autoria. Isto aqui é um retrato, e existe para as perguntas que arquivo responde mal:
 * "todos os diagramas do projeto", "toda decisão sem dono", "o que quebra se eu mexer aqui".
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

/** O catálogo de tipos, para quem está escrevendo e quer saber o que existe. */
export async function tipos() {
  const { catalogue } = await import('../core/kinds.js');
  console.log('\nTipos de conteúdo — todo trecho validável é de um destes:\n');
  for (const t of catalogue()) {
    console.log(`  ${t.id.padEnd(11)} ${t.name}${t.numbered ? '' : '   (sem número na página)'}`);
    console.log(`  ${''.padEnd(11)} ${t.description.replace(/\s+/g, ' ')}\n`);
  }
}
