# Glossary: the concepts of the method

**The owner's decision, `2026-09-20`, replacing the one from `2026-09-19`:** **nothing in Portuguese in the
code.** Identifier, comment, file name, table name, column name, data key — all English.

The earlier rule said comments would stay in pt-BR "for this pass". It fell: the repository is
public and MIT, and a comment is the part of the code an outsider reads most before deciding
whether to adopt it. A comment that person cannot read is worth less than no comment at all.

The **content** follows a different rule: each project's documentation pages are written in the
language of whoever reviews them. Messages the reviewer reads go through `review/core/i18n.js`.

This file exists so the same concept does not end up with two names in two files. **Before
inventing a new name, look here.** If one is missing, add it on the same line you write the code.

---

## The unit of review

| Concept | What it is |
|---|---|
| **block** | the piece of text that gets approved, one at a time. In the HTML it is the element carrying `data-id` and `data-cod`, inside `<main>`. Everything outside `<main>` is not reviewable |
| **sheet** | one page of documentation, identified by a page code (`A01`, `D01`, `UC-01`) |
| **kind** | what a block *is* — heading, text, list, callout, table, image, diagram, palette, configuration, contract, data model, rationale, open decision. Catalogue in `review/core/kinds.js` |
| **demand** | what a kind requires of itself before a block counts as ready. An image demands an `alt`; a table demands a header row; an open decision demands an owner and a deadline. ⚠️ A kind never changes **who** approves, nor **how** the fingerprint is computed — only what is demanded first |

Kinds exist because "is this good?" is not the same question for a heading and for a diagram.
Without kinds those rules become spoken convention, and spoken convention dies with the third
person who joins the project.

## The lock

| Concept | What it is |
|---|---|
| **fingerprint** | SHA-256 of the block's visible text, 16 characters. `review/core/fingerprint.js`. One implementation only — it runs in the browser and on the server, with no build step |
| **normalize** | how the fingerprint reads text: whitespace collapsed, ends trimmed. Rewrapping a paragraph must not drop a human approval. Only the words count |
| **validation** | a human ✓ tied to **one fingerprint**, not to a block. Change one letter and the approval stops holding, because nobody approved the new text |
| **lock** | the consequence of that ✓ in the repository. Only the owner's ✓ locks; a reviewer's approval is recorded but does not lock |
| **dependency** | block B stands on block A. Declared by hand today, in `data-depende` |

The fingerprint existed three times, in three languages, until `2026-09-18`, and the three agreed
only by luck — one of them did not strip the review UI, so merely saving a marker into the HTML
would have turned every approval into "an earlier version of the text", silently, with nobody able
to say why. A rule like that is not kept identical in three places by discipline. It is kept by
being one.

## The traffic light

The state of a validation. It is **computed, never declared** — `review/core/validity.js`. The
question it answers is not "did someone approve it?" but "**does the approval still hold?**".

| | State | Meaning |
|---|---|---|
| ⚪ | `none` | nobody has validated it yet |
| 🟢 | `valid` | validated, and nothing has changed since |
| 🟡 | `stale` | **this** block's text changed after the ✓ — nobody approved the new text |
| 🔴 | `broken` | this block's text is unchanged, but something it **depends on** changed |

Yellow was always visible through the fingerprint. Red is what makes documentation living rather
than merely traceable: it says *"this is still written exactly as approved, but the rule it stood
on moved — go check whether it is still true"*.

⚠️ **Red is not an error. It is a question.** The engine does not know the block became wrong — it
knows it became **suspect**, and that a human needs to look. Treating it as an error would make
people switch the check off at the first false positive, and then the whole lock is pointless.

Yellow beats red: if the block's own text changed, that is the problem to fix first.

## The cycle

The state machine of a change request. Single source: `review/cycle.json`, read by the API and by
the agent's tool. The front end computes no state at all — it receives one.

| State | Owned by | Meaning |
|---|---|---|
| `open` | owner | waiting for triage |
| `approved` | owner | approved |
| `rejected` | owner | rejected, with a reason |
| `question` | owner | a question back to whoever asked |
| `applying` | agent | being applied |
| `waiting` | agent | being applied, with a doubt outstanding |
| `applied` | agent | applied, with a commit |

| Concept | What it is |
|---|---|
| **request** | somebody asking for a change to a block. The starting point of the cycle |
| **triage** | deciding the fate of a request: approve, reject, or ask. It belongs to the owner or an admin. ⚠️ Nobody triages themselves — a request from an owner or an admin is born `approved` (design decision, `2026-09-17`) |
| **supplement** | detail added to a request that is `open`, `rejected` or `question`. A supplement on a rejected one sends it back to `open` |
| **snapshot** | the text of the block at the instant of the request or the approval. Git stays the version history; the snapshot shows *what* was approved or asked |
| **doubt** | a category of request — "I do not understand this". ⚠️ `doubt`, not `question`: `question` is already a **state** of the cycle. Both travel as loose text, and the same name on both would make a `grep` lie |

