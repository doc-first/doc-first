/**
 * The configuration of the project using the method, read from `doc-first.json` at the root.
 *
 * It exists so the ENGINE does not know the product. Before it, the owner's e-mail and the cloud
 * project were scattered through the code — anyone who cloned it started a service pointing at
 * somebody else's infrastructure. Now there is exactly one file to edit.
 *
 * Environment variables beat the file: the same repository serves more than one environment.
 * @module
 */

/**
 * ⚠️ The KEYS of `doc-first.json` are still Portuguese (`nome`, `nuvem.projeto`): that file is
 * edited by whoever ADOPTS the method, and renaming what already sits on someone else's disk is a
 * migration, not a translation. What speaks English here is what this function returns.
 *
 * @param {string} root
 * @param {{ readFile: (path: string) => string }} io  injected so this can be tested without disk
 */
export function readConfig(root, io, env = {}) {
  let file = {};
  try {
    file = JSON.parse(io.readFile(`${root}/doc-first.json`));
  } catch {
    // With no file, only the environment matters. That is the case of running the engine outside
    // a project at all.
  }
  const cloud = file.nuvem ?? {};
  const dev = file.desenvolvimento ?? {};
  const content = file.conteudo ?? {};

  return {
    name: env.DOC_FIRST_NOME ?? file.nome ?? 'Documentation',
    owner: env.REVISAO_OWNER ?? file.owner ?? null,
    admins: env.REVISAO_ADMINS ?? (file.admins ?? []).join(','),
    project: env.REVISAO_PROJETO ?? cloud.projeto ?? null,
    account: env.REVISAO_CONTA ?? cloud.conta ?? null,
    region: cloud.regiao ?? null,
    service: cloud.servico ?? null,
    projectNumber: cloud.numeroDoProjeto ?? null,
    port: Number(env.PORT ?? dev.porta ?? 8095),
    actAs: env.REVISAO_DEV_EMAIL ?? dev.comoQuem ?? null,

    // WHERE THE CONTENT LIVES. This is what the engine used to know by heart, and what tied it to
    // a single project: `front/telas` was written inside pages.ts, and the approvals file inside
    // validation.ts. Anyone adopting the method would have had to name their folders the way the
    // first project named its own.
    // The defaults below are that first project's — they stand as an example of shape, not a rule.
    sheetFolders: content.pastas ?? ['front/telas', 'front/ds/catalogo'],
    registry: content.registro ?? 'docs/validacoes.json',
    home: content.inicio ?? '/front/index.html',
    /** For the short file name in the record: the part of the path not worth showing. */
    trimPrefix: content.recortar ?? 'front/',
    /** Only for the invalid-page error message. Empty means: give no example. */
    pageExamples: content.exemplosDePagina ?? '',
    /** The project's default language, when the reader states no preference. */
    idioma: file.idioma ?? env.REVISAO_IDIOMA ?? 'pt-BR',
  };
}
