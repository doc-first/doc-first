import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { readFileSync } from 'node:fs';
import { createCycle } from '../core/cycle.js';
import { doHistorico, paraOContrato, estadoAtual, estadoEmPortugues } from '../core/legacy.js';
import { readConfig } from '../core/config.js';
import { createRoles } from '../core/roles.js';
import { overLimit, validCommit } from '../core/limits.js';
import { createI18n } from '../core/i18n.js';
import { RegistroEmMemoria, RegistroFirestore } from './store.ts';
import { RegistroSqlite } from './store-sqlite.ts';
import { Pessoas } from './users.ts';
import { IdentidadeSenha } from './identity-password.ts';
import { Identidade } from './identity-iap.ts';
import { TIPOS_DE_EVENTO, type Evento, type NovoEvento, type Registro } from './types.ts';

/**
 * The Doc First service: serves the site and records review events.
 *
 * When an identity proxy guards the edge, the API still validates who the caller is — defence in
 * depth. The business rules — cycle, roles, limits — come from `review/core/`, the SAME code the
 * browser imports.
 */

// The PROJECT's configuration comes from doc-first.json; environment variables beat the file. The
// engine knows no product name, no e-mail and no cloud project — it asks.
const raizDoProjeto = process.env.REVISAO_SITE ?? join(import.meta.dirname, '..', '..');
const doProjeto = readConfig(raizDoProjeto, { readFile: (p: string) => readFileSync(p, 'utf8') }, process.env);

