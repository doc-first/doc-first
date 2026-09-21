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
import { LOGIN_KEYS, keysUsedByTemplate, renderLoginPage } from '../api/login-page.ts';

const read = (dir) => Object.fromEntries(readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(new URL(f, dir), 'utf8'))]));

const dicts = read(new URL('../locales/', import.meta.url));

// ⚠️ The engine ships English only, so `review/locales/` on its own can never catch a key present
// in one language and missing in another — there is only one language in there. The worked
// translation in examples/locales/ is the second language, and the check is worth little without
// it. Left out until now, which is exactly how a hole this test exists to find stays open.
const everyDict = { ...dicts, ...read(new URL('../../examples/locales/', import.meta.url)) };

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
  const i18n = createI18n(everyDict, 'en');
  const holes = i18n.missing().filter((h) => !h.key.startsWith('_'));
  assert.deepEqual(holes, [],
    `keys missing per language:\n${holes.map((h) => `  ${h.lang}: ${h.key}`).join('\n')}`);
  assert.ok(i18n.languages.includes('en'), 'English is the fallback and has to be there');
  assert.ok(i18n.languages.includes('pt-BR'), 'without a second language the check proves nothing');
});

test('the login screen asks for exactly the keys it declares', () => {
  // Both directions on purpose. A key in the markup and not in the list renders as `{{…}}`; a key
  // in the list and not in the markup is a translation everyone keeps translating for nothing.
  assert.deepEqual(keysUsedByTemplate(), [...LOGIN_KEYS].sort());
});

test('every key the login screen uses exists in every language', () => {
  // The one screen a person sees before they are anybody. A key missing here is not a blemish in
  // a corner of the panel — it is the first impression, in a language nobody chose.
  for (const [lang, dict] of Object.entries(everyDict)) {
    const holes = LOGIN_KEYS.filter((k) => !(k in dict));
    assert.deepEqual(holes, [], `${lang} is missing: ${holes.join(', ')}`);
  }
});

test('the login screen comes out translated, with nothing left to fill in', () => {
  const i18n = createI18n(everyDict, 'en');
  const english = renderLoginPage(i18n, 'en');
  const portuguese = renderLoginPage(i18n, 'pt-BR');

  assert.match(english, /<html lang="en">/);
  assert.match(english, /<title>Sign in<\/title>/);
  assert.match(portuguese, /<html lang="pt-BR">/);
  assert.match(portuguese, /<title>Entrar<\/title>/);

  // No placeholder survives the render — the failure this catches is a page that ships a raw
  // `{{login.submit}}` on the button, which no type checker and no lint would ever notice.
  for (const page of [english, portuguese]) assert.doesNotMatch(page, /\{\{/);

  // `{min}` comes from users.ts, not from the sentence: a screen promising a different number from
  // the one the server enforces locks someone out with a password they believe is long enough.
  assert.match(portuguese, /12 caracteres ou mais/);
});

test('a translation cannot close the script tag it travels in', () => {
  // The dictionaries are files someone contributes. `</script>` inside one would end the JSON
  // block and turn the rest of the sentence into code running on the login page.
  const nasty = { ...everyDict.en, 'login.error.noAnswer': '</script><script>alert(1)</script>' };
  const page = renderLoginPage(createI18n({ en: nasty }, 'en'), 'en');
  assert.doesNotMatch(page, /<\/script><script>alert/);
  assert.match(page, /\\u003c\/script/);
});
