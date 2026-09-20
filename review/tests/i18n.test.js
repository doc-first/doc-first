/**
 * Language choice.
 *
 * The test that earns its place here is the last one: every key present in one dictionary has to
 * exist in all of them. That is the one bug translated software always ships — the key exists in
 * the language of whoever wrote it, and is missing everywhere else. Nothing breaks at build time,
 * nothing breaks in their tests, and one day a reviewer sees `block.state.valid` on screen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createI18n } from '../core/i18n.js';

const dir = new URL('../locales/', import.meta.url);
const dicts = Object.fromEntries(readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(new URL(f, dir), 'utf8'))]));

test('a missing key returns the key, never nothing', () => {
  // A page showing `block.approved` is ugly and diagnosable in one second. A page showing an empty
  // string is a bug someone chases for an afternoon.
  const i18n = createI18n({ en: { a: 'A' } }, 'en');
  assert.equal(i18n.t('en', 'does.not.exist'), 'does.not.exist');
});

test('a language with no dictionary falls back instead of breaking', () => {
  const i18n = createI18n({ en: { a: 'A' } }, 'en');
  assert.equal(i18n.t('ja', 'a'), 'A');
});

test('a key missing in one language falls back to the other', () => {
  const i18n = createI18n({ en: { a: 'A', b: 'B' }, 'pt-BR': { a: 'a' } }, 'en');
  assert.equal(i18n.t('pt-BR', 'a'), 'a');
  assert.equal(i18n.t('pt-BR', 'b'), 'B', 'falls back rather than showing the key');
});

test('placeholders are replaced, and unknown ones are left alone', () => {
  const i18n = createI18n({ en: { greet: 'hello {name}, you have {n}' } }, 'en');
  assert.equal(i18n.t('en', 'greet', { name: 'ana', n: 3 }), 'hello ana, you have 3');
  // Leaving `{missing}` visible beats rendering "undefined": one says a parameter was forgotten,
  // the other says the software is broken.
  assert.equal(i18n.t('en', 'greet', { name: 'ana' }), 'hello ana, you have {n}');
});

test('the person decides before the browser does', () => {
  // The browser header is usually whatever the laptop shipped with. A stated preference is the
  // only one the person actually made.
  const i18n = createI18n({ en: {}, 'pt-BR': {} }, 'en');
  assert.equal(i18n.choose({ person: 'pt-BR', acceptLanguage: 'en-US,en;q=0.9' }), 'pt-BR');
  assert.equal(i18n.choose({ acceptLanguage: 'pt-PT,pt;q=0.9,en;q=0.8' }), 'pt-BR',
    'a near dialect is closer to right than the wrong language');
  assert.equal(i18n.choose({ project: 'pt-BR' }), 'pt-BR');
  assert.equal(i18n.choose({}), 'en', 'with nothing to go on, the fallback');
});

test('a fallback with no dictionary is caught at build time, not at render', () => {
  assert.throws(() => createI18n({ en: {} }, 'ja'), /fallback language/);
});

test('every key exists in every language', () => {
  const i18n = createI18n(dicts, 'en');
  const holes = i18n.missing().filter((h) => !h.key.startsWith('_'));
  assert.deepEqual(holes, [],
    `keys missing per language:\n${holes.map((h) => `  ${h.lang}: ${h.key}`).join('\n')}`);
  assert.ok(i18n.languages.length >= 2, 'a translator with one language proves nothing');
});
