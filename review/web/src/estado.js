/**
 * O estado de um trecho, a partir dos eventos. Nenhuma regra de ciclo mora aqui: o servidor manda
 * `situacao` pronta em cada pedido, e o painel obedece.
 *
 * Era assim no painel clássico e continua sendo, de propósito. Quando o front calculava estado, ele
 * e o servidor discordavam — o mesmo pedido aparecia "Aprovado" num lugar e "Aguardando" no outro.
 */

/**
 * O semáforo de um trecho, do ponto de vista do navegador.
 *
 * O 🔴 não sai dos eventos: ele sai da comparação entre o que o trecho declara depender e como
 * essas dependências estão AGORA na página. É por isso que ele é calculado aqui e não vem do
 * servidor — só o navegador tem o texto renderizado de todos os trechos ao mesmo tempo.
 *
 * @param {{validado: string|null, depende: string[], dependiaDe?: Record<string,string>}} trecho
 * @param {Map<string,string>} digitaisAgora  id → digital de cada trecho da página
 */
export function semaforoDo(trecho, situacao, digitaisAgora) {
  if (!situacao.aprovado && !trecho.validado) return { cor: 'none', culpados: [] };

  // 🟡 pelo repositório: a digital gravada no ✓ não bate com a do texto que está na tela agora.
  // Sem este atributo, um trecho reescrito continuaria verde no navegador — o `data-validado`
  // sozinho só diz QUE foi validado, não SOBRE QUAL texto.
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

  // Uma aprovação só vale para o texto que ela aprovou. Mudou o texto, a digital muda, e a
  // aprovação passa a ser história — não some, mas não vale mais.
  const valendo = aprovacoes.filter((e) => e.digital === digitalAtual);
  const vencidas = aprovacoes.filter((e) => e.digital !== digitalAtual);

  const abertos = pedidos.filter((p) => {
    const s = p.situacao?.estado;
    return s && s !== 'aplicado' && s !== 'recusado';
  });

  return { aprovado: valendo.length > 0, valendo, vencidas, pedidos, abertos, eventos: meus };
}

export const porQuando = (a, b) => String(a.quando || '').localeCompare(String(b.quando || ''));
