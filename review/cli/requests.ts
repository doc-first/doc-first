import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCycle } from '../core/cycle.js';
import { doHistorico, estadoAtual, estadoEmPortugues } from '../core/legacy.js';
import { createRoles } from '../core/roles.js';
import { lerTrechos, type Trecho } from './pages.ts';
import { Fonte } from './remote.ts';
import type { Evento } from '../api/types.ts';

/**
 * A ferramenta do agente: ler os pedidos que os revisores fizeram no site, ver o contexto, medir o
 * impacto e registrar o andamento. NUNCA altera conteúdo — quem altera é o agente, com o dono, em
 * commit com os trailers `Pedido:` e `Solicitado-por:`.
 */

export interface Pedido extends Evento {
  estado: string;
  historico: Evento[];
}

export function carregarCiclo(raiz: string) {
  return createCycle(JSON.parse(readFileSync(join(raiz, 'review', 'cycle.json'), 'utf8')));
}

/**
 * O rótulo que a pessoa lê. Mora aqui, e não no núcleo: desde 2026-09-19 a regra não carrega texto de
 * interface — ela devolve a chave, e cada borda resolve no idioma de quem está lendo.
 */
const rotuloDe = (ciclo: ReturnType<typeof createCycle>, estado: string) =>
  ciclo.table.states[estado]?.label ?? estado;

export function papeisDoAmbiente() {
  return createRoles(process.env.REVISAO_OWNER, process.env.REVISAO_ADMINS);
}

/** Reduz os eventos a pedidos com estado — usando o MESMO núcleo que o servidor e o navegador. */
export function pedidos(raiz: string, eventos: Evento[]): Pedido[] {
  const ciclo = carregarCiclo(raiz);
  const papeis = papeisDoAmbiente();
  // O núcleo fala inglês, e `Pedido.estado` também — quem traduz para o que a pessoa lê é a impressão,
  // logo abaixo. Ver review/core/legacy.js.
  const paraONucleo = eventos.map(doHistorico);
  return eventos.filter((e) => e.tipo === 'pedido').map((p) => ({
    ...p,
    estado: ciclo.currentState(p.id, paraONucleo, papeis.isAdmin(p.autor)),
    historico: eventos
      .filter((e) => e.dados?.pedido === p.id && e.tipo !== 'pedido')
      .sort((a, b) => a.quando.localeCompare(b.quando)),
  }));
}

export function achar(ps: Pedido[], prefixo: string): Pedido {
  const c = ps.filter((p) => p.id.startsWith(prefixo));
  if (c.length !== 1) {
    throw new Error(`pedido "${prefixo}": ${c.length === 0 ? 'não encontrado' : 'ambíguo, use mais caracteres'}`);
  }
  return c[0];
}

const quando = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso.slice(0, 16)
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

export async function listar(raiz: string, fonte: Fonte, todos: boolean) {
  const ciclo = carregarCiclo(raiz);
  const eventos = await fonte.eventos();
  const ps = pedidos(raiz, eventos);
  const fila = ciclo.table.agent_queue ?? ['approved', 'applying', 'waiting'];
  const mostrar = todos ? ps : ps.filter((p) => fila.includes(p.estado));

  if (!mostrar.length) {
    const triar = ps.filter((p) => p.estado === 'open').length;
    console.log(`nenhum pedido ${todos ? 'registrado' : 'aprovado para aplicar'}.` +
      (triar && !todos ? ` (${triar} aguardando triagem do dono)` : ''));
    return;
  }
  const trechos = await lerTrechos(raiz);
  for (const p of mostrar) {
    const t = p.caixa ? trechos.get(p.caixa) : undefined;
    const mudou = t && p.digital && t.digital !== p.digital ? ' · ⚠ o trecho mudou desde o pedido' : '';
    const rotulo = ciclo.table.states[p.estado]?.short ?? p.estado;
    console.log(`${p.id.slice(0, 8)}  ${rotulo.padEnd(10)} ${(p.caixa ?? p.pagina).padEnd(10)} ` +
      `${quando(p.quando)}  ${p.autor}${mudou}`);
    console.log(`          “${(p.texto ?? '').replace(/\n/g, ' ').slice(0, 140)}”`);
  }
}

export async function ver(raiz: string, fonte: Fonte, prefixo: string) {
  const ciclo = carregarCiclo(raiz);
  const eventos = await fonte.eventos();
  const p = achar(pedidos(raiz, eventos), prefixo);
  const trechos = await lerTrechos(raiz);
  const t = p.caixa ? trechos.get(p.caixa) : undefined;

  console.log(`Pedido  ${p.id}`);
  console.log(`Estado  ${rotuloDe(ciclo, p.estado)}`);
  console.log(`Quem    ${p.autor}  ·  ${quando(p.quando)}`);
  console.log(`Onde    ${p.caixa ?? p.pagina}${t ? `  (${t.arquivo})` : ''}`);
  console.log(`\nPediu:\n  ${(p.texto ?? '').replace(/\n/g, '\n  ')}`);
  if (p.foto) console.log(`\nTexto do trecho quando ele pediu:\n  ${p.foto.slice(0, 500)}`);
  if (t) {
    console.log(`\nTexto do trecho AGORA:\n  ${t.texto.slice(0, 500)}`);
    if (p.digital && t.digital !== p.digital) console.log('\n  ⚠ o trecho MUDOU desde o pedido.');
    if (t.validado) console.log(`  ⚠ este trecho está VALIDADO (${t.validado}): mudar exige permissão do dono.`);
  }
  if (p.historico.length) {
    console.log('\nConversa:');
    for (const e of p.historico) {
      // `e.dados.estado` vem do registro, ainda em pt-BR: traduzir antes de procurar o rótulo.
      const que = e.tipo === 'complemento' ? 'acrescentou'
        : (rotuloDe(ciclo, estadoAtual(String(e.dados?.estado ?? ''))) || e.tipo);
      console.log(`  ${quando(e.quando)}  ${e.autor}  ${que}`);
      if (e.texto) console.log(`      ${e.texto.replace(/\n/g, ' ')}`);
    }
  }
}

