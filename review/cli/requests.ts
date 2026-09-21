import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCycle } from '../core/cycle.js';
import { doHistorico, estadoAtual, estadoEmPortugues } from '../core/legacy.js';
import { createRoles } from '../core/roles.js';
import { lerTrechos } from './pages.ts';
import { Source } from './remote.ts';
import type { Evento } from '../api/types.ts';

/**
 * The agent's tool: read the change requests reviewers made on the site, see the context, measure
 * the impact, and record progress. It NEVER edits content — the agent does that, with the owner,
 * in a commit carrying the request trailers.
 *
 * ⚠️ What this file prints is English, and deliberately not routed through `review/core/i18n.js`:
 * whoever operates the tool reads logs, and a log is evidence. Evidence whose wording changes with
 * the machine's locale is evidence nobody can grep for. The one exception below is the state LABEL,
 * which comes from the project's `cycle.json` and is the reviewer's own language on purpose.
 */

export interface Request extends Evento {
  state: string;
  history: Evento[];
}

export function loadCycle(root: string) {
  return createCycle(JSON.parse(readFileSync(join(root, 'review', 'cycle.json'), 'utf8')));
}

/**
 * The label a person reads. It lives here, not in the core: the rule carries no interface text —
 * it returns the key, and each edge resolves it in the reader's language.
 */
const labelOf = (cycle: ReturnType<typeof createCycle>, state: string) =>
  cycle.table.states[state]?.label ?? state;

export function rolesFromEnvironment() {
  return createRoles(process.env.REVISAO_OWNER, process.env.REVISAO_ADMINS);
}

/** Reduces events to requests with a state — using the SAME core as the server and the browser. */
export function requests(root: string, events: Evento[]): Request[] {
  const cycle = loadCycle(root);
  const roles = rolesFromEnvironment();
  // The core speaks English, and so does `Request.state` — what translates to what a person reads
  // is the printing, just below. See review/core/legacy.js.
  const forTheCore = events.map(doHistorico);
  return events.filter((e) => e.tipo === 'pedido').map((p) => ({
    ...p,
    state: cycle.currentState(p.id, forTheCore, roles.isAdmin(p.autor)),
    history: events
      .filter((e) => e.dados?.pedido === p.id && e.tipo !== 'pedido')
      .sort((a, b) => a.quando.localeCompare(b.quando)),
  }));
}

export function find(all: Request[], prefix: string): Request {
  const hits = all.filter((p) => p.id.startsWith(prefix));
  if (hits.length !== 1) {
    throw new Error(`request "${prefix}": ${hits.length === 0 ? 'not found' : 'ambiguous, use more characters'}`);
  }
  return hits[0];
}

/**
 * When something happened, short enough to sit in a column.
 *
 * ⚠️ Built by hand instead of `toLocaleString`. It used to be pinned to `pt-BR`, which printed
 * `20/09 14:03` for everybody — and dropping the pin for the machine's own locale would be worse:
 * the same run would read `09/20` on one laptop and `20/09` on the next, so two people comparing
 * the same output would disagree about the day. Month-day, in that order, is the one shape that
 * cannot be read backwards. The CLOCK stays local, because the question being asked is "how long
 * ago", and that is only answerable in the reader's own day.
 */
const formatWhen = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 16);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

export async function list(root: string, source: Source, all: boolean) {
  const cycle = loadCycle(root);
  const events = await source.events();
  const found = requests(root, events);
  const queue = cycle.table.agent_queue ?? ['approved', 'applying', 'waiting'];
  const showing = all ? found : found.filter((p) => queue.includes(p.state));

  if (!showing.length) {
    const toTriage = found.filter((p) => p.state === 'open').length;
    console.log(`no requests ${all ? 'recorded' : 'approved and waiting to be applied'}.` +
      (toTriage && !all ? ` (${toTriage} waiting for the owner's triage)` : ''));
    return;
  }
  const blocks = await lerTrechos(root);
  for (const p of showing) {
    const block = p.caixa ? blocks.get(p.caixa) : undefined;
    const changed = block && p.digital && block.digital !== p.digital
      ? ' · ⚠ the block changed since the request' : '';
    const label = cycle.table.states[p.state]?.short ?? p.state;
    console.log(`${p.id.slice(0, 8)}  ${label.padEnd(10)} ${(p.caixa ?? p.pagina).padEnd(10)} ` +
      `${formatWhen(p.quando)}  ${p.autor}${changed}`);
    console.log(`          “${(p.texto ?? '').replace(/\n/g, ' ').slice(0, 140)}”`);
  }
}

