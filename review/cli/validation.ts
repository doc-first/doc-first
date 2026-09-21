import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { fingerprintOfText } from '../core/fingerprint.js';
import { lerTrechos, arquivosDeFolhas, acharArquivoDoTrecho, nomeCurto, type Trecho } from './pages.ts';
import { readConfig } from '../core/config.js';
import { trafficLight, dependentsOf, COLOURS } from '../core/validity.js';
import { Source } from './remote.ts';

/**
 * The validation lock: an approved block does not change without permission, and no approval mark
 * exists without a trail.
 *
 * The most critical piece of the method — it decides whether a human approval still holds.
 *
 * ⚠️ Everything printed from here is English, and deliberately NOT routed through
 * `review/core/i18n.js`. The reader of these lines is whoever operates the tool, and the line they
 * read is also the line they paste into a report and grep for months later. Evidence that changes
 * wording by locale is evidence nobody can search. The reviewer's own language lives in the
 * browser, not here.
 */

export interface Registry {
  /** ⚠️ The keys stay in Portuguese: this is the on-disk shape of the approvals file in every
   *  project that already adopted the method. Renaming them here would invalidate every registry
   *  out there — that is a migration, not a translation. */
  [id: string]: { arquivo: string; data: string; digital_texto: string; digital?: string;
                  origem?: string; evento?: string; texto?: string; migrado_de?: string[];
                  /** The fingerprint EACH dependency had at the moment of the ✓. Without this there is
                   *  no way to tell later that the base moved — the block's own fingerprint stays silent. */
                  depende?: Record<string, string> };
}

/**
 * Where the approval registry lives. It comes from `doc-first.json` (`conteudo.registro`), not from
 * the code: `docs/validacoes.json` was a decision of the first project, written inside the engine.
 */
const registryPath = (root: string) =>
  join(root, ...readConfig(root, { readFile: (p: string) => readFileSync(p, 'utf8') }, process.env)
    .registry.split('/'));

