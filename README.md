# Doc First

Documentation that tells you when it stopped being true.

You write documentation in HTML. Reviewers approve it block by block in the browser. Every approval
records who approved, when — and **which exact text** they approved. Change one letter and the
approval stops holding, because nobody approved the new text.

That last part is the whole point. Most documentation does not die from neglect; it dies because
**nothing tells you it went stale**. The document does not know the code changed. The use case does
not know the rule changed. The diagram does not know the screen changed.

## In two minutes

```bash
git clone https://github.com/doc-first/doc-first
cd doc-first
REVISAO_OWNER=you@example.org docker compose up
```

Open `http://localhost:8080`. The first-access password is printed **once** in the log, and the
first login forces you to change it. There is no `admin/admin`: internal tools stay up for years.

You land on `examples/ola-mundo` — two pages that explain, in their own text, everything a page
needs to work here.

> Run that in an empty folder. A repository that already **uses** Doc First has a `doc-first`
> script at its root, and `git clone` refuses a folder name already taken by a file.

## The traffic light

Every block has a state, and the state is computed — never declared by anyone.

| | State | Meaning | What to do |
|---|---|---|---|
| ⚪ | not validated | nobody has looked yet | read and approve, or ask for a change |
| 🟢 | validated | approved, and nothing changed since | nothing |
| 🟡 | stale | **this** block's text changed after the ✓ | re-approve the new text |
| 🔴 | suspect | the text is unchanged, but something it **depends on** moved | check whether it still holds |

Red is what separates this from version control with a badge. It catches the case nobody notices
while reading the page — because **on the page, nothing changed**.

```
  "The response deadline is 24 hours."       ← someone edits this…
  "Since the deadline is short, the alert
   fires the same day."                      ← …and this turns red, untouched
```

**Red is a question, not an error.** The engine does not know the block became wrong; it knows it
became suspect. Treating it as an error would make people switch the check off at the first false
positive, and then the whole lock is pointless.

## For your own documentation

```bash
docker run -p 8080:8080 -v data:/data \
  -v "$PWD/my-docs:/content" -e REVISAO_SITE=/content \
  -e REVISAO_OWNER=you@example.org ghcr.io/doc-first/doc-first
```

`my-docs/` needs a `doc-first.json` saying where the pages live. Copy `examples/gabarito/` and edit
— it is a template with eleven sections: kinds, discovery, roles, design system, screens, decisions,
stack, data model, use cases, architecture (C4) and contracts.

## What your page needs

The review panel **switches itself off silently** if any of these is missing. On purpose: better
absent than wrong.

| # | Requirement |
|---|---|
| 1 | an element with class `doc-titulo__cod` holding the page code (`A01`) |
| 2 | a `<main>`. Nothing outside it is reviewable |
| 3 | every block carrying `data-id` **and** `data-cod` |
| 4 | `data-cod` shaped `section.number` (`1.2`) |
| 5 | the block with `position: relative` in CSS |
| 6 | **everything JavaScript injects inside `<main>` marked `data-revisao-ui`** |
| 7 | `common.js`, `review.js` and `core-web.js`, in that order |
| 8 | `painel.css` |

Number 6 is the one that hurts when forgotten: injected text enters the fingerprint and knocks down
**every** approval on the page at once, with no error at all.
`examples/ola-mundo/paginas/A01.html` has it commented at the exact place it happens.

## Kinds of content

Every reviewable piece is of one kind, and each kind knows what it demands of itself.

| Kind | Demands | Why |
|---|---|---|
| `image` | an `alt` | text inside an image never enters the fingerprint; the description is its only reviewable part |
| `diagram` | to be text, not an image | a PNG has no useful fingerprint: recompressing changes the bytes without changing the meaning |
| `table` | a header row | without `<th>` the table is unreadable by a screen reader |
| `decision` | an owner and a deadline | without them it is not a pending decision, it is a lost one |
| `colors` | the value | "primary blue" is not a value; `#0883C5` is |
| `list` | two items | a one-item list is a paragraph in bad clothing |
| `rule` | the test that defends it (`data-prova`) | a rule nobody proved is a rule nobody can check |

Plus `title`, `subtitle`, `text`, `box`, `config`, `contract`, `model` and `rationale` — fifteen in
all, in `review/core/kinds.js`. A kind never changes who approves or how the fingerprint is
computed — only what is demanded before a block counts as ready.

## How it is stored

Nothing is erased. Every ✓, every request, every rejection becomes a new event with author and
timestamp. The database refuses `UPDATE` and `DELETE` — through triggers, not through discipline.

Events live in a SQLite file on the `/data` volume by default. The same interface takes Postgres,
MySQL or a hosted document store.

There is also an **index** — blocks, kinds, dependencies, issues — rebuilt on demand. That one is
*not* truth and can be deleted without loss: the truth is the file, versioned in git, which is what
has diffs, history and authorship.

## Where the users live

