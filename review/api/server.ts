import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { createCycle } from '../core/cycle.js';
import { doHistorico, paraOContrato, estadoAtual, estadoEmPortugues } from '../core/legacy.js';
import { readConfig } from '../core/config.js';
import { createRoles } from '../core/roles.js';
import { overLimit, validCommit } from '../core/limits.js';
import { createI18n } from '../core/i18n.js';
import { RegistroEmMemoria, RegistroFirestore } from './store.ts';
import { RegistroSqlite } from './store-sqlite.ts';
import {
  openUserStore, ephemeralUserStoreWarning, DEFAULT_SQLITE_PATH, UserInputError,
  normalizeEmail, isEmailAddress, MAX_NAME_LENGTH, type UserStore,
} from './users.ts';
import { log } from './log.ts';
import { renderLoginPage } from './login-page.ts';
import { loadTheme } from './theme.ts';
import { LANGUAGE_ROUTE, chosenLanguage, languageSwitch } from './language.ts';
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
//
// ⚠️ Discovered, not listed. A hard-coded list made the README lie — it promises that adding a
// language is copying one file into review/locales/, when it was copying a file AND editing this
// line. It also killed the server the day pt-BR.json moved out to examples/, and not one of the 61
// unit tests noticed, because none of them boot the server. Reading the folder fixes both.
const pastaDeIdiomas = new URL('../locales/', import.meta.url);
const dicionarios = Object.fromEntries(
  readdirSync(pastaDeIdiomas).filter((f) => f.endsWith('.json')).map((f) =>
    [f.slice(0, -5), JSON.parse(readFileSync(new URL(f, pastaDeIdiomas), 'utf8'))]));
const i18n = createI18n(dicionarios, 'en');
// `person` is what makes a deliberate choice beat the browser header — see review/api/language.ts.
const idioma = (req: IncomingMessage) =>
  i18n.choose({
    person: chosenLanguage(req.headers.cookie),
    acceptLanguage: req.headers['accept-language'] as string, project: doProjeto.idioma,
  });

/**
 * How the project dresses the engine. Read ONCE, at boot, for two reasons: the logo is a file on
 * disk and re-reading it on every sign-in would put an I/O call on the one request that is always
 * a cold start; and a theme that changes without a restart is a theme nobody can reason about when
 * two instances disagree.
 *
 * ⚠️ Whatever was refused is logged, and logged LOUDLY. A theme that quietly does not apply is an
 * afternoon of someone reloading the page wondering where their colour went — and if the reason it
 * was refused is that the value looked like an injection attempt, that is the line an operator
 * needs to find.
 */
const { theme: temaDoProjeto, warnings: avisosDoTema } = loadTheme(
  raizDoProjeto, doProjeto.theme, { readBinary: (p: string) => readFileSync(p) },
);
for (const aviso of avisosDoTema) log('WARNING', 'theme_rejected', { reason: aviso });

const cfg = {
  porta: Number(process.env.PORT ?? 8080),
  site: raizDoProjeto,
  projeto: doProjeto.project,
  owner: doProjeto.owner,
  admins: doProjeto.admins,
  modo: process.env.REVISAO_MODO,
  ambiente: process.env.NODE_ENV === 'development' ? 'Development' : (process.env.REVISAO_AMBIENTE ?? 'Production'),
};

// ---------------------------------------------------------------- configuration that fails at boot
/**
 * How people get in.
 *   senha | user and password in the service itself. This is "start the image and use it".
 *   iap   | Google Cloud IAP. Needs REVISAO_AUDIENCIA.
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
    // The three values stay as they are: they are what someone already wrote in a compose file.
    throw new Error(`REVISAO_IDENTIDADE="${comoEntrar}" does not exist (use senha, iap or dev)`);
  }
} catch (erro) {
  // ⚠️ English, hard-coded, and NOT through i18n. This prints before the server listens, so there
  // is no request, no session and nobody whose language we could have chosen — the same reason the
  // first-access banner below stays English. See the comment at the top of review/core/i18n.js.
  console.error('invalid configuration: ' + (erro instanceof Error ? erro.message : String(erro)));
  process.exit(1);
}

/**
 * Where events live. `sqlite` is the default for running the tool without a cloud: one file, no
 * external dependency, and the database REFUSING update and delete — "nothing is erased" stops
 * being a promise and becomes a guarantee.
 *   memoria  | gone when it stops. For developing and testing.
 *   sqlite   | a file on disk. The "start it and use it" mode.
 *   firestore| Google Cloud. Needs REVISAO_PROJETO.
 */
