/** One suggestion produced by the Auto-link "link to" mode (#175). */
export interface AutoLinkSuggestion {
  /** Verbatim substring of the active note body that should become a link. */
  anchorText: string;
  /** Target note's relative path (with .md). The link itself drops the extension. */
  target: string;
  /** Short reason the LLM gave for suggesting this link. */
  rationale: string;
}

/** Condensed note record sent to the LLM as a candidate target. */
export interface CandidateNote {
  relativePath: string;
  title: string;
  summary: string;
}

/** Approximate budget per candidate summary (in characters). Keeps the prompt bounded. */
const SUMMARY_CHAR_BUDGET = 360;

/**
 * Pulls a short summary from a note: frontmatter `description` if present,
 * otherwise the first non-empty paragraph of body content. Falls back to
 * the first 360 chars of whatever we have when neither is available.
 */
export function extractSummary(body: string, frontmatterDescription?: string): string {
  const d = frontmatterDescription?.trim();
  if (d) return truncate(d, SUMMARY_CHAR_BUDGET);

  // Strip common non-prose noise: headings, list markers, code fences.
  const stripped = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#+\s.*$/gm, '')
    .trim();
  const firstPara = stripped.split(/\n\s*\n/).find((p) => p.trim().length > 0)?.trim() ?? '';
  return truncate(firstPara, SUMMARY_CHAR_BUDGET);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + '\u2026';
}

/**
 * Builds the "link to" prompt. The LLM sees the active note's body and an
 * index of candidate notes (path + title + summary). It returns a JSON
 * array of `{ anchorText, target, rationale }` suggestions.
 */
export function buildAutoLinkToPrompt(args: {
  activeTitle: string;
  activeBody: string;
  candidates: CandidateNote[];
}): string {
  const index = args.candidates
    .map((c) => `- \`${c.relativePath}\` \u2014 **${c.title}**\n  ${c.summary || '(no summary)'}`)
    .join('\n');

  return `You are identifying missing wiki-links in a note the user is working on. Your job is to propose places where a link to one of the candidate notes would fit naturally.

## Rules
- Only propose links where the active note **already mentions the candidate\u2019s concept** \u2014 don\u2019t invent topics, and don\u2019t link to notes the active note doesn\u2019t actually discuss.
- The \`anchorText\` must be a **verbatim substring** of the active note body. Don\u2019t paraphrase. Don\u2019t add or drop punctuation. Preserve capitalisation exactly.
- Prefer short anchor phrases (1\u20134 words) over long ones.
- Skip anchors that are already inside an existing \`[[\u2026]]\` link.
- If a concept appears multiple times, propose **one** anchor for it \u2014 the most natural first occurrence. The user can manually add more later.
- \`target\` must be one of the candidate paths below, verbatim.
- Keep rationale short \u2014 one short sentence, no fluff.
- If nothing fits, return \`[]\`.

## Output format
A single JSON array, nothing else. No prose, no commentary, no code fences.

\`\`\`
[
  { "anchorText": "\u2026", "target": "\u2026.md", "rationale": "\u2026" }
]
\`\`\`

## Active note
Title: ${args.activeTitle || '(untitled)'}

${args.activeBody}

## Candidate notes (targets)
${index || '(none)'}
`;
}

/**
 * Parses the LLM\u2019s JSON array of suggestions. Tolerant of surrounding
 * prose, code fences, and trailing commas. Skips malformed entries.
 */
export function parseAutoLinkResponse(
  text: string,
  validTargets: Set<string>,
): AutoLinkSuggestion[] {
  const json = extractJsonArray(text);
  if (!json) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const out: AutoLinkSuggestion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const anchorText = typeof e.anchorText === 'string' ? e.anchorText : null;
    const target = typeof e.target === 'string' ? e.target : null;
    const rationale = typeof e.rationale === 'string' ? e.rationale : '';
    if (!anchorText || !target) continue;
    if (!validTargets.has(target)) continue;
    out.push({ anchorText, target, rationale });
  }
  return out;
}

function extractJsonArray(text: string): string | null {
  // Strip markdown code fences if the model wrapped the JSON in one.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export interface ApplyResult {
  /** Rewritten active-note content. Equals the input when nothing applied. */
  content: string;
  /** Suggestions that were inserted. */
  applied: AutoLinkSuggestion[];
  /** Suggestions whose anchor text wasn\u2019t found (content drifted). */
  skipped: AutoLinkSuggestion[];
}

/**
 * Inserts accepted suggestions into the active note body. Each suggestion
 * replaces the **first** occurrence of its anchor text with
 * `[[target-stem|anchorText]]` (or `[[target-stem]]` when the anchor
 * already matches the target\u2019s stem). Skips anchors already inside a
 * `[[\u2026]]` link, and anchors that can\u2019t be found.
 *
 * Processes suggestions in descending order of anchor length so a longer
 * phrase isn\u2019t shadowed by a substring of it that already got linked.
 */
export function applyLinkInsertions(
  content: string,
  suggestions: AutoLinkSuggestion[],
): ApplyResult {
  const ordered = [...suggestions].sort((a, b) => b.anchorText.length - a.anchorText.length);
  const applied: AutoLinkSuggestion[] = [];
  const skipped: AutoLinkSuggestion[] = [];
  let current = content;

  for (const s of ordered) {
    const offset = findUnlinkedOccurrence(current, s.anchorText);
    if (offset < 0) {
      skipped.push(s);
      continue;
    }
    const stem = s.target.replace(/\.md$/i, '');
    const link = stem === s.anchorText ? `[[${stem}]]` : `[[${stem}|${s.anchorText}]]`;
    current = current.slice(0, offset) + link + current.slice(offset + s.anchorText.length);
    applied.push(s);
  }

  return { content: current, applied, skipped };
}

/**
 * First occurrence of `needle` in `haystack` that isn\u2019t inside an existing
 * `[[\u2026]]` wiki-link. Returns -1 when none found.
 */
function findUnlinkedOccurrence(haystack: string, needle: string): number {
  if (!needle) return -1;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) return -1;
    if (!isInsideWikiLink(haystack, idx)) return idx;
    from = idx + needle.length;
  }
  return -1;
}

function isInsideWikiLink(text: string, offset: number): boolean {
  // Scan backwards for `[[` without a closing `]]` between it and offset.
  const before = text.slice(0, offset);
  const lastOpen = before.lastIndexOf('[[');
  if (lastOpen < 0) return false;
  const lastClose = before.lastIndexOf(']]');
  return lastClose < lastOpen;
}