// The sentences the reviewer reads. The core returns keys; here they become words, in the language
// of whoever is reading. Logs and boot errors do NOT come through here, on purpose — a log is
// evidence, and evidence that changes wording by locale cannot be grepped.
const dicionarios = Object.fromEntries(
  ['en', 'pt-BR'].map((lang) => [lang,
    JSON.parse(readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8'))]));
const i18n = createI18n(dicionarios, 'en');
const idioma = (req: IncomingMessage) =>
  i18n.choose({ acceptLanguage: req.headers['accept-language'] as string, project: doProjeto.idioma });

const cfg = {
  porta: Number(process.env.PORT ?? 8080),
  site: raizDoProjeto,
  projeto: doProjeto.project,
  owner: doProjeto.owner,
  admins: doProjeto.admins,
  modo: process.env.REVISAO_MODO,
  ambiente: process.env.NODE_ENV === 'development' ? 'Development' : (process.env.REVISAO_AMBIENTE ?? 'Production'),
};

function log(nivel: string, evento: string, extra: Record<string, unknown> = {}) {
  // One JSON line per fact: log collectors understand severity, and an event can be found by id.
  // The previous API had three log calls in total, none of them on the write path.
  console.log(JSON.stringify({ severity: nivel, evento, hora: new Date().toISOString(), ...extra }));
}

// ---------------------------------------------------------------- configuration that fails at boot
/**
 * Como as pessoas entram.
 *   senha | user and password in the service itself. This is "start the image and use it".
 *   iap   | Google Cloud IAP. Exige REVISAO_AUDIENCIA.
 *   dev   | the X-Dev-Email header, Development only. Open the browser and work, with no login.
 *
 * The default is never `dev` outside Development: a service that accepts "I am whoever I say I
 * am" in production is not a small oversight. Outside Development it is the identity proxy when
 * there is an audience, and password everywhere else — whoever starts the image configuring
 * nothing lands on a login screen, which is the worst acceptable case.
 */
const comoEntrar = process.env.REVISAO_IDENTIDADE
  ?? (cfg.ambiente === 'Development' ? 'dev' : process.env.REVISAO_AUDIENCIA ? 'iap' : 'senha');

let papeis: ReturnType<typeof createRoles>;
let identidade: Identidade | null = null;
const ciclo = createCycle(JSON.parse(readFileSync(new URL('../cycle.json', import.meta.url), 'utf8')));

// The core speaks English; the API still writes Portuguese. Translation happens HERE, at the
// core's entrance, and nowhere else — see review/core/legacy.js.
const paraONucleo = (todos: Evento[]) => todos.map(doHistorico);

try {
  // No default, on purpose: in a distributed package, an e-mail of ours here would make anyone who
  // forgot to configure it start a service with OUR owner.
  papeis = createRoles(cfg.owner, cfg.admins);
  // The proxy identity is only built when it is the one in charge: demanding its audience from
  // someone logging in with a password would block the "start it and use it" case, which is the
  // whole point of password identity.
  if (comoEntrar === 'iap' || comoEntrar === 'dev') {
    identidade = new Identidade({
      audiencia: process.env.REVISAO_AUDIENCIA, modo: cfg.modo,
      ambiente: cfg.ambiente, // an empty string is a choice — 'identify nobody' — which the test
                              // uses to exercise the 401
      emailDeDev: process.env.REVISAO_DEV_EMAIL !== undefined ? process.env.REVISAO_DEV_EMAIL || undefined : (doProjeto.actAs ?? undefined),
    });
  } else if (comoEntrar !== 'senha') {
    throw new Error(`REVISAO_IDENTIDADE="${comoEntrar}" não existe (use senha, iap ou dev)`);
  }
} catch (erro) {
  console.error('configuração inválida: ' + (erro instanceof Error ? erro.message : String(erro)));
  process.exit(1);
}

/**
 * Where events live. `sqlite` is the default for running the tool without a cloud: one file, no
 * external dependency, and the database REFUSING update and delete — "nothing is erased" stops
 * being a promise and becomes a guarantee.
 *   memoria  | some ao parar. Para desenvolver e testar.
 *   sqlite   | a file on disk. The "start it and use it" mode.
 *   firestore| Google Cloud. Exige REVISAO_PROJETO.
 */
const ondeGuardar = process.env.REVISAO_BANCO ?? (cfg.modo === 'local' ? 'memoria' : 'sqlite');
const registro: Registro = (() => {
  switch (ondeGuardar) {
    case 'memoria': return new RegistroEmMemoria();
    case 'sqlite': return new RegistroSqlite(process.env.REVISAO_SQLITE ?? './dados/eventos.db');
    case 'firestore':
      if (!cfg.projeto) { console.error('configuração inválida: firestore exige REVISAO_PROJETO'); process.exit(1); }
      return new RegistroFirestore(cfg.projeto);
    default:
      console.error(`configuração inválida: REVISAO_BANCO="${ondeGuardar}" (use memoria, sqlite ou firestore)`);
      process.exit(1);
  }
})();

let porSenha: IdentidadeSenha | null = null;
if (comoEntrar === 'senha') {
  const pessoas = new Pessoas(process.env.REVISAO_PESSOAS ?? './dados/pessoas.db');
  porSenha = new IdentidadeSenha(pessoas, { seguro: cfg.ambiente !== 'Development' });
  pessoas.limparSessoesVencidas();

  // First boot: creates the owner's access and shows the password ONCE. A fixed password like
  // "admin" is an invitation, and an internal tool stays up for years with nobody looking.
  const senha = await porSenha.primeiroAcesso(cfg.owner!, 'Dono');
  if (senha) {
    console.log('\n' + '='.repeat(72));
    console.log('  PRIMEIRO ACESSO — anote agora, esta senha não será mostrada de novo:');
    console.log(`     entrar com: ${cfg.owner}`);
    console.log(`     senha:      ${senha}`);
    console.log('  Você terá de trocá-la ao entrar.');
    console.log('='.repeat(72) + '\n');
  }
}

// ---------------------------------------------------------------- utilidades
const json = (res: ServerResponse, codigo: number, corpo: unknown) => {
  const texto = JSON.stringify(corpo);
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(texto);
};

const TIPOS_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.ico': 'image/x-icon',
};

async function corpoJson(req: IncomingMessage): Promise<unknown> {
  const partes: Buffer[] = [];
  let tamanho = 0;
  for await (const p of req) {
    tamanho += p.length;
    if (tamanho > 1_000_000) throw new Error('corpo grande demais');   // teto antes de parsear
    partes.push(p);
  }
  return partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {};
}

/** A request plus the state the server computed. The front end does not reimplement the cycle. */
const comSituacao = (e: Evento, todos: Evento[]) => ({
  ...e,
  situacao: paraOContrato(ciclo.status(ciclo.currentState(e.id, paraONucleo(todos), papeis.isAdmin(e.autor)))),
});

// ---------------------------------------------------------------- rotas da API
async function api(req: IncomingMessage, res: ServerResponse, url: URL, email: string) {
  const rota = url.pathname.replace(/^\/api/, '');

  // ---------------------------------------------------------------- entrar e sair (identidade por senha)
  if (porSenha && req.method === 'POST' && rota === '/sair') {
    porSenha.pessoas.fecharSessao(req.headers.cookie?.match(/docfirst_sessao=([^;]+)/)?.[1]);
    res.setHeader('set-cookie', porSenha.cabecalhoDeSaida());
    return json(res, 200, { ok: true });
  }

  if (porSenha && req.method === 'POST' && rota === '/trocar-senha') {
    const corpo = (await corpoJson(req)) as { atual?: string; nova?: string };
    const conferida = await porSenha.pessoas.conferir(email, corpo.atual ?? '');
    if (!conferida) return json(res, 403, { erro: 'a senha atual não confere' });
    try {
      await porSenha.pessoas.trocarSenha(email, corpo.nova ?? '');
    } catch (erro) {
      return json(res, 400, { erro: erro instanceof Error ? erro.message : 'senha inválida' });
    }
    log('INFO', 'senha_trocada', { email });
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && rota === '/eu') {
    return json(res, 200, {
      email,
      // The core returns the role KEY; `outro` is the name the published contract uses and the
      // front end styles on. Scaffolding, like the rest: it dies when the front end speaks English.
      papel: ({ owner: 'owner', admin: 'admin', other: 'outro' } as Record<string, string>)[papeis.roleOf(email)] ?? 'outro',
      podeAprovar: papeis.canApprove(email),
      podeTriar: papeis.canTriage(email),
      owner: papeis.isOwner(email),
      admins: papeis.admins,
      dono: papeis.isAdmin(email),          // ⚠️ compatibilidade; sai quando o front migrar de vez
      // Only exists with password login. Without it, reloading the page would forget the password
      // is still the first-access one — and the change screen would only appear at login.
      ...(porSenha ? { precisaTrocarSenha: porSenha.daRequisicao(req.headers)?.precisaTrocarSenha ?? false } : {}),
    });
  }

  if (req.method === 'GET' && rota === '/eventos') {
    const pagina = url.searchParams.get('pagina');
    // ALL events of a request live on its own page (triage and the agent write with the request's
    // page), so the filtered query is enough — no need to scan the whole collection.
    const eventos = await registro.listar(pagina);
    return json(res, 200, eventos.map((e) => (e.tipo === 'pedido' ? comSituacao(e, eventos) : e)));
  }

  const umEvento = rota.match(/^\/eventos\/([A-Za-z0-9_-]+)$/);
  if (req.method === 'GET' && umEvento) {
    const achado = (await registro.listar(null)).find((e) => e.id === umEvento[1]);
    return achado ? json(res, 200, achado) : json(res, 404, { erro: 'evento não encontrado', id: umEvento[1] });
  }

  if (req.method === 'GET' && rota === '/pedidos/abertos') {
    const todos = await registro.listar(null);
    const porPagina = new Map<string, Evento[]>();
    for (const e of todos) porPagina.set(e.pagina, [...(porPagina.get(e.pagina) ?? []), e]);
    let triar = 0;
    for (const [, daPagina] of porPagina) {
      triar += daPagina.filter((e) => e.tipo === 'pedido')
        .filter((p) => ciclo.currentState(p.id, paraONucleo(daPagina), papeis.isAdmin(p.autor)) === 'open').length;
    }
    return json(res, 200, { triar });
  }

  if (req.method === 'POST' && rota === '/eventos') {
    const novo = (await corpoJson(req)) as NovoEvento;
    const podeAprovar = papeis.canApprove(email);

    if (!TIPOS_DE_EVENTO.has(novo.tipo)) return json(res, 400, { erro: 'tipo desconhecido', tipo: novo.tipo });
    if (novo.tipo === 'aprovacao' && (!novo.caixa || !novo.digital)) {
      return json(res, 400, { erro: 'aprovação precisa de caixa e digital' });
    }
    // Approving belongs to owner and admin: their ✓ becomes a lock in the repository and tells
    // the agent to apply.
    if (novo.tipo === 'aprovacao' && !podeAprovar) {
      return json(res, 403, { erro: 'só owner e admin aprovam; use pedir alteração ou comentar' });
    }
    if (['pedido', 'comentario', 'complemento'].includes(novo.tipo) && !novo.texto?.trim()) {
      return json(res, 400, { erro: 'escreva o texto' });
    }
    // The core reads the event with its own field names; the API still speaks Portuguese.
    // Translate on the way in, here.
    const limite = overLimit(doHistorico(novo), doProjeto.pageExamples);
    if (limite) return json(res, 400, { erro: i18n.t(idioma(req), limite.key, limite.params) });

    if (novo.tipo === 'pedido_estado' || novo.tipo === 'complemento') {
      const pedidoId = novo.dados?.pedido;
      if (!pedidoId) return json(res, 400, { erro: 'informe dados.pedido' });
      const daPagina = await registro.listar(novo.pagina);
      const pedido = daPagina.find((e) => e.id === pedidoId && e.tipo === 'pedido');
      if (!pedido) return json(res, 404, { erro: 'pedido não encontrado nesta página' });
      // `atual` is the core's language; `atualPt` is the contract's, still Portuguese, and it
      // travels to the front end and into the record. Two variables instead of converting midway:
      // the bug this avoids is comparing one language against the other and never matching.
      const atual = ciclo.currentState(pedidoId, paraONucleo(daPagina), papeis.isAdmin(pedido.autor));
      const atualPt = estadoEmPortugues(atual);

      if (novo.tipo === 'complemento') {
        if (email !== pedido.autor && !podeAprovar) {
          return json(res, 403, { erro: 'só quem pediu, ou um admin, acrescenta detalhes' });
        }
        if (!ciclo.acceptsSupplement(atual)) {
          return json(res, 409, { erro: `pedido ${atualPt}: para mudar algo já aprovado, faça um novo pedido`, estado: atualPt });
        }
      } else {
        const paraPt = novo.dados?.estado as string | undefined;
        if (!paraPt) return json(res, 400, { erro: 'informe dados.estado' });
        const para = estadoAtual(paraPt);
        if (!ciclo.exists(para)) return json(res, 400, { erro: 'estado desconhecido' });
        const doAgente = ciclo.agentStates.includes(para);
        if (!podeAprovar && !(identidade?.modoLocal && doAgente)) {
          return json(res, 403, { erro: 'só owner e admin fazem a triagem' });
        }
        if (ciclo.requiresReason(para) && !novo.texto?.trim()) {
          return json(res, 400, { erro: 'diga o motivo ou a pergunta' });
        }
        if (ciclo.requiresCommit(para) && !validCommit(novo.dados)) {
          return json(res, 400, { erro: 'aplicado precisa do commit (7 a 40 caracteres hexadecimais)' });
        }
        if (!ciclo.canGo(atual, para)) {
          return json(res, 409, { erro: `não dá para ir de ${atualPt} para ${paraPt}`, estado: atualPt });
        }
        // Race guard: recording where the change departed from makes the history itself the
        // guard. Written in Portuguese, like the rest of the record: readers translate
        // (review/core/legacy.js).
        novo.dados = { ...novo.dados, de: atualPt };
      }
    }

    const e = await registro.incluir(novo, email);
    log('INFO', 'evento_incluido', {
      id: e.id, tipo: e.tipo, pagina: e.pagina, caixa: e.caixa, autor: e.autor,
      de: e.dados?.de, para: e.dados?.estado,
    });
    res.setHeader('location', `/api/eventos/${e.id}`);
    return json(res, 201, e);
  }

  return json(res, 405, { erro: 'método ou rota não existe', rota });
}

/** The only page served without a session. Self-contained on purpose: see review/api/login.html. */
const TELA_DE_ENTRADA = '/entrar';

// ---------------------------------------------------------------- static site
async function estatico(url: URL, res: ServerResponse) {
  let caminho = decodeURIComponent(url.pathname);
  // Where the root leads comes from doc-first.json (`conteudo.inicio`). It used to be hard-coded
  // to one project's home page, which is that project's, not the method's.
  if (caminho === '/') return (res.writeHead(302, { location: doProjeto.home }), res.end());

  // The review panel belongs to the ENGINE and lives next to the server — not inside the content.
  // Without this route, pointing REVISAO_SITE at documentation mounted from outside would leave the
  // panel without its own files: the page would load, and no review button would appear.
  // `web` is the panel; `core` comes along because core-web.js is a MODULE importing
  // `../core/fingerprint.js` — the browser resolves that against the URL, so /review/core/ has to
  // answer or the panel loads without the core and no fingerprint gets computed.
  for (const pasta of ['web', 'core']) {
    const prefixo = `/review/${pasta}/`;
    if (!caminho.startsWith(prefixo)) continue;
    const base = normalize(join(import.meta.dirname, '..', pasta));
    const seguro = normalize(join(base, caminho.slice(prefixo.length)));
    if (!seguro.startsWith(base + sep)) break;        // outside the engine folder
    try {
      await stat(seguro);
      return servirArquivo(seguro, res);
    } catch { break; /* not here: fall through to the site */ }
  }

  // normalize plus a prefix check: without it, `/../../etc/passwd` would escape the site folder.
  const alvo = normalize(join(cfg.site, caminho));
  if (!alvo.startsWith(normalize(cfg.site) + sep)) {
    return json(res, 403, { erro: 'caminho fora do site' });
  }
  try {
    const info = await stat(alvo);
    if (info.isDirectory()) return estatico(new URL(url.href.replace(/\/?$/, '/index.html')), res);
    return servirArquivo(alvo, res, caminho);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('não encontrado');
  }
}

/** Serves a file from disk. Used both by the site and by the engine's own files. */
async function servirArquivo(alvo: string, res: ServerResponse, urlPath = '') {
  const ext = extname(alvo).toLowerCase();
  // The theme (fonts and icons) does not change: cache it for real. With no-cache the browser
  // revalidated the menu icons on every navigation, and because they arrive through mask-image,
  // the menu flickered.
  const cache = urlPath.includes('/tema/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, {
    'content-type': TIPOS_MIME[ext] ?? 'application/octet-stream',
    'cache-control': cache,
    'x-robots-tag': 'noindex, nofollow',
  });
  res.end(await readFile(alvo));
}

// ---------------------------------------------------------------- servidor
const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname === '/api/saude') return json(res, 200, { ok: true });

    // /api/entrar is the only API route without a session: it is the one that creates it.
    if (porSenha && url.pathname === '/api/entrar' && req.method === 'POST') {
      const corpo = (await corpoJson(req)) as { email?: string; senha?: string };
      const r = await porSenha.entrar(corpo.email ?? '', corpo.senha ?? '');
      if (!r) {
        // The same answer for an unknown e-mail and a wrong password: saying which of the two
        // failed hands over who has an account. The response time matches too (see users.ts).
        log('AVISO', 'entrada_recusada', { email: corpo.email });
        return json(res, 401, { erro: 'e-mail ou senha não conferem' });
      }
      res.setHeader('set-cookie', porSenha.cabecalhoDeSessao(r.sessao));
      log('INFO', 'entrou', { email: r.pessoa.email, precisaTrocarSenha: r.pessoa.precisaTrocarSenha });
      return json(res, 200, { email: r.pessoa.email, nome: r.pessoa.nome, precisaTrocarSenha: r.pessoa.precisaTrocarSenha });
    }

    if (url.pathname.startsWith('/api/')) {
      const email = porSenha
        ? porSenha.daRequisicao(req.headers)?.email ?? null
        : await identidade!.email(req.headers);
      if (!email) return json(res, 401, { erro: 'não autenticado' });
      return await api(req, res, url, email);
    }

    // With an identity proxy, the edge blocks before anything reaches here. With password login
    // there is no edge at all: without this guard the entire documentation was open to anyone who
    // could reach the port — and whoever started the image believing they had configured a login
    // had no way to suspect otherwise. Found while testing.
    if (porSenha && !porSenha.daRequisicao(req.headers)) {
      if (url.pathname === TELA_DE_ENTRADA) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(await readFile(new URL('./login.html', import.meta.url)));
      }
      const destino = encodeURIComponent(url.pathname + url.search);
      return (res.writeHead(302, { location: `${TELA_DE_ENTRADA}?destino=${destino}` }), res.end());
    }
    // With a session already in hand, the login screen has nothing to do: send them to the site.
    if (porSenha && url.pathname === TELA_DE_ENTRADA) {
      return (res.writeHead(302, { location: '/' }), res.end());
    }

    return await estatico(url, res);
  } catch (erro) {
    const id = crypto.randomUUID().slice(0, 8);
    log('ERROR', 'erro_nao_tratado', { id, caminho: url.pathname, motivo: erro instanceof Error ? erro.message : String(erro) });
    json(res, 500, { erro: 'erro interno', id });   // o id liga a tela ao log
  }
});

servidor.listen(cfg.porta, () => {
  log('INFO', 'servidor_no_ar', {
    porta: cfg.porta, ambiente: cfg.ambiente, identidade: comoEntrar, banco: ondeGuardar,
    modoLocal: identidade?.modoLocal ?? false, site: cfg.site,
  });
});
