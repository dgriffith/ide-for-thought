/**
 * Pure pieces of SPARQL autocomplete (#198). Cursor-context detection,
 * keyword tables, buffer-scanners for current-query variables and
 * user-defined prefixes. The renderer wraps these in a CodeMirror
 * CompletionSource; tests exercise them directly.
 */

export const SPARQL_KEYWORDS = [
  // Query forms + PREFIX / BASE
  'SELECT', 'CONSTRUCT', 'ASK', 'DESCRIBE', 'WHERE', 'FROM', 'FROM NAMED',
  'PREFIX', 'BASE',
  // Modifiers
  'DISTINCT', 'REDUCED',
  // Patterns
  'OPTIONAL', 'FILTER', 'FILTER NOT EXISTS', 'FILTER EXISTS',
  'UNION', 'MINUS', 'GRAPH', 'SERVICE', 'BIND', 'VALUES',
  'EXISTS', 'NOT EXISTS',
  // Solution sequence
  'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET',
  'ASC', 'DESC',
  // Boolean / shorthand
  'TRUE', 'FALSE', 'UNDEF', 'AS', 'IN', 'NOT IN', 'BY',
] as const;

export const SPARQL_BUILTINS = [
  // Term-type predicates
  'isIRI', 'isURI', 'isBlank', 'isLiteral', 'isNumeric', 'bound', 'sameTerm',
  // Constructors
  'IRI', 'URI', 'BNODE', 'STRLANG', 'STRDT',
  // Strings
  'STR', 'LANG', 'LANGMATCHES', 'DATATYPE',
  'CONCAT', 'SUBSTR', 'STRLEN', 'REPLACE', 'UCASE', 'LCASE',
  'CONTAINS', 'STRSTARTS', 'STRENDS', 'STRBEFORE', 'STRAFTER',
  'ENCODE_FOR_URI', 'REGEX',
  // Numerics
  'ABS', 'CEIL', 'FLOOR', 'ROUND', 'RAND',
  // Aggregates
  'COUNT', 'SUM', 'MIN', 'MAX', 'AVG', 'SAMPLE', 'GROUP_CONCAT',
  // Date/time
  'YEAR', 'MONTH', 'DAY', 'HOURS', 'MINUTES', 'SECONDS', 'TIMEZONE', 'TZ', 'NOW',
  // Misc
  'UUID', 'STRUUID', 'MD5', 'SHA1', 'SHA256', 'SHA384', 'SHA512',
  'COALESCE', 'IF',
] as const;

/** Standard prefixes the main-process `injectSparqlPrefixes` auto-adds. */
export const STANDARD_PREFIXES: ReadonlyArray<{ prefix: string; iri: string }> = [
  { prefix: 'minerva', iri: 'https://minerva.dev/ontology#' },
  { prefix: 'thought', iri: 'https://minerva.dev/ontology/thought#' },
  { prefix: 'dc', iri: 'http://purl.org/dc/terms/' },
  { prefix: 'rdf', iri: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' },
  { prefix: 'rdfs', iri: 'http://www.w3.org/2000/01/rdf-schema#' },
  { prefix: 'xsd', iri: 'http://www.w3.org/2001/XMLSchema#' },
  { prefix: 'csvw', iri: 'http://www.w3.org/ns/csvw#' },
  { prefix: 'prov', iri: 'http://www.w3.org/ns/prov#' },
  { prefix: 'bibo', iri: 'http://purl.org/ontology/bibo/' },
  { prefix: 'schema', iri: 'http://schema.org/' },
];

// ── Phase detection ──────────────────────────────────────────────────────

export type SparqlCompletionPhase =
  | { kind: 'variable'; from: number; prefix: string }
  | { kind: 'prefixed'; from: number; prefix: string; local: string; localFrom: number }
  | { kind: 'general'; from: number; prefix: string }
  | { kind: 'none' };

/**
 * Inspect the text before the cursor and decide what phase of completion
 * we\u2019re in. `pos` is the absolute cursor offset; the returned `from` is
 * the document position CodeMirror should use as the replacement start.
 *
 * Rules:
 *   1. Immediately after `?` or `$` with word chars \u2192 variable phase.
 *   2. After `<known-prefix>:<local>` \u2192 prefixed phase.
 *   3. Otherwise \u2192 general phase, matching the current identifier word.
 */
export function detectSparqlPhase(
  before: string,
  pos: number,
  knownPrefixes: ReadonlySet<string>,
): SparqlCompletionPhase {
  // Variable: preceded by `?` or `$` and optional word chars.
  const varM = /([?$])([A-Za-z_]\w*)?$/.exec(before);
  if (varM) {
    const prefix = varM[2] ?? '';
    return { kind: 'variable', from: pos - prefix.length, prefix };
  }

  // Prefixed name: <prefix>:<local> where prefix is known.
  const pnM = /([A-Za-z_][\w-]*):([A-Za-z_][\w-]*)?$/.exec(before);
  if (pnM && knownPrefixes.has(pnM[1])) {
    const local = pnM[2] ?? '';
    return {
      kind: 'prefixed',
      from: pos - local.length - 1 - pnM[1].length, // back to start of prefix
      prefix: pnM[1],
      local,
      localFrom: pos - local.length,
    };
  }

  // Current identifier word. Typing `SEL` should complete `SELECT`,
  // `minerv` should complete `minerva:`.
  const wordM = /([A-Za-z_][\w-]*)$/.exec(before);
  if (wordM) {
    return { kind: 'general', from: pos - wordM[1].length, prefix: wordM[1] };
  }

  // Explicit Ctrl+Space on whitespace / punctuation.
  return { kind: 'general', from: pos, prefix: '' };
}

// ── Buffer scanners ──────────────────────────────────────────────────────

/**
 * Distinct variables (`?x`, `$y`) mentioned anywhere in the buffer, sans
 * the leading sigil. Used to populate variable-phase completions with the
 * names already in play.
 */
export function extractQueryVariables(text: string): string[] {
  const out = new Set<string>();
  const re = /[?$]([A-Za-z_]\w*)/g;
  let m;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return [...out].sort();
}

/**
 * User-defined `PREFIX foo: <iri>` declarations in the current buffer.
 * Case-insensitive for the `PREFIX` keyword; prefix name is returned
 * verbatim.
 */
export function extractUserPrefixes(text: string): Array<{ prefix: string; iri: string }> {
  const seen = new Set<string>();
  const out: Array<{ prefix: string; iri: string }> = [];
  const re = /PREFIX\s+([A-Za-z_][\w-]*):\s*<([^>]*)>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push({ prefix: m[1], iri: m[2] });
    }
  }
  return out;
}
