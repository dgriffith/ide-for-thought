/**
 * Records keyed by user text — frontmatter keys, alias names, tag paths — as
 * plain objects that answer only for their OWN keys.
 *
 * A `{}` inherits from `Object.prototype`, so a bare `rec[key]` read answers
 * `constructor`, `toString`, `hasOwnProperty`, `__proto__` … with a function or
 * object when the key is absent, and a `rec[key] = v` write with `key ===
 * '__proto__'` invokes the prototype setter: the key is dropped and an object
 * value re-parents the record (#2461, and its follow-up for frontmatter).
 *
 * Two halves, and both are needed:
 *   - {@link ownRecord} builds the record with a null prototype, so every key —
 *     `__proto__` included — lands as an ordinary own data property and nothing
 *     is inherited.
 *   - {@link getOwn} reads through `Object.hasOwn`. A null prototype does not
 *     survive structured clone (IPC) or JSON: the receiver gets an ordinary
 *     object back (with `__proto__` still an own key), so the guard has to live
 *     on the read side too.
 *
 * `Object.hasOwn` works through a Svelte `$state` proxy, so a renderer holder of
 * one of these records can use `getOwn` unchanged.
 */

/** Build a null-prototype record from `[key, value]` entries. Later entries win,
 *  as with `Object.fromEntries`. */
export function ownRecord<V>(entries: Iterable<readonly [string, V]>): Record<string, V> {
  const out = Object.create(null) as Record<string, V>;
  for (const [key, value] of entries) out[key] = value;
  return out;
}

/** The value under `key` if it is an OWN property of `record`, else `undefined`
 *  — never an inherited `Object.prototype` member. */
export function getOwn<V>(record: Readonly<Record<string, V>>, key: string): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