const ondeGuardar = process.env.REVISAO_BANCO ?? (cfg.modo === 'local' ? 'memoria' : 'sqlite');
const registro: Registro = (() => {
  switch (ondeGuardar) {
    case 'memoria': return new RegistroEmMemoria();
    case 'sqlite': return new RegistroSqlite(process.env.REVISAO_SQLITE ?? './dados/eventos.db');
    case 'firestore':
      if (!cfg.projeto) { console.error('invalid configuration: firestore needs REVISAO_PROJETO'); process.exit(1); }
      return new RegistroFirestore(cfg.projeto);
    default:
      console.error(`invalid configuration: REVISAO_BANCO="${ondeGuardar}" (use memoria, sqlite or firestore)`);
      process.exit(1);
  }
})();

/**
 * Where the people and their sessions live. Same idea as Keycloak: a file to run it on a laptop, a
 * real database for a deployment whose instances come and go.
 *   (absent)      | SQLite, at REVISAO_PESSOAS or ./dados/pessoas.db
 *   sqlite:<path> | SQLite in that file
 *   firestore     | Google Cloud. Needs REVISAO_PROJETO
 *   postgres://…  | Postgres. `postgresql://…` works too
 *
 * ⚠️ SQLite on Cloud Run loses people. The disk there is ephemeral and per instance, so an access
 * created today is gone when the platform recycles the instance — with no error and no log. That
 * failure is the reason this variable exists; see review/api/users.ts.
 *
 * REVISAO_PESSOAS still names the SQLite file, and keeps doing so: it is published contract, it is
 * in the compose file people copied, and breaking it would lock someone out of their own tool.
 */
/** The kind of store a URL names, with nothing secret left in it. Safe to log. */
const userStoreKind = (url: string | undefined): string => {
  const u = (url ?? '').trim();
  if (u === '' || u.startsWith('sqlite')) return 'sqlite';
  if (u === 'firestore') return 'firestore';
  if (u.startsWith('postgres')) return 'postgres';
  return 'unknown';
};

let porSenha: IdentidadeSenha | null = null;
if (comoEntrar === 'senha') {
  let users;
  try {
    users = await openUserStore(process.env.REVISAO_USERS, {
      projectId: cfg.projeto,
      sqlitePath: process.env.REVISAO_PESSOAS ?? DEFAULT_SQLITE_PATH,
    });
  } catch (erro) {
    console.error('invalid configuration: ' + (erro instanceof Error ? erro.message : String(erro)));
    process.exit(1);
  }
  porSenha = new IdentidadeSenha(users, { seguro: cfg.ambiente !== 'Development' });
  await users.purgeExpiredSessions();

  // ⚠️ It WARNS, it does not refuse. This configuration works — it just forgets people — and a
  // service that refuses to start is a new way to be stuck at three in the morning over something
  // that was never an emergency. The choice stays with whoever deploys; what they were missing is
  // the information.
  //
  // One structured line at WARNING rather than a banner of '=': this fires only on a hosted
  // runtime, where nobody is watching a terminal and the log collector is the only reader. A
  // banner is loud on a screen; a severity is loud in a log.
  const ephemeralWarning = ephemeralUserStoreWarning(process.env.REVISAO_USERS);
  if (ephemeralWarning) log('WARNING', 'ephemeral_user_store', { warning: ephemeralWarning });

  // First boot: creates the owner's access and shows the password ONCE. A fixed password like
  // "admin" is an invitation, and an internal tool stays up for years with nobody looking.
  //
  // The display name comes from configuration because the alternative is everyone's first account
  // being called "Owner" — and a review history where every approval is signed by a job title
  // instead of a person is a history that answers "who said this?" with "the owner did".
  //
  // ⚠️ English, hard-coded, and NOT through i18n. This prints before anyone has a session, so
  // there is no person and no chosen language yet — the same reason boot errors stay English. The
  // comment at the top of review/core/i18n.js is the long version.
  const senha = await porSenha.primeiroAcesso(cfg.owner!, process.env.REVISAO_OWNER_NAME || 'Owner');
  if (senha) {
    console.log('\n' + '='.repeat(72));
    console.log('  FIRST ACCESS — write it down now, this password is not shown again:');
    console.log(`     sign in with: ${cfg.owner}`);
    console.log(`     password:     ${senha}`);
    console.log('  You will have to change it when you sign in.');
    console.log('='.repeat(72) + '\n');
  }
}

