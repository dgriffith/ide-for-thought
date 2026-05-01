/**
 * Format an in-flight tool call as a single one-line user-facing
 * indicator (#NEW). Surfaced in the conversation stream so the user
 * can see what's causing the pause — "Searching the web for X",
 * "Reading note Y", "Running SPARQL query Z" — rather than a generic
 * "Running tool" notice that obscures whether anything's stuck.
 *
 * Per-tool extraction picks the most informative input field; an
 * unknown tool falls back to a truncated JSON dump so something
 * useful still appears in the stream.
 */

const MAX_SNIPPET = 100;

export function formatToolCall(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'web_search': {
      const q = pickString(i, 'query');
      return q ? `🔍 Searching the web for **${truncate(q, MAX_SNIPPET)}**` : '🔍 Searching the web';
    }
    case 'web_fetch': {
      const url = pickString(i, 'url');
      return url ? `🌐 Fetching **${truncate(url, MAX_SNIPPET)}**` : '🌐 Fetching a URL';
    }
    case 'search_notes': {
      const q = pickString(i, 'query');
      return q ? `🔎 Searching notes for **${truncate(q, MAX_SNIPPET)}**` : '🔎 Searching notes';
    }
    case 'read_note': {
      const p = pickString(i, 'relative_path');
      return p ? `📄 Reading **${truncate(p, MAX_SNIPPET)}**` : '📄 Reading a note';
    }
    case 'query_graph': {
      const sparql = pickString(i, 'sparql');
      // SPARQL queries can be long and multi-line; the first non-empty
      // line is usually descriptive enough (the SELECT / ASK clause).
      const head = sparql ? firstNonEmptyLine(sparql) : null;
      return head ? `🧠 Running graph query: \`${truncate(head, MAX_SNIPPET)}\`` : '🧠 Running graph query';
    }
    case 'describe_graph_schema':
      return '🧠 Inspecting graph schema';
    case 'propose_notes': {
      const notes = i.notes;
      const count = Array.isArray(notes) ? notes.length : null;
      return count
        ? `📝 Proposing ${count} note${count === 1 ? '' : 's'}`
        : '📝 Proposing notes';
    }
    default: {
      // Unknown tool — show name + a JSON snippet so the user has
      // something to recognise. Strip whitespace to keep the line tight.
      const snippet = truncate(JSON.stringify(input ?? {}).replace(/\s+/g, ' '), MAX_SNIPPET);
      return `⚙️ Running \`${name}\` ${snippet}`;
    }
  }
}

function pickString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function firstNonEmptyLine(s: string): string {
  for (const line of s.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return s.trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}
