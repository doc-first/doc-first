import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import type { Evento } from '../api/types.ts';

const exec = promisify(execFile);

/**
 * Where events come from for the agent's tool: the cloud (REST, with a gcloud token), a local
 * SQLite file, or a local server in memory.
 *
 * ⚠️ Writing straight to the cloud store bypasses the API — and therefore the cycle, the roles and
 * the limits. The right path is for the agent to come in through the API with an identity of its
 * own. Until that exists, reading happens here.
 */
export class Fonte {
  #local: boolean;
  #banco?: string;
  #projeto: string;
  #urlLocal: string;
  #token?: string;
  #conta?: string;
  #preferida?: string;

  constructor(opcoes: { local?: boolean; projeto?: string; urlLocal?: string; conta?: string;
                       banco?: string } = {}) {
    this.#local = opcoes.local ?? false;
    // The events file, when the project runs without a cloud. This is what closes the loop
    // offline: without it, `sincronizar` only worked against the cloud store or against a server
    // in development mode — and a Doc First started from a container is neither.
    this.#banco = opcoes.banco ?? process.env.REVISAO_SQLITE;
    // No hard-coded value: it comes from the project's doc-first.json, or from the environment.
    this.#projeto = opcoes.projeto ?? process.env.REVISAO_PROJETO ?? '';
    this.#urlLocal = opcoes.urlLocal ?? process.env.REVISAO_LOCAL ?? 'http://localhost:8095';
    this.#preferida = process.env.REVISAO_CONTA ?? opcoes.conta;
  }

  /**
   * With no project, the URL comes out as `projects//databases/...` and the cloud answers 400
   * "Invalid resource field value" — an error that tells the reader nothing. Failing here, naming
   * what is missing, costs one line and saves the whole investigation.
   */
  #exigeProjeto(): string {
    if (this.#projeto) return this.#projeto;
    throw new Error(
      'não sei em que projeto da nuvem procurar.\n' +
      '  Preencha `nuvem.projeto` no doc-first.json, ou exporte REVISAO_PROJETO.\n' +
      '  Para trabalhar sem nuvem, use --local com o servidor de pé (bash review/run-local.sh).');
  }

