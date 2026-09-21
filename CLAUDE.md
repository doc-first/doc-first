# Working on Doc First

Read this before changing anything. It is short on purpose, and every rule in it was paid for by a
real mistake in this repository — most of them in its first week.

## What this is

**An engine, not a project.** Doc First is the review machinery — fingerprints, the traffic light,
the approval lock, the panel, the CLI — distributed as a public Docker image. Documentation projects
**consume** it: they keep their own content and mount it into the image, the way Keycloak is used.

It names no company, no product and no person. Whatever varies is configuration in the adopting
project's `doc-first.json`. If you find yourself writing a client's name, colour or e-mail in here,
it belongs in their config instead.

Start with `README.md`, then `docs/METHOD.md` (what exists today), `docs/IMPACT.md` and
`docs/BUGS.md` (designs, partly built — each ends with an honest built / not-built table).

## The rules that do not bend

**1. Nothing in Portuguese.** Not an identifier, a comment, a string, a test name, a column or a
commit message. The repository is public, and someone who opens it and sees another language closes
the tab. `scripts/check-language.sh` enforces comments in CI.
*Exceptions, all declared:* the translated values in `review/locales/pt-BR.json` and `es.json`;
event keys and state values that are published contract (`aprovacao`, `pedido_estado`, `aberto`…),
translated on read by `review/core/legacy.js`; the `data-*` attributes; `REVISAO_*` variables; and
the old command names, which survive as silent aliases.

**2. Green is not proof.** A passing suite is not the same claim as "it works". Four times this
week the suite was green while the thing was broken — the server did not boot, the traffic light
called every approval stale, the local-run script exited before starting, the security headers
were missing on the one page they protect. None of those had a test that ran that path.
So every change with logic gets a **mutation**: break it on purpose, watch a *named* test fail,
restore it. If nothing fails, the test proves nothing and needs fixing before the change lands.
When there is no logic to mutate — a pure removal, a translation — say so instead of inventing one.

**3. The five proofs, before every commit.**
```bash
npx tsc --noEmit
npx eslint review
npm test
bash review/test-contract.sh          # must end in "all good"
bash scripts/check-language.sh --comments=en $(git ls-files '*.ts' '*.js' '*.sh')
```
The pre-commit hook is deliberately fast and does **not** run the contract test. `npm test` is unit
only and **never boots the server**. Run the contract test yourself.

**4. Comments say *why*, not *what*.** The code already says what. Keep the reasoning, the rejected
alternative and the bug that taught the lesson — that is what this codebase's comments are for, and
it is how the next reader avoids repeating the mistake.

## Git

- **Never `git add -A`**, and never while another agent is working. It absorbed another agent's
  half-finished work into an unrelated commit twice. Add by path.
- **Parallel work goes in a worktree:** `bash scripts/worktree.sh <name>`. Two agents in one tree
  overwrite each other. The script links `node_modules` — replace the link with a real copy before
  installing anything, or you write into the main tree.
- ⚠️ **Never run `git init` with an inherited `GIT_DIR`**, which is what you get inside a git hook.
  A test did that once, wrote `bare = true` into the main repository's config, and stopped all work
  for nine hours. `review/core/git.js` strips the `GIT_*` variables; use it, and the test helper in
  `review/tests/git.test.js`, rather than improvising.
- `main` is protected: linear history, and the `testar` check is required. No force push.

## Invariants the security of the product rests on

Each has a test. If you change the code around one, run the contract test and read it.

- **Exactly one owner**, and it comes from `REVISAO_OWNER`, never from a database column. Zero or two
  and the service refuses to start.
- **Nobody but the owner resets or creates the owner's account.** Both routes are guarded, because
  guarding only one left the other open — an admin could create the owner's account during a handover
  and read the generated password out of the response.
- **Nothing is erased.** Events refuse `UPDATE` and `DELETE` by trigger. People are *disabled*, never
  deleted, and disabling drops the open session.
- **Only the owner's ✓ becomes a lock.** An agent may *close* an impact — "this change did not reach
  here" — and never *approve* — "this text is correct".
- **The theme is untrusted input.** It lands inside CSS and HTML. Colours are validated against a
  known format; interpolating a raw string lets `red; } body { display:none } /*` through.

## Running it

```bash
bash review/run-local.sh                              # straight in, no login
bash review/run-local.sh --login --site examples/gabarito   # the real sign-in screen
```
Data goes to a throwaway folder wiped on every start — working on the engine cannot touch anybody's
real approvals. The first-access password is printed once, in the log.

⚠️ If the port is taken, the OLD process keeps answering and you end up testing the previous build
without knowing it. `run-local.sh` refuses to start rather than lie; stop the process **by port**,
not by name.

## Releasing

Tags are `vMAJOR.MINOR.PATCH`, and **a tag must point at a commit whose CI is green** — once one
didn't, and the next version existed only to say "use this one instead".
`gh workflow run publicar-imagem.yml -f versao=X.Y.Z` publishes `ghcr.io/doc-first/doc-first:X.Y.Z`.

Projects that consume the engine **pin** a version. A new command or behaviour reaches them only
when they move the pin — so change a caller of a new feature in the same commit that bumps the
version that contains it, never before.
