# The panel, in React

The review panel, written in React. `review/web/painel-react.js` is the bundled result, and it is
**committed on purpose**: this project promises "clone and run", and a bundle that only exists after
`npm install` would break that promise.

    npm run build:web      # produces review/web/painel-react.js

CI checks the built file is not stale. Touch anything here, run it and commit the result.

## What lives where

| File | What it is |
|---|---|
| `entrada.jsx` | the bridge to the page: finds the blocks, creates the buttons, mounts React |
| `Painel.jsx` | the dialog: badge, actions, request form, triage, history |
| `api.js` | the three API routes, and the fingerprint (which comes from the core, not a copy) |
| `estado.js` | a block's state, derived from the events |

## Two rules that do not bend

**React does not own the page.** The buttons are created in the page's own DOM, not by a component:
the page belongs to whoever adopts the method, and it may be HTML, Astro, Jekyll or anything else.
React mounts only the dialog, in a `<div>` at the end of `<body>`.

**Everything entering `<main>` carries `data-revisao-ui`.** Injected text enters the fingerprint, and
the fingerprint is what decides whether a human approval still holds. Forgetting it knocks down
every approval on the page at once, with no error at all.

## Triage, and why the buttons are not listed here

Whoever can triage sees, on each request, the possible destinations — and that list comes from
`situacao.triagem`, computed by the SERVER. There is no list of states written in the front end.

That is what keeps the two from disagreeing: on an already-approved request the triage list comes
back empty, and the "Approve" button simply does not exist, instead of existing and failing on
click. A request made by the owner is born approved — they do not triage themselves — so no triage
appears at all.

Rejecting and asking require a reason, and the panel blocks before calling the API.

## What it does not do yet

The side menu and the consolidated triage queue. Triage works inside the panel, block by block,
which is enough to review; what is missing is the "every open request in the project" view.

Two panels coexist: `ola-mundo` uses the classic one (`review.js`), `gabarito` uses React.
