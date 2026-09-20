# A bug is documentation

> Design, `2026-09-20`. Not built. The machinery it needs mostly exists — see the end.

## What a bug report actually is

Two documents disagree. One of them is the documentation. The other is the system's behaviour, as a
person just experienced it.

That is the same shape as 🔴 — two things that used to agree and no longer do — with one difference:
one side is not in the repository. Which is why a bug report does not enter here as a ticket. It
enters as an **event against a block**, like everything else, and it gets triaged like everything
else.

## The three outcomes

The interesting part is that triage has three answers, not one.

| The documentation says | The system does | What it is | What it produces |
|---|---|---|---|
| X | not X | **the system is wrong** | a fix. The block stays 🟢 — it was right all along, and it is now the specification of the fix |
| X | not X, and X was the bad idea | **the documentation is wrong** | a change request. The block goes to triage and loses its ✓ |
| *nothing* | something | **the documentation has a hole** | a new block to write |

The third row is the one every issue tracker loses. Somebody did a thing the tool allowed and the
manual never mentioned — that is not a defect in the code and not a wrong sentence. It is
**undocumented behaviour**, and in a tracker it dies as *works as intended* or *won't fix*.

Here it becomes a ⚪ block with a subject attached, sitting in the queue. The documentation grows by
exactly the amount the product surprised somebody, which is the right amount.

## Why this is not a bug tracker

A tracker's unit is the ticket, and a ticket's life ends at *closed*. The unit here is the **block**,
and blocks never close: they get approved, and then the approval either holds or stops holding.

Things that fall out of that for free:

- the report keeps the **snapshot** of the block it contradicted — the same snapshot machinery every
  request already uses
- the fix's commit carries `Pedido:` and `Solicitado-por:`, so the change, the reason and the person
  are one object
- *"did this come back?"* is answerable: the block turned 🟡, somebody re-approved it, and the event
  log says who and when
- the same bug reported twice lands on the **same block**, visibly

And the one that matters most: ***"why is it like this?"* has an answer**, because the `rationale`
block and the bug report are neighbours in the same document instead of five years apart in two
systems.

## Domain rule, integration rule — the engine does not guess

It does not infer the category. The content was already **typed**, and the kind is where the answer
lives. Two of the fourteen already carry it: `model` is the domain's shape, `contract` is the
integration promise. What is missing is `rule` — the domain rule proper, the thing that has to hold
regardless of how the system is built.

Then a third property on the kind, beside `gravity` and `sensitivity`:

**`entails` — what a substantive change here creates as work.**

| kind | entails |
|---|---|
| `rule` | the tests that prove it have to be re-run, and probably rewritten |
| `contract` | whoever consumes it has to be told; a version |
| `model` | a migration |
| `config` | a deploy |
| `text`, `colors` | nothing |

Same shape as `demands()`: the kind declares it, nobody guesses it, and it is one file to argue
about instead of a convention that dies with the third person to join.

## The bridge to the code

"This may mean redoing the tests" is a warning. For it to be a **check**, the block has to know
*which* tests.

```html
<div data-tipo="rule" data-prova="tests/deadline.test.js::responds within 24h">
```

The check is deterministic and costs nothing: *this rule changed substantively in this commit range,
and its proof did not.* That is the git-diff layer from `IMPACT.md`, pointed at code instead of at
documentation.

It reads the other way too: a `rule` with no `data-prova` is a rule nobody proved — and `demands()`
can say so, exactly as `decision` already demands an owner and a deadline.

⚠️ This is the one thing here that makes it an engine and not a wiki: **a documentation block that
knows which test defends it**. It is also the easiest to get wrong — a stale path silently proves
nothing. The path has to be checked for existence on every index, and a `data-prova` pointing at a
file that is gone is an issue, not a shrug.

## Where it plugs in

| Needed | Status |
|---|---|
| event against a block, with snapshot and author | ✅ exists |
| triage with states and legal transitions (`review/cycle.json`) | ✅ exists |
| a `bug` request category beside `text`, `term`, `remove`, `doubt` | ⬜ one line |
| the three outcomes as triage results, instead of approve/reject | ⬜ |
| `rule` as a fifteenth kind | ⬜ |
| `entails` on the kind | ⬜ |
| `data-prova`, and the check that the proof moved too | ⬜ |
| a report that lands on **no** block — the hole case | ⬜ the hard one: it needs a subject before it has a home |
