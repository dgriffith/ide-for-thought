/**
 * "Auto-link inbound" mode (#175 follow-up): find places in *other* notes
 * where a link pointing at the active note would fit naturally.
 */

/** One suggestion for a link pointing to the active note from a specific source note. */
export interface AutoLinkInboundSuggestion {
  /** Relative path of the note that should gain the new link. */
  source: string;
  /** Verbatim substring of the source note's body that should become the link. */
  anchorText: string;
  /** Short reason the LLM gave. */
  rationale: string;
  /** Context snippet around the anchor in the source note body, for the review dialog. */
  contextSnippet?: string;
}

export interface InboundCandidate {
  relativePath: string;
  title: string;
  /** Full body (frontmatter stripped). */
  body: string;
}

export function buildAutoLinkInboundPrompt(args: {
  activeTitle: string;
  activePath: string;
  activeSummary: string;
  candidates: InboundCandidate[];
}): string {
  const sections = args.candidates.map((c) =>
    `### ${c.title} \u2014 \`${c.relativePath}\`\n\n${c.body.trim() || '(empty)'}`,
  ).join('\n\n');

  const activeStem = args.activePath.replace(/\.md$/i, '');

  return `You are identifying missing inbound wiki-links across a personal knowledge base. The user is working in a specific "active note", and your job is to find spots in **other notes** where a link pointing at the active note would fit naturally.

## Active note
Title: ${args.activeTitle || '(untitled)'}
Path: \`${args.activePath}\`

Summary:
${args.activeSummary || '(no summary)'}

## Rules
- Only propose a link where the source note **already discusses the concept covered by the active note**. Don\u2019t invent topics. Don\u2019t link to concepts merely adjacent.
- The \`anchorText\` must be a **verbatim substring** of the source note\u2019s body. Don\u2019t paraphrase. Preserve capitalisation and punctuation exactly.
- Prefer short anchor phrases (1\u20134 words) over long ones.
- Skip anchors that are already inside an existing \`[[\u2026]]\` wiki-link.
- One anchor per source note per concept \u2014 the most natural first occurrence. The user can manually add more later.
- Some candidate source notes may genuinely have no good insertion point. **Skip them silently** rather than forcing a suggestion.
- If nothing fits across any source, return \`[]\`.

## Output format
A single JSON array, nothing else. No prose, no commentary, no code fences.

\`\`\`
[
  { "source": "path/to/source.md", "anchorText": "\u2026", "rationale": "\u2026" }
]
\`\`\`

The \`source\` field must be one of the candidate paths below, verbatim. The link itself will be \`[[${activeStem}]]\` \u2014 you do not control the target.

## Candidate source notes
${sections || '(none)'}
`;
}

export function parseInboundResponse(
  text: string,
  validSources: Set<string>,
): AutoLinkInboundSuggestion[] {
  const json = extractJsonArray(text);
  if (!json) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const out: AutoLinkInboundSuggestion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const source = typeof e.source === 'string' ? e.source : null;
    const anchorText = typeof e.anchorText === 'string' ? e.anchorText : null;
    const rationale = typeof e.rationale === 'string' ? e.rationale : '';
    if (!source || !anchorText) continue;
    if (!validSources.has(source)) continue;
    out.push({ source, anchorText, rationale });
  }
  return out;
}

function extractJsonArray(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

/** Returns a ~100-char window around the first occurrence of `anchor` in `body`. Empty when not found. */
export function snippetAround(body: string, anchor: string, radius = 50): string {
  const idx = body.indexOf(anchor);
  if (idx < 0) return '';
  const start = Math.max(0, idx - radius);
  const end = Math.min(body.length, idx + anchor.length + radius);
  const prefix = start > 0 ? '\u2026' : '';
  const suffix = end < body.length ? '\u2026' : '';
  return (
    prefix +
    body.slice(start, idx) +
    '\u00BB' + anchor + '\u00AB' +
    body.slice(idx + anchor.length, end) +
    suffix
  ).replace(/\s+/g, ' ');
}
