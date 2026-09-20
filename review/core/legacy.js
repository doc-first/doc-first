/**
 * What was written before `2026-09-19`, read by today's code.
 *
 * The code became entirely English, and that includes the values that travel stored: the event
 * type, the request state, the field names. But **history is not rewritten** — that was a design
 * decision, and it is the right one: the log is append-only by construction (SQLite refuses UPDATE
 * and DELETE through triggers), and a dated human approval is evidence, not data.
 *
 * So translation happens **on read**, here, in one direction only. The core never sees Portuguese.
 *
 * ⚠️ **Today it translates more than history.** The API and the front end still speak Portuguese
 * (`tipo`, `dados`, `pedido`), because the rename started with the core. So EVERY event entering
 * the core passes through here, not just the old ones. When `review/api/` and the front are
 * translated, this file goes back to being only what its name says — and whatever is left in it is
 * the measure of what is still pending.
 *
 * ⚠️ Beyond that, it only grows by accident: if you are about to add a pair because new code wrote
 * in Portuguese, the defect is in the new code — fix it there.
 * @module
 */

/** Event field: `pagina` → `page`. */
const CAMPOS = {
  pagina: 'page', caixa: 'block', digital: 'fingerprint', texto: 'text',
  foto: 'snapshot', autor: 'author', quando: 'when', dados: 'data', tipo: 'type',
};

/** Event type: `aprovacao` → `approval`. */
const TIPOS = {
  aprovacao: 'approval', pedido: 'request', comentario: 'comment',
  resposta_decisao: 'decision_reply', pedido_estado: 'request_state', complemento: 'supplement',
};

/** Cycle state: `aberto` → `open`. */
const ESTADOS = {
  aberto: 'open', aprovado: 'approved', recusado: 'rejected', pergunta: 'question',
  analise: 'applying', aguardando: 'waiting', aplicado: 'applied',
};

/** Request category: `duvida` → `doubt`. */
const CATEGORIAS = { texto: 'text', termo: 'term', remover: 'remove', duvida: 'doubt' };

/** Key inside `dados`: `pedido` → `request`. */
const DADOS = {
  pedido: 'request', estado: 'state', de: 'from', motivo: 'reason',
  categoria: 'category', relacionado: 'related', mensagem: 'message',
};

/** @param {Record<string,string>} mapa */
const traduz = (mapa) => (v) => (typeof v === 'string' && mapa[v] ? mapa[v] : v);

export const estadoAtual = traduz(ESTADOS);
export const tipoAtual = traduz(TIPOS);
export const categoriaAtual = traduz(CATEGORIAS);

/**
 * An event as today's code expects to read it, whenever it came from.
 *
 * It renames only what it recognises: an unknown field passes through untouched, because an event
 * this map does not understand is still a fact — losing the field would be worse than carrying it
 * in Portuguese.
 *
 * @param {Record<string, any>} evento
 * @returns {import('./cycle.js').Event}
 */
export function doHistorico(evento) {
  if (!evento || typeof evento !== 'object') return evento;

  /** @type {Record<string, any>} */
  const saida = {};
  for (const [k, v] of Object.entries(evento)) saida[CAMPOS[k] ?? k] = v;

  if (typeof saida.type === 'string') saida.type = tipoAtual(saida.type);

  if (saida.data && typeof saida.data === 'object') {
    /** @type {Record<string, any>} */
    const dados = {};
    for (const [k, v] of Object.entries(saida.data)) dados[DADOS[k] ?? k] = v;
    // `state` and `from` carry a state name; `category` carries a category name.
    if (dados.state) dados.state = estadoAtual(dados.state);
    if (dados.from) dados.from = estadoAtual(dados.from);
    if (dados.category) dados.category = categoriaAtual(dados.category);
    saida.data = dados;
  }
  return saida;
}

// ---------------------------------------------------------------- the way back, and why it exists

/** Inverts a map. Done once, at load: seven pairs, and inverting by hand is cheap to get wrong. */
const inverso = (mapa) => Object.fromEntries(Object.entries(mapa).map(([a, b]) => [b, a]));

const ESTADOS_PT = inverso(ESTADOS);

/**
 * ⚠️ **SCAFFOLDING, with an expiry date.** The core already speaks English; the HTTP API and the
 * front end do not. Meanwhile the edge translates the response back to Portuguese, so the published
 * contract does not change mid-migration.
 *
 * This is not design — it is the mark of a migration in progress. It **dies** when the front end
 * reads `state` instead of `estado`. If you are reading this long after that, the debt stayed.
 *
 * @param {{ state: string, ownedBy: string, canGoTo: string[], triage: string[],
 *           requiresReason: string[], acceptsSupplement: boolean }} status
 */
export function paraOContrato(status) {
  const pt = (s) => ESTADOS_PT[s] ?? s;
  return {
    estado: pt(status.state),
    deQuem: status.ownedBy === 'owner' ? 'dono' : 'agente',
    podeIr: status.canGoTo.map(pt),
    triagem: status.triage.map(pt),
    exigeMotivo: status.requiresReason.map(pt),
    aceitaComplemento: status.acceptsSupplement,
  };
}

/** A state's Portuguese name — for the CLI and the contract. Dies together with `paraOContrato`. */
export const estadoEmPortugues = (s) => ESTADOS_PT[s] ?? s;
