# The method

> `2026-09-20`. This describes **what exists today**, not the intention. Anything not built yet is
> in "Not built yet" at the end, and in the README under the same name.

Doc First is an engine, not a project. Everything here has to hold on a documentation project it
has never seen: nothing in the engine names a company, a product or a person — whatever varies is
configuration.

## The cycle

```
Write (agent + owner)  →  Publish when the owner says so  →  Review (people, in the browser)
        ↑                                                            │
        └──── Apply, after impact analysis (agent) ←──── Request recorded
```

| Step | Who | How |
|---|---|---|
| **Write** | the agent, with the owner | HTML pages, one `data-id` per block, in the standard of whoever adopts the method |
| **Publish** | the owner decides when | outside the engine: the content is a repository, and publishing it is that repository's business |
| **Review** | whoever has access | in the browser, block by block: **Approve · Ask for a change · Comment** |
| **Apply** | **the agent only**, with the owner | reads the request, measures the impact, asks about anything ambiguous, applies it, commits with `Pedido:` and `Solicitado-por:`, closes the request |
| **Learn** | the agent | a repeated correction becomes a written lesson in the adopting project |

## The six rules

1. **Git is the source of the content.** Nothing changes a page outside a commit. The site never
   edits content — it only records what people said about it.
2. **Review is a log of events that never get erased.** Approved, asked, commented, answered,
   applied, refused: each with **who** (verified identity), **when** (the server's clock), **where**
   (page and block) and **the fingerprint of the text** at that instant.
3. **An approval is for a text, not for a block.** Change the text and the approval drops on its
   own — nobody has to remember to drop it.
4. **Every change is born from a request or from a session with the owner**, and the commit says
   which.
5. **Impact before change.** The agent never applies a request without looking at everywhere else it
   touches.
6. **Minimum cost.** A container and a file. No managed database is required to start.

## The traffic light

Rule 3 gives you yellow. Rule 5, written down, gives you red.

| | State | Meaning |
|---|---|---|
| ⚪ | `none` | nobody has validated it yet |
| 🟢 | `valid` | validated, and nothing has changed since |
| 🟡 | `stale` | **this** block's text changed after the ✓ |
| 🔴 | `broken` | the text is unchanged, but something it **depends on** moved |

Red is the reason the method exists. It catches what nobody notices while reading the page, because
**on the page, nothing changed**: the deadline in section 2 was edited, and the sentence in section 7
that reasoned from that deadline is now standing on nothing.

It works because the ✓ records more than the block's own fingerprint. At the moment of approval,
`marcar()` also writes the fingerprint **each declared dependency had right then** (`depende` in the
record, `data-dependia-de` in the HTML). `stateOf()` compares those with today's. A dependency that
vanished counts as moved: the block is pointing at something that no longer exists.

Yellow beats red, deliberately. If the text itself changed, saying "something it depends on also
changed" adds nothing — re-approving the new text is the next step either way.

⚠️ **Red is a question, not an error.** The engine does not know the block became wrong; it knows it
became suspect. Treat it as an error and people switch the check off at the first false positive —
and then the whole lock is worth nothing.

Code: `review/core/validity.js` (`stateOf`, `trafficLight`, `dependentsOf`).
Commands: `doc-first lights`, `doc-first if-i-touch <id>`.

## Kinds of content

Every reviewable piece is of one kind, and each kind knows what it demands of itself. `title`,
`subtitle`, `text`, `list`, `box`, `table`, `image`, `diagram`, `colors`, `config`, `contract`,
`model`, `rule`, `rationale`, `decision` — fifteen, in `review/core/kinds.js`.

The kind is **declared** (`data-tipo`) or **inferred** from how the block was written (a `<table>`
is a table, a `<pre>` is a diagram). Inference exists so the method does not open by demanding:
documentation that already exists gets kinds without anyone rewriting anything.

⚠️ A kind **never** changes who approves, nor how the fingerprint is computed. It changes only
**what is demanded** before a block counts as ready. There is one lock, and it is the same for all
fifteen.

## Roles

The engine knows three: **owner**, **admin** and everyone else. Product roles — clinical lead,
manager, auditor — belong to whoever adopts the method, and usually come from their identity
provider. If the engine named a product role, it would stop being an engine.

| Who | Can |
|---|---|
| **owner** | exactly one, always the same. Everything, including granting admin |
| **admin** | everything the owner does, **except** being the owner or changing who that is |
| **anyone else with access** | see, ask for a change, comment, answer an open decision |

- **A single owner is an invariant, not a convention.** Zero or two owners **do not bring the
  service up**, with a legible message. It is tested.
- **The owner is an admin by consequence**, not by configuration — there is no way to strip their
  power by accident.
- **Only the owner's ✓ becomes a lock in the repository.** Anyone else's approval is recorded as an
  event, and stays an opinion.
- **A request from an owner or an admin is born approved.** Nobody triages themselves.

Code: `review/core/roles.js`. Configuration: `REVISAO_OWNER`, `REVISAO_ADMINS`.

## The request cycle

```
somebody asks ──► To triage ──► owner: Approve ──► agent: Applying ──► Applied (commit)
                     │  ▲
                     │  └── whoever asked adds detail
                     ▼
               owner: Reject (reason) · Ask ──► can be revisited and approved
```

- **Rejected can be revisited**: whoever asked adds detail and it goes back to "To triage".
- **Approved never goes back**, and takes no supplement. Changing something already approved is a
  **new request** linked to the previous one — even when it means returning to the earlier text.
- **Snapshot of the text**: every request and every approval keeps the text of the block at that
  instant. Git stays the version history; the snapshot shows *what* was approved or asked.

Which transitions are legal lives in one file, `review/cycle.json`, read by `review/core/cycle.js` —
server, CLI and browser all obey the same table.

## How the ✓ gets back into the repository

The owner validates **in the browser, not in the terminal**. The site does not write to the
repository; the agent closes the loop.

```
owner clicks ✓ ──► event in the store ──► doc-first sync
                                     ──► the approvals file + three attributes in the HTML
```

The approvals file is the project's, not the engine's: `conteudo.registro` in `doc-first.json` says
where it goes. Writing it inside the engine was a decision of the first project, and it came out.

| In the HTML | Holds | Without it |
|---|---|---|
| `data-validado` | who validated, and when | there is no ✓ |
| `data-digital-validada` | the text that was approved | there is no 🟡 |
| `data-dependia-de` | the ground it stood on at that moment | there is no 🔴 |

- **A stale ✓ does not lock.** If the text changed between the click and the sync, the command warns
  and ignores it: the lock exists only for the text they actually read.
- **Two fingerprints, on purpose.** `digital_texto` (SHA-256 of the visible text) is what the browser
  computes and the only one that matches the site. `digital` (SHA-256 of the HTML) is the only one
  that catches a change of **formatting** in a validated block. Keeping both ties the lock to the
  site without loosening it.
- **One implementation.** Browser, server and CLI import the same `review/core/fingerprint.js`. Two
  implementations of the same hash is two implementations that will drift.

## How the agent applies a request

```bash
node review/cli/doc-first.ts <command>     # --local to talk to the local server
```

1. **See** — `list` (only the ones the owner approved) and `show <id>`: what was asked, by whom, the
   text then and now, and whether the block is validated.
2. **Mark it under analysis** — `state <id> analise "…"`. Whoever asked sees it in the panel.
3. **Measure the impact** — `impact <id> --term "…"` for each subject in the request, and
   `if-i-touch <id>` for what the block holds up. Dependency of meaning counts: remove a use case,
   and whatever cited that use case is now suspect.
4. **Ask the owner** about anything ambiguous, and about anything touching a validated block — "only
   in this block, or in the other N as well?". If the answer belongs to whoever asked,
   `state <id> aguardando "question"`.
5. **Apply** it, then run `check` (a validated block changes only with the owner's ok) and
   `index`.
6. **Commit** with trailers:
   ```
   Pedido: <full id>
   Solicitado-por: <e-mail of whoever asked>
   ```
7. **Close** — `state <id> aplicado "what changed" --commit <sha> --blocks A01.2.1,A01.2.2`, or
   `recusado "reason"`.

**The separation of powers is tested:** the agent applies, and refuses to approve. Triage belongs to
whoever owns the documentation, and the API answers 403 to anyone else.

## The pieces

| Piece | Where | Note |
|---|---|---|
| The lock | `review/core/fingerprint.js` | one implementation, shared by browser, server and CLI |
| The traffic light | `review/core/validity.js` | ⚪ 🟢 🟡 🔴, computed — never declared |
| Kinds | `review/core/kinds.js` | fifteen, and what each demands of itself |
| The cycle | `review/cycle.json` + `review/core/cycle.js` | the legal transitions, in one table |
| Roles | `review/core/roles.js` | owner, admin, everyone else |
| Language | `review/core/i18n.js` + `review/locales/` | the reviewer's messages; logs stay English |
| Server | `review/api/server.ts` | Node 24 running TypeScript directly — no build step |
| Event store | `review/api/store-sqlite.ts` | SQLite on `/data`; the interface takes other stores |
| Index | `review/api/index-store.ts` | derived, disposable, rebuilt by `index` |
| Identity | `review/api/identity-password.ts`, `identity-iap.ts` | password, or a signed header from an identity proxy |
| Review panel | `review/web/` | React, bundled into `painel-react.js` |
| The agent's tool | `review/cli/doc-first.ts` | the commands above |
| Example content | `examples/gabarito/`, `examples/ola-mundo/` | a template with eleven sections, and a two-page tour |

**Configuration** (all of it optional except the first):

| Variable | What it is |
|---|---|
| `REVISAO_OWNER` | who approves. Their ✓ is what becomes a lock |
| `REVISAO_ADMINS` | e-mails, comma separated |
| `REVISAO_SITE` | where the pages live (default: what `doc-first.json` says) |
| `REVISAO_SQLITE` | the events file (default: `./dados/eventos.db`) |
| `REVISAO_IDENTIDADE` | `senha`, `iap`, or `dev` — never `dev` outside Development |
| `REVISAO_IDIOMA` | the project's default language, when the reader has no preference |

## Truth and index

Two databases, and only one of them is truth.

- **`events`** is fact. Triggers refuse `UPDATE` and `DELETE` — through the database, not through
  discipline. Nothing is ever erased; a correction is a new event.
- **`blocks`, `dependencies`, `issues`** are derived. `index` wipes and rewrites them inside a
  transaction. Delete the file and you lose nothing.

They are separate because files answer some questions badly — "every suspect diagram in the
project", "every decision with no owner", "what breaks if I touch this". Those are database
questions. But if both were truth, one day they would disagree, and there would be no way to know
which to believe.

## Language

The engine is in English. Messages the reviewer reads go through `review/core/i18n.js`; adding a
language is copying one file (`examples/locales/` has a worked one).

Three audiences, and they are not the same:

| Who | Reads | Language |
|---|---|---|
| the reviewer | the panel, in the browser | theirs — person, then `Accept-Language`, then the project's default |
| whoever operates | logs | English, always. A log is evidence, and evidence that changes wording by locale cannot be grepped |
| whoever installs | boot errors | English, hard-coded. A service refusing to start has no session and no chosen language yet |

A missing key returns the key itself. A page showing `block.approved` is ugly and diagnosable in a
second; a page showing nothing is a bug someone chases for an afternoon. `missing()` lists every
hole, and a test calls it.

## Not built yet

Honest, `2026-09-20`:

- **The consolidated triage queue.** Triage works inside the panel, block by block; the "every open
  request in the project" view is missing.
- **Generation.** Today a human writes and the tool keeps it honest. The intent is the tool writing
  the first draft, and the human correcting it.
- **Generated diagrams.** `diagram` exists as a kind and enters the lock; nothing produces one.
- **Automatic dependencies.** Dependencies are declared by hand. The tool should propose them: two
  blocks using the same term probably depend on each other.
- **AI assistance.** Designed, not built. Each project brings its own key.
- **Identity beyond password and identity proxy.** OIDC, Google, LDAP: the interface is there, the
  piece is not.
- **Some configuration keys are still Portuguese** (`conteudo`, `REVISAO_*`). The commands have
  been renamed already, and their old Portuguese names still work as aliases.

## What is not in here, and why

⚠️ **No survey of similar methodologies** until the engine stands on its own. Build first, compare
after — comparing first turns into designing for a comparison table.

**Who can implement is still not a permission.** Approving is: it is the owner's, and the code
enforces it. Running the agent is whoever has the repository in hand. That is a real gap, it is
known, and it is not being papered over.
