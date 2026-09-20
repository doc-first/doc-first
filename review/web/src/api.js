/**
 * The review API client. The only part of the panel that knows HTTP.
 *
 * Everything here belongs to the ENGINE: the routes do not change from project to project. What
 * changes is the content the pages carry, and the panel knows nothing about that.
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
 * The block's fingerprint, computed by the SAME code the server uses — not by a copy.
 *
 * This is what makes an approval mean anything: the text the browser saw and the text the server
 * stored are the same, because the function is the same one.
 */
export async function digitalDo(el) {
  // ABSOLUTE path, not relative: this import stays out of the bundle (it is the core, which the
  // server serves), and the browser resolves it against the bundle's URL — not against this file's
  // folder. With a relative path the browser asked for /core/fingerprint.js and got a silent 404.
  const { fingerprintOfElement } = await import('/review/core/fingerprint.js');
  return fingerprintOfElement(el);
}
