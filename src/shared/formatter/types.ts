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

export interface FormatterRule<Config = unknown> {
  id: string;
  category: FormatterCategory;
  title: string;
  description: string;
  defaultConfig: Config;
  /** Pure, idempotent. Must not perform IO or mutate shared state. */
  apply(content: string, config: Config, cache: ParseCache): string;
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