// ---------------------------------------------------------------- helpers
const json = (res: ServerResponse, codigo: number, corpo: unknown) => {
  const texto = JSON.stringify(corpo);
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
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
    // A ceiling BEFORE parsing, and the message goes to the log, not to the person: the reply is
    // the unhandled-error 500 below, which says only `api.internal` plus an id. Whoever operates
    // greps this line by that id, so it is English like every other piece of evidence.
    if (tamanho > 1_000_000) throw new Error('request body larger than 1 MB');
    partes.push(p);
  }
  return partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {};
}

/** A request plus the state the server computed. The front end does not reimplement the cycle. */
const comSituacao = (e: Evento, todos: Evento[]) => ({
  ...e,
  situacao: paraOContrato(ciclo.status(ciclo.currentState(e.id, paraONucleo(todos), papeis.isAdmin(e.autor)))),
});

// ---------------------------------------------------------------- the API routes
async function api(req: IncomingMessage, res: ServerResponse, url: URL, email: string) {
  const rota = url.pathname.replace(/^\/api/, '');

  // ---------------------------------------------------------------- in and out (password identity)
  if (porSenha && req.method === 'POST' && rota === '/sair') {
    await porSenha.users.closeSession(req.headers.cookie?.match(/docfirst_sessao=([^;]+)/)?.[1]);
    res.setHeader('set-cookie', porSenha.cabecalhoDeSaida());
    return json(res, 200, { ok: true });
  }

  if (porSenha && req.method === 'POST' && rota === '/trocar-senha') {
    const corpo = (await corpoJson(req)) as { atual?: string; nova?: string };
    const conferida = await porSenha.users.check(email, corpo.atual ?? '');
    if (!conferida) return json(res, 403, { error: i18n.t(idioma(req), 'api.password.currentWrong') });
    try {
      await porSenha.users.changePassword(email, corpo.nova ?? '');
    } catch (erro) {
      // Translated HERE, at the edge, and only here: the store throws a key, never a sentence.
      const falha = UserInputError.from(erro, 'api.password.invalid');
      return json(res, 400, { error: i18n.t(idioma(req), falha.key, falha.params) });
    }
    log('INFO', 'password_changed', { email });
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
      dono: papeis.isAdmin(email),          // ⚠️ kept for compatibility; goes when the front end migrates
      // Only exists with password login. Without it, reloading the page would forget the password
      // is still the first-access one — and the change screen would only appear at login.
      ...(porSenha ? { precisaTrocarSenha: (await porSenha.daRequisicao(req.headers))?.mustChangePassword ?? false } : {}),
    });
  }

  // ---------------------------------------------------------------- people, and who may get in
  //
  // ⚠️ These routes exist ONLY with password identity, and the guard is `porSenha`. Behind an
  // identity proxy there is no user store at all — who exists is the proxy's directory — so
  // answering here would be inventing a second, empty source of truth for who works at the
  // company. Without a store they fall through to the 405 at the bottom.
  //
  // ⚠️ The route names and the field names are ENGLISH here and Portuguese above. Those older
  // names are published contract and stay as they are for as long as somebody depends on them;
  // nothing NEW is added in Portuguese. The error key is no longer one of the differences — every
  // route in this file now answers `error`, including the older ones.
  //
  // ⚠️ Who may do this comes from `papeis`, which reads REVISAO_OWNER and REVISAO_ADMINS — NOT
  // from the user store. The two are different questions: the store answers "does this person have
  // a way in", the configuration answers "what may they do". Putting the role in the row would
  // create a second truth, and on the day they disagree nobody can say which one is the service.
  if (porSenha && (await userRoutes(req, res, rota, email, porSenha.users, idioma(req)))) return;

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
    return achado
      ? json(res, 200, achado)
      : json(res, 404, { error: i18n.t(idioma(req), 'api.event.notFound'), id: umEvento[1] });
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
    // The sentences on this path are for the person looking at the panel, so they come out of the
    // dictionaries in the language they chose. `tipo` and the state values below do NOT: those are
    // contract, and a value that changes with the reader's locale is a value nobody can match on.
    const say = (key: string, params?: Record<string, string | number>) =>
      i18n.t(idioma(req), key, params);

    if (!TIPOS_DE_EVENTO.has(novo.tipo)) {
      return json(res, 400, { error: say('api.event.unknownType'), tipo: novo.tipo });
    }
    if (novo.tipo === 'aprovacao' && (!novo.caixa || !novo.digital)) {
      return json(res, 400, { error: say('api.approval.needsBlockAndFingerprint') });
    }
    // Approving belongs to owner and admin: their ✓ becomes a lock in the repository and tells
    // the agent to apply.
    if (novo.tipo === 'aprovacao' && !podeAprovar) {
      return json(res, 403, { error: say('api.approval.ownerOnly') });
    }
    if (['pedido', 'comentario', 'complemento'].includes(novo.tipo) && !novo.texto?.trim()) {
      return json(res, 400, { error: say('api.text.required') });
    }
    // The core reads the event with its own field names; the API still speaks Portuguese.
    // Translate on the way in, here.
    const limite = overLimit(doHistorico(novo), doProjeto.pageExamples);
    if (limite) return json(res, 400, { error: say(limite.key, limite.params) });

    if (novo.tipo === 'pedido_estado' || novo.tipo === 'complemento') {
      const pedidoId = novo.dados?.pedido;
      if (!pedidoId) return json(res, 400, { error: say('api.request.needsRequestId') });
      const daPagina = await registro.listar(novo.pagina);
      const pedido = daPagina.find((e) => e.id === pedidoId && e.tipo === 'pedido');
      if (!pedido) return json(res, 404, { error: say('api.request.notFound') });
      // `atual` is the core's language; `atualPt` is the contract's, still Portuguese, and it
      // travels to the front end and into the record. Two variables instead of converting midway:
      // the bug this avoids is comparing one language against the other and never matching.
      const atual = ciclo.currentState(pedidoId, paraONucleo(daPagina), papeis.isAdmin(pedido.autor));
      const atualPt = estadoEmPortugues(atual);

      if (novo.tipo === 'complemento') {
        if (email !== pedido.autor && !podeAprovar) {
          return json(res, 403, { error: say('api.supplement.ownerOrAuthor') });
        }
        if (!ciclo.acceptsSupplement(atual)) {
          // The state travels into the sentence as the contract value, untranslated, because it is
          // also the `estado` field next to it — one name for one thing, in both places.
          return json(res, 409, { error: say('api.supplement.tooLate', { state: atualPt }), estado: atualPt });
        }
      } else {
        const paraPt = novo.dados?.estado as string | undefined;
        if (!paraPt) return json(res, 400, { error: say('api.state.required') });
        const para = estadoAtual(paraPt);
        if (!ciclo.exists(para)) return json(res, 400, { error: say('api.state.unknown') });
        const doAgente = ciclo.agentStates.includes(para);
        if (!podeAprovar && !(identidade?.modoLocal && doAgente)) {
          return json(res, 403, { error: say('api.triage.ownerOnly') });
        }
        if (ciclo.requiresReason(para) && !novo.texto?.trim()) {
          return json(res, 400, { error: say('api.reason.required') });
        }
        if (ciclo.requiresCommit(para) && !validCommit(novo.dados)) {
          return json(res, 400, { error: say('api.commit.required') });
        }
        if (!ciclo.canGo(atual, para)) {
          return json(res, 409, { error: say('api.state.cannotGo', { from: atualPt, to: paraPt }), estado: atualPt });
        }
        // Race guard: recording where the change departed from makes the history itself the
        // guard. Written in Portuguese, like the rest of the record: readers translate
        // (review/core/legacy.js).
        novo.dados = { ...novo.dados, de: atualPt };
      }
    }

    const e = await registro.incluir(novo, email);
    // The field names are English, the VALUES are the contract's: `tipo` and the states still
    // travel in Portuguese everywhere else, and a log that renamed them would no longer match the
    // record it is evidence about.
    log('INFO', 'event_recorded', {
      id: e.id, kind: e.tipo, page: e.pagina, block: e.caixa, author: e.autor,
      from: e.dados?.de, to: e.dados?.estado,
    });
    res.setHeader('location', `/api/eventos/${e.id}`);
    return json(res, 201, e);
  }

  return json(res, 405, { error: i18n.t(idioma(req), 'api.route.notFound'), rota });
}