export async function show(root: string, source: Source, prefix: string) {
  const cycle = loadCycle(root);
  const events = await source.events();
  const p = find(requests(root, events), prefix);
  const blocks = await lerTrechos(root);
  const block = p.caixa ? blocks.get(p.caixa) : undefined;

  console.log(`Request  ${p.id}`);
  console.log(`State    ${labelOf(cycle, p.state)}`);
  console.log(`Who      ${p.autor}  ·  ${formatWhen(p.quando)}`);
  console.log(`Where    ${p.caixa ?? p.pagina}${block ? `  (${block.arquivo})` : ''}`);
  console.log(`\nAsked for:\n  ${(p.texto ?? '').replace(/\n/g, '\n  ')}`);
  if (p.foto) console.log(`\nThe block's text when they asked:\n  ${p.foto.slice(0, 500)}`);
  if (block) {
    console.log(`\nThe block's text NOW:\n  ${block.texto.slice(0, 500)}`);
    if (p.digital && block.digital !== p.digital) console.log('\n  ⚠ the block CHANGED since the request.');
    if (block.validado) {
      console.log(`  ⚠ this block is VALIDATED (${block.validado}): changing it needs the owner's permission.`);
    }
  }
  if (p.history.length) {
    console.log('\nThread:');
    for (const e of p.history) {
      // `e.dados.estado` comes from the record, still in Portuguese: translate before looking up
      // the label.
      const what = e.tipo === 'complemento' ? 'added more'
        : (labelOf(cycle, estadoAtual(String(e.dados?.estado ?? ''))) || e.tipo);
      console.log(`  ${formatWhen(e.quando)}  ${e.autor}  ${what}`);
      if (e.texto) console.log(`      ${e.texto.replace(/\n/g, ' ')}`);
    }
  }
}

/** Where else the subject shows up — the impact analysis you run before editing. */
export async function impact(root: string, source: Source, prefix: string, terms: string[]) {
  const events = await source.events();
  const p = find(requests(root, events), prefix);
  const blocks = await lerTrechos(root);
  const searching = terms.length ? terms : [(p.texto ?? '').split(/\s+/).slice(0, 3).join(' ')];

  console.log(`Impact of request ${p.id.slice(0, 8)} — ${p.caixa ?? p.pagina}\n`);
  for (const term of searching) {
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const hits = [...blocks.values()].filter((t) => rx.test(t.texto));
    console.log(`"${term}" shows up in ${hits.length} block(s):`);
    for (const t of hits.slice(0, 25)) {
      console.log(`  ${t.id.padEnd(12)} ${t.validado ? '✓ validated ' : '            '}${t.texto.slice(0, 80)}`);
    }
    if (hits.length > 25) console.log(`  … and ${hits.length - 25} more`);
    const validated = hits.filter((t) => t.validado).length;
    if (validated) console.log(`  ⚠ ${validated} of them are VALIDATED: changing those needs the owner's permission.`);
    console.log('');
  }
}

export async function summary(root: string, source: Source) {
  const events = await source.events();
  const all = requests(root, events);
  const perPage = new Map<string, { approvals: number; requests: number; open: number }>();
  for (const e of events) {
    const v = perPage.get(e.pagina) ?? { approvals: 0, requests: 0, open: 0 };
    if (e.tipo === 'aprovacao') v.approvals++;
    if (e.tipo === 'pedido') v.requests++;
    perPage.set(e.pagina, v);
  }
  // ⚠️ `open`, not `aberto`. The cycle's states became English in `review/core/cycle.js`, and this
  // comparison was left behind spelling the old name — so the "open" column counted zero forever,
  // on every page, and read like a clean queue.
  for (const p of all.filter((x) => x.state === 'open')) {
    const v = perPage.get(p.pagina)!; v.open++;
  }
  for (const [page, v] of [...perPage].sort()) {
    console.log(`${page.padEnd(8)} ${String(v.approvals).padStart(3)} approval(s) · ` +
      `${v.requests} request(s) · ${v.open} open`);
  }
  console.log(`total: ${events.length} event(s), ${all.length} request(s), ` +
    `${all.filter((p) => p.state === 'open').length} open`);
}

/**
 * Records progress on a request — what the reviewer sees in the block's panel.
 * The agent only uses ITS OWN states: approving, rejecting and asking is the owner's triage, on
 * the site.
 */
export async function setState(root: string, source: Source, prefix: string, wanted: string,
                               message: string, extra: { commit?: string; blocks?: string } = {}) {
  const cycle = loadCycle(root);
  const events = await source.events();
  const p = find(requests(root, events), prefix);

  // People type the state on the command line, and they learned the old names. Those keep
  // working — migrating the language of the code does not migrate anyone's fingers.
  const target = estadoAtual(wanted);
  if (!cycle.agentStates.includes(target)) {
    // Both spellings are listed because both are accepted: naming only the canonical one would
    // make the error contradict the alias that is still working one line above.
    const accepted = cycle.agentStates.map((s: string) => `${s} (${estadoEmPortugues(s)})`).join(', ');
    throw new Error(`the agent only uses: ${accepted} ` +
      '(approving, rejecting and asking is the owner\'s triage, on the site)');
  }
  if (!cycle.canGo(p.state, target)) {
    throw new Error(`no: the request is "${labelOf(cycle, p.state)}". ` +
      'The agent only applies requests the owner APPROVED.');
  }
  if (cycle.requiresCommit(target) && !extra.commit) {
    throw new Error('applied needs --commit SHA (the trail ties request ↔ commit)');
  }

  // Written in Portuguese, like the rest of the record: the front end still reads it that way.
  // See legacy.js.
  const data: Record<string, string> = {
    pedido: p.id, estado: estadoEmPortugues(target), de: estadoEmPortugues(p.state),
  };
  if (extra.commit) data.commit = extra.commit;
  if (extra.blocks) data.caixas = extra.blocks;

  const text = message + (extra.commit ? ` · commit ${extra.commit.slice(0, 7)}` : '') +
    (extra.blocks ? ` · blocks: ${extra.blocks}` : '');
  await source.add({ tipo: 'pedido_estado', pagina: p.pagina, caixa: p.caixa, texto: text, dados: data });
  console.log(`recorded: ${p.id.slice(0, 8)} → ${labelOf(cycle, target)}`);
}
