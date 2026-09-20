import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import type { Evento } from '../api/types.ts';

const exec = promisify(execFile);

/**
 * De onde vêm os eventos para a ferramenta do agente: do Firestore na nuvem (REST, com o token do
 * gcloud) ou do servidor local em memória.
 *
 * ⚠️ Escrever direto no Firestore contorna a API — e portanto o ciclo, os papéis e os limites. Está
 * registrado como o achado S3 em docs/DIVIDA-TECNICA.md, e o caminho certo é o agente entrar pela
 * API com identidade própria. Enquanto isso não existe, a leitura é por aqui.
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
    // O arquivo de eventos, quando o projeto roda sem nuvem. É o caminho que fecha o ciclo sem
    // Google: sem ele, `sincronizar` só funcionava contra o Firestore ou contra um servidor em modo
    // de desenvolvimento — e um Doc First que sobe por contêiner não é nenhum dos dois.
    this.#banco = opcoes.banco ?? process.env.REVISAO_SQLITE;
    // Sem valor fixo: vem do doc-first.json do projeto, ou do ambiente.
    this.#projeto = opcoes.projeto ?? process.env.REVISAO_PROJETO ?? '';
    this.#urlLocal = opcoes.urlLocal ?? process.env.REVISAO_LOCAL ?? 'http://localhost:8095';
    this.#preferida = process.env.REVISAO_CONTA ?? opcoes.conta;
  }

  /**
   * Sem projeto, a URL do Firestore sai como `projects//databases/...` e a nuvem responde 400
   * "Invalid resource field value" — erro que não diz nada a quem está lendo. Falhar aqui, com o
   * nome do que falta, custa uma linha e economiza a investigação inteira.
   */
  #exigeProjeto(): string {
    if (this.#projeto) return this.#projeto;
    throw new Error(
      'não sei em que projeto da nuvem procurar.\n' +
      '  Preencha `nuvem.projeto` no doc-first.json, ou exporte REVISAO_PROJETO.\n' +
      '  Para trabalhar sem nuvem, use --local com o servidor de pé (bash review/run-local.sh).');
  }

  /**
   * Primeira conta do gcloud que realmente emite token.
   * A conta era fixa no código, e quando a credencial dela expirou — com o Ale remoto, sem como
   * refazer o login — a ferramenta parou, embora OUTRA conta autenticada na mesma máquina tivesse
   * acesso ao projeto.
   */
  async #contaComToken(): Promise<string> {
    if (this.#conta) return this.#conta;
    let contas: string[] = [];
    try {
      const { stdout } = await exec('gcloud', ['auth', 'list', '--format=value(account)']);
      contas = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch { /* gcloud ausente: cai no erro claro abaixo */ }

    // A preferida primeiro, e só depois as outras: a escolha deixa de depender de qual conta o
    // gcloud lista antes. Se a preferida existe mas não emite, as outras ainda valem — trabalhar
    // remoto, sem como refazer um login, não pode parar a ferramenta.
    const ordem = this.#preferida
      ? [this.#preferida, ...contas.filter((c) => c !== this.#preferida)]
      : contas;

    for (const c of ordem) {
      try {
        await exec('gcloud', ['auth', 'print-access-token', '--account', c]);
        // Ler a nuvem com uma identidade que não é a esperada é coisa que se diz em voz alta.
        if (this.#preferida && c !== this.#preferida) {
          console.warn(`  ⚠ a credencial de ${this.#preferida} não emite token; lendo como ${c}.\n` +
            `    Para voltar ao normal:  gcloud auth login ${this.#preferida} --no-launch-browser`);
        }
        return (this.#conta = c);
      } catch { /* essa não emite; tenta a próxima */ }
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

  /** A mensagem que a nuvem devolve vem enterrada em JSON; o que ajuda é ela mais o que fazer. */
  async #erroDaNuvem(r: Response, oQue: string): Promise<Error> {
    const cru = await r.text();
    let recado = cru.slice(0, 200);
    try { recado = JSON.parse(cru).error?.message ?? recado; } catch { /* não era JSON */ }
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
   * Lê os eventos direto do arquivo SQLite. SÓ LÊ — nunca escreve: gravar por aqui contornaria o
   * ciclo, os papéis e os limites, que é o achado S3 de docs/DIVIDA-TECNICA.md.
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
    // O arquivo vem antes da nuvem: quem configurou um banco local quis o banco local.
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
   * Registra um evento. No local vai pela API (passando pelo ciclo, pelos papéis e pelos limites);
   * na nuvem, escreve direto no Firestore.
   *
   * ⚠️ Escrever direto CONTORNA a API — e portanto todas as validações. É o achado S3 de
   * docs/DIVIDA-TECNICA.md, e o caminho certo é o agente ter identidade própria e entrar pela API.
   * Enquanto isso não existe, este é o caminho, e ele está marcado.
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
          currentDocument: { exists: false },                     // só inclui, nunca sobrescreve
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
