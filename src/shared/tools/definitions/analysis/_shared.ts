/**
 * Shared helpers for analysis ThinkingTools (#508 / #512 ports). Most
 * analysis tools have the same shape: take the active note's selection
 * (or whole body if nothing selected), append it to a system prompt
 * pulled from a sibling .prompt.md, fire a short "for X, do Y" first
 * message. Extracted here so per-tool files can stay 15-20 lines.
 *
 * If a tool needs a non-default shape (parameters, claim-under-cursor,
 * different framing), it should write its own builders inline rather
 * than try to extend these.
 */

import type { ToolContext } from '../../types';

/**
 * Append the source passage to a tool's system prompt body. Prefers a
 * non-empty selection over the whole-note content.
 */
export function analysisSourceBlock(ctx: ToolContext): string {
  const selected = ctx.selectedText?.trim();
  const full = ctx.fullNoteContent?.trim();
  if (selected) {
    return `\n\n## Selection\n\n${selected}`;
  }
  if (full) {
    const title = ctx.fullNoteTitle ? ` — ${ctx.fullNoteTitle}` : '';
    return `\n\n## Note${title}\n\n${full}`;
  }
  return '';
}

/**
 * Build a short first user-turn for an analysis tool. `verb` is the
 * tool's action phrase ("find the rhymes", "surface the assumptions",
 * "synthesize", etc.) — one short imperative.
 */
export function analysisFirstMessage(ctx: ToolContext, verb: string): string {
  const subject = ctx.selectedText?.trim() ? 'this selection' : 'this note';
  return `For ${subject}, ${verb}.`;
}
