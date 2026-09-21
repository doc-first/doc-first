---
name: doc-first
description: The Doc First methodology — reviewable documentation with traceable approval. Use it when resuming work on the documentation, when applying a reviewer's request, when syncing approvals from the site, or when someone asks how the method works. Also when starting to document a new product with this method.
---

# Doc First — documentation that is reviewed, not just written

This file lives **inside the repository**. Whoever clones the project gets the method, the tool
and the agent together — before, the skill lived outside and the method arrived without the agent
that runs it.

## What the method is, in five lines

Documentation is written **before** the code, and reviewed by whoever understands the subject, not
whoever programs. Every block has a stable code and a **fingerprint of the text**: the approval is
for that text, and drops on its own if the text changes. Reviewers **ask for a change** on the
site; **only the agent makes the change**, with impact analysis and a traceable commit. Git is the
source of the content; the site never edits it.

## When resuming work — do it in this order

```bash
node review/cli/doc-first.ts sincronizar   # brings in the ✓ the owner gave on the site
node review/cli/doc-first.ts listar        # approved requests, ready to apply
node review/cli/doc-first.ts conferir      # did anything validated change without permission?
```

Tell the owner, in a few lines: how many new blocks were validated, how many requests are ready to
apply, and from whom. **Never offer to validate block by block in chat** — validation happens on
the site.

## When applying a request

1. `doc-first ver <id>` — what was asked, the text then and now, and the conversation.
2. `doc-first estado <id> analise "Received…"` — the reviewer sees the progress in the panel.
3. `doc-first impacto <id> --termo "…"` — **everywhere else the subject shows up**. Never change
   anything without this: the command marks which blocks are **validated**, and those need the
   owner's permission to change.
4. Ask about anything ambiguous. A misunderstood request turns into two requests.
5. Apply it, with a commit that carries the trailers `Pedido: <id>` and `Solicitado-por: <e-mail>`.
6. `doc-first estado <id> aplicado "Done" --commit <sha> --trechos D01.1.4,D02.3.1`
7. Add the lesson to the Traps section below, if the fix teaches a rule that is not written yet.

## The rules that are not up for negotiation

1. **Git is the source.** Nothing changes content outside a commit. The site only reads and
   records events.
2. **Events are never erased.** Approved, asked, commented, rejected — each one with who, when,
   where, and the fingerprint of the text at that instant.
3. **An approval is for a text, not for a block.** Change the text and the approval drops on its
   own.
4. **Only owner and admin approve.** Their ✓ becomes a lock in the repository and tells the agent
   to apply it. A reviewer asks for a change, comments, and answers decisions.
5. **A request from whoever can approve is born approved.** Nobody triages themselves.
6. **Impact before change.** The agent never applies a request without looking at everywhere else
   it touches.
7. **Nothing is approved until it is validated.** Always write it as a proposal.

## Where things are

| What | Where |
|---|---|
| The rules of the cycle (states, transitions) | `review/cycle.json` — data, not code |
| Shared core (fingerprint, cycle, roles, limits) | `review/core/` — runs in the browser **and** on the server |
| API and site | `review/api/` (TypeScript, no build step) |
| The agent's tool | `review/cli/doc-first.ts` |
| The method, in writing | `docs/METHOD.md` |
| Known gaps | `docs/METHOD.md`, section "Not built yet" |

## Traps that have already cost us here

- **Port already in use = stale binary.** If `review/run-local.sh` refuses to start, kill the
  process first. Testing the old code without noticing once nearly undid a fix that was correct.
- **`element.focus()` does not trigger `:focus-visible`.** Test focus with Tab.
- **A test that passes for the wrong reason.** An assertion that ran `grep` on the output reported
  failure while everything passed. Prefer an exit code to text.
- **A forged approval.** A hand-written `data-validado` created an approval out of nothing; today
  `conferir` catches it, but the lesson stays: the lock has to look at both sides.
