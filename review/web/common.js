/* What EVERY reviewable page needs, in a single place. Loaded before the other scripts.

   Why it exists (debt review, 2026-09-17): five independent files each solved the same four
   problems on their own — escaping HTML, formatting a date, sorting events and knowing the state
   labels. `esc()` was copied SIX times, and the copy in navegacao.js was different from the rest:
   with no null guard, it wrote the word "undefined" onto the page. Comparing copies to find the odd
   one out is exactly the work the methodology promises to eliminate.

   No ES6 module and no build, on purpose: this is a <script> like the others, and whoever adopts the
   method needs no tooling at all to read it. */
(function () {
  'use strict';

  var A = window.DOC_FIRST = window.DOC_FIRST || {};

  /* The shared core (review/core/) arrives as a module, in parallel — see js/core-web.js.
     The promise is born here so that whoever loads before it does not miss the signal. */
  if (!A.nucleoPronto) {
    A.nucleoPronto = new Promise(function (ok) { A._nucleoResolve = ok; });
  }

  /** Escapes for interpolation into HTML. Single quotes included: an attribute quoted with single
      quotes exists too. */
  A.esc = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /** Short date for a human: "17/09 14:32". Returns '' for a missing or invalid date —
      `new Date('')` produced the literal "Invalid Date Invalid Date" on screen. */
  A.quando = function (iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
           d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  /** Sorts events from oldest to newest.
      The previous comparator (`a.quando < b.quando ? -1 : 1`) NEVER returned 0, so for two events at
      the same instant cmp(a,b) and cmp(b,a) both gave 1 — sort's contract violated, order left
      undefined by the specification. Since a request's state is decided by the LAST event in the
      ordering, two browsers could show different states for the same request. */
  A.porQuando = function (a, b) {
    return String(a.quando || '').localeCompare(String(b.quando || ''));
  };

  /** Labels of the request cycle, in the interface.

      These labels were the first thing here to be unified, and the reason is worth keeping: the
      cycle used to exist in five implementations — C#, pedidos.py, revisao.js, shell.js and
      triagem.html — and the five were not equal, they were similar. Python said "To triage" where
      JS said "Awaiting triage", and the same request showed a different state depending on which
      screen you opened it in.

      The cycle itself now lives in review/cycle.json and is read by server, CLI and browser alike.
      What is left here is only the wording. */
  A.ESTADOS_PEDIDO = {
    aberto: 'Awaiting triage', aprovado: 'Approved', recusado: 'Declined',
    pergunta: 'Question for the requester', analise: 'Being applied',
    aguardando: 'Being applied · question', aplicado: 'Applied'
  };

  /** The categories of a request, as `[value sent to the API, label on screen]`.

      The list has to match `request_categories` in review/cycle.json — that table is the source,
      this is the wording. The four older values travel in Portuguese because that is how they were
      recorded before 2026-09-19, and review/core/legacy.js renames them on read; `bug` was born
      after the rename, so it travels as `bug` and needs no pair in that map. Do NOT "fix" it to
      `erro` for symmetry: that would add history that never happened. */
  A.CATEGORIAS = [['texto', 'Adjust the text'], ['termo', 'Change a term'],
                  ['remover', 'Remove'], ['duvida', 'Question'], ['bug', 'Report a bug']];

  A.rotuloEstado = function (e) { return A.ESTADOS_PEDIDO[e] || e || 'Awaiting triage'; };

  A.rotuloCategoria = function (c) {
    for (var i = 0; i < A.CATEGORIAS.length; i++) if (A.CATEGORIAS[i][0] === c) return A.CATEGORIAS[i][1];
    return 'Request';
  };

  /** Who I am, once per page. shell.js and revisao.js each asked /api/eu on their own — two
      identical requests on each of the 36 sheets, on every navigation. The answer does not change
      during the visit, so the promise is kept and reused. */
  var _eu = null;
  A.eu = function () {
    if (!_eu) _eu = A.api('/eu');
    return _eu;
  };

  /** Fetches the API with the error in plain sight. A `fetch(...).then(r => r.json())` that never
      checks `ok` blows up inside json() when the server answers with an HTML error page — and
      vanishes, if the catch is empty. */
  A.api = function (caminho, corpo) {
    var opcoes = corpo
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), credentials: 'same-origin' }
      : { credentials: 'same-origin' };
    return fetch('/api' + caminho, opcoes).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); });
      return r.json();
    });
  };
})();
