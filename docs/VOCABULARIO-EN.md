# Vocabulário: como cada conceito se chama em inglês

**Decisão de desenho, `2026-09-19`:** o código do Doc First é em **inglês** — nomes de variável, classe,
função, arquivo e chave de dado. O **conteúdo** continua em pt-BR: as telas da documentação, os
rótulos do painel de revisão e as mensagens que o revisor lê, porque quem revisa é brasileiro.
Os **comentários** ficam em pt-BR nesta passada e serão traduzidos depois, em separado.

Este arquivo existe para o mesmo conceito não virar dois nomes em dois arquivos. **Antes de inventar
um nome novo, procure aqui.** Se faltar, acrescente na mesma linha em que escrever o código.

## O domínio

| pt-BR | inglês | Onde aparece |
|---|---|---|
| revisão | review | pasta `review/` |
| núcleo | core | pasta `review/core/` |
| digital (do texto) | fingerprint | `fingerprint.js` |
| ciclo (do pedido) | cycle | `cycle.js` |
| papéis | roles | `roles.js` |
| limites | limits | `limits.js` |
| registro (dos eventos) | store | `store.ts` — é onde os eventos ficam |
| pessoas | users | `users.ts` |
| identidade | identity | `identity-iap.ts`, `identity-password.ts` |
| trecho / caixa | block | o pedaço de texto com `data-id` |
| foto (do texto de então) | snapshot | campo do evento |
| pedido | request | tipo de evento |
| triagem | triage | quem decide o destino do pedido |
| folha | sheet | uma página da documentação |
| fonte (da verdade, na nuvem) | remote | `remote.ts` |

## As funções do núcleo (camada 2, `2026-09-19`)

| pt-BR | inglês | Onde |
|---|---|---|
| `criarCiclo` | `createCycle` | `cycle.js` |
| `estadoAtual` | `currentState` | `cycle.js` |
| `situacao` | `status` | `cycle.js` |
| `podeIr` | `canGo` | `cycle.js` |
| `existe` | `exists` | `cycle.js` |
| `doAgente` / `estadosDoDono` | `agentStates` / `ownerStates` | `cycle.js` |
| `exigeMotivo` / `exigeCommit` | `requiresReason` / `requiresCommit` | `cycle.js` |
| `aceitaComplemento` | `acceptsSupplement` | `cycle.js` |
| `rotulo` | *(saiu do núcleo)* | a borda lê `table.states[x].label` |
| `criarPapeis` | `createRoles` | `roles.js` |
| `ehOwner` / `ehAdmin` | `isOwner` / `isAdmin` | `roles.js` |
| `podeAprovar` / `podeTriar` | `canApprove` / `canTriage` | `roles.js` |
| `de` (papel de alguém) | `roleOf` | `roles.js` — devolve `owner`, `admin` ou `other` |
| `estourou` | `overLimit` | `limits.js` |
| `commitValido` | `validCommit` | `limits.js` |
| `LIMITES` | `LIMITS` | `limits.js` |
| `normalizar` | `normalize` | `fingerprint.js` |
| `digitalDoTexto` | `fingerprintOfText` | `fingerprint.js` |
| `digitalDoElemento` | `fingerprintOfElement` | `fingerprint.js` |
| `textoDoElemento` | `textOfElement` | `fingerprint.js` |
| `TAMANHO` | `SIZE` | `fingerprint.js` |
| `lerConfig` | `readConfig` | `config.js` |

⚠️ **`duvida` virou `doubt`, não `question`** — `question` já é um estado do ciclo. Os dois viajam
como texto solto, e o mesmo nome nos dois faria um grep mentir.

## Os estados do ciclo

`cycle.json` → `cycle.json`. Os valores mudam de língua, e por isso existe um **mapa de
compatibilidade** para os eventos gravados antes de `2026-09-19` (ver `review/core/legacy.js`).

| pt-BR | inglês | Rótulo que o revisor vê (continua pt-BR) |
|---|---|---|
| `aberto` | `open` | Aguardando triagem |
| `aprovado` | `approved` | Aprovado |
| `recusado` | `rejected` | Recusado |
| `pergunta` | `question` | Pergunta para quem pediu |
| `analise` | `applying` | Em aplicação |
| `aguardando` | `waiting` | Em aplicação · dúvida |
| `aplicado` | `applied` | Aplicado |

## Os tipos de evento

| pt-BR | inglês |
|---|---|
| `aprovacao` | `approval` |
| `pedido` | `request` |
| `comentario` | `comment` |
| `resposta_decisao` | `decision_reply` |
| `pedido_estado` | `request_state` |
| `complemento` | `supplement` |

## Os campos do evento

| pt-BR | inglês |
|---|---|
| `pagina` | `page` |
| `caixa` | `block` |
| `digital` | `fingerprint` |
| `texto` | `text` |
| `foto` | `snapshot` |
| `autor` | `author` |
| `quando` | `when` |
| `dados` | `data` |

## O que NÃO muda

- **Os rótulos e mensagens da interface**: "Aguardando triagem", "Aprovado", os textos do painel.
  O revisor é médico e brasileiro; traduzir isso atrapalharia o trabalho dele.
- **Os `data-*` do HTML das folhas** (`data-id`, `data-validado`, `data-revisao-ui`). Estão em
  ~490 trechos de conteúdo, e `data-validado` é lido pela trava de validação. Mudá-los é uma
  operação à parte, com a trava conferida antes e depois. Anotado em `docs/DIVIDA-TECNICA.md`.
- **As variáveis de ambiente `REVISAO_*`** nesta passada: elas estão no Cloud Run, no `publicar.sh`
  e no CI. Renomear exige publicar junto, então vira um passo próprio.
