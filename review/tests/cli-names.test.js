/**
 * The old command names have to keep working, and keep doing exactly the same thing.
 *
 * The tool was renamed from Portuguese to English while its Portuguese names were already a
 * published interface: typed by hand, written into shell scripts, and wired into pre-commit hooks
 * in the repositories that use this engine. The alias table in `review/cli/doc-first.ts` is what
 * keeps those callers alive, and a table is exactly the kind of thing that loses an entry in a
 * later edit without anything going red.
 *
 * So this proves it end to end, through the real CLI: for each pair, the old name and the new name
 * produce byte-identical output. Remove one line from the table and the old name falls into
 * `unknown command`, the outputs diverge, and the matching case fails by name.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const CLI = join(ROOT, 'review', 'cli', 'doc-first.ts');

/**
 * Runs the CLI and returns what the user would see, whatever the exit code.
 *
 * The exit code is not the subject here: several of these commands legitimately fail against a
 * throwaway project (no cycle file, no events). What matters is WHICH message comes out — the
 * whole point of the change is that the old name must not produce "unknown command".
 */
function run(args, cwd) {
  try {
    return execFileSync(process.execPath, [CLI, ...args],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return String(e.stdout ?? '') + String(e.stderr ?? '');
  }
}

/** A disposable copy of the hello world, so a command that writes cannot dirty the repository. */
function project(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docfirst-names-'));
  cpSync(join(ROOT, 'examples', 'ola-mundo'), dir, { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Old name, new name, and the rest of the arguments each one needs. */
const PAIRS = [
  ['listar', 'list', []],
  ['ver', 'show', []],
  ['impacto', 'impact', []],
  ['resumo', 'summary', []],
  ['estado', 'state', []],
  ['sincronizar', 'sync', []],
  ['conferir', 'check', []],
  ['indexar', 'index', []],
  ['tipos', 'kinds', []],
  ['semaforo', 'lights', []],
  ['se-eu-mexer', 'if-i-touch', []],
];

for (const [old, current, extra] of PAIRS) {
  test(`\`${old}\` is an alias of \`${current}\`, and lands in the same place`, (t) => {
    const dir = project(t);
    const viaOld = run([old, ...extra], dir);
    const viaNew = run([current, ...extra], dir);

    assert.doesNotMatch(viaOld, /unknown command/,
      `\`${old}\` no longer resolves — someone dropped it from COMMAND_ALIASES`);
    assert.doesNotMatch(viaNew, /unknown command/, `\`${current}\` is not in the switch`);
    assert.equal(viaOld, viaNew, `\`${old}\` and \`${current}\` must do the same thing`);
  });
}

test('a command that needs an argument says so — it does not say "unknown command"', (t) => {
  // This is the distinction the whole change turns on. Before, `ver` with no id complained about
  // the missing id; if the alias broke, it would complain about the command instead, and whoever
  // hit it would go looking for a typo in their own script.
  const dir = project(t);
  for (const [old, current] of [['ver', 'show'], ['impacto', 'impact'],
    ['estado', 'state'], ['se-eu-mexer', 'if-i-touch']]) {
    assert.match(run([old], dir), new RegExp(`missing argument. Usage: doc-first ${current} `),
      `\`${old}\` must reach \`${current}\` and complain about the ARGUMENT`);
  }
});

test('a name that is neither old nor new is still rejected', (t) => {
  // The bridge must not turn into "anything goes": a typo has to stay a visible error.
  assert.match(run(['listarr'], project(t)), /unknown command: listarr/);
});

test('the old long options are aliases too', (t) => {
  const dir = project(t);
  // --raiz/--root carry a value, so this also proves the value survives the rewrite: pointed at
  // the hello world from somewhere else, the count of blocks has to be the hello world's.
  const viaOld = run(['semaforo', '--raiz', dir], ROOT);
  const viaNew = run(['lights', '--root', dir], ROOT);
  assert.doesNotMatch(viaOld, /unknown command|Unknown option/);
  assert.equal(viaOld, viaNew);
  assert.match(viaNew, /8 block/, 'it really read the project it was pointed at');

  // `--raiz=<value>` in one token takes a different branch of the rewrite than `--raiz <value>`.
  assert.equal(run(['lights', `--raiz=${dir}`], ROOT), viaNew);

  // Boolean, and an option that only some commands read.
  assert.equal(run(['listar', '--todos'], dir), run(['list', '--all'], dir));
  assert.equal(run(['semaforo', '--so', 'text'], dir), run(['lights', '--only', 'text'], dir));
});

test('--ajuda, --help and -h all print the help, and it advertises the new names', (t) => {
  const dir = project(t);
  const help = run(['--help'], dir);
  assert.equal(run(['--ajuda'], dir), help);
  assert.equal(run(['-h'], dir), help);
  assert.match(help, /^\s*list \[--all\]/m, 'the help shows the new names');
  assert.match(help, /still work/, 'and says the old ones are still accepted');
});