/**
 * Managing the people who may sign in. Returns true when it answered the request.
 *
 * Split out of `api()` because it is a self-contained subject with five routes and one rule that
 * has to hold across all of them, and because the next thing to arrive here is a screen — the
 * guards below are the whole contract that screen may rely on.
 *
 * ## What never leaves this function
 *
 * A generated password is returned EXACTLY ONCE, in the body of the request that generated it. It
 * is never readable again, never in a `GET`, and never in a log line. That is not tidiness: this
 * service writes one structured JSON line per fact, and on a hosted runtime those lines go to a
 * collector that many more people can read than can ever sign in here. A password in a log is a
 * password with a much wider audience than the account it opens.
 */
async function userRoutes(
  req: IncomingMessage, res: ServerResponse, rota: string, email: string,
  users: UserStore, lang: string,
): Promise<boolean> {
  const say = (key: string, params?: Record<string, string | number>) => i18n.t(lang, key, params);
  /** Owner and admin, and nobody else. `isAdmin` already counts the owner as one. */
  const manages = () => papeis.isAdmin(email);
  const forbidden = () => (json(res, 403, { error: say('api.users.adminOnly') }), true);

  // ---------------------------------------------------------------- the list
  if (rota === '/users' && req.method === 'GET') {
    if (!manages()) return forbidden();
    // `list()` hands back `User` objects: no salt, no hash, and no password — the plain one was
    // never stored anywhere, so there is nothing here that could give one back.
    json(res, 200, { users: await users.list() });
    return true;
  }

  // ---------------------------------------------------------------- creating an access
  if (rota === '/users' && req.method === 'POST') {
    if (!manages()) return forbidden();
    const body = (await corpoJson(req)) as { email?: string; name?: string };
    const novo = normalizeEmail(String(body.email ?? ''));
    if (!isEmailAddress(novo)) {
      // The bad value goes back in the message. "Invalid e-mail" next to a form with three fields
      // is a message that makes the person guess which one, and guess what is wrong with it.
      json(res, 400, { error: say('api.users.emailInvalid', { email: String(body.email ?? '') }) });
      return true;
    }
    const nome = String(body.name ?? '').trim();
    if (!nome) { json(res, 400, { error: say('api.name.empty') }); return true; }
    if (nome.length > MAX_NAME_LENGTH) {
      json(res, 400, { error: say('api.name.tooLong', { max: MAX_NAME_LENGTH }) });
      return true;
    }
    // ⚠️ Checked, AND caught below. The check is what produces a message worth reading; the catch
    // is what covers two admins creating the same address at the same moment, where the check
    // passes twice and the database is the only thing that can still say no.
    // ⚠️ Nobody but the owner creates the OWNER's account, and this guard is the twin of the one
    // on the reset route — I wrote that one and left this door open, which is the whole lesson:
    // a rule enforced on one path is not enforced.
    //
    // Being the owner is decided by REVISAO_OWNER, not by a column, so the account can legitimately
    // not exist yet: `primeiroAcesso` only runs while the store is EMPTY, so handing the role over
    // — new address in the variable, store already full — leaves the owner's row missing. In that
    // window any admin could create it, read the generated password from this very response, sign
    // in, and from then on be the owner for every purpose: their ✓ locks, and nobody can disable
    // them. They never needed the reset route at all.
    if (papeis.isOwner(novo) && !papeis.isOwner(email)) {
      json(res, 409, { error: say('api.users.ownerIsProvisionedAtBoot', { email: novo }) });
      return true;
    }
    if (await users.find(novo)) {
      json(res, 400, { error: say('api.users.emailTaken', { email: novo }) });
      return true;
    }
    let senha: string;
    try {
      senha = await users.create(novo, nome);
    } catch {
      json(res, 400, { error: say('api.users.emailTaken', { email: novo }) });
      return true;
    }
    // The password is NOT in this line, and this is the line where it would be easiest to put it.
    log('INFO', 'user_created', { email: novo, by: email });
    json(res, 201, { user: await users.find(novo), password: senha });
    return true;
  }

  // ⚠️ `/users/me/name` is matched before the patterns below and cannot collide with them: `me` is
  // not an address, and `isEmailAddress` is what every other route puts in that position.
  if (rota === '/users/me/name' && req.method === 'POST') {
    // No role check, on purpose: this is the one route about the caller's OWN row. Anybody who got
    // this far has a session, and correcting the spelling of your own name is not a privilege.
    const body = (await corpoJson(req)) as { name?: string };
    try {
      await users.rename(email, String(body.name ?? ''));
    } catch (erro) {
      const falha = UserInputError.from(erro, 'api.name.invalid');
      json(res, 400, { error: say(falha.key, falha.params) });
      return true;
    }
    log('INFO', 'user_renamed', { email });
    json(res, 200, { user: await users.find(email) });
    return true;
  }

  // ---------------------------------------------------------------- a new password for somebody
  const reset = rota.match(/^\/users\/([^/]+)\/password$/);
  if (reset && req.method === 'POST') {
    if (!manages()) return forbidden();
    const alvo = await found(reset[1]);
    if (!alvo) return true;
    // ⚠️ Nobody resets the OWNER's password but the owner. Without this an admin resets it, reads
    // the new password from this very response, signs in as the owner — and from then on every ✓
    // is signed with the owner's e-mail. In a method whose whole claim is "who approved this, and
    // when", that is not privilege escalation in the abstract: it is the audit trail becoming a
    // lie, with nothing in the record to show it happened.
    //
    // An owner who loses the password recovers it the way the invariant implies: whoever operates
    // the service removes the account and restarts, and the first-access password is generated
    // again. That is an operations act, on purpose — being the owner is configuration, not a
    // button someone else can press.
    if (papeis.roleOf(alvo) === 'owner' && alvo !== email) {
      return json(res, 409, { error: i18n.t(idioma(req), 'api.users.ownerPasswordIsOwnTo') }), true;
    }
    const senha = await users.resetPassword(alvo);
    // Said once, here, and nowhere else. Not in the log line below, not in any later GET.
    log('INFO', 'user_password_reset', { email: alvo, by: email });
    json(res, 200, { user: await users.find(alvo), password: senha });
    return true;
  }

  // ---------------------------------------------------------------- taking the access away
  const enabled = rota.match(/^\/users\/([^/]+)\/enabled$/);
  if (enabled && req.method === 'POST') {
    if (!manages()) return forbidden();
    const body = (await corpoJson(req)) as { enabled?: unknown };
    // A missing field is not "false". Read as falsy, a body with a typo in the key would silently
    // revoke somebody's access, which is the most expensive way to misread a request here.
    if (typeof body.enabled !== 'boolean') {
      json(res, 400, { error: say('api.users.enabledMissing') });
      return true;
    }
    const alvo = await found(enabled[1]);
    if (!alvo) return true;

    // ⚠️ The owner cannot be disabled, not by an admin and not by themselves. `createRoles`
    // refuses to start with anything other than exactly one owner, so a service whose owner cannot
    // sign in is a service where nobody can approve and nobody can hand the role to anyone else —
    // and the fix is a restart with a different environment variable, which is not something the
    // person locked out can do from the screen they are looking at.
    //
    // 409 and not 403: 403 above means "you may not do this", and this is "this may not be done".
    // Telling the two apart is the difference between asking an admin for help and understanding
    // that the answer is in the configuration.
    if (!body.enabled && papeis.isOwner(alvo)) {
      json(res, 409, { error: say('api.users.ownerCannotBeDisabled', { email: alvo }) });
      return true;
    }
    await users.setEnabled(alvo, body.enabled);
    log('INFO', 'user_enabled_changed', { email: alvo, enabled: body.enabled, by: email });
    json(res, 200, { user: await users.find(alvo) });
    return true;
  }

  return false;

  /** The address in the path, if somebody is there. Answers 404 itself and returns null if not. */
  async function found(segment: string): Promise<string | null> {
    // ⚠️ `decodeURIComponent` THROWS on a half-written escape like `%zz`, and an uncaught throw
    // here becomes a 500 with an incident id — the shape of an answer that says "the service is
    // broken" about a request that was simply malformed. A path nobody can decode names nobody.
    let alvo: string;
    try {
      alvo = normalizeEmail(decodeURIComponent(segment));
    } catch {
      json(res, 404, { error: say('api.users.notFound', { email: segment }) });
      return null;
    }
    // ⚠️ `find` returns disabled people too, and it has to: giving an access back is a request
    // about somebody who is, by definition, already disabled.
    if (await users.find(alvo)) return alvo;
    json(res, 404, { error: say('api.users.notFound', { email: alvo }) });
    return null;
  }
}

