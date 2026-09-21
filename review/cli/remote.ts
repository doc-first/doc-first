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
 *
 * ⚠️ Every message thrown from here is English and hard-coded. These are the lines somebody pastes
 * into a chat when the tool refuses to start, and each one names the exact command that fixes it —
 * a message that changes wording with the machine's locale cannot be searched for, and a message
 * that only states the failure leaves the reader to guess the remedy.
 */
export class Source {
  #local: boolean;
  #db?: string;
  #project: string;
  #localUrl: string;
  #token?: string;
  #account?: string;
  #preferredAccount?: string;

  constructor(options: { local?: boolean; project?: string; localUrl?: string; account?: string;
                        db?: string } = {}) {
    this.#local = options.local ?? false;
    // The events file, when the project runs without a cloud. This is what closes the loop
    // offline: without it, `sync` only worked against the cloud store or against a server
    // in development mode — and a Doc First started from a container is neither.
    this.#db = options.db ?? process.env.REVISAO_SQLITE;
    // No hard-coded value: it comes from the project's doc-first.json, or from the environment.
    this.#project = options.project ?? process.env.REVISAO_PROJETO ?? '';
    this.#localUrl = options.localUrl ?? process.env.REVISAO_LOCAL ?? 'http://localhost:8095';
    this.#preferredAccount = process.env.REVISAO_CONTA ?? options.account;
  }

  /**
   * With no project, the URL comes out as `projects//databases/...` and the cloud answers 400
   * "Invalid resource field value" — an error that tells the reader nothing. Failing here, naming
   * what is missing, costs one line and saves the whole investigation.
   */
  #requireProject(): string {
    if (this.#project) return this.#project;
    throw new Error(
      'I do not know which cloud project to look in.\n' +
      '  Fill in `nuvem.projeto` in doc-first.json, or export REVISAO_PROJETO.\n' +
      '  To work with no cloud, use --local with the server up (bash review/run-local.sh).');
  }

  /**
   * The first gcloud account that actually issues a token.
   *
   * The account used to be hard-coded, and when its credential expired — with the owner on a
   * remote session and no way to redo the login — the tool simply stopped, even though ANOTHER
   * authenticated account on the same machine had access to the project.
   */
  async #accountWithToken(): Promise<string> {
    if (this.#account) return this.#account;
    let accounts: string[] = [];
    try {
      const { stdout } = await exec('gcloud', ['auth', 'list', '--format=value(account)']);
      accounts = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch { /* no gcloud: falls through to the clear error below */ }

    // The preferred one first, the others after: the choice stops depending on which account
    // gcloud happens to list first. If the preferred one exists but issues nothing, the others
    // still count — working remotely, with no way to redo a login, must not stop the tool.
    const order = this.#preferredAccount
      ? [this.#preferredAccount, ...accounts.filter((c) => c !== this.#preferredAccount)]
      : accounts;

    for (const candidate of order) {
      try {
        await exec('gcloud', ['auth', 'print-access-token', '--account', candidate]);
        // Reading the cloud as an identity other than the expected one is something you say out
        // loud.
        if (this.#preferredAccount && candidate !== this.#preferredAccount) {
          console.warn(`  ⚠ the credential for ${this.#preferredAccount} issues no token; reading as ${candidate}.\n` +
            `    To get back to normal:  gcloud auth login ${this.#preferredAccount} --no-launch-browser`);
        }
        return (this.#account = candidate);
      } catch { /* this one issues nothing; try the next */ }
    }

    throw new Error(
      'no gcloud account issues a token.\n' +
      '  Almost always an expired credential. Fix it with:  gcloud auth login <your e-mail>\n' +
      '  With no browser on the machine (remote access), add:  --no-launch-browser');
  }

  async #gcloudToken(): Promise<string> {
    if (this.#token) return this.#token;
    const account = await this.#accountWithToken();
    try {
      const { stdout } = await exec('gcloud', ['auth', 'print-access-token', '--account', account]);
      return (this.#token = stdout.trim());
    } catch {
      throw new Error(`gcloud could not get a token for ${account}.\n` +
        `  Fix it with:  gcloud auth login ${account}`);
    }
  }

  /**
   * The cloud's message comes buried in JSON; what helps is that message plus what to do.
   *
   * `what` is a verb phrase — `reading` or `writing to` — so the sentence reads as one line
   * instead of a template with a hole in it.
   */
  async #cloudError(r: Response, what: string): Promise<Error> {
    const raw = await r.text();
    let detail = raw.slice(0, 200);
    try { detail = JSON.parse(raw).error?.message ?? detail; } catch { /* it was not JSON */ }
    const account = this.#account ?? '(unknown account)';
    const out = [`error ${r.status} ${what} Firestore: ${detail}`];
    if (r.status === 403) {
      out.push(`  ${account} has no access to project ${this.#project}.`,
        '  Sign in with the account that does, or fix `nuvem.conta` in doc-first.json.');
    }
    if (r.status === 401) out.push(`  the token for ${account} expired:  gcloud auth login ${account} --no-launch-browser`);
    return new Error(out.join('\n'));
  }

  /**
   * Reads events straight from the SQLite file. READ ONLY — never writes: writing through here
   * would bypass the cycle, the roles and the limits.
   */
  async #fromFile(path: string): Promise<Evento[]> {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const rows = db.prepare(
        'SELECT id, tipo, pagina, caixa, digital, texto, foto, autor, quando, dados' +
        '  FROM eventos ORDER BY quando').all() as Record<string, any>[];
      return rows.map((row) => ({
        id: String(row.id), tipo: String(row.tipo), pagina: String(row.pagina),
        caixa: row.caixa ?? null, digital: row.digital ?? null, texto: row.texto ?? null,
        foto: row.foto ?? null, autor: String(row.autor), quando: String(row.quando),
        dados: row.dados ? JSON.parse(String(row.dados)) : null,
      }));
    } finally {
      db.close();
    }
  }

