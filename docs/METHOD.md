# Doc First — rich, collaborative, traceable documentation before the app

> Proposal · `2026-09-17` · born out of practice, on a real product documentation project.
> The idea: before building the project or the app, build the **documentation of the full system**,
> reviewed by whoever knows the subject, with a record of **who asked, when, what and why**.
> The first use was a healthcare product. The method has to be replicable on another project
> without rewriting anything.

## The cycle

```
Write (agent + owner)  →  Publish on demand  →  Review (people, on the site)
        ↑                                              │
        └──── Apply with impact analysis (agent) ←── Request recorded
```

| Step | Who | How |
|---|---|---|
| **Write** | the agent, with the owner | pages in the approved standard (`PADRAO-DOCUMENTO.md`), numbered blocks, lessons (`LICOES-DE-REVISAO.md`) |
| **Publish** | the owner decides when | `gh workflow run publicar-leitura.yml` — batches the changes, publishes them in one go |
| **Review** | reviewers with access (e.g. the domain specialist) | on the site, on every block: **Approve · Ask for a change · Comment**; answer open decisions |
| **Apply** | **the agent only**, with the owner | reads the request, **analyses the impact** (the term on other pages, a use case other parts rely on, approvals that will drop), asks about anything ambiguous, applies it, commits with `Pedido:` and `Solicitado-por:`, marks the request as applied |
| **Learn** | the agent | a pattern of correction becomes a lesson; a reviewer's preference becomes memory |

## Rules of the method

1. **Git is the source of the content.** Nothing changes a page outside a commit. The site never
   edits content.
2. **Review is a log of events that do not get erased.** Approved, asked, commented, answered,
   applied, refused — each one with **who** (verified identity), **when** (server), **where** (page
   and block) and **the fingerprint of the text** at that moment.
3. **An approval is for a text, not for a block.** Change the text and the approval drops on its own.
3b. **Approving belongs to owner and admin** (design decision, `2026-09-17`). Their ✓ is not an
   opinion: it becomes a **lock in the repository** and sends the agent off to apply. A reviewer
   **asks for a change, comments and answers a decision**; the API refuses `aprovacao` from anyone
   who is not an admin (403), and the site does not even show the button. *Today there is no admin
   besides the owner — in practice, the one who approves is the owner.*
3c. **A request from an owner or an admin is born approved.** Nobody triages themselves. It holds
   the same for a request made on the site and for one made straight into the conversation with the
   agent.
4. **Every change is born from a request or from a session with the owner**, and the commit says
   which.
5. **Impact before change.** The agent never applies a request without looking for everywhere else
   it touches.
6. **Minimum cost.** Everything inside free quotas while it is an internal tool.

## The request cycle (the owner triages before the agent)

```
reviewer asks ──► To triage ──► owner: Approve ──► agent: Applying ──► Applied (commit)
                     │  ▲
                     │  └── reviewer/owner adds detail
                     ▼
               owner: Reject (reason) · Ask ──► can be reviewed again and Approved
```

- **Who triages** = **owner or admin** (`Papeis.cs`). The API refuses anyone else (403). Today only
  the owner exists.
- **Rejected can be revisited**: whoever asked adds detail (it goes back to "To triage"), or the
  owner approves it straight away.
- **Approved never goes back** to rejected, and takes no supplement. Changing something approved =
  **a new request** linked to the previous one (`dados.relacionado`), even if it means going back to
  the earlier text.
- **Snapshot of the text**: every request and every approval keeps the text of the block at that
  instant. Git remains the version history; the snapshot shows *what* was approved or asked.
- Triage page: the project's request queue.

## System roles (`2026-09-17`)

"If the documentation is part of the system, we are already talking about **roles**." So review has
no list of people of its own: it uses the system roles, which **go to Keycloak** once it exists —
and then only `Papeis.cs` changes, because nobody else asks who is who.

