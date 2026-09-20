/**
 * The catalogue of content kinds. Every validatable piece of documentation is of ONE kind, and
 * each kind knows what it demands of itself.
 *
 * Why type content at all, instead of "a block is a block": because the question *"is this good?"*
 * is not the same for a heading and for a diagram. A diagram has to be text to enter the
 * fingerprint. An image has to carry a description, or it does not exist for anyone using a screen
 * reader. A decision without an owner is not a pending decision — it is a lost one.
 *
 * Without kinds, those rules become spoken convention, and spoken convention dies with the third
 * person who joins the project.
 *
 * ⚠️ A kind does NOT change who approves, nor how the fingerprint is computed. It changes **what is
 * demanded** before a block counts as ready for approval. There is still only one lock.
 * @module
 */

/**
 * @typedef {{
 *   name: string,
 *   description: string,
 *   numbered: boolean,
 *   demands?: (block: {text: string, html: string, attributes: Record<string,string>}) => string[],
 * }} Kind
 */

/** A failed demand returns the sentence of what to do, not the name of the rule. */
const nothing = () => [];

/** @type {Record<string, Kind>} */
export const KINDS = {
  // ---------------------------------------------------------------- structure
  title: {
    name: 'heading',
    description: 'the title of a page or a section. Shows no number, but IS locked: changing a '
      + 'heading changes the meaning of everything under it.',
    numbered: false,
    demands: ({ text }) => text.trim().length > 80
      ? ['heading longer than 80 characters — probably a paragraph in disguise'] : [],
  },
  subtitle: {
    name: 'subheading',
    description: 'the one line that explains the section, right under the heading.',
    numbered: false,
    demands: nothing,
  },

  // ---------------------------------------------------------------- text
  text: {
    name: 'text',
    description: 'a paragraph. The most common kind, and the default for anything undeclared.',
    numbered: true,
    demands: nothing,
  },
  list: {
    name: 'list',
    description: 'items in sequence. A one-item list is a paragraph in bad clothing.',
    numbered: true,
    demands: ({ html }) => (html.match(/<li\b/g) ?? []).length < 2
      ? ['list with fewer than two items — either make it a paragraph, or add the rest'] : [],
  },
  box: {
    name: 'callout',
    description: 'a warning, a caveat, a note. It has to say which it is — info, warning, ban — '
      + 'otherwise it is just a paragraph with a border, and the colour means nothing.',
    numbered: true,
    demands: ({ attributes }) => attributes['data-box'] ? []
      : ['callout without data-box: say whether it is info, warning, ok or forbidden'],
  },
  table: {
    name: 'table',
    description: 'data in rows and columns. Every table needs a header row — without it, nobody '
      + 'using a screen reader knows what each cell means.',
    numbered: true,
    demands: ({ html }) => /<th\b/.test(html) ? []
      : ['table without <th>: with no header, the table is unreadable by a screen reader'],
  },

  // ---------------------------------------------------------------- visual
  image: {
    name: 'image',
    description: 'a figure. ⚠️ Text INSIDE an image does not enter the fingerprint — swapping the '
      + 'image does not change the block fingerprint, which is why the description is mandatory: '
      + 'it is the only reviewable part of it.',
    numbered: true,
    demands: ({ html }) => {
      const missing = [];
      if (/<img\b/.test(html) && !/\balt="[^"]+"/.test(html)) {
        missing.push('image without alt: describe what it shows — it is the only part of it under the lock');
      }
      return missing;
    },
  },
  diagram: {
    name: 'diagram',
    description: 'a flow, a model, an architecture — AS TEXT (Mermaid, PlantUML). A diagram as an '
      + 'image has no useful fingerprint: recompressing changes the bytes without changing the '
      + 'meaning, and changing the meaning does not show up in a diff.',
    numbered: true,
    demands: ({ html }) => /<img\b/.test(html)
      ? ['diagram as an image: use Mermaid or PlantUML inside <code>, so it comes under the lock']
      : [],
  },
  colors: {
    name: 'palette',
    description: 'brand colours, with the value next to them. "Primary blue" is not a value; '
      + '"#0883C5" is.',
    numbered: true,
    demands: ({ text }) => /#[0-9a-fA-F]{3,8}\b|\b(rgb|hsl|oklch)\(/.test(text) ? []
      : ['palette with no colour value: write the hex, not just the name'],
  },

  // ---------------------------------------------------------------- technical
  config: {
    name: 'configuration',
    description: 'a variable, a parameter, a value that differs per environment.',
    numbered: true,
    demands: nothing,
  },
  contract: {
    name: 'contract',
    description: 'a route, an event, a payload. It is a public promise: breaking it here breaks '
      + "somebody else's system.",
    numbered: true,
    demands: nothing,
  },
  model: {
    name: 'data model',
    description: 'an entity, a relationship, a field of the data dictionary.',
    numbered: true,
    demands: nothing,
  },

  // ---------------------------------------------------------------- decision
  rationale: {
    name: 'rationale',
    description: 'why it was done this way, and what was rejected. The rejected alternative is the '
      + 'part that pays: it proves there was a choice, and not just inertia.',
    numbered: true,
    demands: nothing,
  },
  decision: {
    name: 'open decision',
    description: 'what is still undecided. With no owner and no deadline it is not a pending '
      + 'decision — it is a lost one.',
    numbered: true,
    demands: ({ attributes }) => {
      const missing = [];
      if (!attributes['data-dono']) missing.push('decision without data-dono: who decides this?');
      if (!attributes['data-prazo']) missing.push('decision without data-prazo: by when?');
      return missing;
    },
  },
};

export const DEFAULT_KIND = 'text';

/**
 * The kind of a block: what it declares, or what can be inferred from how it was written.
 *
 * Inference exists so the method does not start by demanding: documentation that already exists
 * gets kinds without anyone rewriting anything, and whoever wants precision declares it.
 *
 * @param {{ attributes: Record<string,string>, classes: string[], tag: string, html: string }} b
 */
export function kindOf(b) {
  const declared = b.attributes['data-tipo'];
  if (declared && KINDS[declared]) return declared;
  if (declared) return DEFAULT_KIND;               // made-up kind: falls back, and the lint reports

  const code = b.attributes['data-cod'] ?? '';
  if (/\.titulo$/.test(code) || /^h[1-3]$/.test(b.tag)) return 'title';
  if (/\.sub$/.test(code) || b.classes.includes('lead-secao')) return 'subtitle';

  if (/class="mermaid"|<pre\b/.test(b.html)) return 'diagram';
  if (/<table\b/.test(b.html)) return 'table';
  if (/<img\b/.test(b.html)) return 'image';
  if (/<[uo]l\b/.test(b.html)) return 'list';
  if (b.classes.some((c) => c.startsWith('caixa'))) return 'box';
  return DEFAULT_KIND;
}

/** What this block is still missing before it is ready for approval. */
export function whatIsMissing(kind, block) {
  const k = KINDS[kind];
  if (!k) return [`unknown kind: "${kind}" — see review/core/kinds.js`];
  return k.demands ? k.demands(block) : [];
}

/** Every kind there is, for the catalogue and for `doc-first kinds`. */
export const catalogue = () =>
  Object.entries(KINDS).map(([id, k]) => ({ id, ...k, demands: undefined }));
