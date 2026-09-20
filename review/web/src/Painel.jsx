/**
 * The review panel, in React. It is the window that opens when someone clicks a block's number.
 *
 * What it does NOT do, and that is the point: it does not compute the request cycle. `situacao`
 * arrives ready from the server, and `situacao.triagem` is the list of allowed destinations — that
 * list is what decides which buttons exist. When the front end computed this, it and the server
 * disagreed about the same request.
 */
import { useEffect, useRef, useState } from 'react';
import { doTrecho, porQuando } from './estado.js';

const dia = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
const quem = (email, eu) => (email === eu ? 'You' : email);

function Selo({ situacao, validadoEm }) {
  if (validadoEm) return <b className="rv-selo rv-selo--repo">✓ validated on {dia(validadoEm)}</b>;
  if (situacao.aprovado) return <b className="rv-selo rv-selo--ok">✓ approved</b>;
  if (situacao.vencidas.length) {
    return <b className="rv-selo rv-selo--aviso">the text changed after the approval</b>;
  }
  if (situacao.abertos.length) {
    return <b className="rv-selo rv-selo--pedido">{situacao.abertos.length} request(s) in progress</b>;
  }
  return null;
}

const ROTULO = {
  aberto: 'Awaiting triage', aprovado: 'Approved', recusado: 'Declined',
  pergunta: 'Question for the requester', analise: 'Being applied',
  aguardando: 'Being applied · question', aplicado: 'Applied',
};

/**
 * The owner's triage: deciding where a request someone filed goes next.
 *
 * The buttons come from `situacao.triagem`, which the SERVER computes — not a list written here.
 * That is what keeps the front end and the server from disagreeing: on an already approved request
 * the triage arrives empty, and the "Approve" button simply does not exist, instead of existing and
 * failing on click.
 */
function Triagem({ pedido, aoDecidir }) {
  const [destino, setDestino] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [indo, setIndo] = useState(false);
  const [erro, setErro] = useState('');

  const s = pedido.situacao ?? {};
  const destinos = s.triagem ?? [];
  if (!destinos.length) return null;

  const precisaMotivo = destino && (s.exigeMotivo ?? []).includes(destino);

  async function decidir() {
    if (precisaMotivo && !motivo.trim()) { setErro('give the reason, or the question'); return; }
    setIndo(true); setErro('');
    try {
      await aoDecidir({
        tipo: 'pedido_estado', pagina: pedido.pagina, caixa: pedido.caixa,
        texto: motivo.trim() || null,
        dados: { pedido: pedido.id, estado: destino },
      });
      setDestino(null); setMotivo('');
    } catch (e) {
      setErro(String(e.message ?? e));
    } finally {
      setIndo(false);
    }
  }

  return (
    <div className="rv-triagem">
      <p className="rv-estado">
        Request from {pedido.autor}: <b>{ROTULO[s.estado] ?? s.estado}</b>
      </p>
      {destinos.map((d) => (
        <button key={d} type="button" data-t={d}
                className={destino === d ? 'rv-ativa' : ''}
                onClick={() => setDestino(destino === d ? null : d)}>
          {ROTULO[d] ?? d}
        </button>
      ))}
      {destino ? (
        <div className="rv-form">
          {precisaMotivo ? (
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3}
                      placeholder={destino === 'pergunta' ? 'What do you want to ask?' : 'Why are you declining it?'} />
          ) : null}
          <button type="button" className="rv-enviar" onClick={decidir} disabled={indo}>
            {indo ? 'recording…' : `Confirm: ${ROTULO[destino] ?? destino}`}
          </button>
        </div>
      ) : null}
      {erro ? <p className="rv-aviso">{erro}</p> : null}
    </div>
  );
}

function Historico({ eventos, eu }) {
  if (!eventos.length) return null;
  return (
    <div className="rv-hist">
      <h4 className="rv-hist-titulo">What has happened here</h4>
      {[...eventos].sort(porQuando).map((e) => (
        <p key={e.id} className={`rv-h rv-h--${e.tipo === 'aprovacao' ? 'aprov' : 'pedido'}`}>
          <span className="rv-estado">{dia(e.quando)}</span> {quem(e.autor, eu)}
          {e.tipo === 'aprovacao' ? ' approved' : ' requested a change'}
          {e.texto ? <>: {e.texto}</> : null}
          {e.foto ? (
            <details className="rv-foto">
              <summary>the text at the time</summary>
              <p>{e.foto}</p>
            </details>
          ) : null}
        </p>
      ))}
    </div>
  );
}

