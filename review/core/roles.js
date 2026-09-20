/**
 * Papéis do sistema. Da METODOLOGIA vêm só `owner` e a tag `founder`; `admin`, `gestor médico` e os
 * demais são papéis do PROJETO que adota o método (decisão do Ale, 2026-09-17).
 *
 *   owner   um só, sempre o mesmo: o arquiteto fundador. Pode tudo, inclusive criar as roles.
 *   admin   pode tudo o que o owner faz, menos ser owner.
 *   outro   qualquer outra identidade liberada.
 *
 * O motor fala em CAPACIDADE — "pode aprovar?", "pode triar?" —, não em nome de papel de produto.
 * @module
 */

/**
 * @param {string|undefined|null} owner  UM e-mail. Zero ou mais de um é erro de configuração.
 * @param {string|undefined|null} admins e-mails separados por vírgula; pode ser vazio.
 */
export function createRoles(owner, admins) {
  const split = (s) =>
    String(s ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

  const list = [...new Set(split(owner))];
  if (list.length !== 1) {
    throw new Error(
      `REVISAO_OWNER precisa de exatamente um e-mail (veio ${list.length}). ` +
      'O owner é único por definição: é o arquiteto fundador do projeto.');
  }
  const ownerEmail = list[0];
  // O owner é admin por consequência, não por configuração: não há como tirar o poder dele por engano.
  const everyone = new Set([...split(admins), ownerEmail]);
  const normalized = (e) => String(e ?? '').trim().toLowerCase();

  return {
    owner: ownerEmail,
    admins: [...everyone],
    isOwner: (e) => normalized(e) === ownerEmail,
    /** Owner também é admin. É isto que responde "pode aprovar?" e "pode triar?". */
    isAdmin: (e) => everyone.has(normalized(e)),
    canApprove: (e) => everyone.has(normalized(e)),
    canTriage: (e) => everyone.has(normalized(e)),
    roleOf: (e) => (normalized(e) === ownerEmail ? 'owner' : everyone.has(normalized(e)) ? 'admin' : 'other'),
  };
}
