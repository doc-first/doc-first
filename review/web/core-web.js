/* The bridge between the shared core (ESM, in review/core/) and the pages' classic scripts.
 *
 * Why a bridge, instead of turning everything into a module: a module script is `defer` by
 * definition, and revisao.js MUST be classic to build the buttons before the first paint — that is
 * how the flicker reported on 17/09 was fixed. A module here would undo that fix.
 *
 * So the core arrives in parallel and announces when it is ready. The fingerprint is only used after
 * mounting, so nothing is lost. Whoever needs it does:  await window.DOC_FIRST.nucleoPronto
 */
import { fingerprintOfElement, fingerprintOfText, textOfElement, normalize, SIZE } from '../core/fingerprint.js';

const A = (window.DOC_FIRST = window.DOC_FIRST || {});

/* The KEYS stay in pt-BR: what reads them is the front end, whose identifiers have not been
   translated (layer 2, step 5). The bridge is the right place for that seam — one map in one file,
   instead of two names for the same function scattered across the pages.
   `criarCiclo` left here: the front end does NOT compute the cycle, it receives `situacao` ready
   from the API. It was exported without a single caller, and exporting what nobody calls is an
   invitation to reimplement it. */
A.nucleo = {
  digitalDoElemento: fingerprintOfElement, digitalDoTexto: fingerprintOfText,
  textoDoElemento: textOfElement, normalizar: normalize, TAMANHO: SIZE,
};
A.digital = fingerprintOfElement;       // the name revisao.js already used

// whoever was waiting for the core can go ahead
(A._nucleoResolve || (() => {}))();
A.nucleoPronto = Promise.resolve();
document.dispatchEvent(new CustomEvent('doc-first:nucleo'));
