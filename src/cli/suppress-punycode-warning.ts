/**
 * Silence the Node `punycode` deprecation (DEP0040) for the CLI.
 *
 * The warning is emitted by transitive deps inside the bundled RDF + fetch stack
 * (uri-js, whatwg-url → tr46) that still `require('punycode')`. We can't fix that
 * upstream, and it prints on EVERY CLI invocation — pure noise on stderr. Node's
 * builtin raises it through `process.emitWarning('…', 'DeprecationWarning',
 * 'DEP0040')` (node:punycode line 7), so we wrap `emitWarning` and drop only that
 * one warning; every other warning still passes through untouched.
 *
 * This must run BEFORE the deps that trigger it load, so it is imported FIRST
 * (as a side effect) in `main.ts`, ahead of `./run`. Scoped to the CLI entry —
 * `run.ts` (imported directly by tests) never patches the global.
 */
// Widen the opaque bound-overload type to a plain callable so forwarding the
// captured args needs no per-call assertion.
const original = process.emitWarning.bind(process) as (warning: string | Error, ...args: unknown[]) => void;

// Recognise the punycode deprecation across emitWarning's overloads
// (`(msg, type, code?, …)` and `(msg, { code })`): match the DEP0040 code or the
// message text, so a change in how it's raised can't let it slip back through.
function isPunycodeDeprecation(warning: string | Error, args: unknown[]): boolean {
  const message = typeof warning === 'string' ? warning : warning?.message ?? '';
  if (message.includes('punycode')) return true;
  for (const a of args) {
    if (a === 'DEP0040') return true;
    if (a && typeof a === 'object' && (a as { code?: string }).code === 'DEP0040') return true;
  }
  return false;
}

process.emitWarning = function patchedEmitWarning(warning: string | Error, ...args: unknown[]): void {
  if (isPunycodeDeprecation(warning, args)) return;
  original(warning, ...args);
};