`approved` **never goes back** to `rejected`. Changing something approved means a **new request**
linked to the previous one — even if the change is going back to the earlier text.

Before `cycle.json`, the same state machine was written **five** times, and the five were not
equal, they were similar: different labels between one language and another, seven transitions on
one side and eleven on the other. Changing the cycle cost three commits in three languages, and
nothing warned you if you forgot one.

## Who can do what

| Concept | What it is |
|---|---|
| **owner** | exactly one, always the same: the founding architect. Can do everything, including creating the roles. Zero or more than one **does not bring the service up** — it is an invariant, not a convention |
| **admin** | can do everything the owner does, except be the owner. A role of the **project**, not of the method |
| **other** | any other allowed identity |
| **founder** | a tag that grants the power to see the whole documentation. It sits **on the role, not on the person**, so the second holder of that role sees it too, without an exception |
| **capability** | what the engine actually asks about: **can approve?**, **can triage?**. Role names change with every company; capabilities do not |

The method defines only `owner` and the `founder` tag. `admin`, clinical lead, operator, auditor —
those belong to the project adopting the method. If the engine named a product role, it would stop
being an engine. `review/core/roles.js`.

The owner is an admin by consequence, not by configuration: there is no way to strip their power by
accident.

## How it is stored

| Concept | What it is |
|---|---|
| **event** | every ✓, request, rejection and comment, with author, timestamp, page, block and the fingerprint at that moment. Nothing is erased |
| **store** | where the events live. The database refuses `UPDATE` and `DELETE` — through triggers, not through discipline |
| **index** | blocks, kinds, dependencies and issues, rebuilt on demand. ⚠️ The index is **not** truth and can be deleted without loss: the truth is the file, versioned in git, which is what has diffs, history and authorship |
| **limits** | the size and shape of everything crossing the boundary. `review/core/limits.js`. It exists because a POST with 500 KB per field used to be accepted and then served back to everyone, on every page load, into a collection nobody can delete from |
| **remote** | the source of truth in the cloud, when there is one |

## Around the edges

| Concept | What it is |
|---|---|
| **config** | the configuration of the project using the method, in `doc-first.json` at the root. It exists so the **engine** does not know the product. Environment variables beat the file: the same repository serves more than one environment |
| **i18n** | the core returns **keys**; the edge turns them into sentences, in the reader's language. `review/core/i18n.js` |
| **legacy** | translation on read, in one direction, of what was written before `2026-09-19`. `review/core/legacy.js`. History is not rewritten: a dated human approval is evidence, not data |

⚠️ Three audiences, and they are not the same. **The reviewer** reads messages in the browser, in
their own language, always translated. **Whoever operates** reads logs: English always, and not
through `i18n.js` — a log is evidence, and evidence that changes wording by locale cannot be
grepped. **Whoever develops** reads configuration errors at boot: English, hard-coded, because a
service that refuses to start has no session, no person and no chosen language yet.

---

# Legacy names

Identifiers and commands in Portuguese still exist in the code, and they are being renamed. The
old names keep working. This is the mapping.

⚠️ `review/core/legacy.js` **translates more than history today.** The API and the front end still
speak Portuguese (`tipo`, `dados`, `pedido`), because the rename started with the core, so every
event entering the core passes through it — not only the old ones. When `review/api/` and the front
end are translated, that file goes back to being only what its name says, and whatever is left in
it is the measure of what is still pending.

⚠️ It only grows by accident: if you are about to add a pair because new code wrote in Portuguese,
the defect is in the new code — fix it there.

## Still Portuguese

| What | Where | Why it has not moved |
|---|---|---|
| CLI commands: `sincronizar`, `listar`, `ver`, `impacto`, `estado`, `resumo`, `conferir`, `indexar`, `tipos`, `semaforo`, `se-eu-mexer` | `review/cli/doc-first.ts` | typed by people and written into scripts; renaming means keeping both for a while |
| `doc-first.json` keys: `nome`, `conteudo.pastas`, `conteudo.registro`, `desenvolvimento` | the root of each project | that file is edited by whoever **adopts** the method. Renaming what already sits on somebody else's disk is a migration, not a translation |
| HTML attributes: `data-id`, `data-cod`, `data-validado`, `data-revisao-ui`, `data-depende`, `data-tipo`, `data-dono`, `data-prazo` | the sheets | they are in ~490 blocks of content, and `data-validado` is read by the validation lock. Changing them is a job of its own, with the lock checked before and after |
| `REVISAO_OWNER`, `REVISAO_ADMINS`, `REVISAO_SITE` | Cloud Run, `publicar.sh`, CI | renaming requires publishing at the same time, so it becomes its own step |
| The reviewer's labels: "Aguardando triagem", "Aprovado" | `review/cycle.json` | they leave once the language choice arrives. Until then, translating them would leave a reviewer who works in Portuguese without Portuguese |