export default function Painel({ trecho, eu, podeAprovar, eventos, aoRegistrar, aoFechar }) {
  const dlg = useRef(null);
  const [aba, setAba] = useState(null);
  const [texto, setTexto] = useState('');
  const [categoria, setCategoria] = useState('texto');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (trecho && !dlg.current?.open) dlg.current?.showModal();
    if (!trecho && dlg.current?.open) dlg.current?.close();
    setAba(null); setTexto(''); setErro('');
  }, [trecho]);

  if (!trecho) return <dialog className="rv-painel" data-revisao-ui ref={dlg} />;

  const situacao = doTrecho(eventos, trecho.id, trecho.digital);

  async function enviar(tipo) {
    if (tipo === 'pedido' && !texto.trim()) { setErro('write what needs to change'); return; }
    setEnviando(true); setErro('');
    try {
      await aoRegistrar({
        tipo, pagina: trecho.pagina, caixa: trecho.id, digital: trecho.digital,
        texto: texto.trim() || null,
        // The snapshot is the text at the instant of recording, and it has to be THE SAME text the
        // fingerprint looked at. Otherwise the history shows one thing and the fingerprint talks
        // about another.
        foto: trecho.texto,
        dados: tipo === 'pedido' ? { categoria } : null,
      });
      setTexto(''); setAba(null);
    } catch (e) {
      setErro(String(e.message ?? e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <dialog className="rv-painel" data-revisao-ui ref={dlg} onClose={aoFechar}>
      <header className="rv-cabeca">
        <h3>Block {trecho.cod}</h3>
        <button type="button" className="rv-fechar" onClick={aoFechar} aria-label="Close">✕</button>
      </header>

      <p className="rv-resumo">{trecho.resumo}</p>
      <p className="rv-situacao"><Selo situacao={situacao} validadoEm={trecho.validado} /></p>

      {/* Red with no reason makes a person re-approve out of fright — which is exactly what the lock
          exists to prevent. So the panel says WHAT changed, and sends them to look there before
          deciding here. */}
      {trecho.semaforo?.cor === 'broken' ? (
        <div className="rv-quebrado">
          <b>This text has not changed, but the ground under it has.</b>
          It depends on {trecho.semaforo.culpados.map((c) => <code key={c}>{c}</code>)},
          {' '}and that changed after you approved here. Check it is still true before approving
          again.
        </div>
      ) : null}

      <div className="rv-acoes">
        {podeAprovar && !situacao.aprovado ? (
          <button type="button" onClick={() => enviar('aprovacao')} disabled={enviando}>
            ✓ Approve this block
          </button>
        ) : null}
        <button type="button" className={aba === 'pedido' ? 'rv-ativa' : ''}
                onClick={() => setAba(aba === 'pedido' ? null : 'pedido')}>
          Request a change
        </button>
      </div>

      {aba === 'pedido' ? (
        <div className="rv-form">
          <label>
            What it is
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="texto">Adjust the text</option>
              <option value="termo">Change a term</option>
              <option value="remover">Remove</option>
              <option value="duvida">Question</option>
            </select>
          </label>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4}
                    placeholder="What needs to change, and why." />
          <button type="button" className="rv-enviar" onClick={() => enviar('pedido')} disabled={enviando}>
            {enviando ? 'sending…' : 'Send request'}
          </button>
        </div>
      ) : null}

      {erro ? <p className="rv-aviso">{erro}</p> : null}

      {/* Triage shows only for whoever can triage, and only on requests that still have a destination. */}
      {podeAprovar
        ? situacao.pedidos.map((p) => <Triagem key={p.id} pedido={p} aoDecidir={aoRegistrar} />)
        : null}

      <Historico eventos={situacao.eventos} eu={eu} />
    </dialog>
  );
}
