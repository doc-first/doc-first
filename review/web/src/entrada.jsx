/**
 * The bridge between a documentation page (HTML from any project) and the React panel.
 *
 * The contract with the page is the same as the classic panel's, and has to stay that way:
 * `.doc-titulo__cod` holding the page code, blocks with `data-id` and `data-cod` inside `<main>`,
 * and — the rule that knocks down the most approvals when forgotten — `data-revisao-ui` on
 * everything JavaScript injects.
 *
 * Each block's button is created here, in the page's own DOM, not by React: the page belongs to
 * whoever adopts the method, and React does not own it. React mounts only the dialog.
 */
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import Painel from './Painel.jsx';
import { quemSouEu, eventosDaPagina, registrar, digitalDo } from './api.js';
import { doTrecho, semaforoDo } from './estado.js';

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

  // Each block's number becomes a button, and the TRAFFIC LIGHT paints it: ⚪ 🟢 🟡 🔴.
  useEffect(() => {
    const digitaisAgora = new Map(trechos.map((t) => [t.id, t.digital]));
    for (const t of trechos) {
      const situacao = doTrecho(eventos, t.id, t.digital);
      const { cor, culpados } = semaforoDo(t, situacao, digitaisAgora);
      t.semaforo = { cor, culpados };
      t.botao.className = 'rv-num'
        + (cor === 'valid' ? ' rv-num--ok' : '')
        + (cor === 'stale' ? ' rv-num--stale' : '')
        + (cor === 'broken' ? ' rv-num--broken' : '')
        + (situacao.abertos.length ? ' rv-num--pedido' : '');
      t.botao.title = cor === 'broken'
        ? `the text is unchanged, but this moved: ${culpados.join(', ')}`
        : '';
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
 * No API, no session, or an error: the page falls back to static, whole and readable.
 *
 * The `motivo` argument is not decoration. The first version did `.catch(() => desligar())` and
 * swallowed everything — the panel simply did not appear, without a line in the console, and there
 * was no way to find out why other than reading the code.
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
    if (!/^\d+\.\d/.test(cod)) continue;               // headings and subheadings get no button

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'rv-num';
    botao.textContent = cod;
    botao.setAttribute('data-revisao-ui', '');          // ⚠️ without this the fingerprint moves
                                                       //    and every approval falls
    botao.setAttribute('aria-label', `Block ${cod}. Open review`);
    el.appendChild(botao);

    trechos.push({
      el, botao, cod,
      id: el.getAttribute('data-id'),
      pagina,
      validado: el.getAttribute('data-validado'),
      depende: (el.getAttribute('data-depende') ?? '').split(/\s+/).filter(Boolean),
      digitalValidada: el.getAttribute('data-digital-validada'),
      // The snapshot of the dependencies at the moment of the ✓, injected into the HTML on mark.
      dependiaDe: JSON.parse(el.getAttribute('data-dependia-de') || '{}'),
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
