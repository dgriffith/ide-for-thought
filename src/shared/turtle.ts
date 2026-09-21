/**
 * Turtle string-literal escaping (#676).
 *
 * Three copies of this had drifted: `escapeTurtle` in conversation.ts and
 * approval.ts (backslash / quote / newline only) and `escapeTurtleLiteral` in
 * register-compute.ts (also \r and \t). Unified here on the more complete
 * version — a single-quoted Turtle `"..."` literal must escape CR and TAB too,
 * so the 5-escape form is the correct one; the 3-escape copies were a latent
 * bug for content containing tabs or carriage returns.
 *
 * Escapes the five characters that can't appear raw in a `"..."` literal, in
 * an order that's safe (backslash first so we don't double-escape our own
 * inserts).
 */
export function escapeTurtleLiteral(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}
