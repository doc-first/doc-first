/**
 * O cliente da API de revisão. É a única parte do painel que conhece HTTP.
 *
 * Tudo aqui é do MOTOR: as rotas não mudam de projeto para projeto. O que muda é o conteúdo que
 * as folhas trazem, e disso o painel não sabe nada.
 */

const API = '/api';

async function fala(caminho, corpo) {
  const r = await fetch(API + caminho, corpo
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }
    : undefined);
  if (!r.ok) throw new Error(`${r.status} em ${caminho}`);
  return r.json();
}

export const quemSouEu = () => fala('/eu');
export const eventosDaPagina = (pagina) => fala(`/eventos?pagina=${encodeURIComponent(pagina)}`);
export const registrar = (evento) => fala('/eventos', evento);

/**
 * A digital do trecho, calculada pelo MESMO código que o servidor usa — não por uma cópia.
 * É isto que faz uma aprovação valer: o texto que o navegador viu e o que o servidor guardou são
 * o mesmo, porque a função é a mesma.
 */
export async function digitalDo(el) {
  // Caminho ABSOLUTO, e não relativo: o import fica de fora do bundle (é o núcleo, que o servidor
  // serve), e o navegador resolve contra a URL do bundle — não contra a pasta deste arquivo.
  // Com `../../core/` o navegador pedia /core/fingerprint.js e recebia 404 em silêncio.
  const { fingerprintOfElement } = await import('/review/core/fingerprint.js');
  return fingerprintOfElement(el);
}
