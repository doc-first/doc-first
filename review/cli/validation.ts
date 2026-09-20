import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { fingerprintOfText } from '../core/fingerprint.js';
import { lerTrechos, arquivosDeFolhas, acharArquivoDoTrecho, nomeCurto, type Trecho } from './pages.ts';
import { readConfig } from '../core/config.js';
import { Fonte } from './remote.ts';

/**
 * A trava de validação: um trecho aprovado não muda sem permissão, e não existe marca de aprovação
 * sem rastro.
 *
 * É a peça mais crítica do método — decide se uma aprovação humana ainda vale.
 */

export interface Registro {
  [id: string]: { arquivo: string; data: string; digital_texto: string; digital?: string;
                  origem?: string; evento?: string; texto?: string; migrado_de?: string[] };
}

/**
 * Onde o registro de aprovações mora. Vem do `doc-first.json` (`conteudo.registro`), não do código:
 * `docs/validacoes.json` era uma decisão do Arautos escrita dentro do motor.
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
                             origem: string, evento?: string): Promise<string | null> {
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

  const antigo = reg[id];
  reg[id] = {
    arquivo: nomeCurto(raiz, achado.caminho),
    data: quando, digital_texto: digital, origem,
    texto: texto.replace(/\s+/g, ' ').trim().slice(0, 120),
    ...(evento ? { evento } : {}),
    ...(antigo?.migrado_de ? { migrado_de: antigo.migrado_de } : {}),
    ...(antigo?.digital ? { digital: antigo.digital } : {}),
  };
  return digital;
}

/** Traz para o repositório os ✓ que o dono deu no site. Só os dele: aprovação de revisor não trava. */
export async function sincronizar(raiz: string, fonte: Fonte, opcoes: { dono?: string } = {}) {
  const dono = (opcoes.dono ?? process.env.ARAUTOS_DONO ?? process.env.REVISAO_OWNER ?? '').toLowerCase();
  if (!dono) throw new Error('defina REVISAO_OWNER (ou ARAUTOS_DONO): é o ✓ dele que vira trava.');

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
    if (await marcar(raiz, reg, id, quando, 'site', e.id)) {
      console.log(`  ✓ ${id} validado por você no site em ${quando}`);
      novos++;
    }
  }
  salvar(raiz, reg);
  console.log(`${novos} novo(s) · ${iguais} já estavam · ${vencidas} ✓ vencido(s) · ${Object.keys(reg).length} validados no total`);
  return { novos, iguais, vencidas, offline: false };
}
