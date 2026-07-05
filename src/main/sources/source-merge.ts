/**
 * Metadata merge for re-ingested sources (#90).
 *
 * When the canonical id resolves to a source folder that already exists,
 * earlier ingests landed at the same folder and returned `duplicate:
 * true` without doing anything. That left enriching metadata on the
 * floor — re-ingesting a paper by DOI (after first ingesting by URL)
 * should pick up the DOI / ISBN / publisher / abstract fields the
 * URL-only ingest didn't have.
 *
 * Conservative merge:
 *   - Add a predicate ONLY when the existing meta.ttl lacks it.
 *   - Never overwrite existing values — preserves the user's hand edits
 *     (title corrections, abstract trimming, custom dc:subject lines).
 *   - Skip multi-valued predicates (dc:creator) when ANY value exists,
 *     so a richer second ingest doesn't append a contradictory
 *     dc:creator alongside the first.
 *   - Leave body.md and other files in the source dir untouched.
 *
 * The merge is text-based: we control the writer (`buildMetaTtl`) and
 * the shape is line-per-predicate; spotting "predicate is/isn't present"
 * with a regex is reliable for our own output and tolerant of common
 * hand edits. A round-trip Turtle parse + reserialize would lose
 * comments and incidental whitespace.
 */

export interface SourceMetaUpdate {
  /** ISO date string (YYYY / YYYY-MM / YYYY-MM-DD) for dc:issued. */
  issued?: string | null;
  publisher?: string | null;
  /** Journal / book / proceedings title → schema:inContainer. */
  containerTitle?: string | null;
  doi?: string | null;
  isbn?: string | null;
  /** Canonical URL → bibo:uri. */
  uri?: string | null;
  abstract?: string | null;
  /** Multi-valued: only added if no dc:creator exists already. */
  creators?: readonly string[] | null;
}

export interface MergeResult {
  /** The merged TTL — equal to the input when nothing was added. */
  ttl: string;
  /** Predicate localnames that were added (`doi`, `isbn`, …). */
  added: string[];
}

/**
 * Merge `update` into `existingTtl`. Adds any predicate the existing
 * file lacks; never overwrites. New predicate lines are inserted just
 * before the closing `.` so the Turtle stays grammatical and the
 * thought:accessedAt timestamp stays at the bottom where the writer
 * always puts it.
 */
export function mergeMetaTtl(existingTtl: string, update: SourceMetaUpdate): MergeResult {
  const present = detectPresentPredicates(existingTtl);
  const additions: { predicate: string; ttlLine: string }[] = [];

  if (update.doi && !present.has('bibo:doi')) {
    additions.push({ predicate: 'doi', ttlLine: `    bibo:doi ${ttlString(update.doi)} ;` });
  }
  if (update.isbn && !present.has('bibo:isbn')) {
    additions.push({ predicate: 'isbn', ttlLine: `    bibo:isbn ${ttlString(update.isbn)} ;` });
  }
  if (update.uri && !present.has('bibo:uri')) {
    additions.push({ predicate: 'uri', ttlLine: `    bibo:uri ${ttlString(update.uri)} ;` });
  }
  if (update.issued && !present.has('dc:issued')) {
    additions.push({ predicate: 'issued', ttlLine: `    dc:issued ${issuedLiteral(update.issued)} ;` });
  }
  if (update.publisher && !present.has('dc:publisher')) {
    additions.push({ predicate: 'publisher', ttlLine: `    dc:publisher ${ttlString(update.publisher)} ;` });
  }
  if (update.containerTitle && !present.has('schema:inContainer')) {
    additions.push({ predicate: 'containerTitle', ttlLine: `    schema:inContainer ${ttlString(update.containerTitle)} ;` });
  }
  if (update.abstract && !present.has('dc:abstract')) {
    additions.push({ predicate: 'abstract', ttlLine: `    dc:abstract ${ttlString(update.abstract)} ;` });
  }
  if (update.creators && update.creators.length > 0 && !present.has('dc:creator')) {
    for (const creator of update.creators) {
      additions.push({ predicate: 'creator', ttlLine: `    dc:creator ${ttlString(creator)} ;` });
    }
  }

  if (additions.length === 0) {
    return { ttl: existingTtl, added: [] };
  }

  return {
    ttl: insertBeforeFinalDot(existingTtl, additions.map((a) => a.ttlLine)),
    // Dedupe predicate names: the creator path pushes one entry per
    // author and the caller only needs to know "creators were added".
    added: [...new Set(additions.map((a) => a.predicate))],
  };
}

