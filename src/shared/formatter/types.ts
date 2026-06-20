/**
 * Formatter engine types (#153). Each rule is a pure function that takes
 * note content plus a config blob and returns transformed content. Rules
 * share a parse-once cache so identifying code fences, frontmatter, math
 * blocks, etc. happens one time per invocation rather than per rule.
 */

export type FormatterCategory =
  | 'yaml'
  | 'heading'
  | 'content'
  | 'spacing'
  | 'footnote'
  | 'minerva';

/** Half-open character offset range `[start, end)` into the note content. */
export interface Range {
  start: number;
  end: number;
}

/**
 * Read-only snapshot of the structural regions the formatter should treat
 * as "don’t touch unless a rule explicitly targets this kind of block."
 * Rules consult `isProtected(offset)` before rewriting at a given position.
 */
export interface ParseCache {
  /** Top-of-file YAML frontmatter block, or null if none. Offsets cover the surrounding `---` fences. */
  frontmatterRange: Range | null;
  /** Fenced code blocks (``` or ~~~). Offsets cover the fences plus the body. */
  codeFenceRanges: Range[];
  /** Inline backticked spans — a single rule like "escape YAML special chars" still needs to skip these. */
  inlineCodeRanges: Range[];
  /** `$$…$$` math blocks and `$…$` inline math. */
  mathRanges: Range[];
  /** Blockquote regions (contiguous lines starting with `>` after optional indent). */
  blockquoteRanges: Range[];
  /** Convenience: true when the offset lies inside any of the above ranges. */
  isProtected(offset: number): boolean;
}

/**
 * Thoughtbase-scope context for cross-note rules (#215). Most rules are
 * purely local and ignore this; a few need to know about *other* notes —
 * which paths exist, or who links to a given anchor. The orchestrator
 * populates it on the main side (it has the graph + file list); buffer-mode
 * formatting (e.g. paste) leaves it undefined, and ctx-dependent rules must
 * no-op gracefully when a field they need is absent.
 */
export interface FormatContext {
  /** Relative path of the note being formatted. */
  notePath?: string;
  /** All `.md` relative paths in the thoughtbase. */
  allNotePaths?: readonly string[];
  /** How many notes link to `target#slug` (slug is a heading slug, or a
   *  `^block-id` including the caret). Backed by the graph. */
  incomingAnchorLinkCount?: (target: string, slug: string) => number;
  /** Rewrite a wiki-link's path part to the canonical form for `style`
   *  (#778), or null when it doesn't resolve to a note (leave it as-is).
   *  Backed by the alias-aware resolver. */
  canonicalizeLinkTarget?: (target: string, style: 'absolute' | 'shortest') => string | null;
}

export interface FormatterRule<Config = unknown> {
  id: string;
  category: FormatterCategory;
  title: string;
  description: string;
  defaultConfig: Config;
  /** Idempotent, no IO of its own. `ctx` (#215) is the only outside channel:
   *  cross-note rules read through it; local rules ignore it. */
  apply(content: string, config: Config, cache: ParseCache, ctx?: FormatContext): string;
}

/** A rule bound to its user-configured state for a single invocation. */
export interface EnabledRule<Config = unknown> {
  rule: FormatterRule<Config>;
  config: Config;
}

/** Per-file outcome of a batch format run. */
export interface FormatFileResult {
  relativePath: string;
  /** True when the content differs from disk after applying enabled rules. */
  changed: boolean;
  /** Original content (for callers that want to show a diff later). */
  before: string;
  /** Rewritten content. Equals `before` when no rule matched. */
  after: string;
  /** Other notes whose incoming `[[file#slug]]` links were rewritten when a heading slug changed. */
  cascadedPaths: string[];
}
