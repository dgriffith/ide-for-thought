/**
 * Format an in-flight tool call as a single one-line user-facing
 * indicator. Surfaced in the conversation stream so the user can see
 * what's causing the pause — "Searching the web for X", "Reading Y" —
 * rather than a generic "Running tool" notice that obscures whether
 * anything's stuck.
 *
 * The line is for a READER, not a developer: plain English, never source
 * code, a query language, a tool's snake_case name or a JSON dump. It
 * used to fall back to exactly those — `⚙️ Running code: print(text[text
 * .find("## Best art…`, `⚙️ Running \`list_object_types\`
 * {"type_id":"museum"}` — so every Minerva tool without a case of its own
 * read like a log line. Each tool now has a sentence; a tool added later
 * without one still gets one, from its name (`humanizeToolName`), and
 * `format-tool-call.test.ts` fails if a registered tool falls back.
 *
 * The argument shown is what the user would recognise — a note path, a
 * search phrase, a count — never the model's own rationale (`note` on the
 * propose_* tools; the review card shows that).
 */

const MAX_SNIPPET = 100;

export function formatToolCall(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    // ── Looking things up ────────────────────────────────────────────────
    case 'web_search': {
      const q = pickString(i, 'query');
      return q ? `🔍 Searching the web for **${truncate(q, MAX_SNIPPET)}**` : '🔍 Searching the web';
    }
    case 'web_fetch': {
      const url = pickString(i, 'url');
      return url ? `🌐 Fetching **${truncate(url, MAX_SNIPPET)}**` : '🌐 Fetching a web page';
    }
    case 'search_notes': {
      const q = pickString(i, 'query');
      return q ? `🔎 Searching notes for **${truncate(q, MAX_SNIPPET)}**` : '🔎 Searching notes';
    }
    case 'grep_notes': {
      const p = pickString(i, 'pattern');
      return p ? `🔦 Looking through notes for **${truncate(p, MAX_SNIPPET)}**` : '🔦 Looking through notes';
    }
    case 'search_related': {
      const about = pickString(i, 'relative_path') ?? pickString(i, 'query');
      return about ? `🔗 Finding notes related to **${truncate(about, MAX_SNIPPET)}**` : '🔗 Finding related notes';
    }
    case 'search_help': {
      const q = pickString(i, 'query');
      return q ? `📖 Checking the docs for **${truncate(q, MAX_SNIPPET)}**` : '📖 Checking the docs';
    }
    case 'list_notes':
      return '🗂️ Looking over your notes';
    case 'read_note': {
      const p = pickString(i, 'relative_path');
      return p ? `📄 Reading **${truncate(p, MAX_SNIPPET)}**` : '📄 Reading a note';
    }
    case 'fetch_properties': {
      const p = pickString(i, 'relative_path');
      return p ? `🏷️ Checking the properties of **${truncate(p, MAX_SNIPPET)}**` : '🏷️ Checking a note\'s properties';
    }
    case 'read_source': {
      const id = pickString(i, 'source_id');
      return id ? `📚 Reading source **${truncate(id, MAX_SNIPPET)}**` : '📚 Reading a source';
    }
    case 'list_object_types': {
      const id = pickString(i, 'type_id');
      return id ? `🧩 Checking the **${truncate(id, MAX_SNIPPET)}** object type` : '🧩 Checking your object types';
    }
    case 'query_graph':
      return '🧠 Querying the knowledge graph';
    case 'describe_graph_schema':
      return '🧠 Looking over the knowledge graph\'s structure';
    case 'query_sql':
      return '📊 Querying your tables';
    case 'describe_tables':
      return '📊 Looking over your tables';
    case 'code_execution': {
      // The server-side web tools (web_search_20260209 / web_fetch_20260209)
      // can surface as `code_execution` blocks whose code calls them; reach
      // in for the argument so those read like the cases above. Anything
      // else is the model working over results in a sandbox — say that, not
      // its first line of Python.
      const code = pickString(i, 'code');
      if (code) {
        const ws = code.match(/web_search\s*\(\s*\{[^}]*['"]query['"]\s*:\s*['"]([^'"]+)['"]/);
        if (ws) return `🔍 Searching the web for **${truncate(ws[1]!, MAX_SNIPPET)}**`;
        const wf = code.match(/web_fetch\s*\(\s*\{[^}]*['"]url['"]\s*:\s*['"]([^'"]+)['"]/);
        if (wf) return `🌐 Fetching **${truncate(wf[1]!, MAX_SNIPPET)}**`;
      }
      return '🧮 Running a quick analysis';
    }

    // ── Asking and delegating ────────────────────────────────────────────
    case 'ask_user': {
      const q = pickString(i, 'question');
      return q ? `❓ Asking: **${truncate(q, MAX_SNIPPET)}**` : '❓ Asking you a question';
    }
    case 'run_skill': {
      const id = pickString(i, 'skillId');
      return id ? `🛠️ Running the **${humanizeSlug(id)}** thinking tool` : '🛠️ Running a thinking tool';
    }
    case 'mcp_call': {
      const tool = pickString(i, 'tool');
      const server = pickString(i, 'server');
      if (tool && server) return `🔌 Using **${humanizeSlug(tool)}** from ${truncate(server, MAX_SNIPPET)}`;
      return server ? `🔌 Using a tool from ${truncate(server, MAX_SNIPPET)}` : '🔌 Using a connected tool';
    }

    // ── Proposals (each becomes a card for you to review) ───────────────
    case 'propose_notes':
      return counted('📝 Proposing', arrayLen(i, 'payloads') ?? arrayLen(i, 'notes'), 'a new note', 'new notes');
    case 'propose_sources':
      return counted('📚 Proposing', arrayLen(i, 'sources'), 'a source', 'sources');
    case 'propose_claims':
      return counted('💡 Proposing', arrayLen(i, 'claims'), 'a claim', 'claims');
    case 'propose_note_edits':
    case 'propose_note_body':
      return targeted('✏️ Proposing edits to', items(i, 'edits'), 'relative_path', 'notes');
    case 'set_properties':
      return targeted('🏷️ Proposing property changes to', items(i, 'updates'), 'relativePath', 'notes');
    case 'propose_note_types':
      return targeted('🧩 Proposing types for', items(i, 'assignments'), 'relativePath', 'notes');
    case 'propose_note_delete':
      return targeted('🗑️ Proposing to delete', stringsAsItems(i, 'paths'), 'path', 'notes');
    case 'propose_folder_delete':
      return targeted('🗑️ Proposing to delete', stringsAsItems(i, 'paths'), 'path', 'folders');
    case 'propose_note_move':
      return targeted('↪️ Proposing to move', items(i, 'moves'), 'path', 'notes');
    case 'propose_folder_move':
      return targeted('↪️ Proposing to move', items(i, 'moves'), 'path', 'folders');
    case 'propose_note_rename':
      return targeted('✏️ Proposing to rename', items(i, 'renames'), 'path', 'notes');
    case 'propose_reorganization':
      return counted('🗂️ Proposing a reorganization', arrayLen(i, 'operations'), 'with 1 step', null, (n) => `with ${n} steps`);
    case 'propose_object_type': {
      const id = pickString(i, 'id');
      const label = pickString(i, 'label');
      if (id) return `🧩 Proposing changes to the **${truncate(label ?? id, MAX_SNIPPET)}** object type`;
      return label ? `🧩 Proposing a **${truncate(label, MAX_SNIPPET)}** object type` : '🧩 Proposing an object type';
    }
    case 'propose_source_properties':
      return '📚 Proposing a summary for a source';
    case 'propose_compute': {
      const lang = pickString(i, 'language');
      return lang ? `🧮 Proposing a **${truncate(lang, 20)}** cell to run` : '🧮 Proposing code to run';
    }

    default:
      // A tool with no sentence of its own still reads as English: its name
      // turned into words, plus the first short text argument if it has one.
      return `⚙️ ${humanizeToolName(name, i)}`;
  }
}

/** Gerunds for the verbs tool names start with; anything else is "Using". */
const GERUNDS: Readonly<Record<string, string>> = {
  list: 'Listing', get: 'Getting', read: 'Reading', fetch: 'Fetching', search: 'Searching',
  find: 'Finding', query: 'Querying', describe: 'Describing', propose: 'Proposing',
  set: 'Setting', create: 'Creating', update: 'Updating', delete: 'Deleting', add: 'Adding',
  remove: 'Removing', run: 'Running', check: 'Checking', open: 'Opening', write: 'Writing',
  move: 'Moving', rename: 'Renaming', summarize: 'Summarizing', analyze: 'Analyzing',
};

/**
 * `list_object_types` + `{type_id:"museum"}` → `Listing object types: **museum**`.
 * Exported for the test that keeps every registered tool off this path.
 */
export function humanizeToolName(name: string, input: Record<string, unknown> = {}): string {
  const words = name.split(/[_\-.\s]+/).filter(Boolean).map((w) => w.toLowerCase());
  if (words.length === 0) return 'Working';
  const verb = GERUNDS[words[0]!];
  const phrase = verb ? [verb, ...words.slice(1)].join(' ') : `Using ${words.join(' ')}`;
  const arg = firstShortString(input);
  return arg ? `${phrase}: **${truncate(arg, MAX_SNIPPET)}**` : phrase;
}

/** `find-opposing-arguments` → `find opposing arguments`. */
function humanizeSlug(s: string): string {
  return truncate(s.replace(/[_-]+/g, ' ').trim(), MAX_SNIPPET);
}

function counted(
  lead: string,
  n: number | null,
  one: string,
  many: string | null,
  manyPhrase: (n: number) => string = (k) => `${k} ${many}`,
): string {
  if (n === null || n === 0) return many === null ? lead : `${lead} ${many}`;
  return `${lead} ${n === 1 ? one : manyPhrase(n)}`;
}

/** "Proposing edits to **notes/a.md**" for one target, "… to 3 notes" for several. */
function targeted(lead: string, list: Record<string, unknown>[] | null, pathKey: string, noun: string): string {
  if (!list || list.length === 0) return `${lead} ${noun}`;
  const paths = [...new Set(list.map((x) => pickString(x, pathKey)).filter((p): p is string => p !== null))];
  if (paths.length === 1) return `${lead} **${truncate(paths[0]!, MAX_SNIPPET)}**`;
  const n = paths.length > 0 ? paths.length : list.length;
  return `${lead} ${n} ${noun}`;
}

function items(o: Record<string, unknown>, key: string): Record<string, unknown>[] | null {
  const v = o[key];
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : null;
}

function stringsAsItems(o: Record<string, unknown>, key: string): Record<string, unknown>[] | null {
  const v = o[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((path) => ({ path })) : null;
}

function arrayLen(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  return Array.isArray(v) ? v.length : null;
}

function firstShortString(o: Record<string, unknown>): string | null {
  for (const v of Object.values(o)) {
    if (typeof v === 'string' && v.trim() && v.length <= 80 && !v.includes('\n')) return v.trim();
  }
  return null;
}

function pickString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}
