import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from '../core/config.js';
import { parseHTML } from 'linkedom';
import { fingerprintOfText } from '../core/fingerprint.js';
import { tipoDe, oQueFalta } from '../core/kinds.js';

/**
 * Leitura das folhas do repositório: quais trechos existem, o texto de cada um e a digital.
 *
 * ⚠️ O texto tem de sair EXATAMENTE como o navegador o vê, senão a digital diverge e toda aprovação
 * cai em silêncio. O `linkedom` foi conferido contra os trechos já validados no primeiro projeto (calculados
 * antes com lxml e com o DOM real): 17 de 17 batem. Trocar de parser exige refazer essa conferência.
 */

export interface Trecho {
  id: string; pagina: string; arquivo: string; caminho: string;
  texto: string; digital: string; validado: string | null;
  /** De que outros trechos este depende (`data-depende="D01.1.4 D02.3.1"`). É o que permite dizer
   *  "o texto não mudou, mas a base mudou" — o vermelho do semáforo. */
  depende: string[];
  /** O tipo do conteúdo: title, box, diagram, decision… (review/core/kinds.js). */
  tipo: string;
  /** O que este tipo cobra e o trecho não tem. Vazio quer dizer pronto para aprovação. */
  falta: string[];
  cod: string;
  /** Título e subtítulo de seção não mostram número, mas TÊM trava: entram no registro e precisam
   *  ser conferidos. Filtrá-los aqui fazia o `conferir` dizer "elemento sumiu" para os três que o
   *  o dono já validou. */
  numerado: boolean;
}

/** O que o projeto diz sobre onde o conteúdo mora. Lido do doc-first.json da raiz. */
function doProjeto(raiz: string) {
  return readConfig(raiz, { readFile: (p: string) => readFileSync(p, 'utf8') }, process.env);
}

/**
 * As pastas de folhas vêm do `doc-first.json` (`conteudo.pastas`), não do código.
 * Estavam escritas aqui, e era o acoplamento mais duro entre o motor e o projeto de origem: quem
 * adotasse o método teria de nomear as pastas exatamente como este projeto as nomeia.
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
    } catch { /* pasta que não existe neste projeto */ }
  }
  return saida;
}

/** Todos os trechos numerados das folhas, com digital calculada. */
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
      const contexto = { texto: texto.replace(/\s+/g, ' ').trim(), html: el.innerHTML ?? '', atributos };
      const tipo = tipoDe({
        atributos, classes: (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean),
        tag: (el.tagName ?? 'div').toLowerCase(), html: contexto.html,
      });

      mapa.set(id, {
        id, pagina: id.split('.')[0], caminho, cod,
        tipo, falta: oQueFalta(tipo, contexto),
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

/** Um trecho específico, sem varrer tudo (usado ao marcar validação). */
export function acharArquivoDoTrecho(raiz: string, id: string): { caminho: string; html: string } | null {
  for (const caminho of arquivosDeFolhas(raiz)) {
    const html = readFileSync(caminho, 'utf8');
    if (html.includes(`data-id="${id}"`)) return { caminho, html };
  }
  return null;
}

/**
 * O nome do arquivo como ele aparece no registro de validações.
 *
 * Era `caminho.slice(caminho.indexOf('front'))` — procurava a string "front" no caminho absoluto.
 * Num projeto sem pasta `front/`, `indexOf` devolve -1 e o slice corta pelo fim, devolvendo lixo.
 * Agora é o caminho relativo à raiz, sem o prefixo que o projeto pedir para recortar.
 */
export function nomeCurto(raiz: string, caminho: string): string {
  const rel = caminho.startsWith(raiz) ? caminho.slice(raiz.length).replace(/^[/\\]/, '') : caminho;
  const corte = doProjeto(raiz).trimPrefix;
  return corte && rel.startsWith(corte) ? rel.slice(corte.length) : rel;
}

export function gravar(caminho: string, conteudo: string) {
  writeFileSync(caminho, conteudo, 'utf8');
}
