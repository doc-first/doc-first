/**
 * A configuração do projeto que usa o método, lida de `doc-first.json` na raiz.
 *
 * Existe para que o MOTOR não conheça o produto. Antes, o e-mail do dono e o projeto na nuvem
 * estavam espalhados pelo código — quem clonasse subia um serviço apontando para a infraestrutura
 * de outra pessoa. Agora há um arquivo só para editar.
 *
 * Variável de ambiente vence o arquivo: o mesmo repositório serve a mais de um ambiente.
 * @module
 */

/**
 * ⚠️ As CHAVES do `doc-first.json` continuam em pt-BR (`nome`, `nuvem.projeto`): o arquivo é
 * editado por quem ADOTA o método, e renomear o que já está no disco de outra pessoa é migração,
 * não tradução. Quem fala inglês aqui é o que sai desta função.
 *
 * @param {string} root
 * @param {{ readFile: (path: string) => string }} io  injetado para poder testar sem disco
 */
export function readConfig(root, io, env = {}) {
  let file = {};
  try {
    file = JSON.parse(io.readFile(`${root}/doc-first.json`));
  } catch {
    // Sem o arquivo, só o ambiente manda. É o caso de quem roda o motor fora de um projeto.
  }
  const cloud = file.nuvem ?? {};
  const dev = file.desenvolvimento ?? {};
  const content = file.conteudo ?? {};

  return {
    name: env.DOC_FIRST_NOME ?? file.nome ?? 'Documentação',
    owner: env.REVISAO_OWNER ?? file.owner ?? null,
    admins: env.REVISAO_ADMINS ?? (file.admins ?? []).join(','),
    project: env.REVISAO_PROJETO ?? cloud.projeto ?? null,
    account: env.REVISAO_CONTA ?? cloud.conta ?? null,
    region: cloud.regiao ?? null,
    service: cloud.servico ?? null,
    projectNumber: cloud.numeroDoProjeto ?? null,
    port: Number(env.PORT ?? dev.porta ?? 8095),
    actAs: env.REVISAO_DEV_EMAIL ?? dev.comoQuem ?? null,

    // ONDE O CONTEÚDO MORA. Era isto que o motor sabia de cor, e que o prendia a um projeto só:
    // `front/telas` estava escrito dentro de pages.ts, e `docs/validacoes.json` dentro de
    // validation.ts. Quem adotasse o método teria de nomear as pastas como o Arautos as nomeia.
    // Os padrões são os do Arautos, para nada quebrar enquanto os dois ainda moram juntos.
    sheetFolders: content.pastas ?? ['front/telas', 'front/ds/catalogo'],
    registry: content.registro ?? 'docs/validacoes.json',
    home: content.inicio ?? '/front/index.html',
    /** Para o nome curto do arquivo no registro: o pedaço do caminho que não interessa mostrar. */
    trimPrefix: content.recortar ?? 'front/',
    /** Só para a mensagem de erro de página inválida. Vazio = não dá exemplo. */
    pageExamples: content.exemplosDePagina ?? '',
  };
}
