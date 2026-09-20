/** A fact from the review. Only created — never altered, never deleted. */
export interface Evento {
  id: string;
  tipo: string;            // aprovacao · pedido · comentario · resposta_decisao · pedido_estado · complemento
  pagina: string;          // D01, T07, UC-01…
  caixa?: string | null;   // D01.1.4 (null when the event belongs to the page or to a decision)
  digital?: string | null; // fingerprint of the text at that moment: the approval holds for THIS text
  texto?: string | null;
  foto?: string | null;    // the text of the block at that instant
  autor: string;           // e-mail verified by IAP
  quando: string;          // ISO, server clock
  // The same shape the core reads (review/core/cycle.js, typedef Dados): `pedido` and `estado`
  // on pedido_estado, `commit` on the applied one, `categoria` on the request. `unknown` forces
  // the reader to check the type — it was `string` and it lied, because `dados.relacionado`
  // already holds an object.
  dados?: { pedido?: string; estado?: string; de?: string; [k: string]: unknown } | null;
}

export type NovoEvento = Omit<Evento, 'id' | 'autor' | 'quando'>;

/** Persistence. The in-memory registry and Firestore implement the same contract. */
export interface Registro {
  incluir(novo: NovoEvento, autor: string): Promise<Evento>;
  listar(pagina?: string | null): Promise<Evento[]>;
}

export const TIPOS_DE_EVENTO = new Set([
  'aprovacao', 'pedido', 'comentario', 'resposta_decisao', 'pedido_estado', 'complemento',
]);