/** Onde mais o assunto aparece — a análise de impacto antes de alterar. */
export async function impacto(raiz: string, fonte: Fonte, prefixo: string, termos: string[]) {
  const eventos = await fonte.eventos();
  const p = achar(pedidos(raiz, eventos), prefixo);
  const trechos = await lerTrechos(raiz);
  const busca = termos.length ? termos : [(p.texto ?? '').split(/\s+/).slice(0, 3).join(' ')];

  console.log(`Impacto do pedido ${p.id.slice(0, 8)} — ${p.caixa ?? p.pagina}\n`);
  for (const termo of busca) {
    const rx = new RegExp(termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const achados = [...trechos.values()].filter((t) => rx.test(t.texto));
    console.log(`"${termo}" aparece em ${achados.length} trecho(s):`);
    for (const t of achados.slice(0, 25)) {
      console.log(`  ${t.id.padEnd(12)} ${t.validado ? '✓ validado ' : '           '}${t.texto.slice(0, 80)}`);
    }
    if (achados.length > 25) console.log(`  … e mais ${achados.length - 25}`);
    const validados = achados.filter((t) => t.validado).length;
    if (validados) console.log(`  ⚠ ${validados} deles estão VALIDADOS: mudar exige permissão do dono.`);
    console.log('');
  }
}

export async function resumo(raiz: string, fonte: Fonte) {
  const eventos = await fonte.eventos();
  const ps = pedidos(raiz, eventos);
  const porPagina = new Map<string, { aprovacoes: number; pedidos: number; abertos: number }>();
  for (const e of eventos) {
    const v = porPagina.get(e.pagina) ?? { aprovacoes: 0, pedidos: 0, abertos: 0 };
    if (e.tipo === 'aprovacao') v.aprovacoes++;
    if (e.tipo === 'pedido') v.pedidos++;
    porPagina.set(e.pagina, v);
  }
  for (const p of ps.filter((x) => x.estado === 'aberto')) {
    const v = porPagina.get(p.pagina)!; v.abertos++;
  }
  for (const [pagina, v] of [...porPagina].sort()) {
    console.log(`${pagina.padEnd(8)} ${String(v.aprovacoes).padStart(3)} aprovação(ões) · ` +
      `${v.pedidos} pedido(s) · ${v.abertos} em aberto`);
  }
  console.log(`total: ${eventos.length} evento(s), ${ps.length} pedido(s), ` +
    `${ps.filter((p) => p.estado === 'aberto').length} em aberto`);
}

/**
 * Registra o andamento de um pedido — o que o revisor vê no painel do trecho.
 * O agente só usa os estados DELE: aprovar, recusar e perguntar é triagem do dono, no site.
 */
export async function estado(raiz: string, fonte: Fonte, prefixo: string, novo: string,
                             mensagem: string, extra: { commit?: string; caixas?: string } = {}) {
  const ciclo = carregarCiclo(raiz);
  const eventos = await fonte.eventos();
  const p = achar(pedidos(raiz, eventos), prefixo);

  // A pessoa digita o estado na linha de comando, e aprendeu a digitar `analise`. O nome antigo
  // continua valendo — quem migra a língua do código não faz o usuário remigrar o dedo.
  const alvo = estadoAtual(novo);
  if (!ciclo.agentStates.includes(alvo)) {
    throw new Error(`o agente só usa: ${ciclo.agentStates.map(estadoEmPortugues).join(', ')} ` +
      '(aprovar, recusar e perguntar é triagem do dono, no site)');
  }
  if (!ciclo.canGo(p.estado, alvo)) {
    throw new Error(`não dá: o pedido está "${rotuloDe(ciclo, p.estado)}". ` +
      'O agente só aplica pedidos APROVADOS pelo dono.');
  }
  if (ciclo.requiresCommit(alvo) && !extra.commit) {
    throw new Error('aplicado precisa de --commit SHA (o rastro liga pedido ↔ commit)');
  }

  // Grava em pt-BR, como o resto do registro: o front ainda lê assim. Ver legacy.js.
  const dados: Record<string, string> = {
    pedido: p.id, estado: estadoEmPortugues(alvo), de: estadoEmPortugues(p.estado),
  };
  if (extra.commit) dados.commit = extra.commit;
  if (extra.caixas) dados.caixas = extra.caixas;

  const texto = mensagem + (extra.commit ? ` · commit ${extra.commit.slice(0, 7)}` : '') +
    (extra.caixas ? ` · trechos: ${extra.caixas}` : '');
  await fonte.incluir({ tipo: 'pedido_estado', pagina: p.pagina, caixa: p.caixa, texto, dados });
  console.log(`registrado: ${p.id.slice(0, 8)} → ${rotuloDe(ciclo, alvo)}`);
}
