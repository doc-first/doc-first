import { readFileSync } from 'node:fs';
import { MIN_PASSWORD_LENGTH } from './users.ts';

/**
 * The login screen, with its sentences already inside it.
 *
 * ## Why the server renders, instead of the page fetching its own dictionary
 *
 * The page could have asked for `/api/textos` on load and filled itself in. It does not, for four
 * reasons, in order of how much they cost:
 *
 *   1. **No untranslated flash.** A page that arrives with `login.title` in the heading and fixes
 *      it a moment later shows a raw key to every person on a slow connection — on the one screen
 *      where someone who has never seen this tool decides whether it looks finished.
 *   2. **It works with no JavaScript.** Labels, button and `<title>` are plain HTML by the time
 *      they leave here. Only the change-password step, which is interaction anyway, needs script.
 *   3. **One round trip instead of two**, on the request that is always a cold start.
 *   4. **Less code.** No route, no cache header for it, no second thing that can 500.
 *
 * The cost is that the HTML is no longer a static file. It is one `String.replace` — accepted.
 *
 * ⚠️ The page is served with `cache-control: no-store` (see server.ts). That is not a detail here:
 * a cached login page is a page rendered in somebody else's language.
 */

/**
 * Everything the screen says. One list, and the test in review/tests/i18n.test.js reads the
 * template to check that it still matches what the file actually uses — a hand-kept list is a list
 * that drifts, and a key that drifted shows up as `login.submit` on the button.
 */
export const LOGIN_KEYS = [
  'login.title',
  'login.subtitle',
  'login.form.label',
  'login.email.label',
  'login.email.placeholder',
  'login.password.label',
  'login.password.placeholder',
  'login.submit',
  'login.change.title',
  'login.change.subtitle',
  'login.change.new.label',
  'login.change.repeat.label',
  'login.change.submit',
  'login.error.signInFailed',
  'login.error.changeFailed',
  'login.error.passwordsDiffer',
  'login.error.noAnswer',
] as const;

/** Read once: the template does not change while the process lives. */
const TEMPLATE = readFileSync(new URL('./login.html', import.meta.url), 'utf8');

/**
 * Every key the page actually asks for: the double-brace placeholders in the markup, plus the
 * `say('…')` calls the script makes after the page is open. What the test compares against.
 *
 * ⚠️ The two halves both matter. A key only the script uses has no placeholder to find, and a key
 * only the markup uses is never named in the script — checking one half would have let the other
 * rot quietly.
 */
export function keysUsedByTemplate(): string[] {
  const found = new Set<string>();
  for (const [, name] of TEMPLATE.matchAll(/\{\{([^}#][^}]*)\}\}/g)) found.add(name!);
  for (const [, name] of TEMPLATE.matchAll(/\bsay\('([^']+)'\)/g)) found.add(name!);
  return [...found].sort();
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

/**
 * Escaped for HTML, including the quotes: half of these land inside an attribute (`placeholder`,
 * `aria-label`) and a translator who writes `"` in a sentence should not be able to end it.
 */
const forHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/**
 * Only what `createI18n` actually offers, so a test can hand in a stub without building a server.
 */
export interface Translator {
  t(lang: string, key: string, params?: Record<string, string | number>): string;
}

/**
 * The login page in one language, ready to write to the socket.
 *
 * @param i18n  the translator built in server.ts from review/locales/
 * @param lang  the language chosen for THIS request — see `idioma()` in server.ts
 */
export function renderLoginPage(i18n: Translator, lang: string): string {
  // `{min}` belongs to the change-password sentence. Handing the same params to every key is
  // harmless: `t` only replaces a placeholder the text actually contains.
  const params = { min: MIN_PASSWORD_LENGTH };
  const texts = Object.fromEntries(LOGIN_KEYS.map((k) => [k, i18n.t(lang, k, params)]));

  return TEMPLATE.replace(/\{\{([^}]+)\}\}/g, (whole, name: string) => {
    if (name === '#lang') return forHtml(lang);
    if (name === '#minPassword') return String(MIN_PASSWORD_LENGTH);
    // The whole set, not a hand-picked subset of what the script happens to need today: a subset
    // is a second list to forget. `<` becomes `<` so a translation containing `</script>`
    // cannot close the tag it lives in.
    if (name === '#texts') return JSON.stringify(texts).replace(/</g, '\\u003c');
    // An unknown `{{…}}` is left visible on purpose, for the same reason `t` returns the key: a
    // page showing `{{login.submit}}` is diagnosable in one second; a blank button is not.
    return name in texts ? forHtml(texts[name]!) : whole;
  });
}
