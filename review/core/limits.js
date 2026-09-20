/**
 * Tudo o que atravessa a fronteira tem tamanho e formato.
 *
 * Por que existe: havia limite em texto e foto, e NENHUM em caixa, digital e dados. Um POST com
 * 500 KB em cada campo foi aceito e depois devolvido a todo mundo, a cada navegação — numa coleção
 * que, por desenho, ninguém apaga.
 * @module
 */

export const LIMITS = {
  text: 4000, snapshot: 20000, block: 64, fingerprint: 64,
  dataKeys: 12, dataKey: 40, dataValue: 200,
};

// Deliberadamente frouxo: barra lixo, não impõe taxonomia. As páginas reais incluem D01, T03a, C02,
// UC-01, Fontes e DNN — um regex "letra + 2 dígitos" recusaria metade delas.
const PAGE_FORMAT = /^[A-Za-z][A-Za-z0-9-]{0,7}$/;
const ID_FORMAT = /^[A-Za-z0-9._:-]+$/;
const COMMIT_FORMAT = /^[0-9a-f]{7,40}$/;

const short = (v) => (String(v ?? '').length <= 20 ? String(v ?? '') : String(v).slice(0, 20) + '…');
const longerThan = (v, max) => String(v ?? '').length > max;

/**
 * O evento chega com os nomes do NÚCLEO (`page`, `block`), não com os que a API ainda usa. Quem
 * chama traduz antes — `review/core/legacy.js`. As MENSAGENS continuam em pt-BR: quem as lê é o
 * revisor, e ele é brasileiro.
 *
 * @param {{page?:string, text?:string|null, snapshot?:string|null, block?:string|null,
 *          fingerprint?:string|null, data?:Record<string,unknown>|null}} e
 * @returns {string|null} a mensagem do primeiro limite estourado, ou null
 */
export function overLimit(e, exemplos = '') {
  if (!PAGE_FORMAT.test(e.page ?? '')) {
    // Os exemplos vêm do projeto (`conteudo.exemplosDePagina`). Estavam fixos como "D01, T03a ou
    // UC-01" — a taxonomia do Arautos, dentro de uma mensagem do motor.
    const como = exemplos ? ` como ${exemplos}` : '';
    return `página inválida: esperado um código curto${como}, veio "${short(e.page)}"`;
  }
  if (longerThan(e.text, LIMITS.text)) return `o texto passa de ${LIMITS.text} caracteres`;
  if (longerThan(e.snapshot, LIMITS.snapshot)) return `a foto do trecho passa de ${LIMITS.snapshot} caracteres`;
  if (longerThan(e.block, LIMITS.block)) return `o código do trecho passa de ${LIMITS.block} caracteres`;
  if (longerThan(e.fingerprint, LIMITS.fingerprint)) return `a digital passa de ${LIMITS.fingerprint} caracteres`;
  if (e.block && !ID_FORMAT.test(e.block)) {
    return 'o código do trecho tem caractere que não é letra, número, ponto, dois-pontos, hífen ou sublinhado';
  }
  if (!e.data) return null;
  const keys = Object.keys(e.data);
  if (keys.length > LIMITS.dataKeys) return `dados tem mais de ${LIMITS.dataKeys} chaves`;
  for (const k of keys) {
    if (longerThan(k, LIMITS.dataKey)) return `a chave "${short(k)}" de dados passa de ${LIMITS.dataKey} caracteres`;
    // Escalar só. Um objeto ou lista aqui vira "[object Object]" — 15 caracteres — e ATRAVESSA o
    // limite de tamanho levando megabytes junto, que é exatamente o POST gigante que este módulo
    // existe para barrar. Nada no projeto grava outra coisa em `dados`.
    const v = e.data[k];
    if (v !== null && typeof v === 'object') return `o valor de "${short(k)}" precisa ser texto ou número`;
    if (longerThan(v, LIMITS.dataValue)) return `o valor de "${short(k)}" passa de ${LIMITS.dataValue} caracteres`;
  }
  return null;
}

/** `applied` sem commit de verdade grava um rastro oco — e o rastro é o ponto. */
export const validCommit = (data) => COMMIT_FORMAT.test(data?.commit ?? '');
