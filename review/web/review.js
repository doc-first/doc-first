/* Revisão Doc First — camada por cima das páginas D, T e C.
   Entrada: o número que já existe na quina de cada caixa vira botão.
   Painel: Aprovar (SÓ O DONO) · Pedir alteração · Comentar + histórico da caixa.
   Aprovar é de quem tem a capacidade (owner ou admin) porque o ✓ dele vira trava no repositório e manda o agente aplicar (Ale, 17/09).
   Pedido de quem pode aprovar nasce aprovado — ele não tria a si mesmo.
   Triagem (só quem pode): Aprovar pedido · Recusar · Perguntar. Recusado pode ser revisto; aprovado nunca volta.
   Sem API (arquivo local, sem login) a página fica exatamente como era.
   Regras: nada se apaga; aprovação vale para a DIGITAL do texto (mudou o texto, a aprovação não vale mais);
   quem altera o conteúdo é o agente, a partir do pedido. */
(function () {
  'use strict';
  var API = '/api';
  var pagina = (document.querySelector('.doc-titulo__cod') || {}).textContent;
  if (!pagina || location.protocol === 'file:') return;

  var eu = null, podeAprovar = false, eventos = [], caixas = [];   // capacidade, não papel
  var C = window.DOC_FIRST;                                    // esc, quando, porQuando, rótulos (js/common.js)
  var CATEGORIAS = C.CATEGORIAS;
  var ESTADOS_PEDIDO = C.ESTADOS_PEDIDO;
  /* mesmo ciclo da API (CicloDoPedido) */
  /* O ciclo do pedido NÃO é calculado aqui. O servidor manda `situacao` em cada pedido — ele é o
     único que tem todas as entradas (quem é admin, o histórico inteiro, inclusive de outras páginas).
     Havia três tentativas em JavaScript (aqui, no shell.js e na triagem.html) e elas divergiam entre
     si e da API: o mesmo pedido aparecia "Aprovado" num lugar e "Aguardando triagem" noutro. */
  function estadoDoPedido(p) {
    var s = p.situacao || {};
    var ult = eventos.filter(function (e) { return e.dados && e.dados.pedido === p.id && e.tipo === 'pedido_estado'; })
                     .sort(C.porQuando).pop() || null;
    return { estado: s.estado || 'aberto', situacao: s, ultimo: ult };
  }

  var esc = C.esc, quando = C.quando;
  function quem(email) { return email === eu ? 'Você' : email; }
  function foto(e, rotulo) {
    return e.foto ? '<details class="rv-foto"><summary>' + rotulo + '</summary><p>' + esc(e.foto) + '</p></details>' : '';
  }

  /* A digital vem do NÚCLEO (review/core/fingerprint.js) — o mesmo arquivo que o servidor usa.
     Era uma cópia daqui, outra no validacao.py e outra no pedidos.py, e as três só concordavam por
     acaso: a do Python não removia a UI da revisão. A regra que decide se uma aprovação ainda vale
     não pode depender de três implementações continuarem iguais. */
  async function digital(el) {
    await C.nucleoPronto;
    return C.nucleo.digitalDoElemento(el);
  }

  async function api(caminho, corpo) {
    var r = await fetch(API + caminho, corpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), credentials: 'same-origin' } : { credentials: 'same-origin' });
    if (!r.ok) throw new Error((await r.text()) || r.status);
    return r.json();
  }

  /* ------------------------------------------------------------ estado de uma caixa */
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
    var rotulo = 'Trecho ' + caixa.cod + (s.valendo.length ? ', aprovada' : '') + (s.abertos.length ? ', ' + s.abertos.length + ' pedido(s) em andamento' : '') + '. Abrir revisão';
    b.setAttribute('aria-label', rotulo);
  }

  /* ------------------------------------------------------------ painel */
  var dlg = document.createElement('dialog');
  dlg.className = 'rv-painel';
  dlg.setAttribute('data-revisao-ui', '');
  document.body.appendChild(dlg);
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });

  function abrir(caixa, aba) {
    try { localStorage.setItem('doc-first:abriu', JSON.stringify({ id: caixa.id, cod: caixa.cod, pagina: pagina, quando: Date.now() })); }
    catch { /* "continue de onde parou" é conveniência: sem localStorage, apenas não lembra */ }
    var s = estadoDa(caixa);
    var aprovEu = s.valendo.some(function (e) { return e.autor === eu; });
    var antigas = s.aprovacoes.filter(function (e) { return e.digital !== caixa.digital; });
    var hist = s.eventos.slice().reverse().filter(function (e) { return e.tipo !== 'pedido_estado' && e.tipo !== 'complemento'; }).map(function (e) {
      if (e.tipo === 'aprovacao') {
        var vale = e.digital === caixa.digital;
        return '<li class="rv-h rv-h--aprov' + (vale ? '' : ' rv-h--velha') + '"><b>' + esc(quem(e.autor)) + '</b> aprovou <span>' + quando(e.quando) + '</span>' +
          (vale ? '' : '<small>o texto mudou depois — esta aprovação não vale mais</small>' + foto(e, 'Texto aprovado')) + '</li>';
      }
      if (e.tipo === 'pedido') {
        var p = s.pedidos.find(function (x) { return x.id === e.id; });
        var cat = (CATEGORIAS.find(function (c) { return e.dados && c[0] === e.dados.categoria; }) || [0, 'Pedido'])[1];
        var fio = eventos.filter(function (x) { return x.dados && x.dados.pedido === e.id; })
          .sort(C.porQuando).map(function (x) {
            var o = x.tipo === 'complemento' ? 'acrescentou' : (ESTADOS_PEDIDO[x.dados.estado] || x.dados.estado).toLowerCase();
            return '<div class="rv-fio"><b>' + esc(quem(x.autor)) + '</b> · ' + esc(o) + ' <span>' + quando(x.quando) + '</span>' + (x.texto ? '<p>' + esc(x.texto) + '</p>' : '') + '</div>';
          }).join('');
        var acoes = '';
        // `triagem` já vem só com os destinos DO DONO: num pedido aprovado, as transições possíveis
        // são todas do agente, e o botão "Aprovar pedido" não deve aparecer.
        var podeIr = (p.situacao && p.situacao.triagem) || [];
        if (podeAprovar && podeIr.length) {
          acoes += '<div class="rv-triagem" data-pedido="' + e.id + '">' +
            (podeIr.indexOf('aprovado') >= 0 ? '<button type="button" data-t="aprovado">Aprovar pedido</button>' : '') +
            (podeIr.indexOf('recusado') >= 0 ? '<button type="button" data-t="recusado">Recusar</button>' : '') +
            (podeIr.indexOf('pergunta') >= 0 ? '<button type="button" data-t="pergunta">Perguntar</button>' : '') + '</div>';
        }
        if ((e.autor === eu || podeAprovar) && (p.situacao || {}).aceitaComplemento) {
          acoes += '<button type="button" class="rv-link" data-complemento="' + e.id + '">Acrescentar detalhes</button>';
        }
        if (p.estado === 'aprovado' || p.estado === 'aplicado' || p.estado === 'analise' || p.estado === 'aguardando') {
          acoes += '<button type="button" class="rv-link" data-relacionado="' + e.id + '">Novo pedido sobre este</button>';
        }
        return '<li class="rv-h rv-h--pedido"><b>' + esc(quem(e.autor)) + '</b> pediu · ' + esc(cat) + ' <span>' + quando(e.quando) + '</span>' +
          (e.dados && e.dados.relacionado ? '<small>' + (function () {                     // o relacionado pode estar em OUTRA página: os eventos vêm filtrados
              var q = quando((eventos.find(function (x) { return x.id === e.dados.relacionado; }) || {}).quando);
              return q ? 'sobre o pedido de ' + q : 'sobre um pedido anterior';
            })() + '</small>' : '') +
          '<p>' + esc(e.texto) + '</p>' + foto(e, 'Texto do trecho quando pediu') +
          '<em class="rv-estado rv-estado--' + p.estado + '">' + C.rotuloEstado(p.estado) + '</em>' + fio + acoes + '</li>';
      }
      return '<li class="rv-h"><b>' + esc(quem(e.autor)) + '</b> comentou <span>' + quando(e.quando) + '</span><p>' + esc(e.texto) + '</p></li>';
    }).join('');

    dlg.innerHTML =
      '<div class="rv-cabeca"><div><small>' + esc(pagina) + ' · trecho</small><b>' + esc(caixa.cod) + '</b></div>' +
        '<button type="button" class="rv-fechar" aria-label="Fechar">✕</button></div>' +
      '<p class="rv-resumo">' + esc(caixa.resumo) + '</p>' +
      '<div class="rv-situacao">' +
        (caixa.validadoRepo ? '<span class="rv-selo rv-selo--repo">✓ validado pelo dono em ' + esc(caixa.validadoRepo.split('-').reverse().join('/')) + '</span>' : '') +
        (s.valendo.length ? '<span class="rv-selo rv-selo--ok">✓ aprovada por ' + s.valendo.map(function (e) { return esc(quem(e.autor)); }).join(', ') + '</span>' : '') +
        (s.abertos.length ? '<span class="rv-selo rv-selo--pedido">' + s.abertos.length + ' pedido' + (s.abertos.length > 1 ? 's' : '') + ' em andamento</span>' : '') +
        (!caixa.validadoRepo && !s.valendo.length && !s.abertos.length ? '<span class="rv-selo">ainda não revisada</span>' : '') +
        (antigas.length && !s.valendo.length ? '<span class="rv-selo rv-selo--aviso">o texto mudou desde a última aprovação</span>' : '') +
      '</div>' +
      '<div class="rv-acoes" role="tablist">' +
        (podeAprovar ? '<button type="button" data-aba="aprovar" ' + (aprovEu ? 'disabled' : '') + '>' + (aprovEu ? '✓ Você aprovou' : 'Aprovar') + '</button>' : '') +
        '<button type="button" data-aba="pedido">Pedir alteração</button>' +
        '<button type="button" data-aba="comentario">Comentar</button>' +
      '</div>' +
      '<form class="rv-form" hidden></form>' +
      '<p class="rv-msg" role="status" aria-live="polite"></p>' +
      (hist ? '<h3 class="rv-hist-titulo">Histórico</h3><ol class="rv-hist">' + hist + '</ol>' : '') +
      '<p class="rv-rodape">Registrado com seu e-mail, data e hora. Nada é apagado. Quem altera o texto é a equipe, a partir do seu pedido.</p>';

    dlg.querySelector('.rv-fechar').onclick = function () { dlg.close(); };
    var form = dlg.querySelector('.rv-form'), msg = dlg.querySelector('.rv-msg');

    function mostrar(qual) {
      dlg.querySelectorAll('.rv-acoes button').forEach(function (b) { b.classList.toggle('rv-ativa', b.dataset.aba === qual); });
      msg.textContent = '';
      if (qual === 'aprovar') {
        form.innerHTML = '<p>Você confirma que <b>o texto deste trecho, como está agora</b>, está certo?</p>' +
          '<button type="submit" class="rv-enviar">Aprovar o trecho ' + esc(caixa.cod) + '</button>';
      } else if (qual === 'pedido') {
        form.innerHTML = '<label>Tipo<select name="categoria">' + CATEGORIAS.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + '</option>'; }).join('') + '</select></label>' +
          '<label>O que precisa mudar, e por quê<textarea name="texto" rows="4" maxlength="4000" required placeholder="Ex.: trocar “paciente” por “pessoa”, porque…"></textarea></label>' +
          '<button type="submit" class="rv-enviar">Enviar pedido</button>';
      } else if (qual === 'comentario') {
        form.innerHTML = '<label>Comentário<textarea name="texto" rows="3" maxlength="4000" required></textarea></label>' +
          '<button type="submit" class="rv-enviar">Comentar</button>';
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
        var titulo = { aprovado: 'Aprovar o pedido. Ele vai para a fila de aplicação e não pode mais ser recusado.', recusado: 'Recusar o pedido. Quem pediu pode acrescentar detalhes, e você pode rever.', pergunta: 'Perguntar a quem pediu. O pedido volta para a triagem quando responder.' }[t];
        formulario('<p>' + titulo + '</p><label>' + (t === 'aprovado' ? 'Observação (opcional)' : t === 'recusado' ? 'Motivo' : 'Pergunta') +
          '<textarea name="texto" rows="3" maxlength="4000"' + (t === 'aprovado' ? '' : ' required') + '></textarea></label>' +
          '<button type="submit" class="rv-enviar">' + b.textContent + '</button>', 'pedido_estado', { pedido: id, estado: t });
      };
    });
    dlg.querySelectorAll('[data-complemento]').forEach(function (b) {
      b.onclick = function () {
        formulario('<label>O que você quer acrescentar<textarea name="texto" rows="3" maxlength="4000" required></textarea></label>' +
          '<button type="submit" class="rv-enviar">Acrescentar</button>', 'complemento', { pedido: b.dataset.complemento });
      };
    });
    dlg.querySelectorAll('[data-relacionado]').forEach(function (b) {
      b.onclick = function () {
        mostrar('pedido'); form.dataset.relacionado = b.dataset.relacionado;
        form.insertAdjacentHTML('afterbegin', '<p class="rv-aviso">Este pedido fica ligado ao anterior, já aprovado. O aprovado não muda: esta é uma nova solicitação.</p>');
      };
    });

    form.onsubmit = async function (ev) {
      ev.preventDefault();
      var botao = form.querySelector('.rv-enviar'); botao.disabled = true; msg.textContent = 'Registrando…';
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
          texto: dados.get('texto') || null, foto: C.nucleo.textoDoElemento(caixa.el),   // o MESMO texto que a digital considera
          dados: Object.keys(extra).length ? extra : null
        });
        eventos.push(novo);
        pintar(caixa);
        abrir(caixa);
        dlg.querySelector('.rv-msg').textContent = ({ aprovacao: 'Aprovação registrada.', pedido: 'Pedido registrado. Vai para a triagem.',
          comentario: 'Comentário registrado.', complemento: 'Detalhes acrescentados. O pedido volta para a triagem.', pedido_estado: 'Triagem registrada.' })[form.dataset.tipo];
      } catch (e) {
        msg.textContent = 'Não foi possível registrar. Tente de novo. (' + e.message + ')';
        botao.disabled = false;
      }
    };

    if (!dlg.open) dlg.showModal();
    if (aba) mostrar(aba);
  }

  /* ------------------------------------------------------------ início */
  /* ORDEM IMPORTA (piscada relatada em 17/09). Este script roda na última linha do <body>,
     ANTES do primeiro paint. Se a estrutura for montada aqui, de forma síncrona, a página nasce pronta.
     Antes era o contrário: esperava duas chamadas de API e uma digital POR CAIXA, e só então punha
     `rv-ativa` — o CSS já tinha pintado as 52 etiquetas ::after, que sumiam todas de uma vez enquanto
     32 botões nasciam um a um. Era esse o flash coletivo logo depois de a página abrir. */
  function avisar(texto) {
    var t = document.createElement('p');
    t.className = 'rv-alerta'; t.setAttribute('role', 'alert'); t.setAttribute('data-revisao-ui', '');
    t.textContent = texto;
    document.body.insertBefore(t, document.body.firstChild);
  }

  function desligar() {                                            // sem API ou sem login: volta ao estático
    document.body.classList.remove('rv-ativa');
    caixas.forEach(function (c) { c.botao.remove(); });
    caixas = [];
  }

  async function iniciar() {
    /* 1 · síncrono, antes de qualquer espera: os botões entram no primeiro paint, com o mesmo
           texto da etiqueta que substituem, para não haver troca visível */
    var els = document.querySelectorAll('main [data-id][data-cod]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], cod = el.getAttribute('data-cod');
      if (!/^\d+\.\d/.test(cod)) continue;                         // títulos e subtítulos não têm número visível
      var caixa = { id: el.getAttribute('data-id'), cod: cod, el: el, validadoRepo: el.getAttribute('data-validado') };
      var h = el.querySelector('h3, b, p, summary, th');
      caixa.resumo = (h ? h.textContent : el.textContent).replace(/\s+/g, ' ').trim().slice(0, 110);
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'rv-num'; b.setAttribute('data-revisao-ui', '');
      b.textContent = cod;                                         // nasce igual à etiqueta ::after
      b.setAttribute('aria-label', 'Trecho ' + cod + '. Abrir revisão');
      b.addEventListener('click', (function (c) { return function () { abrir(c); }; })(caixa));
      el.appendChild(b);
      caixa.botao = b;
      caixas.push(caixa);
    }
    if (!caixas.length) return;
    document.body.classList.add('rv-ativa');

    /* 2 · digitais em paralelo, não uma de cada vez */
    await Promise.all(caixas.map(function (c) { return digital(c.el).then(function (d) { c.digital = d; }); }));

    /* 3 · quem sou eu e o que já aconteceu nesta página */
    try { var quemSou = await C.eu(); eu = quemSou.email; podeAprovar = !!(quemSou.podeAprovar !== undefined ? quemSou.podeAprovar : quemSou.dono); }
    catch { desligar(); return; }   /* sem API ou sem login: a página volta ao estático */
    // Antes: `catch { eventos = [] }`. Com a rede fora, a página apagava todos os ✓ e ficava
    // indistinguível de "nunca revisado" — e o revisor aprovava de novo, ou abria pedido duplicado,
    // sem nenhum sinal. Num produto cuja premissa é rastreabilidade, é o erro mais caro do arquivo.
    try { eventos = await api('/eventos?pagina=' + encodeURIComponent(pagina)); }
    catch { desligar(); avisar('Não deu para carregar o estado da revisão. Recarregue a página.'); return; }

    /* 4 · só agora o estado (✓ verde, ● âmbar) muda a aparência — de poucos, não de todos */
    caixas.forEach(pintar);
    var alvo = location.hash.match(/^#revisar=(.+)$/);
    if (alvo) { var c = caixas.find(function (x) { return x.id === decodeURIComponent(alvo[1]); }); if (c) { c.el.scrollIntoView({ block: 'center' }); abrir(c); } }
  }
  iniciar();
})();
