import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from '../core/config.js';
import { parseHTML } from 'linkedom';
import { fingerprintOfText } from '../core/fingerprint.js';
import { kindOf, whatIsMissing } from '../core/kinds.js';

/**
 * Reading a repository's pages: which blocks exist, the text of each one, and the fingerprint.
 *
 * ⚠️ The text has to come out EXACTLY as the browser sees it, or the fingerprint diverges and every
 * approval falls silently. The parser in use was checked against the blocks already validated in
 * the first project — computed beforehand with a different parser and with a real DOM — and all of
 * them matched. Swapping parsers means redoing that check.
 */

export interface Trecho {
  id: string; pagina: string; arquivo: string; caminho: string;
  texto: string; digital: string; validado: string | null;
  /** Which other blocks this one depends on (`data-depende="D01.1.4 D02.3.1"`). It is what allows
   *  saying "the text did not change, but the ground did" — the red of the traffic light. */
  depende: string[];
  /** The content kind: title, box, diagram, decision… (review/core/kinds.js). */
  tipo: string;
  /** The test that defends a `rule`, written as `path/to/file.test.js::name of the test`
   *  (`data-prova`). `null` when the block declares none — which, for a `rule`, the kind already
   *  reports through `falta`. It is read out here because the attribute is a POINTER: unlike every
   *  other demand, satisfying it is not something the block alone can prove. */
  prova: string | null;
  /** What this kind demands and the block does not have. Empty means ready for approval. */
  falta: string[];
  cod: string;
  /** Section headings and subheadings show no number, but they ARE locked: they enter the record
   *  and have to be checked. Filtering them out here made `conferir` report "element vanished" for
   *  the ones the owner had already validated. */
  numerado: boolean;
}

/** What the project says about where its content lives. Read from doc-first.json at the root. */
function doProjeto(raiz: string) {
  return readConfig(raiz, { readFile: (p: string) => readFileSync(p, 'utf8') }, process.env);
}

/**
 * The page folders come from `doc-first.json` (`conteudo.pastas`), not from the code.
 *
 * They used to be written here, and it was the hardest coupling between the engine and the project
 * it grew in: anyone adopting the method would have had to name their folders exactly as that one
 * named its own.
 */
export function pastasDeFolhas(raiz: string): string[] {
  return doProjeto(raiz).sheetFolders.map((p: string) => join(raiz, ...p.split('/')));
}

export function arquivosDeFolhas(raiz: string): string[] {
  const saida: string[] = [];
  for (const pasta of pastasDeFolhas(raiz)) {
    try {
      for (const nome of readdirSync(pasta).sort()) {
        if (nome.endsWith('.html') && !nome.startsWith('_')) saida.push(join(pasta, nome));
      }
    } catch { /* folder that does not exist in this project */ }
  }
  return saida;
}

/** Every block in the pages, with its fingerprint computed. */
export async function lerTrechos(raiz: string): Promise<Map<string, Trecho>> {
  const mapa = new Map<string, Trecho>();
  for (const caminho of arquivosDeFolhas(raiz)) {
    const { document } = parseHTML(readFileSync(caminho, 'utf8'));
    for (const el of document.querySelectorAll('main [data-id]')) {
      const cod = el.getAttribute('data-cod') ?? '';
      const id = el.getAttribute('data-id')!;
      const copia = el.cloneNode(true) as Element;
      copia.querySelectorAll('[data-revisao-ui]').forEach((x: Element) => x.remove());
      const texto = copia.textContent ?? '';
      const atributos: Record<string, string> = {};
      for (const a of Array.from(el.attributes ?? [])) atributos[(a as Attr).name] = (a as Attr).value;
      const contexto = {
        text: texto.replace(/\s+/g, ' ').trim(), html: el.innerHTML ?? '', attributes: atributos,
      };
      const tipo = kindOf({
        attributes: atributos, classes: (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean),
        tag: (el.tagName ?? 'div').toLowerCase(), html: contexto.html,
      });

      mapa.set(id, {
        id, pagina: id.split('.')[0], caminho, cod,
        tipo, falta: whatIsMissing(tipo, contexto),
        prova: el.getAttribute('data-prova'),
        arquivo: nomeCurto(raiz, caminho),
        texto: texto.replace(/\s+/g, ' ').trim(),
        digital: await fingerprintOfText(texto),
        validado: el.getAttribute('data-validado'),
        depende: (el.getAttribute('data-depende') ?? '').split(/\s+/).filter(Boolean),
        numerado: /^\d+\.\d/.test(cod),
      });
    }
  }
  return mapa;
}

/** One specific block, without scanning everything (used when marking a validation). */
export function acharArquivoDoTrecho(raiz: string, id: string): { caminho: string; html: string } | null {
  for (const caminho of arquivosDeFolhas(raiz)) {
    const html = readFileSync(caminho, 'utf8');
    if (html.includes(`data-id="${id}"`)) return { caminho, html };
  }
  return null;
}

/**
 * The file name as it appears in the approvals record.
 *
 * It used to search for a hard-coded folder name inside the absolute path. In a project without
 * that folder, the search returns -1 and the slice cuts from the end, returning garbage. Now it is
 * the path relative to the root, minus whatever prefix the project asks to trim.
 */
export function nomeCurto(raiz: string, caminho: string): string {
  const rel = caminho.startsWith(raiz) ? caminho.slice(raiz.length).replace(/^[/\\]/, '') : caminho;
  const corte = doProjeto(raiz).trimPrefix;
  return corte && rel.startsWith(corte) ? rel.slice(corte.length) : rel;
}

export function gravar(caminho: string, conteudo: string) {
  writeFileSync(caminho, conteudo, 'utf8');
}
