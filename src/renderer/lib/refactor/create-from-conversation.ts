/**
 * Plan a "Create note from conversation" operation (#177).
 *
 * Distinct from extract / split:
 *   - The source content isn't being rewritten; we're not splitting
 *     a note. We just write a new note with the given body.
 *   - Provenance lives in frontmatter (`source:` + `conversation:`)
 *     rather than as a wiki-link back-edit in the source note.
 *
 * Reuses the refactor settings (destination folder, filename
 * prefix) so the new note lands consistently with extract /
 * split-here output. When the conversation has no origin note, the
 * destination falls back to `root`.
 */

import {
  deriveProposedTitle,
  resolveDestinationFolder,
  renderFilenamePrefix,
  sanitizeFilename,
} from './extract';
import type { RefactorSettings } from './settings';
import { DEFAULT_REFACTOR_SETTINGS } from './settings';

export interface PlanCreateFromConversationOptions {
  /** Pre-resolved title for the new note (caller may have prompted). */
  title: string;
  /** Body text to land in the note — selection or last-assistant text. */
  body: string;
  /** Origin-note relativePath when the conversation has one; null
   *  for freeform conversations. Drives the destination folder via
   *  `same-folder` settings + the frontmatter `source:` field. */
  sourceRelativePath: string | null;
  /** Conversation id, recorded in frontmatter for traceability. */
  conversationId: string;
  /** YYYY-MM-DD for the frontmatter `created:` line. */
  today: string;
  settings?: RefactorSettings;
  now?: Date;
}

export interface CreateFromConversationPlan {
  newNotePath: string;
  newNoteContent: string;
}

export function planCreateFromConversation(opts: PlanCreateFromConversationOptions): CreateFromConversationPlan {
  const settings = opts.settings ?? DEFAULT_REFACTOR_SETTINGS;
  // Freeform conversations have no source — fall back to root
  // regardless of the destination setting, since `same-folder` has
  // no folder to copy from.
  const sourcePath = opts.sourceRelativePath ?? '';
  const dir = sourcePath
    ? resolveDestinationFolder(sourcePath, settings, opts.now)
    : '';
  const prefix = sourcePath ? renderFilenamePrefix(sourcePath, settings, opts.now) : '';
  const stem = `${prefix}${sanitizeFilename(opts.title) || `note-${Date.now()}`}`;
  const newNotePath = dir ? `${dir}/${stem}.md` : `${stem}.md`;

  const frontmatter = buildFrontmatter({
    title: opts.title,
    today: opts.today,
    sourceRelativePath: opts.sourceRelativePath,
    conversationId: opts.conversationId,
  });
  const trimmedBody = opts.body.replace(/^\s+|\s+$/g, '');
  const newNoteContent = `${frontmatter}${trimmedBody}\n`;
  return { newNotePath, newNoteContent };
}

interface FrontmatterArgs {
  title: string;
  today: string;
  sourceRelativePath: string | null;
  conversationId: string;
}

function buildFrontmatter(args: FrontmatterArgs): string {
  const lines = ['---'];
  lines.push(`title: ${yamlScalar(args.title)}`);
  lines.push(`created: ${args.today}`);
  if (args.sourceRelativePath) {
    lines.push(`source: ${yamlScalar(args.sourceRelativePath)}`);
  }
  lines.push(`conversation: ${yamlScalar(args.conversationId)}`);
  lines.push('---', '');
  return lines.join('\n') + '\n';
}

/**
 * Quote-and-escape a YAML scalar when it would otherwise be parsed
 * as something else (numbers, dates, booleans, anything with
 * special punctuation). Plain alphanumerics + a handful of safe
 * punctuation chars round-trip unquoted.
 */
export function yamlScalar(s: string): string {
  if (s === '') return '""';
  // Conservative: any character outside this set forces quoting.
  if (/^[A-Za-z0-9 _.\-/]+$/.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s) && !/^[+-]?\d+$/.test(s) && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }
  // Double-quoted with the standard JSON-escape set is safe.
  return JSON.stringify(s);
}

/**
 * Pick a default title for the new note. If the body has a leading
 * heading or a short first line, use that. Otherwise return null so
 * the host can prompt the user.
 *
 * Re-uses the existing `deriveProposedTitle` heuristic so titles
 * across extract / split-here / create-from-conversation stay
 * consistent.
 */
export function suggestConversationNoteTitle(body: string): string | null {
  return deriveProposedTitle(body);
}