The people who log in are stored separately from the events, and the storage is **pluggable**, the
way Keycloak's is: a file to run it on a laptop, a real database for a deployment whose instances
come and go. One variable, `REVISAO_USERS`:

| `REVISAO_USERS` | Where people and sessions go |
|---|---|
| *(not set)* | SQLite, at `REVISAO_PESSOAS` or `./dados/pessoas.db` |
| `sqlite:/data/users.db` | SQLite in that file |
| `firestore` | Firestore, in the project named by `REVISAO_PROJETO` |
| `postgres://user:pass@host/db` | Postgres. `postgresql://…` works too |

`REVISAO_PESSOAS` still names the SQLite file and will keep doing so — it is published, it is in
the compose file people copied, and breaking it would lock someone out of their own tool.

Postgres needs the `pg` package, which is an **optional** dependency: it is not downloaded unless
you ask for it, and it is imported only when a `postgres://` URL is configured. Nobody running on
SQLite pays for a driver they will never open.

> ⚠️ **On Cloud Run, do not leave this on SQLite.** The disk there is ephemeral and per instance:
> an access created today disappears when the platform recycles the instance, with **no error and
> no log**. The person whose account was created simply stops getting in, and nobody connects the
> two events. Use `firestore` or `postgres://…`.
>
> The service now says so itself: when it starts on a runtime that looks ephemeral (`K_SERVICE`,
> which Cloud Run sets) with people kept in a file, it logs a `WARNING` naming what will be lost
> and what to set instead. It **warns and starts** — the configuration works, it just forgets
> people, and refusing to come up would be a worse surprise.

All three implementations are checked by **the same suite**,
`review/tests/users-conformance.test.js`. A store that does not pass it is not supported. What that
suite could not run, it says so in its own output rather than passing quietly — see
[What does not work yet](#what-does-not-work-yet).

## The tool

```bash
docker run --rm -v "$PWD:/work" -w /work --user "$(id -u):$(id -g)" \
  ghcr.io/doc-first/doc-first node /app/review/cli/doc-first.ts list
```

| Command | What it does |
|---|---|
| `lights` | the state of the whole documentation: 🟢 🟡 🔴 ⚪ |
| `if-i-touch <id>` | what will need checking if you edit this |
| `index` | rebuilds the index: kinds, dependencies, what is missing |
| `sync` | pulls in the ✓ given on the site |
| `list` | approved requests, waiting to be applied |
| `show <id>` | the request, the text then, and the text now |
| `impact <id>` | where else the subject shows up, and what is validated |
| `check` | a validated block that changed, and an approval with no trail |
| `kinds` | the catalogue of content kinds |

The commands used to be Portuguese (`listar`, `ver`, `conferir`, …), and those names still work —
silently, and doing exactly the same thing. They are a published interface: dropping them would
break scripts and pre-commit hooks that already exist, so it will only happen in a major version.

The separation of powers is tested: **the agent applies, but refuses to approve.** Triage belongs to
whoever owns the documentation.

## Language

The engine ships in English. Messages the reviewer reads go through `review/core/i18n.js`, so adding
a language is copying one file — see `examples/locales/`.

The **login screen** is in there too. The server renders its text before sending the page, in the
language the browser asked for, so there is no untranslated flash and the labels are there with
JavaScript off. With no preference stated, English: set `idioma` in `doc-first.json` (or
`REVISAO_IDIOMA`) to change what the project defaults to.

Logs stay English always: a log is evidence, and evidence that changes wording by locale cannot be
grepped.

## What does not work yet

Honest, as of `2026-09-20`:

- **The side menu and the consolidated triage queue.** Triage works inside the panel, block by
  block; what is missing is the "every open request in the project" view.
- **Generation.** Today a human writes and the tool keeps it honest. The intent is the tool writing
  the first draft from the business, and the human correcting.
- **Generated diagrams.** Diagrams are text and enter the lock, but nothing produces them yet.
- **Automatic dependencies.** Dependencies are declared by hand. The tool should propose them: two
  blocks talking about the same term probably depend on each other.
- **AI assistance.** Each project with its own key. Designed, not built — `.env.example` already
  holds the place.
- **Identity beyond password and an identity proxy.** OIDC, Google and LDAP are missing; the
  interface is there, the piece is not.
- **SQLite loses users on Cloud Run.** Not a bug to fix — a property of the platform. The disk is
  ephemeral and per instance, so `pessoas.db` goes away with the instance, silently. The fix is
  configuration (`REVISAO_USERS=postgres://…` or `firestore`); what is missing is the service
  refusing to start in that combination instead of trusting whoever deploys it to have read this.
- **The Firestore user store is proved by code review, not by execution.** There is no emulator in
  this project's test environment, so its conformance tests skip, loudly. Postgres and SQLite do
  run for real.
- **Some configuration keys are still Portuguese** (`conteudo`, `REVISAO_*`). The commands have
  been renamed already, and their old names still work.

## Licence

MIT. See `LICENSE`.