  async events(): Promise<Evento[]> {
    // The file comes before the cloud: whoever configured a local database wanted the local one.
    if (this.#db && existsSync(this.#db)) return this.#fromFile(this.#db);
    if (this.#local) {
      const r = await fetch(`${this.#localUrl}/api/eventos`, {
        headers: { 'X-Dev-Email': 'agent@local' },
      });
      if (!r.ok) throw new Error(`the local server answered ${r.status}. Is it running? (bash review/run-local.sh)`);
      return r.json() as Promise<Evento[]>;
    }

    const base = `https://firestore.googleapis.com/v1/projects/${this.#requireProject()}/databases/(default)/documents`;
    const headers = { Authorization: `Bearer ${await this.#gcloudToken()}` };
    const out: Evento[] = [];
    let page: string | undefined;
    do {
      const url = `${base}/eventos?pageSize=300${page ? `&pageToken=${page}` : ''}`;
      const r = await fetch(url, { headers });
      if (!r.ok) throw await this.#cloudError(r, 'reading');
      const body = (await r.json()) as { documents?: unknown[]; nextPageToken?: string };
      for (const d of body.documents ?? []) out.push(this.#fromFirestore(d as Record<string, any>));
      page = body.nextPageToken;
    } while (page);
    return out.sort((a, b) => a.quando.localeCompare(b.quando));
  }

  /**
   * Records an event. Locally it goes through the API (and therefore through the cycle, the roles
   * and the limits); in the cloud, it writes to the store directly.
   *
   * ⚠️ Writing directly BYPASSES the API, and therefore every validation. The right path is for
   * the agent to have an identity of its own and come in through the API. Until that exists, this
   * is the path — and it is marked as such.
   */
  async add(event: Record<string, unknown>): Promise<string> {
    const author = `agent via ${await this.#accountWithToken().catch(() => 'local')}`;

    if (this.#local) {
      const r = await fetch(`${this.#localUrl}/api/eventos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-Email': author },
        body: JSON.stringify(event),
      });
      if (!r.ok) throw new Error(`the server refused it: ${r.status} ${(await r.text()).slice(0, 200)}`);
      return ((await r.json()) as { id: string }).id;
    }

    const base = `https://firestore.googleapis.com/v1/projects/${this.#requireProject()}/databases/(default)/documents`;
    const fields: Record<string, unknown> = { autor: { stringValue: author } };
    for (const [k, v] of Object.entries(event)) {
      if (v == null) continue;
      fields[k] = typeof v === 'object'
        ? { mapValue: { fields: Object.fromEntries(Object.entries(v as object).map(([a, b]) => [a, { stringValue: String(b) }])) } }
        : { stringValue: String(v) };
    }
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const r = await fetch(`${base.replace('/documents', '')}/documents:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.#gcloudToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [{
          update: { name: `projects/${this.#project}/databases/(default)/documents/eventos/${id}`, fields },
          currentDocument: { exists: false },                     // insert only, never overwrite
          updateTransforms: [{ fieldPath: 'quando', setToServerValue: 'REQUEST_TIME' }],
        }],
      }),
    });
    if (!r.ok) throw await this.#cloudError(r, 'writing to');
    return id;
  }

  #fromFirestore(d: Record<string, any>): Evento {
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
