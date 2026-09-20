/**
 * O semáforo da documentação viva: em que estado está a validação de cada trecho.
 *
 * A pergunta que isto responde não é "alguém aprovou?", é **"a aprovação ainda vale?"**. São coisas
 * diferentes, e a segunda é a que importa numa documentação que muda.
 *
 *   ⚪ none     ninguém validou ainda
 *   🟢 valid    validado, e nada mudou desde então
 *   🟡 stale    o TEXTO deste trecho mudou depois do ✓ — ninguém aprovou o texto novo
 *   🔴 broken   o texto deste trecho está igual, mas algo de que ele DEPENDE mudou
 *
 * O amarelo o motor já sabia ver desde o começo, pela digital. O vermelho é o que faz a
 * documentação ser viva em vez de só rastreável: é ele que diz *"isto aqui continua escrito do
 * mesmo jeito, mas a regra em que se apoiava mudou — vá conferir se ainda é verdade"*.
 *
 * ⚠️ Vermelho não é erro. É **pergunta**. O motor não sabe se o trecho ficou errado — sabe que ele
 * ficou SUSPEITO, e que um humano precisa olhar. Tratar como erro faria as pessoas desligarem a
 * checagem no primeiro falso positivo, e aí a trava inteira perde o sentido.
 * @module
 */

/** @typedef {'none'|'valid'|'stale'|'broken'} Estado */

/**
 * Um trecho, do ponto de vista do semáforo.
 * @typedef {{
 *   id: string,
 *   digital: string,
 *   depende?: string[],
 * }} Trecho
 */

/**
 * O que está gravado sobre a validação de um trecho.
 * @typedef {{ digital_texto: string, data?: string, depende?: Record<string,string> }} Registro
 */

export const CORES = /** @type {const} */ ({
  none: '⚪', valid: '🟢', stale: '🟡', broken: '🔴',
});

/**
 * O estado de UM trecho.
 *
 * @param {Trecho} trecho          como ele está agora, no disco
 * @param {Registro|undefined} reg o que foi gravado quando alguém validou
 * @param {Map<string, string>} digitaisAgora  id → digital atual de todos os trechos
 * @returns {{ estado: Estado, porque: string, culpados: string[] }}
 */
export function estadoDoTrecho(trecho, reg, digitaisAgora) {
  if (!reg) return { estado: 'none', porque: 'ninguém validou ainda', culpados: [] };

  if (reg.digital_texto !== trecho.digital) {
    return {
      estado: 'stale',
      porque: 'o texto mudou depois da validação — ninguém aprovou o texto novo',
      culpados: [],
    };
  }

  // O texto está igual. Resta saber se o chão embaixo dele continua o mesmo.
  // `reg.depende` guarda a digital que CADA dependência tinha no momento do ✓. Comparar com a de
  // agora é o que revela a mudança indireta — aquela que nenhuma digital deste trecho denuncia.
  const dependiaDe = reg.depende ?? {};
  const mudaram = Object.entries(dependiaDe)
    .filter(([id, digitalEntao]) => {
      const agora = digitaisAgora.get(id);
      // Dependência que sumiu também é quebra: o trecho aponta para algo que não existe mais.
      return agora === undefined || agora !== digitalEntao;
    })
    .map(([id]) => id);

  if (mudaram.length) {
    return {
      estado: 'broken',
      porque: `o texto continua igual, mas mudou aquilo de que ele depende: ${mudaram.join(', ')}`,
      culpados: mudaram,
    };
  }

  return { estado: 'valid', porque: 'validado, e nada mudou desde então', culpados: [] };
}

/**
 * O semáforo da documentação inteira.
 *
 * @param {Map<string, Trecho>} trechos
 * @param {Record<string, Registro>} registro
 * @returns {{ porTrecho: Map<string, {estado: Estado, porque: string, culpados: string[]}>,
 *             placar: Record<Estado, number> }}
 */
export function semaforo(trechos, registro) {
  const digitaisAgora = new Map([...trechos].map(([id, t]) => [id, t.digital]));
  const porTrecho = new Map();
  const placar = /** @type {Record<Estado, number>} */ ({ none: 0, valid: 0, stale: 0, broken: 0 });

  for (const [id, t] of trechos) {
    const r = estadoDoTrecho(t, registro[id], digitaisAgora);
    porTrecho.set(id, r);
    placar[r.estado]++;
  }
  return { porTrecho, placar };
}

/**
 * Quem depende de um trecho — a pergunta ao contrário, e a que a pessoa realmente faz:
 * *"se eu mexer aqui, o que mais preciso olhar?"*
 *
 * @param {string} id
 * @param {Map<string, Trecho>} trechos
 * @returns {string[]}
 */
export function quemDependeDe(id, trechos) {
  return [...trechos.values()].filter((t) => (t.depende ?? []).includes(id)).map((t) => t.id);
}
