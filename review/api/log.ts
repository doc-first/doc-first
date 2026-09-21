/**
 * One log line, one shape, for the whole service.
 *
 * This module exists because the same running server used to emit two different envelopes. The API
 * wrote `{severity, evento, hora}`; the identity and the database migration wrote
 * `{nivel, evento, mensagem}` — and `nivel` is not a field any collector reads, so those lines
 * arrived with no severity at all and never matched an alert rule. The levels disagreed too:
 * `AVISO` on one line, `WARNING` on the next, two spellings of one thing.
 *
 * ⚠️ English, always, and NEVER through i18n. A log is evidence, and evidence that changes wording
 * with whoever happens to be signed in is evidence nobody can grep. That covers the level, the
 * event name and the field names alike — see the comment at the top of review/core/i18n.js for the
 * three audiences and why only one of them is translated.
 *
 * @module
 */

/**
 * The three levels, and nothing else.
 *
 * A union rather than `string` because `AVISO` is exactly the kind of typo that a reviewer misses
 * and a compiler never does. There is no DEBUG on purpose: a level nobody has configured a filter
 * for is a level that only makes the important lines harder to find.
 */
export type LogLevel = 'INFO' | 'WARNING' | 'ERROR';

/**
 * One JSON line per fact: log collectors understand `severity`, and an event can be found by id.
 *
 * @param level  the severity a collector routes on
 * @param event  snake_case, English, and stable — this is what someone greps for
 * @param extra  the facts. English field names; contract VALUES (`tipo`, the states) stay as they
 *               are, so a log line still matches the record it is evidence about.
 */
export function log(level: LogLevel, event: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity: level, event, time: new Date().toISOString(), ...extra }));
}
