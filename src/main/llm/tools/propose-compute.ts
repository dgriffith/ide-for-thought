import { randomUUID } from 'node:crypto';
import { scanPythonSafety } from '../../../shared/python-safety';
import type {
  ConversationComputeDraft,
  ProposeComputeInput,
} from '../../../shared/conversation-compute-drafts';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/**
 * Trust-principle parity with the other propose_* tools (#245):
 * `propose_compute` never executes the cell. It validates the input,
 * runs the Python-safety scan (no-op for sparql/sql), and emits a
 * `ConversationComputeDraft`. The renderer shows an inline reviewable
 * card; the user clicks Run to execute, Insert to file as a notebook
 * cell, or Discard.
 */
function runProposeCompute(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): { content: string; isError: boolean } {
  if (!callbacks.onComputeDraft) {
    return {
      content: 'propose_compute is only available in conversation contexts.',
      isError: true,
    };
  }
  if (!ctx.conversationId) {
    return {
      content: 'propose_compute requires a bound conversation id.',
      isError: true,
    };
  }
  const parsed = parseProposeComputeInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }
  const safetyFlags = parsed.language === 'python'
    ? scanPythonSafety(parsed.code).map((f) => ({ id: f.id, message: f.message }))
    : [];
  const draft: ConversationComputeDraft = {
    draftId: `cmpdraft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    language: parsed.language,
    code: parsed.code,
    rationale: parsed.rationale,
    safetyFlags,
    createdAt: new Date().toISOString(),
  };
  callbacks.onComputeDraft(draft);
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      language: draft.language,
      safetyFlags: safetyFlags.map((f) => f.id),
      // Same anti-loop hint that propose_notes / propose_sources /
      // set_properties use. The model otherwise tends to re-emit the
      // proposal in subsequent iterations of the same turn.
      hint:
        'STOP. The cell has been queued for the user to review. End this ' +
        'turn with ONE short acknowledgement sentence (e.g. "I drafted a ' +
        `${parsed.language} cell — run it when ready.") and DO NOT call ` +
        'propose_compute again in this turn. DO NOT call any other tool. ' +
        'The cell output will arrive in the NEXT turn as user-role context — ' +
        'comment on it then.',
    }) + `\n\n(queued ${parsed.language} draft)`,
    isError: false,
  };
}

function parseProposeComputeInput(input: unknown): ProposeComputeInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'propose_compute input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const language = obj.language;
  if (language !== 'sparql' && language !== 'sql' && language !== 'python') {
    return { error: '`language` must be one of "sparql", "sql", "python".' };
  }
  const code = typeof obj.code === 'string' ? obj.code : '';
  if (!code.trim()) {
    return { error: '`code` is required and must be a non-empty string.' };
  }
  const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() : '';
  if (!rationale) {
    return { error: '`rationale` is required and must be a non-empty string.' };
  }
  return { language, code, rationale };
}