| Who | Where it comes from | Can |
|---|---|---|
| **owner** | the methodology | **one, always the same** — the founding architect (the project owner). Everything, including creating the roles |
| **admin** *(project role)* | a project role carrying the capability to approve | everything the owner does, **except being the owner** or changing who that is. Today: none |
| **specialist** *(project role)* | a role with the `founder` tag — whoever answers for the domain | see the whole Fundamental, ask for changes, comment, answer decisions |

- **A single owner is an invariant, not a convention:** a configuration with zero or two owners
  **does not bring the service up**, with a legible error message. It is tested.
- **The owner is an admin by consequence**, not by configuration — there is no way to strip their
  power by accident.
- Today there is no admin at all, so "only the owner approves" stays true without needing an
  exception in the code.

**From the methodology, only `owner` and `founder`** (`2026-09-17`). **`admin`, `clinical lead`,
`operator`, `auditor` — those are roles OF THE PROJECT**, of whoever applies the method. Whoever
adopts Doc First on another project brings their own roles and receives only these two pieces:

| Piece | Whose | Rule |
|---|---|---|
| **owner** | **methodology** | exactly one, always the same. It is who **creates the roles**. Zero or two **do not bring the service up** |
| **the `founder` tag** | **methodology** | it sits **on the role, not on the person**. It grants the power to **see the whole documentation** |
| **role** | the project's | data the owner creates and names. On a healthcare project, for example: admin, clinical lead, manager, operator, doctor, nurse, auditor |
| **capability** | the methodology defines, the project assigns | **see · ask · approve**. The `founder` tag grants see and ask; **approve** belongs to the owner and to whoever they grant it. On a healthcare project, the one who approves is the `admin` |

- The tag belongs to the role and not to the person because that way the **second** holder of that
  role also sees the documentation, without having to be called a founder or to get an exception.
- ⚠️ **Known bottleneck (`2026-09-17`):** today approving **and** implementing both go through the
  owner. `admin` already solves the approving half — what is missing is designing who can
  **implement** (run the agent), which today is not a system permission but whoever has the
  repository in hand. **To be thought through later**, without blocking anything now.
- **Who sees the Fundamental** is whoever holds a role with the **`founder` tag** — the tag sits on
  the role, not on the person, so the second clinical lead sees it too. See, ask and approve are
  three separate powers: the tag grants the first two. Model in
  `MODELO-tenancy-e-compartilhamento.md`.
- **The engine only knows owner, admin and "other".** The **product** role of whoever is not an
  admin — Manager, the business roles of each product — belong to THE PROJECT, and usually come
  from the identity provider. If the engine named a product role, it would stop being an engine.

## How the owner's ✓ gets back into the repository

The owner **validates on the site, not in the terminal** (design decision, `2026-09-17`):
"validation happens on the site; here we only build". The site does not write to the repository —
the one who closes the loop is the agent:

```
owner clicks ✓ on a block ──► `aprovacao` event in Firestore ──► agent: doc-first sincronizar
                                                            ──► docs/validacoes.json + data-validado in the HTML
```

- `node review/cli/doc-first.ts sincronizar` — runs at the start of every session (the resumption
  routine calls it).
- **Only the owner's ✓ locks.** A reviewer's approval is recorded, but it does not become a lock in
  the repository.
- **A stale ✓ does not lock.** If the text changed after the click, the command warns and ignores it
  — the lock only exists for the text they actually read.
- **Two fingerprints, on purpose.** `digital_texto` (SHA-256 of the visible text) is the one the
  browser computes and the only one that matches the site; `digital` (SHA-256 of the HTML) is the
  only one that catches a change of **formatting** in a validated block. Keeping both ties the lock
  to the site without loosening it.
- `validar` in the terminal still exists, for when the site is down. The origin is recorded
  (`origem: site | terminal`).

## How the agent applies a request

Tool: `python3 review/cli/doc-first.ts` (cloud) or `--local` (the `rodar-local.sh` server).

1. **See** — `doc-first listar` (only the ones **approved by the owner**) and `doc-first ver ID`:
   what was asked, by whom, the current text of the block, whether the block changed since the
   request, and whether it is **validated** by Ale.
2. **Mark it under analysis** — `doc-first estado ID analise "Recebido…"` (the reviewer sees it in
   the panel).
