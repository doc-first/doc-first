/**
 * A ponte entre a página de documentação (HTML de qualquer projeto) e o painel React.
 *
 * O contrato com a página é o mesmo do painel clássico, e tem de continuar sendo: `.doc-titulo__cod`
 * com o código da página, trechos com `data-id` e `data-cod` dentro de `<main>`, e — a regra que
 * mais derruba aprovação quando esquecida — `data-revisao-ui` em tudo que o JavaScript injeta.
 *
 * O botão de cada trecho é criado aqui, no DOM da página, e não pelo React: a página é de quem
 * adota o método, e o React não é dono dela. O React monta só a janela.
 */
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import Painel from './Painel.jsx';
import { quemSouEu, eventosDaPagina, registrar, digitalDo } from './api.js';
import { doTrecho } from './estado.js';

const pagina = (document.querySelector('.doc-titulo__cod')?.textContent ?? '').trim();

function textoVisivel(el) {
  const copia = el.cloneNode(true);
  copia.querySelectorAll('[data-revisao-ui]').forEach((x) => x.remove());
  return (copia.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function resumoDe(el) {
  const alvo = el.querySelector('h3, b, p, summary, th') ?? el;
  return (alvo.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 110);
}

function App({ trechos }) {
  const [aberto, setAberto] = useState(null);
  const [eu, setEu] = useState(null);
  const [podeAprovar, setPodeAprovar] = useState(false);
  const [eventos, setEventos] = useState([]);

  async function recarregar() {
    setEventos(await eventosDaPagina(pagina));
  }

  useEffect(() => {
    (async () => {
      const q = await quemSouEu();
      setEu(q.email);
      setPodeAprovar(q.podeAprovar ?? q.dono ?? false);
      await recarregar();
    })().catch((e) => desligar(e));
  }, []);

  // O número de cada trecho vira botão, e o estado pinta nele.
  useEffect(() => {
    for (const t of trechos) {
      const situacao = doTrecho(eventos, t.id, t.digital);
      t.botao.className = 'rv-num' + (situacao.aprovado || t.validado ? ' rv-num--ok'
        : situacao.abertos.length ? ' rv-num--pedido' : '');
      t.botao.onclick = () => setAberto(t);
    }
  }, [eventos, trechos]);

  return (
    <Painel
      trecho={aberto}
      eu={eu}
      podeAprovar={podeAprovar}
      eventos={eventos}
      aoRegistrar={async (e) => { await registrar(e); await recarregar(); }}
      aoFechar={() => setAberto(null)}
    />
  );
}

/**
 * Sem API, sem sessão ou com erro: a página volta ao estático, inteira e legível.
 *
 * O `motivo` não é decoração. A primeira versão fazia `.catch(() => desligar())` e engolia tudo —
 * o painel simplesmente não aparecia, sem uma linha no console, e não havia como descobrir por quê
 * a não ser lendo o código.
 */
function desligar(motivo) {
  if (motivo) console.warn('[doc-first] painel desligado:', motivo);
  document.body.classList.remove('rv-ativa');
  document.querySelectorAll('[data-revisao-ui]').forEach((x) => x.remove());
}

async function iniciar() {
  if (!pagina || location.protocol === 'file:') return;

  const trechos = [];
  for (const el of document.querySelectorAll('main [data-id][data-cod]')) {
    const cod = el.getAttribute('data-cod');
    if (!/^\d+\.\d/.test(cod)) continue;               // título e subtítulo não ganham botão

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'rv-num';
    botao.textContent = cod;
    botao.setAttribute('data-revisao-ui', '');          // ⚠️ sem isto, a digital muda e tudo cai
    botao.setAttribute('aria-label', `Trecho ${cod}. Abrir revisão`);
    el.appendChild(botao);

    trechos.push({
      el, botao, cod,
      id: el.getAttribute('data-id'),
      pagina,
      validado: el.getAttribute('data-validado'),
      resumo: resumoDe(el),
      texto: textoVisivel(el),
      digital: await digitalDo(el),
    });
  }
  if (!trechos.length) return;

  document.body.classList.add('rv-ativa');
  const onde = document.createElement('div');
  onde.setAttribute('data-revisao-ui', '');
  document.body.appendChild(onde);
  createRoot(onde).render(<App trechos={trechos} />);
}

iniciar().catch((e) => desligar(e));
