#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { readConfig } from '../core/config.js';
import { Fonte } from './remote.ts';
import * as pedidos from './requests.ts';
import * as validacao from './validation.ts';

/**
 * The agent's tool for the Doc First methodology.
 *
 * One command instead of two loose scripts: `doc-first <command>`. It reads the requests reviewers
 * made on the site, shows the context, measures the impact before changing anything, and brings into
 * the repository the ✓ the owner gave. It NEVER changes content on its own.
 *
 * It uses the SAME core (review/core/) as the server and the browser: the request cycle and the text
 * fingerprint are one single file, not three implementations that have to stay identical.
 */

const HELP = `
doc-first — the agent's tool for the Doc First method

  Review (what came in from the site)
    list [--all]                requests the owner APPROVED, waiting to be applied (or all)
    show <id>                   the request, the block's text then and now, and the thread
    impact <id> [--term x]      where else the subject shows up, and what is validated
    summary                     approvals and requests, per page
    state <id> <new> "msg"      records progress (whoever asked sees it in the panel)
                                  --commit <sha>    required for "aplicado"
                                  --blocks A01.1.4,A02.3.1

  The validation lock (the human ✓)
    sync                        pulls in the ✓ the owner gave on the site
    check                       a validated block that changed, and a ✓ with no trail
    index                       rebuilds the index: kinds, dependencies, what is missing
    kinds                       the catalogue of content kinds
    lights                      the state of the whole documentation: 🟢 🟡 🔴 ⚪
    if-i-touch <id>             what else needs checking if I edit this

  Options
    --local                     talk to the local server instead of the cloud
    --root <path>               the project root (default: the current directory)
    --db <file>                 read the events from a SQLite file (the no-cloud mode)

  Variables
    REVISAO_OWNER               who approves; it is THEIR ✓ that becomes a lock
    REVISAO_PROJETO             the Firestore project, in the cloud
    REVISAO_CONTA               pins the gcloud account (default: the first one to issue a token)

  The former Portuguese names still work, silently and identically: listar, ver, impacto, resumo,
  estado, sincronizar, conferir, indexar, tipos, semaforo, se-eu-mexer, and the options --raiz,
  --banco, --termo, --todos, --trechos, --so, --ajuda.
`;

/**
 * The names this tool answered to before it spoke English, and what each one is now.
 *
 * Why a table and not a rename: these names are a PUBLISHED interface. They have been the only way
 * to call the tool for its whole life so far, they are typed by hand every day, and they are baked
 * into shell scripts and pre-commit hooks in the repositories that consume this engine — the
 * Arautos hook runs `./doc-first conferir` on every commit. A plain rename would break those hooks
 * on the next pull, with an error that reads like the user's repository is broken rather than like
 * this tool changed. That is how a tool gets uninstalled instead of reported.
 *
 * They resolve SILENTLY: no deprecation warning in this version, on purpose. A warning belongs in a
 * later version, once the documentation, the hooks and the scripts out there have had time to catch
 * up — warning on day one only trains people to ignore the warning. Actually DROPPING the old names
 * is a breaking change and therefore a major version, never a quiet cleanup.
 */
const COMMAND_ALIASES: Readonly<Record<string, string>> = {
  listar: 'list',
  ver: 'show',
  impacto: 'impact',
  resumo: 'summary',
  estado: 'state',
  sincronizar: 'sync',
  conferir: 'check',
  indexar: 'index',
  tipos: 'kinds',
  semaforo: 'lights',
  'se-eu-mexer': 'if-i-touch',
};

/** The same bridge for the long options. `--local` and `--commit` were already English. */
const OPTION_ALIASES: Readonly<Record<string, string>> = {
  raiz: 'root',
  banco: 'db',
  termo: 'term',
  todos: 'all',
  trechos: 'blocks',
  so: 'only',
  ajuda: 'help',
};

