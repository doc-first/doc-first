# Contributing

Thank you for looking. A few things are true about this project that are worth knowing before you
spend time on it.

## How this is built

**This code is written with an AI agent and reviewed by a human.** Every commit carries
`Co-Authored-By`, and that is deliberate — you can see exactly how each line got here.

That is not an excuse for anything. The bar is the opposite: because the code is generated fast,
the proof has to be stronger than usual. So:

- **Every lock is verified by mutation.** Not "there is a test" — the test was broken on purpose to
  watch it fail. The fingerprint check, the traffic light, the missing-translation check, the
  site-up check: each one was sabotaged, observed failing, and restored. If a test cannot fail, it
  is not a test.
- **Comments explain why, not what.** Most of them record an accident that actually happened, and
  they exist so nobody "simplifies" the line back into the bug.
- **Nothing ships without the HTTP contract green.** It starts a real server and talks to it.

If you think a decision here is wrong, the commit message probably says why it was made. Argue with
that.

## What a change needs

| | |
|---|---|
| Tests | `npm test` — green, and a new test for what you changed |
| Types | `npx tsc --noEmit` — clean |
| Contract | `bash review/test-contract.sh` — it starts a server and speaks HTTP |
| Lint | `npx eslint review` |

If your change touches a lock — the fingerprint, the traffic light, approval validity — **break your
own test on purpose and confirm it fails.** Then say so in the pull request. A green test nobody
has seen fail proves nothing.

## Language

Everything in the code is English: identifiers, comments, file names, table names, column names.

Messages a reviewer reads go through `review/core/i18n.js` and live in `review/locales/`. Logs stay
English always — a log is evidence, and evidence that changes wording by locale cannot be grepped.

Some configuration keys are still Portuguese (`conteudo`, `REVISAO_*`), left over from where this
grew. They are being renamed. The CLI commands have already moved (`sincronizar` → `sync`), and the
old names stay accepted as aliases — see the table at the top of `review/cli/doc-first.ts`.

## Commit messages

Long ones. The first line says what changed, and the body says **why it was needed** — with the
accident, if there was one. A message that could have been written without running the code is not
worth the line it takes.

A hook enforces the shape: first line between 15 and 72 characters, no trailing period, blank
second line, and no "fixes", "adjustments" or "wip".

## What is not welcome

- A pull request that adds a dependency without saying what it replaces.
- A test that only proves the happy path.
- A rename that mixes into a behaviour change — they become one unreadable diff.
