# Adding a language

The engine ships **three** dictionaries, in `review/locales/`: `en.json`, `pt-BR.json` and
`es.json`. English is the fallback — a key missing everywhere else lands there.

There is no example dictionary next to this file any more, on purpose. There used to be one
(`pt-BR.json`), kept here as proof the mechanism worked while the engine shipped English only. Now
that the engine ships three, a fourth copy of a translation sitting outside `review/locales/` would
be a file nobody loads and nobody checks — which is exactly the drift the parity test exists to
catch, reintroduced one directory away from it. The three real dictionaries are the worked example,
and they are the ones that have to stay correct.

Adding a fourth is copying a file:

```bash
cp review/locales/en.json review/locales/fr.json
# translate the values, keep the keys and the {placeholders}
```

Nothing else. The server reads the folder, and the language selector reads each dictionary's
`language.name` — so the new language shows up on the login screen without a list anywhere being
edited.

## Three rules

**Keys and placeholders never change.** `{max}`, `{got}`, `{blame}` are replaced at render time.
Translate around them.

**`language.name` is not translated.** It holds the language's own name: `es.json` says `Español`,
never `Spanish`. Somebody hunting for their language looks for the word they would write
themselves, and they cannot be expected to recognise it spelled in a language they do not read.

**Not everything goes here.** Logs stay in English always — a log is evidence, and evidence that
changes wording by locale cannot be grepped. Boot errors stay in English too: a service refusing to
start has no session, no person and no chosen language yet.

## The test that matters

`review/tests/i18n.test.js` fails when a key exists in one dictionary and not in another. That is
the one bug translated software always ships: the key exists in the language of whoever wrote it,
nothing breaks at build time, and one day someone sees `block.state.valid` on screen.