/**
 * Rewrites the old option names into the new ones before `parseArgs` ever sees them.
 *
 * Node's `parseArgs` has `short`, but no alias for a long name, so there were two ways to do this:
 * declare both names and merge the two values afterwards, or translate the tokens up front. Up
 * front wins because it leaves ONE declaration per option. With two declarations every read site
 * has to answer "what does `--root a --raiz b` mean?", and `--term` — which is `multiple: true` —
 * would arrive as two separate arrays that someone has to remember to concatenate in the right
 * order. Here the ambiguity never exists: by the time parsing starts there is only one spelling.
 *
 * Only tokens that look like a long option are touched, and nothing after a bare `--` is, since
 * everything past it is a value by definition.
 */
function withCanonicalOptions(argv: readonly string[]): string[] {
  const out: string[] = [];
  let onlyValuesFromHere = false;
  for (const token of argv) {
    if (onlyValuesFromHere || !token.startsWith('--')) { out.push(token); continue; }
    if (token === '--') { onlyValuesFromHere = true; out.push(token); continue; }
    const equals = token.indexOf('=');
    const name = token.slice(2, equals === -1 ? undefined : equals);
    const canonical = OPTION_ALIASES[name];
    out.push(canonical === undefined ? token : `--${canonical}${equals === -1 ? '' : token.slice(equals)}`);
  }
  return out;
}

async function main() {
  const { values, positionals } = parseArgs({
    args: withCanonicalOptions(process.argv.slice(2)),
    allowPositionals: true,
    options: {
      local: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      term: { type: 'string', multiple: true },
      root: { type: 'string' },
      commit: { type: 'string' },
      blocks: { type: 'string' },
      db: { type: 'string' },
      only: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const [given, arg] = positionals;
  if (values.help || !given) { console.log(HELP.trim()); return 0; }
  const command = COMMAND_ALIASES[given] ?? given;

  const root = values.root ?? process.cwd();
  // The project configuration (name, owner, cloud project) comes from the doc-first.json at the root.
  const projectConfig = readConfig(root, { readFile: (p: string) => readFileSync(p, 'utf8') }, process.env);
  if (projectConfig.owner) process.env.REVISAO_OWNER ??= projectConfig.owner;
  const source = new Fonte({
    local: values.local,
    projeto: projectConfig.project ?? undefined,
    conta: projectConfig.account ?? undefined,
    banco: values.db,
  });

  switch (command) {
    case 'list':       await pedidos.listar(root, source, values.all); return 0;
    case 'show':       await pedidos.ver(root, source, requireArg(arg, 'show <id>')); return 0;
    case 'impact':     await pedidos.impacto(root, source, requireArg(arg, 'impact <id>'), values.term ?? []); return 0;
    case 'summary':    await pedidos.resumo(root, source); return 0;
    case 'state':      await pedidos.estado(root, source, requireArg(arg, 'state <id> <state> "message"'),
                         requireArg(positionals[2], 'state <id> <state> "message"'),
                         requireArg(positionals[3], 'state <id> <state> "message"'),
                         { commit: values.commit, caixas: values.blocks }); return 0;
    case 'sync':       await validacao.sincronizar(root, source); return 0;
    case 'check':      return (await validacao.conferir(root)) ? 1 : 0;
    case 'index':      await validacao.indexar(root, values.db); return 0;
    case 'kinds':      await validacao.tipos(); return 0;
    case 'lights':     await validacao.mostrarSemaforo(root, { so: values.only }); return 0;
    case 'if-i-touch': return validacao.seEuMexer(root, requireArg(arg, 'if-i-touch <id>'));
    default:
      console.error(`unknown command: ${given}\n`);
      console.error(HELP.trim());
      return 2;
  }
}

function requireArg(value: string | undefined, usage: string): string {
  if (!value) { console.error(`missing argument. Usage: doc-first ${usage}`); process.exit(2); }
  return value;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('✗ ' + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  });