/** The only page served without a session. Self-contained on purpose: see review/api/login.html. */
const TELA_DE_ENTRADA = '/entrar';

// ---------------------------------------------------------------- static site
// `lang` is carried in rather than read from the request because this function recurses on the
// index page and never sees the headers again. Both answers it can give are read by a person.
async function estatico(url: URL, res: ServerResponse, lang: string) {
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
    return json(res, 403, { error: i18n.t(lang, 'site.pathOutside') });
  }
  try {
    const info = await stat(alvo);
    if (info.isDirectory()) return estatico(new URL(url.href.replace(/\/?$/, '/index.html')), res, lang);
    return servirArquivo(alvo, res, caminho);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end(i18n.t(lang, 'site.notFound'));
  }
}

/**
 * Headers that cost nothing and close two doors.
 *
 * They mattered little while an identity proxy stood in front — nobody reached a page without
 * being let in first. The moment the service answers on the open internet with only a password,
 * they stop being hygiene and start being the defence:
 *
 *   frame-ancestors 'none'   nobody can put the login screen, or the panel, inside an <iframe>.
 *                            Without it, a hostile page can overlay an invisible "Approve" button
 *                            on top of a real one — and an approval here is a lock in a repository.
 *   nosniff                  the browser respects the content-type instead of guessing it. A file
 *                            served as text does not get executed because it happened to look like
 *                            a script.
 *   referrer-policy          the address of an internal page does not leak to whatever is clicked.
 */
