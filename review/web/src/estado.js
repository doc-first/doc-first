/**
 * A block's state, derived from the events. No cycle rule lives here: the server sends `situacao`
 * ready on every request, and the panel obeys.
 *
 * That was true of the classic panel and stays true, on purpose. When the front end computed state,
 * it and the server disagreed — the same request showed as "Approved" in one place and "Awaiting"
 * in the other.
 */

/**
 * A block's traffic light, from the browser's point of view.
 *
 * 🔴 does not come from the events: it comes from comparing what the block declares it depends on
 * against how those dependencies look RIGHT NOW on the page. That is why it is computed here and
 * not sent by the server — only the browser has the rendered text of every block at once.
 *
 * @param {{validado: string|null, depende: string[], dependiaDe?: Record<string,string>}} trecho
 * @param {Map<string,string>} digitaisAgora  id → current fingerprint of every block on the page
 */
export function semaforoDo(trecho, situacao, digitaisAgora) {
  if (!situacao.aprovado && !trecho.validado) return { cor: 'none', culpados: [] };

  // 🟡 from the repository: the fingerprint recorded at the ✓ does not match the text on screen.
  // Without this attribute a rewritten block would stay green in the browser — `data-validado`
  // alone only says THAT it was validated, not WHICH text was.
  if (trecho.digitalValidada && trecho.digitalValidada !== trecho.digital) {
    return { cor: 'stale', culpados: [] };
  }
  if (situacao.vencidas.length && !situacao.aprovado) return { cor: 'stale', culpados: [] };

  const dependiaDe = trecho.dependiaDe ?? {};
  const mudaram = Object.entries(dependiaDe)
    .filter(([id, entao]) => digitaisAgora.get(id) !== entao)
    .map(([id]) => id);
  if (mudaram.length) return { cor: 'broken', culpados: mudaram };

  return { cor: 'valid', culpados: [] };
}

export function doTrecho(eventos, id, digitalAtual) {
  const meus = eventos.filter((e) => e.caixa === id);
  const aprovacoes = meus.filter((e) => e.tipo === 'aprovacao');
  const pedidos = meus.filter((e) => e.tipo === 'pedido');

  // An approval only holds for the text it approved. Change the text, the fingerprint changes,
  // and the approval becomes history — it does not disappear, it just stops counting.
  const valendo = aprovacoes.filter((e) => e.digital === digitalAtual);
  const vencidas = aprovacoes.filter((e) => e.digital !== digitalAtual);

  const abertos = pedidos.filter((p) => {
    const s = p.situacao?.estado;
    return s && s !== 'aplicado' && s !== 'recusado';
  });

  return { aprovado: valendo.length > 0, valendo, vencidas, pedidos, abertos, eventos: meus };
}

export const porQuando = (a, b) => String(a.quando || '').localeCompare(String(b.quando || ''));
