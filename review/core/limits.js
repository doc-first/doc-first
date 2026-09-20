/**
 * Everything crossing the boundary has a size and a shape.
 *
 * Why it exists: there were limits on text and snapshot, and NONE on block, fingerprint and data.
 * A POST with 500 KB in each field was accepted and then served back to everyone, on every page
 * load — into a collection that, by design, nobody can delete from.
 * @module
 */

export const LIMITS = {
  text: 4000, snapshot: 20000, block: 64, fingerprint: 64,
  dataKeys: 12, dataKey: 40, dataValue: 200,
};

// Deliberately loose: it stops junk, it does not impose a taxonomy. Real page codes look like
// D01, T03a, C02, UC-01 and DNN — a "letter + two digits" regex would reject half of them.
const PAGE_FORMAT = /^[A-Za-z][A-Za-z0-9-]{0,7}$/;
const ID_FORMAT = /^[A-Za-z0-9._:-]+$/;
const COMMIT_FORMAT = /^[0-9a-f]{7,40}$/;

const short = (v) => (String(v ?? '').length <= 20 ? String(v ?? '') : String(v).slice(0, 20) + '…');
const longerThan = (v, max) => String(v ?? '').length > max;

/**
 * The event arrives with the CORE's field names (`page`, `block`), not the ones the API still
 * uses. Callers translate first — see `review/core/legacy.js`. The MESSAGES are still in
 * Portuguese: they are read by whoever reviews, and translating them is waiting on the language
 * choice (i18n).
 *
 * @param {{page?:string, text?:string|null, snapshot?:string|null, block?:string|null,
 *          fingerprint?:string|null, data?:Record<string,unknown>|null}} e
 * @returns {string|null} a mensagem do primeiro limite estourado, ou null
 */
export function overLimit(e, exemplos = '') {
  if (!PAGE_FORMAT.test(e.page ?? '')) {
    // The examples come from the project (`conteudo.exemplosDePagina`). They used to be hard-coded
    // as "D01, T03a or UC-01" — one project's taxonomy, inside an engine message.
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
    // Scalars only. An object or array here becomes "[object Object]" — 15 characters — and slips
    // THROUGH the size limit carrying megabytes with it, which is exactly the giant POST this
    // module exists to stop. Nothing in the project writes anything else into `data`.
    const v = e.data[k];
    if (v !== null && typeof v === 'object') return `o valor de "${short(k)}" precisa ser texto ou número`;
    if (longerThan(v, LIMITS.dataValue)) return `o valor de "${short(k)}" passa de ${LIMITS.dataValue} caracteres`;
  }
  return null;
}

/** `applied` without a real commit records a hollow trail — and the trail is the whole point. */
export const validCommit = (data) => COMMIT_FORMAT.test(data?.commit ?? '');
