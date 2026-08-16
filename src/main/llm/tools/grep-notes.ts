import { searchInNotes } from '../../notebase/search-in-notes';
import type { NotebaseTool, ToolContext } from './types';

/** Cap on the number of match lines returned to the model, so a broad pattern
 *  can't flood the context. The header reports the true total when truncated. */
const DEFAULT_MAX = 50;
const HARD_MAX = 200;
/** Trim absurdly long lines (minified data, base64) to keep output readable. */
const MAX_LINE = 200;

interface GrepInput {
  pattern?: unknown;
  regex?: unknown;
  case_sensitive?: unknown;
  max_matches?: unknown;
}

async function runGrep(ctx: ToolContext, input: unknown): Promise<string> {
  const { pattern, regex, case_sensitive, max_matches } = (input ?? {}) as GrepInput;
  if (typeof pattern !== 'string' || pattern.trim() === '') {
    throw new Error('pattern is required');
  }
  const asRegex = regex === true;
  const caseSensitive = case_sensitive === true;
  const cap = Math.min(
    typeof max_matches === 'number' && Number.isFinite(max_matches) ? Math.max(1, Math.floor(max_matches)) : DEFAULT_MAX,
    HARD_MAX,
  );

  const files = await searchInNotes(ctx.rootPath, { pattern, caseSensitive, regex: asRegex });

  const total = files.reduce((n, f) => n + f.matches.length, 0);
  if (total === 0) {
    // A regex that fails to compile also yields zero matches (searchInNotes
    // swallows the error) — call that out so the model can fix its pattern.
    const hint = asRegex ? ' (if this is an invalid regular expression, no matches are returned)' : '';
    return `No matches for ${asRegex ? 'regex' : 'literal'} "${pattern}".${hint}`;
  }

  const flags = [asRegex ? 'regex' : 'literal', caseSensitive ? 'case-sensitive' : 'case-insensitive'].join(', ');
  const lines: string[] = [];
  let shown = 0;
  outer: for (const f of files) {
    for (const m of f.matches) {
      if (shown >= cap) break outer;
      const text = m.lineText.trim().slice(0, MAX_LINE);
      lines.push(`${f.relativePath}:${m.line}: ${text}`);
      shown++;
    }
  }

  const header =
    `${total} match${total === 1 ? '' : 'es'} in ${files.length} note${files.length === 1 ? '' : 's'}` +
    ` for "${pattern}" (${flags})` +
    (shown < total ? ` — showing the first ${shown}; narrow the pattern to see the rest` : '') +
    ':';
  return `${header}\n${lines.join('\n')}`;
}

export const grepNotes: NotebaseTool = {
  definition: {
    name: 'grep_notes',
    description:
      'Exact literal or regular-expression search over the raw text of every note ' +
      'in the thoughtbase, like `grep`. Returns each matching line as ' +
      '`path:line: text`. Unlike search_notes (ranked, word-based full-text) and ' +
      'search_related (meaning-based), this matches the exact characters — ' +
      'including punctuation, symbols, code, casing, and structure — and finds ' +
      'every occurrence, so it is the tool for a known string (an exact phrase, an ' +
      'identifier, a URL), a structural pattern (unfinished tasks "- [ ]", ' +
      '"[[wiki-links]]", a "status:" property, TODO/FIXME), or to verify whether ' +
      'something literally appears at all. The pattern is a literal substring by ' +
      'default; set regex:true to use a JavaScript regular expression. Matches are ' +
      'per line. This is the ONLY literal search over the user\'s files that exists: ' +
      'a code-execution sandbox cannot see the thoughtbase, so never shell out to ' +
      'grep. Output is capped and the header states the true total, so a truncated ' +
      'result means "narrow the pattern", not "something is wrong with the notes".',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The text to find. A literal substring unless regex is true.',
        },
        regex: {
          type: 'boolean',
          description: 'Treat pattern as a JavaScript regular expression. Defaults to false (literal).',
        },
        case_sensitive: {
          type: 'boolean',
          description: 'Match case exactly. Defaults to false (case-insensitive).',
        },
        max_matches: {
          type: 'integer',
          description: `Maximum match lines to return. Defaults to ${DEFAULT_MAX}, max ${HARD_MAX}.`,
          minimum: 1,
          maximum: HARD_MAX,
        },
      },
      required: ['pattern'],
    },
  },
  run: async (ctx, input) => ({ content: await runGrep(ctx, input), isError: false }),
};
