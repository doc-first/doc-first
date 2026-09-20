/* O que TODA página do Arautos precisa, num lugar só. Carregado antes dos outros scripts.

   Por que existe (revisão de dívida, 2026-09-17): cinco arquivos independentes resolviam cada um por
   si os mesmos quatro problemas — escapar HTML, formatar data, ordenar evento e conhecer os rótulos
   de estado. `esc()` estava copiada SEIS vezes, e a cópia do navegacao.js era diferente das outras:
   sem o guarda de nulo, ela escrevia a palavra "undefined" na página. Comparar cópias para achar a
   divergente é exatamente o trabalho que a metodologia promete eliminar.

   Sem módulo ES6 e sem build de propósito: é <script> como os outros, e quem adotar o método não
   precisa de ferramenta nenhuma para ler isto. */
(function () {
  'use strict';

  var A = window.ARAUTOS = window.ARAUTOS || {};

  /* O núcleo compartilhado (review/core/) chega por módulo, em paralelo — ver js/core-web.js.
     A promessa nasce aqui para que quem carregue antes dele não perca o aviso. */
  if (!A.nucleoPronto) {
    A.nucleoPronto = new Promise(function (ok) { A._nucleoResolve = ok; });
  }

  /** Escapa para interpolar em HTML. Inclui aspas simples: atributo com aspas simples também existe. */
  A.esc = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /** Data curta para humano: "17/09 14:32". Devolve '' para data ausente ou inválida —
      `new Date('')` produzia o literal "Invalid Date Invalid Date" na tela. */
  A.quando = function (iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
           d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  /** Ordena eventos do mais antigo ao mais novo.
      O comparador anterior (`a.quando < b.quando ? -1 : 1`) NUNCA devolvia 0, então para dois eventos
      no mesmo instante cmp(a,b) e cmp(b,a) davam 1 — contrato de sort violado, ordem indefinida pela
      especificação. Como o estado de um pedido é decidido pelo ÚLTIMO evento da ordenação, dois
      navegadores podiam mostrar estados diferentes para o mesmo pedido. */
  A.porQuando = function (a, b) {
    return String(a.quando || '').localeCompare(String(b.quando || ''));
  };

  /** Rótulos do ciclo do pedido, na interface. ⚠️ Enquanto o ciclo viver em cinco implementações
      (C#, pedidos.py, revisao.js, shell.js, triagem.html), estes rótulos são a única parte já
      unificada — Python dizia "Para triar" onde o JS dizia "Aguardando triagem". Ver
      docs/DIVIDA-TECNICA.md, seção "A raiz". */
  A.ESTADOS_PEDIDO = {
    aberto: 'Aguardando triagem', aprovado: 'Aprovado', recusado: 'Recusado',
    pergunta: 'Pergunta para quem pediu', analise: 'Em aplicação',
    aguardando: 'Em aplicação · dúvida', aplicado: 'Aplicado'
  };

  A.CATEGORIAS = [['texto', 'Ajustar texto'], ['termo', 'Trocar um termo'],
                  ['remover', 'Remover'], ['duvida', 'Dúvida']];

  A.rotuloEstado = function (e) { return A.ESTADOS_PEDIDO[e] || e || 'Aguardando triagem'; };

  A.rotuloCategoria = function (c) {
    for (var i = 0; i < A.CATEGORIAS.length; i++) if (A.CATEGORIAS[i][0] === c) return A.CATEGORIAS[i][1];
    return 'Pedido';
  };

  /** Quem sou eu, uma vez por página. shell.js e revisao.js pediam /api/eu cada um por sua conta —
      duas requisições idênticas em cada uma das 36 folhas, a cada navegação. A resposta não muda
      durante a visita, então a promessa é guardada e reaproveitada. */
  var _eu = null;
  A.eu = function () {
    if (!_eu) _eu = A.api('/eu');
    return _eu;
  };

  /** Busca na API com o erro à vista. Um `fetch(...).then(r => r.json())` sem checar `ok` estoura
      dentro do json() quando o servidor devolve HTML de erro — e some, se o catch for vazio. */
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
