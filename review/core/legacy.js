/**
 * O que foi gravado antes de `2026-09-19`, lido pelo código de hoje.
 *
 * O código passou a ser inteiro em inglês (docs/VOCABULARIO-EN.md), e isso inclui os valores que
 * viajam gravados: o tipo do evento, o estado do pedido, os campos. Mas **o histórico não se
 * reescreve** — foi decisão de desenho, e é a certa: o registro é append-only por construção
 * (o SQLite recusa UPDATE e DELETE por trigger), e uma aprovação humana com data é prova, não dado.
 *
 * Então a tradução acontece **na leitura**, aqui, numa direção só. O núcleo nunca vê pt-BR.
 *
 * ⚠️ **Hoje ele traduz mais do que histórico.** A API e o front ainda falam pt-BR (`tipo`, `dados`,
 * `pedido`), porque a camada 2 começou pelo núcleo. Então TODO evento que entra no núcleo passa por
 * aqui, não só o antigo. Quando `review/api/` e `front/js/` forem traduzidos, este arquivo volta a
 * ser só o que o nome diz — e o que sobrar nele é a medida do que ainda falta.
 *
 * ⚠️ Fora isso, ele só cresce por acidente: se você pensa em acrescentar um par porque código novo
 * gravou em pt-BR, o defeito está no código novo — conserte lá.
 * @module
 */

/** Campo do evento: `pagina` → `page`. */
const CAMPOS = {
  pagina: 'page', caixa: 'block', digital: 'fingerprint', texto: 'text',
  foto: 'snapshot', autor: 'author', quando: 'when', dados: 'data', tipo: 'type',
};

/** Tipo do evento: `aprovacao` → `approval`. */
const TIPOS = {
  aprovacao: 'approval', pedido: 'request', comentario: 'comment',
  resposta_decisao: 'decision_reply', pedido_estado: 'request_state', complemento: 'supplement',
};

/** Estado do ciclo: `aberto` → `open`. */
const ESTADOS = {
  aberto: 'open', aprovado: 'approved', recusado: 'rejected', pergunta: 'question',
  analise: 'applying', aguardando: 'waiting', aplicado: 'applied',
};

/** Categoria do pedido: `duvida` → `doubt`. */
const CATEGORIAS = { texto: 'text', termo: 'term', remover: 'remove', duvida: 'doubt' };

/** Chave de dentro de `dados`: `pedido` → `request`. */
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
 * Um evento como o código de hoje espera lê-lo, venha ele de quando vier.
 *
 * Só renomeia o que reconhece: campo desconhecido atravessa intacto, porque um evento que este mapa
 * não entende ainda é um fato — perder o campo seria pior que carregá-lo em pt-BR.
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
    // `state` e `from` carregam nome de estado; `category`, nome de categoria.
    if (dados.state) dados.state = estadoAtual(dados.state);
    if (dados.from) dados.from = estadoAtual(dados.from);
    if (dados.category) dados.category = categoriaAtual(dados.category);
    saida.data = dados;
  }
  return saida;
}

// ---------------------------------------------------------------- a volta, e por que ela existe

/** Inverte um mapa. Feito uma vez, na carga: são sete pares, mas errar a inversão à mão é barato. */
const inverso = (mapa) => Object.fromEntries(Object.entries(mapa).map(([a, b]) => [b, a]));

const ESTADOS_PT = inverso(ESTADOS);

/**
 * ⚠️ **ANDAIME, com prazo.** O núcleo já fala inglês; a API HTTP e o front ainda não. Enquanto isso,
 * a borda traduz a resposta de volta para pt-BR, e o contrato publicado não muda no meio do caminho.
 *
 * Isto não é desenho — é a marca de uma migração em andamento. **Morre** quando `front/js/` ler
 * `state` em vez de `estado` (camada 2, passo 5). Se você está lendo isto muito depois disso,
 * a dívida ficou: `docs/DIVIDA-TECNICA.md`.
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

/** O nome em pt-BR de um estado — para o CLI e para o contrato. Some junto com `paraOContrato`. */
export const estadoEmPortugues = (s) => ESTADOS_PT[s] ?? s;
