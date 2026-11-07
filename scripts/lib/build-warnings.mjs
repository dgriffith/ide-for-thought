/**
 * Build warnings known to be harmless, dropped one by one (#2977) — never by
 * turning a check off, and never by message text (it changes between rolldown
 * versions). Everything else still prints, so a new one stays loud.
 */

/**
 * rolldown's EVAL warning for `@acemir/cssom/lib/errorUtils.js` (linkedom's
 * CSS parser, since linkedom 0.18.14 / #2905). `getErrorConstructor` only
 * `eval`s as its last fallback, after `global[errorType]` and
 * `window[errorType]`, and `errorType` is only ever the library's own literal
 * `'TypeError'` or `'DOMException'` — no note, page or input reaches it, and
 * Node and the renderer both have both constructors, so the fallback doesn't
 * run. The cost rolldown warns about (that module's scope isn't minified) is
 * fine. Reported upstream; drop this once a release without the eval is
 * installed.
 */
export function isKnownHarmlessWarning(warning) {
  if (warning?.code !== 'EVAL') return false;
  const file = String(warning.id ?? warning.loc?.file ?? '').replace(/\\/g, '/');
  return file.endsWith('/node_modules/@acemir/cssom/lib/errorUtils.js');
}

/** An `onwarn` for a Vite/rolldown config: drops the known ones, passes on the rest. */
export function onwarn(warning, warn) {
  if (isKnownHarmlessWarning(warning)) return;
  warn(warning);
}