## Event fields

| Portuguese | English |
|---|---|
| `pagina` | `page` |
| `caixa` | `block` |
| `digital` | `fingerprint` |
| `texto` | `text` |
| `foto` | `snapshot` |
| `autor` | `author` |
| `quando` | `when` |
| `dados` | `data` |
| `tipo` | `type` |

## Event types

| Portuguese | English |
|---|---|
| `aprovacao` | `approval` |
| `pedido` | `request` |
| `comentario` | `comment` |
| `resposta_decisao` | `decision_reply` |
| `pedido_estado` | `request_state` |
| `complemento` | `supplement` |

## Cycle states

| Portuguese | English | Label the reviewer sees (still pt-BR) |
|---|---|---|
| `aberto` | `open` | Aguardando triagem |
| `aprovado` | `approved` | Aprovado |
| `recusado` | `rejected` | Recusado |
| `pergunta` | `question` | Pergunta para quem pediu |
| `analise` | `applying` | Em aplicação |
| `aguardando` | `waiting` | Em aplicação · dúvida |
| `aplicado` | `applied` | Aplicado |

Request categories follow the same path: `duvida` → `doubt`.

## The database

| Portuguese | English |
|---|---|
| table `eventos` | `events` |
| table `trechos` | `blocks` |
| table `dependencias` | `dependencies` |
| table `pendencias` | `issues` |
| column `tipo` | `type` |
| column `pagina` | `page` |
| column `caixa` | `block` |
| column `digital` | `fingerprint` |
| column `texto` | `text` |
| column `foto` | `snapshot` |
| column `autor` | `author` |
| column `quando` | `when` |
| column `dados` | `data` |

⚠️ Renaming a table or a column **breaks stored data**. Every change here needs a migration that
reads the old format — the same principle as `review/core/legacy.js`: history does not get
rewritten.

## Already renamed in the core (`2026-09-19`)

No Portuguese name is left in `review/core/`. Kept here so an old branch or an old commit message
can still be read.

| Portuguese | English | Where |
|---|---|---|
| `criarCiclo` | `createCycle` | `cycle.js` |
| `estadoAtual` | `currentState` | `cycle.js` |
| `situacao` | `status` | `cycle.js` |
| `podeIr` | `canGo` | `cycle.js` |
| `existe` | `exists` | `cycle.js` |
| `doAgente` / `estadosDoDono` | `agentStates` / `ownerStates` | `cycle.js` |
| `exigeMotivo` / `exigeCommit` | `requiresReason` / `requiresCommit` | `cycle.js` |
| `aceitaComplemento` | `acceptsSupplement` | `cycle.js` |
| `rotulo` | *(left the core)* | the edge reads `table.states[x].label` |
| `criarPapeis` | `createRoles` | `roles.js` |
| `ehOwner` / `ehAdmin` | `isOwner` / `isAdmin` | `roles.js` |
| `podeAprovar` / `podeTriar` | `canApprove` / `canTriage` | `roles.js` |
| `de` (someone's role) | `roleOf` | `roles.js` — returns `owner`, `admin` or `other` |
| `estourou` | `overLimit` | `limits.js` |
| `commitValido` | `validCommit` | `limits.js` |
| `LIMITES` | `LIMITS` | `limits.js` |
| `normalizar` | `normalize` | `fingerprint.js` |
| `digitalDoTexto` | `fingerprintOfText` | `fingerprint.js` |
| `digitalDoElemento` | `fingerprintOfElement` | `fingerprint.js` |
| `textoDoElemento` | `textOfElement` | `fingerprint.js` |
| `TAMANHO` | `SIZE` | `fingerprint.js` |
| `lerConfig` | `readConfig` | `config.js` |

And the folders and files themselves: `revisão` → `review/`, `núcleo` → `review/core/`, `digital`
→ `fingerprint.js`, `ciclo` → `cycle.js`, `papéis` → `roles.js`, `limites` → `limits.js`,
`registro` → `store.ts`, `pessoas` → `users.ts`, `identidade` → `identity-iap.ts` and
`identity-password.ts`, `fonte` → `remote.ts`.
