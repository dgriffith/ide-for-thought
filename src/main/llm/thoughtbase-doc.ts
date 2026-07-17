/**
 * `thoughtbase.md` — the thoughtbase's own guide.
 *
 * A user-authored, plain-English file at the project root describing the
 * thoughtbase's structure, intent, and conventions — analogous to CLAUDE.md for
 * Claude Code. When present, its contents are injected into every conversation's
 * system prompt so the assistant understands how this thoughtbase is organized
 * and how the user wants it worked within. Entirely opt-in: no file, no effect.
 */
import * as notebaseFs from '../notebase/fs';
import { THOUGHTBASE_DOC_FILENAME } from '../../shared/thoughtbase';

export { THOUGHTBASE_DOC_FILENAME };

/**
 * Read `thoughtbase.md` from the project root. Returns the trimmed contents, or
 * `null` when the file is absent, empty/whitespace, or unreadable. Read fresh on
 * each conversation turn so a user's edits take effect on their next message.
 */
export async function readThoughtbaseDoc(rootPath: string): Promise<string | null> {
  try {
    const content = (await notebaseFs.readFile(rootPath, THOUGHTBASE_DOC_FILENAME)).trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

/**
 * Format the thoughtbase doc as a labeled system-prompt block, or `''` when
 * there's nothing to inject. Kept pure (no I/O) so the prompt wording is
 * unit-testable independent of the filesystem read.
 */
export function thoughtbaseDocPromptBlock(doc: string | null): string {
  if (!doc) return '';
  return [
    `The following is this thoughtbase's own guide (${THOUGHTBASE_DOC_FILENAME}), written by the user to describe its structure, intent, and conventions. Treat it as authoritative context for how this thoughtbase is organized and how the user wants you to work within it:`,
    '',
    doc,
  ].join('\n');
}
