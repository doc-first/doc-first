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
 * One command instead of two loose scripts: `doc-first <comando>`. It reads the requests reviewers
 * made on the site, shows the context, measures the impact before changing anything, and brings into
 * the repository the ✓ the owner gave. It NEVER changes content on its own.
 *
 * It uses the SAME core (review/core/) as the server and the browser: the request cycle and the text
 * fingerprint are one single file, not three implementations that have to stay identical.
 */

const AJUDA = `
doc-first — the agent's tool for the Doc First method

  Review (what came in from the site)
    listar [--todos]            requests the owner APPROVED, waiting to be applied (or all)
    ver <id>                    the request, the block's text then and now, and the thread
    impacto <id> [--termo x]    where else the subject shows up, and what is validated
    resumo                      approvals and requests, per page
    estado <id> <new> "msg"     records progress (whoever asked sees it in the panel)
                                  --commit <sha>    required for "aplicado"
                                  --trechos A01.1.4,A02.3.1

  The validation lock (the human ✓)
    sincronizar                 pulls in the ✓ the owner gave on the site
    conferir                    a validated block that changed, and a ✓ with no trail
    indexar                     rebuilds the index: kinds, dependencies, what is missing
    tipos                       the catalogue of content kinds
    semaforo                    the state of the whole documentation: 🟢 🟡 🔴 ⚪
    se-eu-mexer <id>            what else needs checking if I edit this

  Options
    --local                     talk to the local server instead of the cloud
    --raiz <path>               the project root (default: the current directory)
    --banco <file>              read the events from a SQLite file (the no-cloud mode)

  Variables
    REVISAO_OWNER               who approves; it is THEIR ✓ that becomes a lock
    REVISAO_PROJETO             the Firestore project, in the cloud
    REVISAO_CONTA               pins the gcloud account (default: the first one to issue a token)

  ⚠️ The command names are still Portuguese. They are a published interface, so they are being
     renamed in their own step, and the old names will keep working.
`;

async function principal() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      local: { type: 'boolean', default: false },
      todos: { type: 'boolean', default: false },
      termo: { type: 'string', multiple: true },
      raiz: { type: 'string' },
      commit: { type: 'string' },
      trechos: { type: 'string' },
      banco: { type: 'string' },
      so: { type: 'string' },
      ajuda: { type: 'boolean', short: 'h', default: false },
    },
  });

  const [comando, arg] = positionals;
  if (values.ajuda || !comando) { console.log(AJUDA.trim()); return 0; }

  const raiz = values.raiz ?? process.cwd();
  // The project configuration (name, owner, cloud project) comes from the doc-first.json at the root.
  const doProjeto = readConfig(raiz, { readFile: (p: string) => readFileSync(p, 'utf8') }, process.env);
  if (doProjeto.owner) process.env.REVISAO_OWNER ??= doProjeto.owner;
  const fonte = new Fonte({
    local: values.local,
    projeto: doProjeto.project ?? undefined,
    conta: doProjeto.account ?? undefined,
    banco: values.banco,
  });

  switch (comando) {
    case 'listar':      await pedidos.listar(raiz, fonte, values.todos); return 0;
    case 'ver':         await pedidos.ver(raiz, fonte, exige(arg, 'ver <id>')); return 0;
    case 'impacto':     await pedidos.impacto(raiz, fonte, exige(arg, 'impacto <id>'), values.termo ?? []); return 0;
    case 'resumo':      await pedidos.resumo(raiz, fonte); return 0;
    case 'estado':      await pedidos.estado(raiz, fonte, exige(arg, 'estado <id> <estado> "mensagem"'),
                          exige(positionals[2], 'estado <id> <estado> "mensagem"'),
                          exige(positionals[3], 'estado <id> <estado> "mensagem"'),
                          { commit: values.commit, caixas: values.trechos }); return 0;
    case 'sincronizar': await validacao.sincronizar(raiz, fonte); return 0;
    case 'conferir':    return (await validacao.conferir(raiz)) ? 1 : 0;
    case 'indexar':     await validacao.indexar(raiz, values.banco); return 0;
    case 'tipos':       await validacao.tipos(); return 0;
    case 'semaforo':    await validacao.mostrarSemaforo(raiz, { so: values.so }); return 0;
    case 'se-eu-mexer': return validacao.seEuMexer(raiz, exige(arg, 'se-eu-mexer <id>'));
    default:
      console.error(`unknown command: ${comando}\n`);
      console.error(AJUDA.trim());
      return 2;
  }
}

function exige(valor: string | undefined, uso: string): string {
  if (!valor) { console.error(`missing argument. Usage: doc-first ${uso}`); process.exit(2); }
  return valor;
}

principal()
  .then((codigo) => process.exit(codigo))
  .catch((erro) => {
    console.error('✗ ' + (erro instanceof Error ? erro.message : String(erro)));
    process.exit(1);
  });
