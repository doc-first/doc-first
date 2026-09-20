# Doc First — living documentation

> Proposal · `2026-09-20` · nothing here is finished, and much of it has not been started.

## The problem

Product documentation dies in a well-known way: somebody writes it, somebody approves it, and six
months later nobody knows what is still true. Not because people are careless — because **nothing
warns them**. The document does not know the code changed. The use case does not know the rule
changed. The diagram does not know the screen changed.

The result is always the same: documentation turns into archaeology, and the decision goes back to
living only in the head of whoever was there.

## The idea in one sentence

**Documentation is generated from the business and validated by a human — and every piece of it can
say whether it can still be trusted.**

This is not "generate documentation automatically". That already exists, and it produces text
nobody reads. This is generating it **and keeping it honest**: when something changes, everything
that depended on it raises its hand.

## The traffic light

The heart of the method. Every block of documentation has a state, and the state is computed —
never declared by anyone.

| | State | Meaning | What to do |
|---|---|---|---|
| ⚪ | not validated | nobody has looked yet | read and approve, or ask for a change |
| 🟢 | validated | approved, and nothing has changed since | nothing |
| 🟡 | stale | **this** block's text changed after the ✓ | re-approve the new text |
| 🔴 | suspect | the text is unchanged, but something it **depends on** moved | check whether it still holds |

Red is what separates this method from version control with a badge. It catches the case nobody
notices while reading the page, because **on the page, nothing changed**.

### Why red is a question, not an error

The engine does not know the block became wrong. It knows it became **suspect**, and that a human
needs to look. Treating it as an error would make the first wave of false positives push somebody
into switching the check off — and then the whole lock is pointless.

*Status:* ⚪ ⟶ 🟢 ⟶ 🟡 implemented from the start; 🔴 implemented on `2026-09-20`.

## What the tool generates, and what the human does

```
  the business changes
        │
        ▼
  ┌─────────────────────┐
  │ the tool generates  │   text, flowchart, C4, use case, model
  │ or updates          │
  └─────────┬───────────┘
            │
            ▼
  ┌─────────────────────┐
  │ everything that     │   🟡 and 🔴 show up on their own
  │ depended on it      │
  │ raises its hand     │
  └─────────┬───────────┘
            │
            ▼
  ┌─────────────────────┐
  │ the human checks    │   ✓ or "this one is wrong, because…"
  │ and approves        │
  └─────────────────────┘
```

The machine never approves. **Approval is human, always** — it is the one part of the method that
does not get automated, and it is where all the value of the rest comes from.

## The documentation categories

The template (`examples/gabarito/`) is the skeleton a project copies. It grows as the method
matures; today it has five sections, and the list below is the destination.

| Section | What it holds | Status |
|---|---|---|
| **Discovery** | why it exists, who for, what changes if it works | ✅ |
| **Roles** | who can do what, the capability table, who approves | ✅ |
| **Design system** | the values, the components, and what is not done here | ✅ |
| **Screens** | what the person came to do, what they see, what they can do, the prototype | ✅ |
| **Decisions** | what is still undecided, with an owner and a deadline | ✅ |
| **Stack** | what the system is made of, and why | ⬜ |
| **Data model** | the entities, the relationships, the data dictionary | ⬜ |
| **Use cases** | the flow end to end, with what travels at each step | ⬜ |
| **Architecture (C4)** | context, containers, components, code | ⬜ |
| **Contracts** | the APIs, the events, what goes in and what comes out | ⬜ |

## The diagrams

**Decision:** a diagram is **text**, not an image. Mermaid, PlantUML or equivalent — something that
gets versioned, gets compared in a diff, and has a fingerprint computed from it.

This is not an aesthetic preference. A PNG has no useful fingerprint: any recompression changes the
bytes without changing the meaning, and no change of meaning is legible in a diff. A diagram in
text enters the traffic light like any other block — and it is the only way a flowchart turns 🟡
when the flow it draws has changed.

*Status:* ⬜ not started.

## What the prototype is, and what it is not

**Ale's decision, `2026-09-20`:** the screen prototypes live in **HTML and CSS**, not in the
product's framework.

The reason is the same as for the diagram in text: whoever adopts the method may use React, Vue,
Svelte or none of them. Doc First cannot impose a framework on anybody's documentation. The review
panel — which belongs to **the engine** — is React; the documented screen belongs to whoever writes
it.

## Who does what

| | Doc First | The project adopting it |
|---|---|---|
| The rule | cycle, traffic light, lock by fingerprint, roles | — |
| The tool | panel, CLI, image, generators | — |
| The template | the empty skeleton | the filled-in content |
| The brand | — | colours, font, icons, name |
| The people | — | who approves, who reviews |

**Method improvements come up here. Content stays down there.** That is the rule that stops the
engine from turning into somebody's product all over again.

## What does not exist yet

In order of how much is missing:

1. **Generation.** Today the human writes and the tool keeps it. The vision is the tool writing the
   first draft from the business, and the human correcting it.
2. **Diagrams.** None. Neither generated, nor versioned, nor in the traffic light.
3. **The five missing categories** — stack, data model, use cases, C4, contracts.
4. **Automatic dependencies.** Today `data-depende` is written by hand. The tool ought to propose
   them: two blocks talking about the same term probably depend on each other.
5. **The consolidated queue** — seeing everything that is 🟡 and 🔴 in one place, without opening
   page after page.
6. **AI assistance.** Each project with its own key. Designed, not built.

## The name

"Doc First" is a working name, like every working name. It describes the order — documentation
before code — but it does not describe the part that matters, which is the documentation **staying
true** afterwards. When a better name shows up, it changes.
