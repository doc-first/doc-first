/** Um fato da revisão. Só é criado — nunca alterado nem apagado. */
export interface Evento {
  id: string;
  tipo: string;            // aprovacao · pedido · comentario · resposta_decisao · pedido_estado · complemento
  pagina: string;          // D01, T07, UC-01…
  caixa?: string | null;   // D01.1.4 (nulo quando o evento é da página ou de uma decisão)
  digital?: string | null; // digital do texto no momento: a aprovação vale para ESTE texto
  texto?: string | null;
  foto?: string | null;    // o texto do trecho naquele instante
  autor: string;           // e-mail verificado pelo IAP
  quando: string;          // ISO, hora do servidor
  // O mesmo formato que o núcleo lê (review/core/cycle.js, typedef Dados): `pedido` e `estado`
  // no pedido_estado, `commit` no aplicado, `categoria` no pedido. `unknown` obriga quem lê a
  // conferir o tipo — era `string` e mentia, porque `dados.relacionado` já guarda objeto.
  dados?: { pedido?: string; estado?: string; de?: string; [k: string]: unknown } | null;
}

export type NovoEvento = Omit<Evento, 'id' | 'autor' | 'quando'>;

/** Persistência. O registro em memória e o Firestore implementam o mesmo contrato. */
export interface Registro {
  incluir(novo: NovoEvento, autor: string): Promise<Evento>;
  listar(pagina?: string | null): Promise<Evento[]>;
}

export const TIPOS_DE_EVENTO = new Set([
  'aprovacao', 'pedido', 'comentario', 'resposta_decisao', 'pedido_estado', 'complemento',
]);
