/**
 * "Decompose Note" (#178): LLM-driven restructure of a note into one
 * parent index + 2\u20137 children. Pure pieces — prompt builder and
 * response parser. The main-side orchestrator lives in `src/main/llm/`
 * and the planner that turns an (edited) proposal into actual file
 * writes lives in `src/renderer/lib/refactor/`.
 */

export interface DecomposeChildProposal {
  /** Proposed title for the child note. */
  title: string;
  /** Proposed body (no frontmatter; planner handles that). */
  content: string;
  /** Short reason the LLM gave for this child existing. */
  rationale: string;
}

export interface DecomposeProposal {
  /** The parent "index" note's body (no frontmatter). The planner appends a Contents block with wiki-links. */
  parent: { content: string };
  /** 2\u20137 children. The preview dialog can edit, drop, or regenerate them. */
  children: DecomposeChildProposal[];
}

export interface BuildDecomposePromptArgs {
  sourceTitle: string;
  sourceBody: string;
  /** Informational — the LLM adapts tone if the user hints at preferences. Not required. */
  hints?: {
    normalizeHeadings?: boolean;
    transcludeByDefault?: boolean;
  };
}

export function buildDecomposePrompt(args: BuildDecomposePromptArgs): string {
  return `You are restructuring a long note into a **parent index note** plus a handful of focused **child notes**. The goal is semantic coherence: each child should cover one distinct topic or line of thought from the source, and the parent should read as an index / orientation for the whole.

## Rules
- Produce **2\u20137 children**. Fewer than 2 isn\u2019t decomposition; more than 7 is noise.
- Each child must stand on its own \u2014 someone reading just that child should get a coherent chunk.
- Children don\u2019t need to map 1:1 to existing headings. Merge related sections. Split a section that\u2019s actually covering two topics. Invent titles that reflect what the child is really about, not just what the original heading said.
- **Do not lose content.** Every substantive point from the source should end up somewhere (a child, or the parent narrative).
- The **parent content** is a short index / orientation: 1\u20133 short paragraphs that frame what the note is about and how the children relate. Don\u2019t duplicate the children\u2019s prose \u2014 point at them.
- Do **not** include wiki-links in the parent content. The post-processor inserts a \`## Contents\` list with links automatically.
- Titles: 2\u20136 words, title-case. Stable when re-run on similar content.
- Preserve the source\u2019s voice in the child bodies; minor tidying is fine, heavy rewriting isn\u2019t.

## Output format
Return a single JSON object, no prose, no commentary, no code fences:

\`\`\`
{
  "parent": { "content": "..." },
  "children": [
    { "title": "...", "content": "...", "rationale": "..." },
    ...
  ]
}
\`\`\`

## Source note
Title: ${args.sourceTitle || '(untitled)'}

${args.sourceBody}
`;
}

export interface ParseDecomposeResult {
  proposal: DecomposeProposal | null;
  /** When the JSON parse failed or the shape was wrong, a short diagnostic for logs. */
  error?: string;
}

/**
 * Parses the LLM response into a proposal. Tolerant of code fences and
 * surrounding prose. Accepts only the strict shape — children with
 * missing \`title\` / \`content\` are dropped individually; an entirely
 * malformed response returns null.
 */
export function parseDecomposeResponse(text: string): ParseDecomposeResult {
  const json = extractJsonObject(text);
  if (!json) return { proposal: null, error: 'no-json' };

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { proposal: null, error: `parse-fail: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { proposal: null, error: 'not-object' };
  }

  const obj = raw as Record<string, unknown>;
  const parent = obj.parent;
  const children = obj.children;
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
    return { proposal: null, error: 'missing-parent' };
  }
  if (!Array.isArray(children)) {
    return { proposal: null, error: 'missing-children' };
  }

  const parentContent = typeof (parent as Record<string, unknown>).content === 'string'
    ? (parent as { content: string }).content
    : '';

  const outChildren: DecomposeChildProposal[] = [];
  for (const c of children) {
    if (!c || typeof c !== 'object') continue;
    const rec = c as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    const content = typeof rec.content === 'string' ? rec.content : '';
    const rationale = typeof rec.rationale === 'string' ? rec.rationale.trim() : '';
    if (!title || !content) continue;
    outChildren.push({ title, content, rationale });
  }

  if (outChildren.length === 0) {
    return { proposal: null, error: 'no-valid-children' };
  }

  return {
    proposal: {
      parent: { content: parentContent },
      children: outChildren,
    },
  };
}

function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}
