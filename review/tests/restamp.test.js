import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restamp } from '../cli/validation.ts';

const ROOT = new URL('../../', import.meta.url).pathname;

/** A throwaway copy of the hello world, with an approvals registry we control. */
function project(registry) {
  const dir = mkdtempSync(join(tmpdir(), 'restamp-'));
  cpSync(join(ROOT, 'examples', 'ola-mundo'), dir, { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  const cfg = JSON.parse(readFileSync(join(dir, 'doc-first.json'), 'utf8'));
  cfg.conteudo.registro = 'docs/approvals.json';
  writeFileSync(join(dir, 'doc-first.json'), JSON.stringify(cfg));
  writeFileSync(join(dir, 'docs', 'approvals.json'), JSON.stringify(registry));
  return dir;
}

const pageOf = (dir) => readFileSync(join(dir, 'paginas', 'A01.html'), 'utf8');

test('writes the fingerprint FROM THE REGISTRY, not the one computed now', async () => {
  // The whole point. A block whose text changed after the ✓ must be stamped with the OLD
  // fingerprint, so the browser paints it 🟡. Stamping the current text would be a silent
  // re-approval — the command meant to reveal the drift would erase it instead.
  const dir = project({ 'A01.1.1': { digital_texto: 'ffffffffffffffff', data: '2026-01-01' } });
  try {
    await restamp(dir);
    assert.match(pageOf(dir), /data-id="A01\.1\.1"[^>]*data-digital-validada="ffffffffffffffff"/,
      'stamped what the registry recorded');
    assert.doesNotMatch(pageOf(dir), /data-digital-validada="(?!ffffffffffffffff)/,
      'no block got a freshly computed fingerprint');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('does not touch a block that already carries the mark', async () => {
  const dir = project({ 'A01.1.1': { digital_texto: 'aaaaaaaaaaaaaaaa' } });
  try {
    await restamp(dir);
    const once = pageOf(dir);
    await restamp(dir);                       // idempotent: running twice changes nothing
    assert.equal(pageOf(dir), once);
    assert.equal((once.match(/data-digital-validada/g) ?? []).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('carries over what the block depended on, when the registry recorded it', async () => {
  const dir = project({
    'A01.1.1': { digital_texto: 'bbbbbbbbbbbbbbbb', depende: { 'A02.1.1': 'cccccccccccccccc' } },
  });
  try {
    await restamp(dir);
    assert.match(pageOf(dir), /data-dependia-de="[^"]*A02\.1\.1/,
      'without this there is no 🔴 in the browser');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an entry with no recorded fingerprint is skipped, not invented', async () => {
  const dir = project({ 'A01.1.1': { data: '2026-01-01' } });
  try {
    assert.equal(await restamp(dir), 0);
    assert.doesNotMatch(pageOf(dir), /data-digital-validada/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