3. **Analyse the impact** — `doc-first impacto ID --termo "…"` for each term/subject in the request:
   blocks on the pages (flagged as validated and approved), real screens, documents, decisions.
   Think about dependency of meaning too (remove a use case → what uses that use case).
4. **Ask the owner** about anything ambiguous, or anything touching a validated block ("only in this
   block, or in the other N as well?"). If the decision belongs to the reviewer,
   `estado ID aguardando "question"`.
5. **Apply** it in the repository, run `marcar_ids.py` if a block was created, run
   `doc-first conferir` (a validated block gets changed only with the owner's ok — re-validate), and
   check the screenshots.
6. **Commit** with trailers:
   ```
   Pedido: <full id>
   Solicitado-por: <reviewer's e-mail>
   ```
7. **Close** — `doc-first estado ID aplicado "what changed" --commit SHA --caixas D01.2.1,D01.2.2`
   (or `recusado "reason"`).
8. **Learn** — if the request reveals a preference or a pattern, add a lesson to
   `LICOES-DE-REVISAO.md` or to memory.
9. **Publish** only when the owner asks — until then the reviewer sees "Applied" but the new text is
   not on the site yet.

## Technical pieces (replicable)

| Piece | Where | Note |
|---|---|---|
| Pages and standard | `front/telas/`, `front/css/doc.css`, `docs/PADRAO-DOCUMENTO.md` | copy to another project |
| Numbering and lock | `front/marcar_ids.py`, `review/cli/doc-first.ts` | a block with a stable code and a fingerprint |
| Index and decisions | `front/gerar_index.py`, `docs/decisoes-em-aberto.json` | |
| Review service | `review/` — minimal API in .NET + static site in the same container | identity comes from the IAP (signed JWT) |
| Events | Firestore, `(default)` database (free quota), `eventos` collection (insert only) | |
| Publishing | `.github/workflows/publicar-leitura.yml` (manual), WIF with no key | |
| Access | `publicar/liberar.sh` | reader/reviewer by e-mail |
| The agent's tool | `review/cli/doc-first.ts` | listar, ver, impacto, estado, resumo |

## Engine and content — separate them from now on (`2026-09-17`)

Doc First belongs to no project: it is an **engine**. The intent is to package it and distribute it
to the community, with the first project as a use case, not as an owner. That is why the boundary
gets marked **while it is being built**, not in a refactor at the end — separating later costs far
more, and never happens.

| | Engine (leaves with the method) | Of this project (stays) |
|---|---|---|
| Method | the request cycle, the lock by fingerprint, "only the owner approves", events that do not get erased | — |
| Code | `review/` (API + `doc-first`), `review/cli/doc-first.ts`, `marcar_ids.py`, `front/js/review.js` | `front/telas/*.html`, `docs/*.md`, `docs/decisoes-em-aberto.json` |
| Identity and roles | IAP + `Papeis.cs` (`REVISAO_OWNER`, `REVISAO_ADMINS`) | the real e-mails |
| Brand | — | theme, icons, product name, typography |

**The rule for whoever writes code here:** nothing in the engine may name a project, a client, a
care pathway or an e-mail — whatever varies becomes configuration (as `REVISAO_OWNER` and
`REVISAO_ADMINS` already are). When something in the engine needs to know about the product, the
product passes the value in; the engine does not go looking for it.

⚠️ **No survey of similar methodologies** before the engine exists — build first, compare later, if
it comes to that.

## Slices of construction

1. **Foundation** — API, IAP identity, event database. *(done, published)*
2. **On the site** — approve and ask for a change, with state. *(done, not published)*
2b. **Owner triage** — approve, reject, ask; supplements; snapshot of the text. *(done, not
   published)*
3. **Agent** — `doc-first` and the impact analysis flow. *(done)*
4. **Decisions** — answering open decisions from the site.
5. **Navigable prototype** — screens wired together with fake data.
6. **Packaged method** — a repository template and a guide, with the engine already separated from
   the content (see "Engine and content"), to distribute to the community.
