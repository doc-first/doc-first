/**
 * O painel de revisão, em React. É a janela que abre quando alguém clica no número de um trecho.
 *
 * O que ele NÃO faz, e é o ponto: não calcula o ciclo do pedido. `situacao` vem pronta do servidor,
 * e `situacao.triagem` é a lista de destinos permitidos — é ela que decide quais botões existem.
 * Quando o front calculava isso, ele e o servidor discordavam sobre o mesmo pedido.
 */
import { useEffect, useRef, useState } from 'react';
import { registrar } from './api.js';
import { doTrecho, porQuando } from './estado.js';

const dia = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
const quem = (email, eu) => (email === eu ? 'Você' : email);

function Selo({ situacao, validadoEm }) {
  if (validadoEm) return <b className="rv-selo rv-selo--repo">✓ validado em {dia(validadoEm)}</b>;
  if (situacao.aprovado) return <b className="rv-selo rv-selo--ok">✓ aprovado</b>;
  if (situacao.vencidas.length) {
    return <b className="rv-selo rv-selo--aviso">o texto mudou desde a aprovação</b>;
  }
  if (situacao.abertos.length) {
    return <b className="rv-selo rv-selo--pedido">{situacao.abertos.length} pedido(s) em andamento</b>;
  }
  return null;
}

function Historico({ eventos, eu }) {
  if (!eventos.length) return null;
  return (
    <div className="rv-hist">
      <h4 className="rv-hist-titulo">O que já aconteceu aqui</h4>
      {[...eventos].sort(porQuando).map((e) => (
        <p key={e.id} className={`rv-h rv-h--${e.tipo === 'aprovacao' ? 'aprov' : 'pedido'}`}>
          <span className="rv-estado">{dia(e.quando)}</span> {quem(e.autor, eu)}
          {e.tipo === 'aprovacao' ? ' aprovou' : ' pediu alteração'}
          {e.texto ? <>: {e.texto}</> : null}
          {e.foto ? (
            <details className="rv-foto">
              <summary>o texto de então</summary>
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
    if (tipo === 'pedido' && !texto.trim()) { setErro('escreva o que precisa mudar'); return; }
    setEnviando(true); setErro('');
    try {
      await aoRegistrar({
        tipo, pagina: trecho.pagina, caixa: trecho.id, digital: trecho.digital,
        texto: texto.trim() || null,
        // A foto é o texto no instante do registro, e tem de ser O MESMO que a digital considerou.
        // Senão o histórico mostra uma coisa e a digital fala de outra.
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
        <h3>Trecho {trecho.cod}</h3>
        <button type="button" className="rv-fechar" onClick={aoFechar} aria-label="Fechar">✕</button>
      </header>

      <p className="rv-resumo">{trecho.resumo}</p>
      <p className="rv-situacao"><Selo situacao={situacao} validadoEm={trecho.validado} /></p>

      <div className="rv-acoes">
        {podeAprovar && !situacao.aprovado ? (
          <button type="button" onClick={() => enviar('aprovacao')} disabled={enviando}>
            ✓ Aprovar este trecho
          </button>
        ) : null}
        <button type="button" className={aba === 'pedido' ? 'rv-ativa' : ''}
                onClick={() => setAba(aba === 'pedido' ? null : 'pedido')}>
          Pedir alteração
        </button>
      </div>

      {aba === 'pedido' ? (
        <div className="rv-form">
          <label>
            O que é
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="texto">Ajustar texto</option>
              <option value="termo">Trocar um termo</option>
              <option value="remover">Remover</option>
              <option value="duvida">Dúvida</option>
            </select>
          </label>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4}
                    placeholder="O que precisa mudar, e por quê." />
          <button type="button" className="rv-enviar" onClick={() => enviar('pedido')} disabled={enviando}>
            {enviando ? 'enviando…' : 'Enviar pedido'}
          </button>
        </div>
      ) : null}

      {erro ? <p className="rv-aviso">{erro}</p> : null}

      <Historico eventos={situacao.eventos} eu={eu} />
    </dialog>
  );
}