export function loadRegistry(root: string): Registry {
  const p = registryPath(root);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

export function saveRegistry(root: string, registry: Registry) {
  const sorted: Registry = {};
  for (const k of Object.keys(registry).sort()) sorted[k] = registry[k];
  writeFileSync(registryPath(root), JSON.stringify(sorted, null, 1) + '\n', 'utf8');
}

/**
 * Flags what changed after being validated, what is marked without a registry entry, and what
 * claims a proof that is no longer on disk.
 */
export async function check(root: string): Promise<number> {
  const registry = loadRegistry(root);
  const blocks = await lerTrechos(root);
  let problems = 0;

  for (const [id, entry] of Object.entries(registry).sort()) {
    const block = blocks.get(id);
    if (!block) { console.log(`  ✗ ${id}: the block is gone (${entry.arquivo})`); problems++; continue; }
    if (!block.validado) { console.log(`  ✗ ${id}: it lost the validated mark`); problems++; }
    if (block.digital !== entry.digital_texto) {
      console.log(`  ✗ ${id}: the TEXT changed after it was validated on ${entry.data} — this needs the owner's permission`);
      problems++;
    }
  }
  problems += await orphanMarks(root, registry);
  problems += missingProofs(root, blocks);
  console.log(`${Object.keys(registry).length} validated · ${problems ? `${problems} problem(s)` : 'all intact'}`);
  return problems;
}

/**
 * A `data-prova` pointing at a file that is not there.
 *
 * Why this is an issue and not a shrug: `data-prova` is the one attribute in the whole catalogue
 * that points OUTSIDE the documentation. Every other demand — an `alt`, a `<th>`, an owner, a
 * deadline — is satisfied by something the block carries, so the block alone can be trusted to
 * answer for it. This one names a file in the code, and files move, get renamed and get deleted by
 * people who never open the documentation. The attribute survives all three, and a rule whose
 * proof was deleted still LOOKS defended: the kind is `rule`, the demand is satisfied, the page
 * shows nothing amiss. A stale path silently proves nothing, and silence is exactly the failure
 * this engine exists to remove.
 *
 * The value is read as `path/to/file.test.js::name of the test`. Only the PATH is checked here.
 * The name after `::` is informative for now — confirming that a test by that name exists inside
 * the file means running or parsing a test runner, which is a different tool with a different
 * failure mode, and a check that half-works is worse than one that says what it covers.
 *
 * ⚠️ The path is relative to the CONTENT project root — the folder holding `doc-first.json` — not
 * to wherever the CLI was invoked from, and not to the page's own file. Anything else would make
 * the same attribute mean different things depending on which directory somebody was standing in.
 * A project whose tests live outside that root cannot be pointed at from here, and should say so
 * out loud rather than have this check quietly guess a second base directory.
 *
 * ⚠️ It does NOT answer the other half of the question — "the rule changed and its proof did not".
 * That one needs to compare two commits, and the git-diff layer does not exist yet. See
 * `docs/BUGS.md`, "The bridge to the code".
 */
export function missingProofs(root: string, blocks: Map<string, Trecho>): number {
  let found = 0;
  for (const [id, block] of [...blocks].sort(([a], [b]) => a.localeCompare(b))) {
    if (block.prova === null) continue;
    const path = block.prova.split('::')[0].trim();
    if (!path) {
      console.log(`  ✗ ${id}: data-prova names no file — write it as `
        + `path/to/file.test.js::name of the test`);
      found++;
      continue;
    }
    if (existsSync(join(root, ...path.split('/')))) continue;
    console.log(`  ✗ ${id}: data-prova points at ${path}, and there is no such file — `
      + `point it at the test that defends this rule, or the rule is not defended`);
    found++;
  }
  return found;
}

/**
 * A validated mark in the HTML with NO matching registry entry.
 *
 * Proved on 2026-09-18: without this sweep, a hand-written `data-validado` created an approval out of
 * nothing — and the site shows it, because the seal comes from the attribute. Approval with no trail,
 * in a method whose thesis is traceable approval.
 */
export async function orphanMarks(root: string, registry: Registry, files?: string[]): Promise<number> {
  let found = 0;
  for (const path of files ?? arquivosDeFolhas(root)) {
    const { document } = parseHTML(readFileSync(path, 'utf8'));
    for (const el of document.querySelectorAll('[data-validado]')) {
      const id = el.getAttribute('data-id');
      const when = el.getAttribute('data-validado');
      if (!id) {
        console.log(`  ✗ ${path}: a validated mark on a block with NO data-id`); found++;
      } else if (!registry[id]) {
        console.log(`  ✗ ${id}: marked as validated on ${when}, and there is NO registry entry — an approval with no trail`);
        found++;
      } else if (registry[id].data !== when) {
        console.log(`  ✗ ${id}: the date in the HTML (${when}) does not match the one in the registry (${registry[id].data})`);
        found++;
      }
    }
  }
  return found;
}

/** Writes a block's lock: marks the HTML and records the fingerprint. */
export async function mark(root: string, registry: Registry, id: string, when: string,
                           source: string, event?: string,
                           fingerprintsNow?: Map<string, string>): Promise<string | null> {
  const found = acharArquivoDoTrecho(root, id);
  if (!found) { console.log(`  ✗ ${id}: not found`); return null; }

  const marked = found.html.replace(
    new RegExp(`(data-id="${id.replace(/\./g, '\\.')}")(?! data-validado)`),
    `$1 data-validado="${when}"`);
  if (marked !== found.html) writeFileSync(found.caminho, marked, 'utf8');

  const { document } = parseHTML(marked);
  const el = document.querySelector(`[data-id="${id}"]`)!;
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('[data-revisao-ui]').forEach((x: Element) => x.remove());
  const text = copy.textContent ?? '';
  const fingerprint = await fingerprintOfText(text);

  // What this block depends on, and how each dependency looked RIGHT NOW. Keeping the snapshot of the
  // dependencies is what allows saying, months later, "the text is still the same but the base moved".
  // Without it the red light would have nothing to compare against.
  const declared = (el.getAttribute('data-depende') ?? '').split(/\s+/).filter(Boolean);
  const depende: Record<string, string> = {};
  for (const other of declared) {
    const d = fingerprintsNow?.get(other);
    if (d) depende[other] = d;
    else console.log(`  ⚠ ${id} declares a dependency on ${other}, which does not exist`);
  }

  // The browser needs two snapshots to paint the traffic light without asking the server:
  //   data-digital-validada  the text that was approved  → without it there is no 🟡
  //   data-dependia-de       the ground at that moment   → without it there is no 🔴
  // The JSON is the truth; these attributes are the copy that travels with the page.
  const attributes: Record<string, string> = { 'data-digital-validada': fingerprint };
  if (Object.keys(depende).length) {
    attributes['data-dependia-de'] = JSON.stringify(depende).replace(/"/g, '&quot;');
  }
  let html = readFileSync(found.caminho, 'utf8');
  for (const [attr, value] of Object.entries(attributes)) {
    const target = new RegExp(`(data-id="${id.replace(/\./g, '\\.')}")((?:(?!${attr})[^>])*?)>`);
    html = html.replace(target, `$1$2 ${attr}="${value}">`);
  }
  writeFileSync(found.caminho, html, 'utf8');

  const previous = registry[id];
  registry[id] = {
    arquivo: nomeCurto(root, found.caminho),
    data: when, digital_texto: fingerprint, origem: source,
    texto: text.replace(/\s+/g, ' ').trim().slice(0, 120),
    ...(Object.keys(depende).length ? { depende } : {}),
    ...(event ? { evento: event } : {}),
    ...(previous?.migrado_de ? { migrado_de: previous.migrado_de } : {}),
    ...(previous?.digital ? { digital: previous.digital } : {}),
  };
  return fingerprint;
}

/** Brings into the repository the ✓ the owner gave on the site. Only his: a reviewer's approval does not lock. */
export async function sync(root: string, source: Source, options: { owner?: string } = {}) {
  const owner = (options.owner ?? process.env.REVISAO_OWNER ?? '').toLowerCase();
  if (!owner) throw new Error('set REVISAO_OWNER: it is THEIR ✓ that becomes a lock.');

  // The cloud being down must not take the whole session down with it. The registry in the repository
  // is the source of what is already validated; the cloud only adds what came from the site. Without
  // it the local score still holds — what must NOT happen is the session going on unaware it read a
  // frozen snapshot.
  let events: Awaited<ReturnType<typeof source.events>>;
  try {
    events = await source.events();
  } catch (e) {
    const registry = loadRegistry(root);
    console.log(`⚠ could not reach the cloud, so no new ✓ from the site came in:\n  ${(e as Error).message}`);
    console.log(`  Going on with the registry in the repository: ${Object.keys(registry).length} validated (a frozen snapshot).`);
    return { added: 0, unchanged: 0, expired: 0, offline: true };
  }
  const approvals = events.filter((e) => e.tipo === 'aprovacao');
  const theOwners = approvals.filter((e) => (e.autor ?? '').toLowerCase() === owner);
  if (approvals.length !== theOwners.length) {
    console.log(`  · ${approvals.length - theOwners.length} approval(s) by somebody else ignored: only the owner's ✓ locks`);
  }

  const registry = loadRegistry(root);
  const blocks = await lerTrechos(root);
  const fingerprintsNow = new Map([...blocks].map(([id, t]) => [id, t.digital]));
  let added = 0, unchanged = 0, expired = 0;

  for (const e of theOwners.sort((a, b) => a.quando.localeCompare(b.quando))) {
    const id = e.caixa;
    if (!id) continue;
    const when = (e.quando || '').slice(0, 10);
    const block = blocks.get(id);
    if (!block) { console.log(`  ✗ ${id}: approved on the site, and does not exist in the repository`); continue; }
    if (e.digital !== block.digital) {
      console.log(`  ⚠ ${id}: the ✓ from ${when} is for an earlier version of the text — it does not hold any more`);
      expired++; continue;
    }
    if (registry[id]?.digital_texto === block.digital) { unchanged++; continue; }
    if (await mark(root, registry, id, when, 'site', e.id, fingerprintsNow)) {
      console.log(`  ✓ ${id} validated by you on the site on ${when}`);
      added++;
    }
  }
  saveRegistry(root, registry);
  console.log(`${added} new · ${unchanged} already there · ${expired} ✓ expired · ${Object.keys(registry).length} validated in all`);
  return { added, unchanged, expired, offline: false };
}

/**
 * A `Trecho` as the traffic light sees it.
 *
 * ⚠️ This function exists because of a bug that hid for days behind `as never`. `review/core/`
 * speaks English — `fingerprint`, `dependsOn` — and the page reader's own type still speaks
 * Portuguese — `digital`, `depende`. Passing one where the other was expected type-checks ONLY
 * because the cast erases the mismatch, and then `block.fingerprint` is `undefined` at run time.
 *
 * What it cost: the traffic light reported EVERY validated block as 🟡 forever, because `undefined`
 * never equals a recorded fingerprint — while `check`, which reads the right field, said
 * "17 validated · all intact" on the same repository. Two commands of the same tool, one lock,
 * opposite answers. And `if-i-touch` always replied "nothing depends on this", which is worse: it
 * is the answer you get right before you break something.
 *
 * The lesson is not "be careful with casts". It is that the translation between the two vocabularies
 * has to live in ONE named place that a test can point at — which is this one.
 */
export function asTheCoreSeesIt(blocks: Map<string, Trecho>) {
  return new Map([...blocks].map(([id, t]) =>
    [id, { id, fingerprint: t.digital, dependsOn: t.depende }]));
}

/**
 * The documentation traffic light: where each block stands, and what needs a human eye.
 *
 * This is the command that answers "can I trust this documentation today?". `check` answers a
 * smaller and older question — whether someone tampered with a mark. This one answers today's
 * question.
 */
export async function showLights(root: string, options: { only?: string } = {}) {
  const blocks = await lerTrechos(root);
  const registry = loadRegistry(root);
  const { byBlock, tally } = trafficLight(asTheCoreSeesIt(blocks), registry as never);

  const total = blocks.size;
  const line = (state: 'valid' | 'stale' | 'broken' | 'none', meaning: string) =>
    `  ${COLOURS[state]} ${String(tally[state]).padStart(4)}  ${meaning}`;

  console.log(`\nDocumentation: ${total} block(s)\n`);
  console.log(line('valid',  'validated, and nothing has changed since'));
  console.log(line('stale',  'the text changed after the ✓ — approve it again'));
  console.log(line('broken', 'the text is the same, but the ground moved — CHECK IT'));
  console.log(line('none',   'nobody has validated it yet'));

  // Red comes first, and named: it is the only state nobody spots on their own by reading the page,
  // because nothing on the page changed.
  const red = [...byBlock].filter(([, r]) => r.state === 'broken');
  if (red.length) {
    console.log(`\n🔴 Need a check — the ground moved, not the text:\n`);
    for (const [id, r] of red) {
      console.log(`  ${id}`);
      console.log(`     depends on: ${r.blame.join(', ')} — and that changed since the ✓`);
    }
  }

  // `--only red` keeps the list to what nobody can spot by reading the page. `vermelho` still
  // answers for the same reason the old command names do: it is typed by hand and baked into
  // scripts out there, and a silent rename reads like the caller's repository is broken.
  const onlyRed = options.only === 'red' || options.only === 'vermelho';
  const yellow = [...byBlock].filter(([, r]) => r.state === 'stale');
  if (yellow.length && !onlyRed) {
    console.log(`\n🟡 Approve again (the text changed):\n  ${yellow.map(([id]) => id).join('  ')}`);
  }

  if (!red.length && !yellow.length) {
    console.log(`\n✓ nothing waiting to be checked.`);
  }
  console.log('');
  return tally;
}

/**
 * Writes into the HTML what the approvals registry already knows.
 *
 * Why this has to exist: the registry (`digital_texto`) is the truth, but the BROWSER cannot read
 * it — the page is static and the panel has no server to ask. It paints the traffic light from
 * three attributes that travel with the page, and `mark()` only writes them at the moment an
 * approval arrives. Any approval recorded before those attributes existed has `data-validado` and
 * nothing else.
 *
 * ⚠️ What that costs is exactly the thing this project is about: `review/web/src/estado.js` says it
 * in one line — without `data-digital-validada`, a rewritten block STAYS GREEN in the browser. The
 * seal shows, and the page never warns that the text drifted. Documentation that lies about being
 * checked is worse than documentation nobody checked.
 *
 * ⚠️ It writes the fingerprint FROM THE REGISTRY, never the one computed from the text on disk now.
 * Recomputing would be a silent re-approval: a block whose text changed after the ✓ would be
 * stamped with its new text and turn green, and the drift this exists to reveal would be erased by
 * the very command meant to reveal it. So a block that drifted gets stamped with the OLD
 * fingerprint and correctly shows 🟡.
 */
export async function restamp(root: string) {
  const registry = loadRegistry(root);
  const blocks = await lerTrechos(root);
  let written = 0, alreadyHad = 0, noSuchBlock = 0;
  const willTurnYellow: string[] = [];

  for (const [id, entry] of Object.entries(registry)) {
    const recorded = (entry as { digital_texto?: string }).digital_texto;
    if (!recorded) continue;
    const found = acharArquivoDoTrecho(root, id);
    if (!found) { noSuchBlock++; continue; }

    const current = blocks.get(id)?.digital;
    if (current && current !== recorded) willTurnYellow.push(id);

    const escaped = id.replace(/\./g, '\\.');
    if (new RegExp(`data-id="${escaped}"[^>]*data-digital-validada`).test(found.html)) {
      alreadyHad++; continue;
    }

    const attributes: Record<string, string> = { 'data-digital-validada': recorded };
    const dependedOn = (entry as { depende?: Record<string, string> }).depende;
    if (dependedOn && Object.keys(dependedOn).length) {
      attributes['data-dependia-de'] = JSON.stringify(dependedOn).replace(/"/g, '&quot;');
    }

    let html = readFileSync(found.caminho, 'utf8');
    for (const [attr, value] of Object.entries(attributes)) {
      html = html.replace(new RegExp(`(data-id="${escaped}")((?:(?!${attr})[^>])*?)>`),
                          `$1$2 ${attr}="${value}">`);
    }
    writeFileSync(found.caminho, html, 'utf8');
    written++;
  }

  console.log(`\n${written} block(s) got the mark they were missing · ${alreadyHad} already had it`);
  if (noSuchBlock) console.log(`⚠ ${noSuchBlock} entries in the registry no longer exist in the pages`);
  if (willTurnYellow.length) {
    console.log(`\n🟡 ${willTurnYellow.length} will show up YELLOW on the site, and that is right —`);
    console.log(`   the text changed after the ✓:\n   ${willTurnYellow.join('  ')}`);
  }
  console.log('');
  return written;
}

/** What else do I have to look at if I touch this? The question to ask BEFORE editing. */
export async function ifITouch(root: string, id: string) {
  const blocks = await lerTrechos(root);
  if (!blocks.has(id)) { console.log(`✗ no such block: ${id}`); return 1; }

  const dependents = dependentsOf(id, asTheCoreSeesIt(blocks));
  const registry = loadRegistry(root);

  console.log(`\nIf you touch ${id}:\n`);
  if (!dependents.length) {
    console.log('  nothing declares a dependency on this block.');
    console.log('  (which does not mean nothing depends on it — only that nobody declared it)\n');
    return 0;
  }
  console.log(`  ${dependents.length} block(s) will turn 🔴 and need a check:\n`);
  for (const d of dependents) {
    const validated = registry[d] ? `✓ validated on ${registry[d].data}` : 'never validated';
    console.log(`  ${d.padEnd(14)} ${validated}`);
  }
  console.log('');
  return 0;
}

// ---------------------------------------------------------------- the index in the database

/**
 * Rebuilds the documentation index in the database: which blocks exist, of what kind, what they depend
 * on, and what is missing in each one.
 *
 * ⚠️ The database does not become the truth. The truth stays in the file, versioned — the file is what
 * has diff and authorship. This is a snapshot, and it exists for the questions a file answers badly:
 * "every diagram in the project", "every decision without an owner", "what breaks if I touch this".
 */
export async function rebuildIndex(root: string, databasePath?: string) {
  const { Index } = await import('../api/index-store.ts');
  const { currentCommit } = await import('../core/git.js');
  const database = databasePath ?? process.env.REVISAO_SQLITE ?? join(root, 'dados', 'events.db');
  const blocks = await lerTrechos(root);

  // Which commit the content was sitting on, so that a later run can ask git which files changed
  // instead of reparsing all of them. ⚠️ null when the content is not in a git repository — a
  // plain folder is a legitimate way to use this tool — and that is not an error: the index is
  // merely less useful, and indexing proceeds exactly the same.
  const commit = currentCommit(root);

  const idx = new Index(database);
  try {
    const howMany = idx.rebuild([...blocks.values()].map((t) => ({
      id: t.id, page: t.pagina, kind: t.tipo, file: t.arquivo, code: t.cod || null,
      numbered: t.numerado, fingerprint: t.digital, text: t.texto.slice(0, 400),
      dependsOn: t.depende, missing: t.falta,
    })), commit);

    console.log(`\nIndexed ${howMany} block(s) in ${database}\n`);
    for (const { kind, count } of idx.byKind()) {
      console.log(`  ${String(count).padStart(4)}  ${kind}`);
    }

    // The summary of where the dependencies landed, and not the list of them: the funnel is judged
    // by how little reaches a person, and that is a number you can read in one glance and compare
    // with the last run. ⚠️ Matrix only — no "before" text exists at index time, so these are the
    // levels the kinds alone produce; see the note in `rebuild`.
    const levels = idx.bySeverity();
    const pairs = levels.reduce((sum, l) => sum + l.count, 0);
    if (pairs) {
      console.log(`\n${pairs} dependency pair(s), by severity (kinds only, no edit signals):`);
      for (const { severity, count } of levels) {
        console.log(`  ${String(count).padStart(4)}  ${severity}`);
      }
      const needsAPerson = idx.needsAPerson();
      for (const p of needsAPerson.slice(0, 10)) {
        console.log(`    person: ${p.block} (${p.kind}) → ${p.dependsOn} (${p.dependsOnKind ?? '?'})`);
      }
      if (needsAPerson.length > 10) console.log(`    … and ${needsAPerson.length - 10} more`);
    }

    const broken = idx.brokenDependencies();
    if (broken.length) {
      console.log(`\n✗ ${broken.length} dependency(ies) point at a block that does not exist:`);
      for (const b of broken) console.log(`    ${b.block} → ${b.dependsOn}`);
    }

    const issues = idx.issues();
    if (issues.length) {
      console.log(`\n⚠ ${issues.length} block(s) are missing what their kind demands:\n`);
      for (const i of issues.slice(0, 20)) console.log(`  ${i.id.padEnd(14)} ${i.missing}`);
      if (issues.length > 20) console.log(`  … and ${issues.length - 20} more`);
    } else {
      console.log('\n✓ every block has what its kind demands.');
    }
    console.log('');
    return {
      howMany, commit, issues: issues.length, broken: broken.length,
      severities: Object.fromEntries(levels.map((l) => [l.severity, l.count])),
    };
  } finally {
    idx.close();
  }
}

/** The catalogue of kinds, for whoever is writing and wants to know what exists. */
export async function listKinds() {
  const { catalogue } = await import('../core/kinds.js');
  console.log('\nContent kinds — every block that can be validated is one of these:\n');
  for (const kind of catalogue()) {
    console.log(`  ${kind.id.padEnd(11)} ${kind.name}${kind.numbered ? '' : '   (no number on the page)'}`);
    console.log(`  ${''.padEnd(11)} ${kind.description.replace(/\s+/g, ' ')}\n`);
  }
}
