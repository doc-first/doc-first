/**
 * O ciclo do pedido: estados, transições e a redução de um histórico de eventos a um estado.
 *
 * ESTA É A ÚNICA IMPLEMENTAÇÃO. Navegador e servidor importam este arquivo; a tabela vem do
 * `cycle.json` ao lado, que continua sendo o dado.
 *
 * Histórico que justifica o arquivo: esta máquina de estados chegou a existir CINCO vezes — em C#,
 * em `pedidos.py`, em `revisao.js`, em `shell.js` e em `triagem.html` — e as cinco não eram iguais,
 * eram parecidas. O mesmo pedido aparecia "Aprovado" num lugar e "Aguardando triagem" noutro, e as
 * contagens do site brigavam entre si. Depois disso, a trava de corrida entrou no C# e não foi levada
 * ao Python, e os dois voltaram a discordar. Regra copiada é regra que diverge.
 *
 * O ciclo NÃO conhece idioma: ele devolve chaves (`open`, `approved`), e quem traduz é o `i18n.js`.
 * Antes, o rótulo em português morava na tabela — e um produto que se quer em três idiomas não pode
 * ter o texto da interface dentro da regra de negócio.
 *
 * @module
 */

// `request` é opcional porque `data` é o saco de dados de QUALQUER evento — um comentário tem
// `category`, um aplicado tem `commit`, e só o request_state tem `request`. Declarar obrigatório
// fazia o tipo do núcleo brigar com o da API, e o checador de tipos só contou isso quando passou
// a rodar de verdade (antes de existir o tsconfig, `tsc --noEmit` só imprimia a própria ajuda).
/** @typedef {{ request?: string, state?: string, from?: string, [k: string]: unknown }} EventData */
/** @typedef {{ id: string, type: string, author?: string, when?: string, data?: EventData|null }} Event */
/**
 * `label` e `short` são para a BORDA, não para a regra: o núcleo nunca os lê, e é por isso que eles
 * são opcionais aqui. Quem mostra texto a uma pessoa resolve o rótulo no idioma dela.
 * @typedef {{ owned_by: string, label?: string, short?: string }} StateDef
 */
/** @typedef {{ initial: string, initial_for_admin: string, states: Record<string,StateDef>,
 *              transitions: Record<string,string[]>, accepts_supplement: string[],
 *              requires_reason: string[], requires_commit: string[], agent_queue: string[],
 *              request_categories?: string[] }} CycleTable */

/**
 * @param {CycleTable} table
 */
export function createCycle(table) {
  // Object.keys, não truthiness: `{}` é truthy, e uma tabela vazia passaria — aceitando qualquer
  // mudança de estado. Pego por teste, não por leitura.
  if (!Object.keys(table?.states ?? {}).length || !Object.keys(table?.transitions ?? {}).length) {
    throw new Error('cycle.json sem estados ou sem transições: qualquer mudança de estado seria aceita.');
  }
  if (!table.states[table.initial]) {
    throw new Error(`cycle.json: o estado inicial "${table.initial}" não está em "states".`);
  }
  const dangling = Object.entries(table.transitions)
    .flatMap(([from, targets]) => targets.filter((t) => !table.states[t]).map((t) => `${from} → ${t}`));
  if (dangling.length) {
    throw new Error('cycle.json: transição para estado inexistente — ' + dangling.join(', '));
  }

  const ownedBy = (who) =>
    Object.entries(table.states).filter(([, v]) => v.owned_by === who).map(([k]) => k);

  return {
    table,
    exists: (state) => Boolean(table.states[state]),
    ownerStates: ownedBy('owner'),
    agentStates: ownedBy('agent'),
    canGo: (from, to) => (table.transitions[from] ?? []).includes(to),
    acceptsSupplement: (state) => table.accepts_supplement.includes(state),
    requiresReason: (state) => table.requires_reason.includes(state),
    requiresCommit: (state) => table.requires_commit.includes(state),

    /**
     * Estado atual de um pedido, a partir do histórico.
     * @param {string} requestId
     * @param {Event[]} events  todos os eventos (a função filtra)
     * @param {boolean} authorIsAdmin  owner e admin não triam a si mesmos
     */
    currentState(requestId, events, authorIsAdmin = false) {
      let state = authorIsAdmin ? table.initial_for_admin : table.initial;
      const ofRequest = events
        .filter((e) => e.data?.request === requestId)
        .sort((a, b) => String(a.when ?? '').localeCompare(String(b.when ?? '')));

      for (const e of ofRequest) {
        if (e.type === 'request_state' && e.data?.state) {
          // Trava de corrida: `from` diz de qual estado a mudança partiu. Duas requisições simultâneas
          // liam o mesmo estado e gravavam as duas — o pedido acabava num estado que a própria
          // máquina declara impossível, e nada se apaga. Quem partiu de um estado que já não era o
          // corrente perdeu a corrida. Evento antigo sem `from` continua valendo: a história não se
          // reescreve.
          if (e.data.from && e.data.from !== state) continue;
          state = e.data.state;
        } else if (e.type === 'supplement' && table.accepts_supplement.includes(state)) {
          state = table.initial;
        }
      }
      return state;
    },

    /**
     * O que o front precisa saber, sem reimplementar nada. Devolve CHAVES — o rótulo que a pessoa lê
     * é resolvido na borda, no idioma dela.
     * `triage` já vem filtrado: num pedido aprovado, as transições possíveis são todas do agente, e
     * o botão "Aprovar pedido" não deve aparecer.
     */
    status(state) {
      const targets = table.transitions[state] ?? [];
      const owner = ownedBy('owner');
      return {
        state,
        ownedBy: table.states[state]?.owned_by ?? 'owner',
        canGoTo: targets,
        triage: targets.filter((t) => owner.includes(t)),
        requiresReason: targets.filter((t) => table.requires_reason.includes(t)),
        acceptsSupplement: table.accepts_supplement.includes(state),
      };
    },
  };
}
