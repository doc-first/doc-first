/* Doc First review — a layer on top of the D, T and C pages.
   Entry point: the number already sitting in the corner of each box becomes a button.
   Panel: Approve (OWNER ONLY) · Request a change · Comment + the box's history.
   Approving belongs to whoever has the capability (owner or admin) because their ✓ becomes a lock in
   the repository and tells the agent to apply it (Ale, 17/09).
   A request from someone who can approve is born approved — they do not triage themselves.
   Triage (only for those who can): Approve request · Decline · Ask. A declined one can be revisited;
   an approved one never comes back.
   With no API (local file, no login) the page stays exactly as it was.
   Rules: nothing is erased; an approval holds for the FINGERPRINT of the text (text changed, the
   approval no longer holds); whoever changes the content is the agent, working from the request. */
(function () {
  'use strict';
  var API = '/api';
  var pagina = (document.querySelector('.doc-titulo__cod') || {}).textContent;
  if (!pagina || location.protocol === 'file:') return;

  var eu = null, podeAprovar = false, eventos = [], caixas = [];   // a capability, not a role
  var C = window.DOC_FIRST;                                    // esc, quando, porQuando, labels (js/common.js)
  var CATEGORIAS = C.CATEGORIAS;
  var ESTADOS_PEDIDO = C.ESTADOS_PEDIDO;
  /* the same cycle as the API (CicloDoPedido) */
  /* The request cycle is NOT computed here. The server sends `situacao` on every request — it is the
     only one holding all the inputs (who is admin, the whole history, other pages included).
     There were three attempts in JavaScript (here, in shell.js and in triagem.html) and they
     diverged from each other and from the API: the same request showed up as "Approved" in one
     place and "Awaiting triage" in another. */
  function estadoDoPedido(p) {
    var s = p.situacao || {};
    var ult = eventos.filter(function (e) { return e.dados && e.dados.pedido === p.id && e.tipo === 'pedido_estado'; })
                     .sort(C.porQuando).pop() || null;
    return { estado: s.estado || 'aberto', situacao: s, ultimo: ult };
  }

  var esc = C.esc, quando = C.quando;
  function quem(email) { return email === eu ? 'You' : email; }
  function foto(e, rotulo) {
    return e.foto ? '<details class="rv-foto"><summary>' + rotulo + '</summary><p>' + esc(e.foto) + '</p></details>' : '';
  }

  /* The fingerprint comes from the CORE (review/core/fingerprint.js) — the same file the server
     uses. There was a copy here, another in validacao.py and another in pedidos.py, and the three
     agreed only by accident: the Python one did not strip the review UI. The rule that decides
     whether an approval still holds cannot depend on three implementations staying identical. */
  async function digital(el) {
    await C.nucleoPronto;
    return C.nucleo.digitalDoElemento(el);
  }

  async function api(caminho, corpo) {
    var r = await fetch(API + caminho, corpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), credentials: 'same-origin' } : { credentials: 'same-origin' });
    if (!r.ok) throw new Error((await r.text()) || r.status);
    return r.json();
  }

  /* ------------------------------------------------------------ the state of one box */
  function estadoDa(caixa) {
    var ev = eventos.filter(function (e) { return e.caixa === caixa.id; });
    var aprov = ev.filter(function (e) { return e.tipo === 'aprovacao'; });
    var valendo = aprov.filter(function (e) { return e.digital === caixa.digital; });
    var pedidos = ev.filter(function (e) { return e.tipo === 'pedido'; }).map(function (p) {
      var s = estadoDoPedido(p);
      return Object.assign({}, p, { estado: s.estado, situacao: s.situacao,
        estadoTexto: s.ultimo ? s.ultimo.texto : null, estadoPor: s.ultimo ? s.ultimo.autor : null });
    });
    var abertos = pedidos.filter(function (p) { return p.estado !== 'aplicado' && p.estado !== 'recusado'; });
    return { eventos: ev, aprovacoes: aprov, valendo: valendo, pedidos: pedidos, abertos: abertos };
  }

  function pintar(caixa) {
    var s = estadoDa(caixa), b = caixa.botao;
    b.classList.toggle('rv-num--ok', s.valendo.length > 0 && !s.abertos.length);
    b.classList.toggle('rv-num--pedido', s.abertos.length > 0);
    b.innerHTML = (s.abertos.length ? '<i aria-hidden="true"></i>' : s.valendo.length ? '✓ ' : '') + esc(caixa.cod);
    var rotulo = 'Block ' + caixa.cod + (s.valendo.length ? ', approved' : '') + (s.abertos.length ? ', ' + s.abertos.length + ' request(s) in progress' : '') + '. Open review';
    b.setAttribute('aria-label', rotulo);
  }

  /* ------------------------------------------------------------ panel */
  var dlg = document.createElement('dialog');
  dlg.className = 'rv-painel';
  dlg.setAttribute('data-revisao-ui', '');
  document.body.appendChild(dlg);
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });

  function abrir(caixa, aba) {
    try { localStorage.setItem('doc-first:abriu', JSON.stringify({ id: caixa.id, cod: caixa.cod, pagina: pagina, quando: Date.now() })); }
    catch { /* "pick up where you left off" is a convenience: with no localStorage, it just does not remember */ }
    var s = estadoDa(caixa);
    var aprovEu = s.valendo.some(function (e) { return e.autor === eu; });
    var antigas = s.aprovacoes.filter(function (e) { return e.digital !== caixa.digital; });
    var hist = s.eventos.slice().reverse().filter(function (e) { return e.tipo !== 'pedido_estado' && e.tipo !== 'complemento'; }).map(function (e) {
      if (e.tipo === 'aprovacao') {
        var vale = e.digital === caixa.digital;
        return '<li class="rv-h rv-h--aprov' + (vale ? '' : ' rv-h--velha') + '"><b>' + esc(quem(e.autor)) + '</b> approved <span>' + quando(e.quando) + '</span>' +
          (vale ? '' : '<small>the text changed afterwards — this approval no longer holds</small>' + foto(e, 'Approved text')) + '</li>';
      }
      if (e.tipo === 'pedido') {
        var p = s.pedidos.find(function (x) { return x.id === e.id; });
        var cat = (CATEGORIAS.find(function (c) { return e.dados && c[0] === e.dados.categoria; }) || [0, 'Request'])[1];
        var fio = eventos.filter(function (x) { return x.dados && x.dados.pedido === e.id; })
          .sort(C.porQuando).map(function (x) {
            var o = x.tipo === 'complemento' ? 'added details' : (ESTADOS_PEDIDO[x.dados.estado] || x.dados.estado).toLowerCase();
            return '<div class="rv-fio"><b>' + esc(quem(x.autor)) + '</b> · ' + esc(o) + ' <span>' + quando(x.quando) + '</span>' + (x.texto ? '<p>' + esc(x.texto) + '</p>' : '') + '</div>';
          }).join('');
        var acoes = '';
        // `triagem` already arrives holding only the OWNER's destinations: on an approved request the
        // possible transitions all belong to the agent, and the "Approve request" button must not
        // show up.
        var podeIr = (p.situacao && p.situacao.triagem) || [];
        if (podeAprovar && podeIr.length) {
          acoes += '<div class="rv-triagem" data-pedido="' + e.id + '">' +
            (podeIr.indexOf('aprovado') >= 0 ? '<button type="button" data-t="aprovado">Approve request</button>' : '') +
            (podeIr.indexOf('recusado') >= 0 ? '<button type="button" data-t="recusado">Decline</button>' : '') +
            (podeIr.indexOf('pergunta') >= 0 ? '<button type="button" data-t="pergunta">Ask</button>' : '') + '</div>';
        }
        if ((e.autor === eu || podeAprovar) && (p.situacao || {}).aceitaComplemento) {
          acoes += '<button type="button" class="rv-link" data-complemento="' + e.id + '">Add details</button>';
        }
        if (p.estado === 'aprovado' || p.estado === 'aplicado' || p.estado === 'analise' || p.estado === 'aguardando') {
          acoes += '<button type="button" class="rv-link" data-relacionado="' + e.id + '">New request about this one</button>';
        }
        return '<li class="rv-h rv-h--pedido"><b>' + esc(quem(e.autor)) + '</b> requested · ' + esc(cat) + ' <span>' + quando(e.quando) + '</span>' +
          (e.dados && e.dados.relacionado ? '<small>' + (function () {                     // the related one may sit on ANOTHER page: the events arrive filtered
              var q = quando((eventos.find(function (x) { return x.id === e.dados.relacionado; }) || {}).quando);
              return q ? 'about the request from ' + q : 'about an earlier request';
            })() + '</small>' : '') +
          '<p>' + esc(e.texto) + '</p>' + foto(e, 'The block text when the request was made') +
          '<em class="rv-estado rv-estado--' + p.estado + '">' + C.rotuloEstado(p.estado) + '</em>' + fio + acoes + '</li>';
      }
      return '<li class="rv-h"><b>' + esc(quem(e.autor)) + '</b> commented <span>' + quando(e.quando) + '</span><p>' + esc(e.texto) + '</p></li>';
    }).join('');

    dlg.innerHTML =
      '<div class="rv-cabeca"><div><small>' + esc(pagina) + ' · block</small><b>' + esc(caixa.cod) + '</b></div>' +
        '<button type="button" class="rv-fechar" aria-label="Close">✕</button></div>' +
      '<p class="rv-resumo">' + esc(caixa.resumo) + '</p>' +
      '<div class="rv-situacao">' +
        (caixa.validadoRepo ? '<span class="rv-selo rv-selo--repo">✓ validated by the owner on ' + esc(caixa.validadoRepo.split('-').reverse().join('/')) + '</span>' : '') +
        (s.valendo.length ? '<span class="rv-selo rv-selo--ok">✓ approved by ' + s.valendo.map(function (e) { return esc(quem(e.autor)); }).join(', ') + '</span>' : '') +
        (s.abertos.length ? '<span class="rv-selo rv-selo--pedido">' + s.abertos.length + ' request' + (s.abertos.length > 1 ? 's' : '') + ' in progress</span>' : '') +
        (!caixa.validadoRepo && !s.valendo.length && !s.abertos.length ? '<span class="rv-selo">not reviewed yet</span>' : '') +
        (antigas.length && !s.valendo.length ? '<span class="rv-selo rv-selo--aviso">the text changed since the last approval</span>' : '') +
      '</div>' +
      '<div class="rv-acoes" role="tablist">' +
        (podeAprovar ? '<button type="button" data-aba="aprovar" ' + (aprovEu ? 'disabled' : '') + '>' + (aprovEu ? '✓ You approved' : 'Approve') + '</button>' : '') +
        '<button type="button" data-aba="pedido">Request a change</button>' +
        '<button type="button" data-aba="comentario">Comment</button>' +
      '</div>' +
      '<form class="rv-form" hidden></form>' +
      '<p class="rv-msg" role="status" aria-live="polite"></p>' +
      (hist ? '<h3 class="rv-hist-titulo">History</h3><ol class="rv-hist">' + hist + '</ol>' : '') +
      '<p class="rv-rodape">Recorded with your e-mail, the date and the time. Nothing is erased. The team changes the text, working from your request.</p>';

    dlg.querySelector('.rv-fechar').onclick = function () { dlg.close(); };
    var form = dlg.querySelector('.rv-form'), msg = dlg.querySelector('.rv-msg');

    function mostrar(qual) {
      dlg.querySelectorAll('.rv-acoes button').forEach(function (b) { b.classList.toggle('rv-ativa', b.dataset.aba === qual); });
      msg.textContent = '';
      if (qual === 'aprovar') {
        form.innerHTML = '<p>Do you confirm that <b>the text of this block, as it stands now</b>, is right?</p>' +
          '<button type="submit" class="rv-enviar">Approve block ' + esc(caixa.cod) + '</button>';
      } else if (qual === 'pedido') {
        form.innerHTML = '<label>Kind<select name="categoria">' + CATEGORIAS.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + '</option>'; }).join('') + '</select></label>' +
          '<label>What needs to change, and why<textarea name="texto" rows="4" maxlength="4000" required placeholder="e.g. replace “patient” with “person”, because…"></textarea></label>' +
          '<button type="submit" class="rv-enviar">Send request</button>';
      } else if (qual === 'comentario') {
        form.innerHTML = '<label>Comment<textarea name="texto" rows="3" maxlength="4000" required></textarea></label>' +
          '<button type="submit" class="rv-enviar">Comment</button>';
      }
      form.hidden = false;
      delete form.dataset.pedido; delete form.dataset.estado; delete form.dataset.relacionado;
      form.dataset.tipo = qual === 'aprovar' ? 'aprovacao' : qual;
      var campo = form.querySelector('textarea, select'); if (campo) campo.focus();
    }
    dlg.querySelectorAll('.rv-acoes button').forEach(function (b) { b.onclick = function () { mostrar(b.dataset.aba); }; });

    function formulario(html, tipo, extra) {
      dlg.querySelectorAll('.rv-acoes button').forEach(function (b) { b.classList.remove('rv-ativa'); });
      form.innerHTML = html; form.hidden = false; form.dataset.tipo = tipo;
      delete form.dataset.pedido; delete form.dataset.estado; delete form.dataset.relacionado;
      Object.keys(extra).forEach(function (k) { form.dataset[k] = extra[k]; });
      msg.textContent = ''; form.scrollIntoView({ block: 'nearest' });
      var campo = form.querySelector('textarea, select'); if (campo) campo.focus();
    }
    dlg.querySelectorAll('.rv-triagem button').forEach(function (b) {
      b.onclick = function () {
        var t = b.dataset.t, id = b.parentNode.dataset.pedido;
        var titulo = { aprovado: 'Approve the request. It goes to the queue to be applied and can no longer be declined.', recusado: 'Decline the request. Whoever asked can add details, and you can revisit it.', pergunta: 'Ask whoever made the request. It goes back to triage once they answer.' }[t];
        formulario('<p>' + titulo + '</p><label>' + (t === 'aprovado' ? 'Note (optional)' : t === 'recusado' ? 'Reason' : 'Question') +
          '<textarea name="texto" rows="3" maxlength="4000"' + (t === 'aprovado' ? '' : ' required') + '></textarea></label>' +
          '<button type="submit" class="rv-enviar">' + b.textContent + '</button>', 'pedido_estado', { pedido: id, estado: t });
      };
    });
    dlg.querySelectorAll('[data-complemento]').forEach(function (b) {
      b.onclick = function () {
        formulario('<label>What do you want to add<textarea name="texto" rows="3" maxlength="4000" required></textarea></label>' +
          '<button type="submit" class="rv-enviar">Add</button>', 'complemento', { pedido: b.dataset.complemento });
      };
    });
    dlg.querySelectorAll('[data-relacionado]').forEach(function (b) {
      b.onclick = function () {
        mostrar('pedido'); form.dataset.relacionado = b.dataset.relacionado;
        form.insertAdjacentHTML('afterbegin', '<p class="rv-aviso">This request stays tied to the earlier one, already approved. The approved one does not change: this is a new request.</p>');
      };
    });

    form.onsubmit = async function (ev) {
      ev.preventDefault();
      var botao = form.querySelector('.rv-enviar'); botao.disabled = true; msg.textContent = 'Recording…';
      var dados = new FormData(form);
      try {
        caixa.digital = await digital(caixa.el);
        var extra = {};
        if (dados.get('categoria')) extra.categoria = dados.get('categoria');
        if (form.dataset.relacionado) extra.relacionado = form.dataset.relacionado;
        if (form.dataset.pedido) extra.pedido = form.dataset.pedido;
        if (form.dataset.estado) extra.estado = form.dataset.estado;
        var novo = await api('/eventos', {
          tipo: form.dataset.tipo, pagina: pagina, caixa: caixa.id, digital: caixa.digital,
          texto: dados.get('texto') || null, foto: C.nucleo.textoDoElemento(caixa.el),   // the SAME text the fingerprint looks at
          dados: Object.keys(extra).length ? extra : null
        });
        eventos.push(novo);
        pintar(caixa);
        abrir(caixa);
        dlg.querySelector('.rv-msg').textContent = ({ aprovacao: 'Approval recorded.', pedido: 'Request recorded. It goes to triage.',
          comentario: 'Comment recorded.', complemento: 'Details added. The request goes back to triage.', pedido_estado: 'Triage recorded.' })[form.dataset.tipo];
      } catch (e) {
        msg.textContent = 'Could not record it. Try again. (' + e.message + ')';
        botao.disabled = false;
      }
    };

    if (!dlg.open) dlg.showModal();
    if (aba) mostrar(aba);
  }

  /* ------------------------------------------------------------ start */
  /* ORDER MATTERS (the flicker reported on 17/09). This script runs on the last line of <body>,
     BEFORE the first paint. If the structure is built here, synchronously, the page is born ready.
     It used to be the opposite: it waited for two API calls and one fingerprint PER BOX, and only
     then set `rv-ativa` — the CSS had already painted the 52 ::after labels, and they all vanished
     at once while 32 buttons were born one by one. That was the collective flash right after the
     page opened. */
  function avisar(texto) {
    var t = document.createElement('p');
    t.className = 'rv-alerta'; t.setAttribute('role', 'alert'); t.setAttribute('data-revisao-ui', '');
    t.textContent = texto;
    document.body.insertBefore(t, document.body.firstChild);
  }

  function desligar() {                                            // no API or no login: back to static
    document.body.classList.remove('rv-ativa');
    caixas.forEach(function (c) { c.botao.remove(); });
    caixas = [];
  }

  async function iniciar() {
    /* 1 · synchronous, before any waiting: the buttons make the first paint, carrying the same text
           as the label they replace, so there is no visible swap */
    var els = document.querySelectorAll('main [data-id][data-cod]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], cod = el.getAttribute('data-cod');
      if (!/^\d+\.\d/.test(cod)) continue;                         // headings and subheadings carry no visible number
      var caixa = { id: el.getAttribute('data-id'), cod: cod, el: el, validadoRepo: el.getAttribute('data-validado') };
      var h = el.querySelector('h3, b, p, summary, th');
      caixa.resumo = (h ? h.textContent : el.textContent).replace(/\s+/g, ' ').trim().slice(0, 110);
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'rv-num'; b.setAttribute('data-revisao-ui', '');
      b.textContent = cod;                                         // born identical to the ::after label
      b.setAttribute('aria-label', 'Block ' + cod + '. Open review');
      b.addEventListener('click', (function (c) { return function () { abrir(c); }; })(caixa));
      el.appendChild(b);
      caixa.botao = b;
      caixas.push(caixa);
    }
    if (!caixas.length) return;
    document.body.classList.add('rv-ativa');

    /* 2 · fingerprints in parallel, not one at a time */
    await Promise.all(caixas.map(function (c) { return digital(c.el).then(function (d) { c.digital = d; }); }));

    /* 3 · who I am and what has already happened on this page */
    try { var quemSou = await C.eu(); eu = quemSou.email; podeAprovar = !!(quemSou.podeAprovar !== undefined ? quemSou.podeAprovar : quemSou.dono); }
    catch { desligar(); return; }   /* no API or no login: the page goes back to static */
    // It used to be `catch { eventos = [] }`. With the network down, the page erased every ✓ and
    // became indistinguishable from "never reviewed" — and the reviewer approved again, or opened a
    // duplicate request, with no signal at all. In a product whose premise is traceability, that is
    // the costliest bug in the file.
    try { eventos = await api('/eventos?pagina=' + encodeURIComponent(pagina)); }
    catch { desligar(); avisar('Could not load the review state. Reload the page.'); return; }

    /* 4 · only now does the state (✓ green, ● amber) change the look — of a few, not of all */
    caixas.forEach(pintar);
    var alvo = location.hash.match(/^#revisar=(.+)$/);
    if (alvo) { var c = caixas.find(function (x) { return x.id === decodeURIComponent(alvo[1]); }); if (c) { c.el.scrollIntoView({ block: 'center' }); abrir(c); } }
  }
  iniciar();
})();