const SECURITY_HEADERS = {
  'content-security-policy': "frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
};

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
    ...SECURITY_HEADERS,
  });
  res.end(await readFile(alvo));
}

// ---------------------------------------------------------------- the server
const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname === '/api/saude') return json(res, 200, { ok: true });

    // Before the authentication guard on purpose: the login screen is where most people change
    // language, and it is the one page they can reach without a session.
    if (url.pathname === LANGUAGE_ROUTE) {
      const cabecalhos = languageSwitch(url, i18n.languages, cfg.ambiente !== 'Development');
      return (res.writeHead(302, cabecalhos), res.end());
    }

    // /api/entrar is the only API route without a session: it is the one that creates it.
    if (porSenha && url.pathname === '/api/entrar' && req.method === 'POST') {
      const corpo = (await corpoJson(req)) as { email?: string; senha?: string };
      const r = await porSenha.entrar(corpo.email ?? '', corpo.senha ?? '');
      if (!r) {
        // The same answer for an unknown e-mail and a wrong password: saying which of the two
        // failed hands over who has an account. The response time matches too (see users.ts).
        log('WARNING', 'sign_in_refused', { email: corpo.email });
        return json(res, 401, { error: i18n.t(idioma(req), 'api.credentials.invalid') });
      }
      res.setHeader('set-cookie', porSenha.cabecalhoDeSessao(r.sessao));
      log('INFO', 'signed_in', { email: r.pessoa.email, mustChangePassword: r.pessoa.mustChangePassword });
      // The response keys stay Portuguese: they are the published contract the login screen reads.
      return json(res, 200, { email: r.pessoa.email, nome: r.pessoa.name, precisaTrocarSenha: r.pessoa.mustChangePassword });
    }

    if (url.pathname.startsWith('/api/')) {
      const email = porSenha
        ? (await porSenha.daRequisicao(req.headers))?.email ?? null
        : await identidade!.email(req.headers);
      if (!email) return json(res, 401, { error: i18n.t(idioma(req), 'api.notAuthenticated') });
      return await api(req, res, url, email);
    }

    // With an identity proxy, the edge blocks before anything reaches here. With password login
    // there is no edge at all: without this guard the entire documentation was open to anyone who
    // could reach the port — and whoever started the image believing they had configured a login
    // had no way to suspect otherwise. Found while testing.
    if (porSenha && !(await porSenha.daRequisicao(req.headers))) {
      if (url.pathname === TELA_DE_ENTRADA) {
        // ⚠️ SECURITY_HEADERS here is not decoration, and I left it out on the first try: the
        // login screen does not go through json() nor through servirArquivo(), so it was the ONE
        // page without `frame-ancestors 'none'` — the exact page the comment on those headers
        // names as the clickjacking target. A rule applied everywhere except where it matters.
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
          ...SECURITY_HEADERS,
        });
        // The text goes in before the bytes leave: no untranslated flash, no second request, and
        // the labels are there with JavaScript off. See review/api/login-page.ts.
        return res.end(renderLoginPage(i18n, idioma(req), url.pathname + url.search, temaDoProjeto));
      }
      const destino = encodeURIComponent(url.pathname + url.search);
      return (res.writeHead(302, { location: `${TELA_DE_ENTRADA}?destino=${destino}` }), res.end());
    }
    // With a session already in hand, the login screen has nothing to do: send them to the site.
    if (porSenha && url.pathname === TELA_DE_ENTRADA) {
      return (res.writeHead(302, { location: '/' }), res.end());
    }

    return await estatico(url, res, idioma(req));
  } catch (erro) {
    const id = crypto.randomUUID().slice(0, 8);
    log('ERROR', 'unhandled_error', {
      id, path: url.pathname, reason: erro instanceof Error ? erro.message : String(erro),
    });
    // The reason is in the log and NOT in the reply: a stack trace or a database message handed to
    // whoever asked is free reconnaissance. The id is what ties the screen to the log line — the
    // person quotes eight characters and whoever operates greps for them.
    json(res, 500, { error: i18n.t(idioma(req), 'api.internal'), id });
  }
});

servidor.listen(cfg.porta, () => {
  log('INFO', 'server_listening', {
    port: cfg.porta, environment: cfg.ambiente, identity: comoEntrar, database: ondeGuardar,
    // Which user store is in play, said out loud at boot. Whoever is losing accounts on Cloud Run
    // needs one grep to find out they are on a disk that does not survive the instance.
    // ⚠️ The KIND, never the URL: `postgres://user:password@host/db` in a log line is the database
    // password in the log collector, readable by everyone who can read logs.
    users: porSenha ? userStoreKind(process.env.REVISAO_USERS) : null,
    localMode: identidade?.modoLocal ?? false, site: cfg.site,
  });
});
