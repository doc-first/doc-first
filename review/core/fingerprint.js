/**
 * A digital de um trecho: SHA-256 do texto visível, 16 caracteres.
 *
 * ESTA É A ÚNICA IMPLEMENTAÇÃO. Roda no navegador e no servidor, sem build.
 *
 * Por que isso importa mais do que parece: a digital decide se uma aprovação humana ainda vale. Até
 * 2026-09-18 ela existia TRÊS vezes — em `front/js/review.js`, `front/validacao.py` e
 * `review/pedidos.py` — e as três só concordavam por acaso: a do Python não removia a UI da revisão,
 * e bastaria alguém salvar um marcador no HTML para que toda aprovação virasse "versão anterior do
 * texto", em silêncio, sem ninguém saber por quê.
 *
 * Uma regra dessas não se mantém igual em três lugares por disciplina. Mantém-se por ser uma só.
 *
 * @module
 */

/** Quantos caracteres do hash entram na digital. Curto o bastante para caber numa tela, longo o
 *  bastante para não colidir por acaso num documento de algumas centenas de trechos. */
export const SIZE = 16;

/**
 * Normaliza o texto do jeito que a digital espera: espaços colapsados, pontas aparadas.
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

/**
 * Digital do texto já extraído.
 * @param {string} text  texto visível do trecho
 * @returns {Promise<string>} 16 caracteres hexadecimais
 */
export async function fingerprintOfText(text) {
  const bytes = new TextEncoder().encode(normalize(text));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, SIZE);
}

/**
 * Digital de um elemento do DOM. Só existe no navegador — o servidor usa `fingerprintOfText`.
 *
 * A UI da revisão (botões, painel) é marcada com `data-revisao-ui` e NÃO entra na conta: ela é
 * desenhada por cima do documento e mudaria a digital de todo trecho a cada versão do site.
 *
 * @param {Element} el
 * @returns {Promise<string>}
 */
export async function fingerprintOfElement(el) {
  return fingerprintOfText(textOfElement(el));
}

/**
 * O texto visível de um elemento, do jeito que a digital o vê.
 *
 * Usado também para a "foto" — o texto do trecho no instante em que alguém aprovou ou pediu
 * alteração. A foto tem de ser o MESMO texto que a digital considerou, senão o histórico mostra uma
 * coisa e a digital fala de outra.
 *
 * @param {Element} el
 * @returns {string}
 */
export function textOfElement(el) {
  const copy = /** @type {Element} */ (el.cloneNode(true));
  copy.querySelectorAll('[data-revisao-ui]').forEach((x) => x.remove());
  return copy.textContent || '';
}
