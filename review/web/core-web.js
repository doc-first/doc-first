/* Ponte entre o núcleo compartilhado (ESM, em review/core/) e os scripts clássicos das páginas.
 *
 * Por que uma ponte, e não converter tudo para módulo: script de módulo é `defer` por definição, e o
 * revisao.js PRECISA ser clássico para montar os botões antes do primeiro paint — foi assim que a
 * piscada relatada em 17/09 foi corrigida. Módulo aqui desfaria aquela correção.
 *
 * Então o núcleo chega em paralelo e avisa quando está pronto. A digital só é usada depois da
 * montagem, então nada se perde. Quem precisa dela faz:  await window.DOC_FIRST.nucleoPronto
 */
import { fingerprintOfElement, fingerprintOfText, textOfElement, normalize, SIZE } from '../core/fingerprint.js';

const A = (window.DOC_FIRST = window.DOC_FIRST || {});

/* As CHAVES continuam em pt-BR: quem as lê é o front, que ainda não foi traduzido (camada 2,
   passo 5). A ponte é o lugar certo para essa costura — um mapa num arquivo só, em vez de dois
   nomes para a mesma função espalhados pelas páginas.
   `criarCiclo` saiu daqui: o front NÃO calcula ciclo, recebe `situacao` pronta da API. Ele estava
   exportado sem nenhum uso, e exportar o que ninguém chama é convidar alguém a reimplementar. */
A.nucleo = {
  digitalDoElemento: fingerprintOfElement, digitalDoTexto: fingerprintOfText,
  textoDoElemento: textOfElement, normalizar: normalize, TAMANHO: SIZE,
};
A.digital = fingerprintOfElement;       // o nome que revisao.js já usava

// quem esperava pelo núcleo pode seguir
(A._nucleoResolve || (() => {}))();
A.nucleoPronto = Promise.resolve();
document.dispatchEvent(new CustomEvent('doc-first:nucleo'));