/**
 * Pull every `prefix:localname` token that sits in a predicate position
 * (start of a line after indentation, or right after the subject's `a`
 * type clause). Tolerant of leading whitespace and hand-edited spacing.
 */
function detectPresentPredicates(ttl: string): Set<string> {
  const out = new Set<string>();
  // Match prefixed names that appear as predicates. A predicate sits
  // after the subject (`this:`) and either `a` (for the type triple) or
  // at the start of a line after whitespace. Either way: a `prefix:local`
  // token followed by whitespace + a value.
  const re = /(?:^|\s)([a-zA-Z][\w-]*:[a-zA-Z][\w-]*)\s+(?!a\s)/gm;
  for (const m of ttl.matchAll(re)) {
    out.add(m[1]!);
  }
  // `a` is the rdf:type predicate — record it too in case a merge
  // someday wants to add a type assertion.
  if (/\sa\s+[a-zA-Z][\w-]*:[a-zA-Z][\w-]*\s*[,;]/.test(ttl)) {
    out.add('rdf:type');
  }
  return out;
}

/**
 * Insert lines immediately before the predicate-list-terminating `.`.
 * The existing buildMetaTtl always ends with `... ;\n    pred value
 * .\n`. We find the trailing `.` and inject the new `;`-terminated
 * lines just above it.
 *
 * Failure mode: if the existing TTL doesn't end with a `.`-terminated
 * triple (malformed file), we append the new lines + a `.` and trust
 * the user to repair. Safer than dropping the new data.
 */
function insertBeforeFinalDot(ttl: string, newLines: string[]): string {
  // Find the last `.` that terminates the predicate list. The shape we
  // emit always has `thought:accessedAt "<iso>"^^xsd:dateTime .` as the
  // final triple; that `.` follows `^^xsd:dateTime` or a quoted string.
  // Match a `.` at the end (allowing trailing whitespace / newline).
  const trailing = ttl.match(/(\s*\.\s*)$/);
  if (!trailing) {
    // Malformed input — append + terminate.
    return ttl + (ttl.endsWith('\n') ? '' : '\n') + newLines.join('\n') + '\n    .\n';
  }
  const dotIdx = trailing.index ?? ttl.length;
  // Walk back from the `.` to find the start of the final predicate's
  // line so the inject lands on its own line, not mid-line. We look
  // for the previous newline.
  const lineStart = ttl.lastIndexOf('\n', dotIdx - 1);
  if (lineStart < 0) {
    // Single-line TTL — append before the `.`.
    return ttl.slice(0, dotIdx).replace(/\s+$/, ' ;') + '\n' + newLines.join('\n') + '\n' + ttl.slice(dotIdx);
  }
  // Inject the new lines on their own lines between the previous
  // predicate's terminating `;` and the final predicate's line.
  return ttl.slice(0, lineStart) + '\n' + newLines.join('\n') + ttl.slice(lineStart);
}

function ttlString(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

function issuedLiteral(iso: string): string {
  if (/^\d{4}$/.test(iso)) return `${ttlString(iso)}^^xsd:gYear`;
  if (/^\d{4}-\d{2}$/.test(iso)) return `${ttlString(iso)}^^xsd:gYearMonth`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${ttlString(iso)}^^xsd:date`;
  return ttlString(iso);
}