export const proposeCompute: NotebaseTool = {
  definition: {
    name: 'propose_compute',
    description:
      'Propose a code cell (SPARQL, SQL, or Python) for the user to review and run. ' +
      'Use this when answering a question would benefit from actual computation over ' +
      'the user\'s data — counting graph nodes, joining CSV tables, fitting a model, ' +
      'plotting a distribution — rather than your own narrative answer. The cell is ' +
      'rendered as a reviewable inline card; the user clicks Run to execute it, ' +
      'Insert into notebook to file it as a permanent cell, or Discard. Per the ' +
      'Trust Principle, you cannot execute code yourself — every cell goes through ' +
      'human review first.\n' +
      '\n' +
      'After Run, the output is appended to the conversation as context for your ' +
      'NEXT turn — so you can comment on the result, refine the query, or propose ' +
      'a follow-up cell. Don\'t describe the expected output inline; let the user ' +
      'run it and see.\n' +
      '\n' +
      'Language guidance:\n' +
      '  - `sparql` — query the knowledge graph (notes, tags, claims, sources, etc.). ' +
      'Use the standard minerva/thought/dc prefixes; they\'re auto-injected.\n' +
      '  - `sql` — query CSV tables registered in DuckDB. Table names follow the ' +
      'project-relative path with `/` and `.` collapsed to `_` (or the user\'s ' +
      '`table_name:` override). Call `describe_tables` to list tables + columns; ' +
      'use `query_sql` if you just need to see the data yourself rather than ' +
      'leaving the user a cell.\n' +
      '  - `python` — pandas / numpy / matplotlib analysis. Network calls, ' +
      'subprocess, and file-write APIs are flagged in the UI and require an extra ' +
      'confirmation — avoid them unless genuinely necessary.\n' +
      '\n' +
      'The `minerva` Python module is the canonical way to reach project data ' +
      '(just `import minerva` at the top of the cell). Every helper returns ' +
      'plain dicts / lists of dicts — NOT custom classes. Access fields with ' +
      'bracket notation (`note[\'body\']`), not dot notation.\n' +
      '\n' +
      '  minerva.sparql(query) -> pandas.DataFrame\n' +
      '    Columns match the SELECT variable names verbatim (no `?` prefix).\n' +
      '    SELECT ?relativePath ?title  →  df columns: [\'relativePath\', \'title\']\n' +
      '\n' +
      '  minerva.sql(query) -> pandas.DataFrame\n' +
      '    Columns match the SQL projection.\n' +
      '\n' +
      '  minerva.notes.read(rel_path) -> dict\n' +
      '    Returns {\'relativePath\', \'title\', \'frontmatter\', \'tags\', \'body\'}.\n' +
      '    To get the markdown source: minerva.notes.read(p)[\'body\'].\n' +
      '\n' +
      '  minerva.notes.by_tag(tag) -> list[dict]\n' +
      '    Each item: {\'relativePath\', \'title\'}.\n' +
      '\n' +
      '  minerva.notes.search(query, limit=20) -> list[dict]\n' +
      '    Each item: {\'relativePath\', \'title\', \'snippet\', \'score\'}.\n' +
      '\n' +
      '  minerva.sources.get(source_id) -> dict (SourceDetail)\n' +
      '  minerva.sources.citing(source_id) -> list[dict]\n' +
      '  minerva.excerpts.for_source(source_id) -> list[str]\n' +
      '  minerva.ctx() -> {\'project_root\': str, \'notebook_path\': str | None}\n' +
      '\n' +
      'Common pitfalls to avoid:\n' +
      '  - There is no `from minerva import read_note`. Use `minerva.notes.read(p)`.\n' +
      '  - DataFrame columns are NOT renamed for ergonomics — `?relativePath` in ' +
      'SPARQL becomes `df[\'relativePath\']`, not `df[\'path\']`. Match the column ' +
      'name to the variable name exactly.\n' +
      '  - Notes are dicts; field access is `note[\'body\']` not `note.body`.\n' +
      '  - For the project root, use `minerva.ctx()[\'project_root\']` rather than ' +
      '`os.environ` so you don\'t trip the safety scan.\n' +
      '\n' +
      'One proposal per turn. End the turn with a one-sentence preamble (e.g. ' +
      '"I drafted a query — run it when ready.") and stop.',
    input_schema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['sparql', 'sql', 'python'],
          description:
            'Which executor the cell targets. SPARQL hits the graph; SQL hits DuckDB ' +
            'over registered CSV tables; Python runs in the project\'s kernel.',
        },
        code: {
          type: 'string',
          description:
            'The cell body, exactly as you want the user to see it. No surrounding ' +
            'markdown fence; the renderer adds language-aware syntax highlighting. ' +
            'Make the cell self-contained — the user may run it without your turn ' +
            'still in scope.',
        },
        rationale: {
          type: 'string',
          description:
            'One short sentence describing what this cell will compute and why ' +
            'it\'s the right answer to the user\'s question. Surfaced on the card.',
        },
      },
      required: ['language', 'code', 'rationale'],
    },
  },
  run: (ctx, input, callbacks) => runProposeCompute(ctx, input, callbacks),
};
