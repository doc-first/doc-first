/**
 * O estado de um trecho, a partir dos eventos. Nenhuma regra de ciclo mora aqui: o servidor manda
 * `situacao` pronta em cada pedido, e o painel obedece.
 *
 * Era assim no painel clássico e continua sendo, de propósito. Quando o front calculava estado, ele
 * e o servidor discordavam — o mesmo pedido aparecia "Aprovado" num lugar e "Aguardando" no outro.
 */

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
