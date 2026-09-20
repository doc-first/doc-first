# Adding a language

The engine ships **English only**, on purpose: one dictionary to keep honest, and nothing to
translate before the project is worth translating.

Adding a language is copying a file:

```bash
cp review/locales/en.json review/locales/es.json
# translate the values, keep the keys and the {placeholders}
```

`pt-BR.json` next to this file is a real translation, kept as proof the mechanism works — the
project it grew in reviews in Portuguese. It is **not** loaded by default. To use it, copy it into
`review/locales/`.

## Two rules

**Keys and placeholders never change.** `{max}`, `{got}`, `{blame}` are replaced at render time.
Translate around them.

**Not everything goes here.** Logs stay in English always — a log is evidence, and evidence that
changes wording by locale cannot be grepped. Boot errors stay in English too: a service refusing to
start has no session, no person and no chosen language yet.

## The test that matters

`review/tests/i18n.test.js` fails when a key exists in one dictionary and not in another. That is
the one bug translated software always ships: the key exists in the language of whoever wrote it,
nothing breaks at build time, and one day someone sees `block.state.valid` on screen.