  /**
   * The first gcloud account that actually issues a token.
   *
   * The account used to be hard-coded, and when its credential expired — with the owner on a
   * remote session and no way to redo the login — the tool simply stopped, even though ANOTHER
   * authenticated account on the same machine had access to the project.
   */
  async #contaComToken(): Promise<string> {
    if (this.#conta) return this.#conta;
    let contas: string[] = [];
    try {
      const { stdout } = await exec('gcloud', ['auth', 'list', '--format=value(account)']);
      contas = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch { /* no gcloud: falls through to the clear error below */ }

    // The preferred one first, the others after: the choice stops depending on which account
    // gcloud happens to list first. If the preferred one exists but issues nothing, the others
    // still count — working remotely, with no way to redo a login, must not stop the tool.
    const ordem = this.#preferida
      ? [this.#preferida, ...contas.filter((c) => c !== this.#preferida)]
      : contas;

    for (const c of ordem) {
      try {
        await exec('gcloud', ['auth', 'print-access-token', '--account', c]);
        // Reading the cloud as an identity other than the expected one is something you say out
        // loud.
        if (this.#preferida && c !== this.#preferida) {
          console.warn(`  ⚠ a credencial de ${this.#preferida} não emite token; lendo como ${c}.\n` +
            `    Para voltar ao normal:  gcloud auth login ${this.#preferida} --no-launch-browser`);
        }
        return (this.#conta = c);
      } catch { /* this one issues nothing; try the next */ }
    }

    throw new Error(
      'nenhuma conta do gcloud emite token.\n' +
      '  Quase sempre é a credencial expirada. Resolva com:  gcloud auth login <seu e-mail>\n' +
      '  Sem navegador na máquina (acesso remoto), acrescente:  --no-launch-browser');
  }

  async #tokenDoGcloud(): Promise<string> {
    if (this.#token) return this.#token;
    const conta = await this.#contaComToken();
    try {
      const { stdout } = await exec('gcloud', ['auth', 'print-access-token', '--account', conta]);
      return (this.#token = stdout.trim());
    } catch (e) {
      throw new Error(`o gcloud não conseguiu um token para ${conta}.\n` +
        `  Resolva com:  gcloud auth login ${conta}`);
    }
  }

  /** The cloud's message comes buried in JSON; what helps is that message plus what to do. */
  async #erroDaNuvem(r: Response, oQue: string): Promise<Error> {
    const cru = await r.text();
    let recado = cru.slice(0, 200);
    try { recado = JSON.parse(cru).error?.message ?? recado; } catch { /* it was not JSON */ }
    const conta = this.#conta ?? '(conta desconhecida)';
    const saida = [`erro ${r.status} ao ${oQue} o Firestore: ${recado}`];
    if (r.status === 403) {
      saida.push(`  ${conta} não tem acesso ao projeto ${this.#projeto}.`,
        '  Entre com a conta que tem, ou corrija `nuvem.conta` no doc-first.json.');
    }
    if (r.status === 401) saida.push(`  o token de ${conta} venceu:  gcloud auth login ${conta} --no-launch-browser`);
    return new Error(saida.join('\n'));
  }

  /**
   * Reads events straight from the SQLite file. READ ONLY — never writes: writing through here
   * would bypass the cycle, the roles and the limits.
   */
  async #doArquivo(caminho: string): Promise<Evento[]> {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(caminho, { readOnly: true });
    try {
      const linhas = db.prepare(
        'SELECT id, tipo, pagina, caixa, digital, texto, foto, autor, quando, dados' +
        '  FROM eventos ORDER BY quando').all() as Record<string, any>[];
      return linhas.map((l) => ({
        id: String(l.id), tipo: String(l.tipo), pagina: String(l.pagina),
        caixa: l.caixa ?? null, digital: l.digital ?? null, texto: l.texto ?? null,
        foto: l.foto ?? null, autor: String(l.autor), quando: String(l.quando),
        dados: l.dados ? JSON.parse(String(l.dados)) : null,
      }));
    } finally {
      db.close();
    }
  }

  async eventos(): Promise<Evento[]> {
    // The file comes before the cloud: whoever configured a local database wanted the local one.
    if (this.#banco && existsSync(this.#banco)) return this.#doArquivo(this.#banco);
    if (this.#local) {
      const r = await fetch(`${this.#urlLocal}/api/eventos`, {
        headers: { 'X-Dev-Email': 'agente@local' },
      });
      if (!r.ok) throw new Error(`o servidor local respondeu ${r.status}. Ele está rodando? (bash review/run-local.sh)`);
      return r.json() as Promise<Evento[]>;
    }

    const base = `https://firestore.googleapis.com/v1/projects/${this.#exigeProjeto()}/databases/(default)/documents`;
    const cabecalho = { Authorization: `Bearer ${await this.#tokenDoGcloud()}` };
    const saida: Evento[] = [];
    let pagina: string | undefined;
    do {
      const url = `${base}/eventos?pageSize=300${pagina ? `&pageToken=${pagina}` : ''}`;
      const r = await fetch(url, { headers: cabecalho });
      if (!r.ok) throw await this.#erroDaNuvem(r, 'ler');
      const corpo = (await r.json()) as { documents?: unknown[]; nextPageToken?: string };
      for (const d of corpo.documents ?? []) saida.push(this.#doFirestore(d as Record<string, any>));
      pagina = corpo.nextPageToken;
    } while (pagina);
    return saida.sort((a, b) => a.quando.localeCompare(b.quando));
  }

  /**
   * Records an event. Locally it goes through the API (and therefore through the cycle, the roles
   * and the limits); in the cloud, it writes to the store directly.
   *
   * ⚠️ Writing directly BYPASSES the API, and therefore every validation. The right path is for
   * the agent to have an identity of its own and come in through the API. Until that exists, this
   * is the path — and it is marked as such.
   */
  async incluir(evento: Record<string, unknown>): Promise<string> {
    const autor = `agente via ${await this.#contaComToken().catch(() => 'local')}`;

    if (this.#local) {
      const r = await fetch(`${this.#urlLocal}/api/eventos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-Email': autor },
        body: JSON.stringify(evento),
      });
      if (!r.ok) throw new Error(`o servidor recusou: ${r.status} ${(await r.text()).slice(0, 200)}`);
      return ((await r.json()) as { id: string }).id;
    }

    const base = `https://firestore.googleapis.com/v1/projects/${this.#exigeProjeto()}/databases/(default)/documents`;
    const campos: Record<string, unknown> = { autor: { stringValue: autor } };
    for (const [k, v] of Object.entries(evento)) {
      if (v == null) continue;
      campos[k] = typeof v === 'object'
        ? { mapValue: { fields: Object.fromEntries(Object.entries(v as object).map(([a, b]) => [a, { stringValue: String(b) }])) } }
        : { stringValue: String(v) };
    }
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const r = await fetch(`${base.replace('/documents', '')}/documents:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.#tokenDoGcloud()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [{
          update: { name: `projects/${this.#projeto}/databases/(default)/documents/eventos/${id}`, fields: campos },
          currentDocument: { exists: false },                     // insert only, never overwrite
          updateTransforms: [{ fieldPath: 'quando', setToServerValue: 'REQUEST_TIME' }],
        }],
      }),
    });
    if (!r.ok) throw await this.#erroDaNuvem(r, 'gravar n');
    return id;
  }

  #doFirestore(d: Record<string, any>): Evento {
    const f = d.fields ?? {};
    const s = (k: string) => f[k]?.stringValue ?? null;
    const dados: Record<string, string> = {};
    for (const [k, v] of Object.entries(f.dados?.mapValue?.fields ?? {})) {
      dados[k] = (v as any).stringValue;
    }
    return {
      id: String(d.name).split('/').pop()!,
      tipo: s('tipo')!, pagina: s('pagina')!, caixa: s('caixa'), digital: s('digital'),
      texto: s('texto'), foto: s('foto'), autor: s('autor')!,
      quando: f.quando?.timestampValue ?? '',
      dados: Object.keys(dados).length ? dados : null,
    };
  }
}
