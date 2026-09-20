import { Firestore, FieldValue } from '@google-cloud/firestore';
import type { Evento, NovoEvento, Registro } from './types.ts';

/** Only for running and testing on the machine. Persists nothing. */
export class RegistroEmMemoria implements Registro {
  #eventos: Evento[] = [];

  async incluir(novo: NovoEvento, autor: string): Promise<Evento> {
    const e: Evento = { ...novo, id: crypto.randomUUID().replace(/-/g, ''), autor, quando: new Date().toISOString() };
    this.#eventos.push(e);
    return e;
  }

  async listar(pagina?: string | null): Promise<Evento[]> {
    return this.#eventos
      .filter((e) => pagina == null || e.pagina === pagina)
      .sort((a, b) => a.quando.localeCompare(b.quando));
  }
}

/**
 * Firestore, `eventos` collection. INSERT ONLY: `create` fails if the document already exists, so
 * no code path overwrites a fact. Here the "nothing is erased" guarantee comes from the code — the
 * project IAM still allows delete, and that is logged as debt in docs/DIVIDA-TECNICA.md.
 */
export class RegistroFirestore implements Registro {
  #db: Firestore;
  constructor(projeto: string) {
    this.#db = new Firestore({ projectId: projeto });
  }

  async incluir(novo: NovoEvento, autor: string): Promise<Evento> {
    const doc = this.#db.collection('eventos').doc();
    await doc.create({
      tipo: novo.tipo, pagina: novo.pagina, caixa: novo.caixa ?? null, digital: novo.digital ?? null,
      texto: novo.texto ?? null, foto: novo.foto ?? null, autor,
      quando: FieldValue.serverTimestamp(), dados: novo.dados ?? {},
    });
    const lido = await doc.get();
    return this.#daFirestore(lido.id, lido.data()!);
  }

  async listar(pagina?: string | null): Promise<Evento[]> {
    let q: FirebaseFirestore.Query = this.#db.collection('eventos');
    if (pagina != null) q = q.where('pagina', '==', pagina);
    const r = await q.get();
    return r.docs
      .map((d) => this.#daFirestore(d.id, d.data()))
      .sort((a, b) => a.quando.localeCompare(b.quando));
  }

  #daFirestore(id: string, d: FirebaseFirestore.DocumentData): Evento {
    return {
      id, tipo: d.tipo, pagina: d.pagina, caixa: d.caixa ?? null, digital: d.digital ?? null,
      texto: d.texto ?? null, foto: d.foto ?? null, autor: d.autor,
      quando: d.quando?.toDate?.().toISOString() ?? new Date(0).toISOString(),
      dados: d.dados ?? null,
    };
  }
}
