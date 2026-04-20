import YAML from 'yaml';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface BuildAutoTagPromptArgs {
  noteTitle: string;
  noteBody: string;
  existingNoteTags: string[];
  thoughtbaseTags: string[];
  /** Max tags the LLM is asked to return. Defaults to 5. */
  cap?: number;
}

export function buildAutoTagPrompt({
  noteTitle,
  noteBody,
  existingNoteTags,
  thoughtbaseTags,
  cap = 5,
}: BuildAutoTagPromptArgs): string {
  const existingList = existingNoteTags.length
    ? existingNoteTags.map((t) => `- ${t}`).join('\n')
    : '(none yet)';

  const vocab = thoughtbaseTags.length
    ? thoughtbaseTags.slice(0, 200).map((t) => `- ${t}`).join('\n')
    : '(the thoughtbase has no tags yet \u2014 feel free to introduce the first ones)';

  return `You are tagging a note in a personal knowledge base.

Produce up to **${cap}** tags that capture what the note is actually about \u2014 the topic, domain, or concept. Prefer specific over generic; skip tags that are so broad they\u2019d apply to half the thoughtbase (e.g. "notes", "thinking", "ideas").

## Rules
- Reuse existing thoughtbase tags when they fit, rather than inventing near-duplicates.
- Only coin a new tag when no existing one applies well.
- Tags must be **kebab-case**: lowercase letters, digits, and hyphens only (e.g. \`machine-learning\`, \`cognitive-bias\`).
- Do **not** repeat tags the note already has.
- If the note is too short, generic, or otherwise tag-free, return no tags at all \u2014 an empty list is a valid answer.

## Output format
Return one tag per line, nothing else. No prose, no numbering, no backticks, no leading hyphens. Just the tags:

machine-learning
cognitive-bias
algorithmic-transparency

## Existing tags on this note (do not repeat)
${existingList}

## Existing thoughtbase vocabulary (reuse when it fits)
${vocab}

## Note
Title: ${noteTitle || '(untitled)'}

${noteBody}`;
}

/**
 * Extracts kebab-case tags from the LLM response. Tolerates leading hyphens,
 * leading "#", stray backticks, numbered lists, and commentary lines that
 * aren\u2019t a valid tag. Deduplicates while preserving first-seen order.
 */
export function parseAutoTagResponse(text: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    // Strip common list prefixes / markdown decorations.
    line = line
      .replace(/^[-*\u2022\u2013\u2014]\s*/, '')
      .replace(/^\d+[.)]\s*/, '')
      .replace(/^#+\s*/, '')
      .replace(/^`+|`+$/g, '')
      .trim();
    if (!line) continue;
    // Skip obvious commentary lines.
    if (/\s/.test(line)) continue;
    const lower = line.toLowerCase();
    if (!KEBAB_RE.test(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    tags.push(lower);
  }
  return tags;
}

export interface MergeResult {
  /** Updated note content. Equals the input when nothing new to add. */
  content: string;
  /** The subset of `newTags` that were actually added (i.e. not already present). */
  addedTags: string[];
}

/**
 * Merges `newTags` into the note\u2019s frontmatter `tags:` array. Skips tags
 * that are already present (case-insensitive). Creates a frontmatter block
 * when the note has none.
 */
export function mergeTagsIntoContent(content: string, newTags: string[]): MergeResult {
  const match = content.match(FRONTMATTER_RE);
  const existing: string[] = [];
  let fm: Record<string, unknown> = {};
  if (match) {
    try {
      const parsed = YAML.parse(match[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fm = parsed as Record<string, unknown>;
      }
    } catch { /* malformed frontmatter \u2014 overwrite */ }
    if (Array.isArray(fm.tags)) {
      for (const t of fm.tags) {
        if (typeof t === 'string') existing.push(t);
      }
    }
  }

  const existingLower = new Set(existing.map((t) => t.toLowerCase()));
  const addedTags: string[] = [];
  for (const t of newTags) {
    const lower = t.toLowerCase();
    if (existingLower.has(lower)) continue;
    existingLower.add(lower);
    addedTags.push(t);
  }
  if (addedTags.length === 0) return { content, addedTags: [] };

  fm.tags = [...existing, ...addedTags];
  const yamlBlock = YAML.stringify(fm).trimEnd();
  const rendered = `---\n${yamlBlock}\n---\n`;
  const body = match ? content.slice(match[0].length) : content;
  const separator = body.startsWith('\n') || body === '' ? '' : '\n';
  return { content: rendered + separator + body, addedTags };
}
