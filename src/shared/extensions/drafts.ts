/**
 * A drafted extension the assistant hands the user (#2652): a skill, or a
 * plugin folder, shown as a card in the conversation. Nothing is written until
 * the user picks what to do with it, and then main does the writing, from the
 * copy it kept when the tool ran, never from anything the renderer sends back.
 *
 * Paths here are relative to the draft itself (the skill's file, or the
 * plugin's folder), never to the thoughtbase. They're checked by
 * `draftPathProblem` before the card is shown, and again where main writes.
 */

export const EXTENSION_DRAFT_KINDS = ['skill', 'plugin'] as const;
export type ExtensionDraftKind = (typeof EXTENSION_DRAFT_KINDS)[number];

export const EXTENSION_DRAFT_LIMITS = { files: 40, fileBytes: 64 * 1024, totalBytes: 512 * 1024, summary: 600 } as const;

export interface ExtensionDraftFile {
  path: string;
  content: string;
}

/** What the card shows: main → renderer when `offer_extension_draft` runs. */
export interface ExtensionDraftOffer {
  offerId: string;
  conversationId: string;
  kind: ExtensionDraftKind;
  /** The skill's or the plugin's id. */
  id: string;
  name: string;
  summary: string;
  files: ExtensionDraftFile[];
  /** A plugin's MCP servers by key: installing runs none of them. */
  mcpServers?: string[];
}

/**
 * What the user can do with a draft:
 * - `save`: a skill into `~/.minerva/skills/`, a plugin installed (checked
 *   whole, as Settings → Plugins does; its MCP servers stay off);
 * - `save-folder`: write it into a folder the user picks in a native dialog;
 * - `dismiss`: neither.
 */
export type ExtensionDraftAction = 'save' | 'save-folder' | 'dismiss';

/**
 * How an action went. A failed save leaves the card up, saying why, so the
 * user can save it to a folder instead; a cancelled folder picker too.
 */
export type ExtensionDraftActionResult =
  | { ok: true; action: ExtensionDraftAction; where?: string }
  | { ok: false; error: string }
  | { ok: false; cancelled: true };

/** How the card ended, as the model is told. */
export type ExtensionDraftOutcome =
  | { kind: 'saved'; where: string }
  | { kind: 'saved-folder'; where: string }
  | { kind: 'dismissed' }
  /** The turn was stopped, or the window closed, before the user chose. */
  | { kind: 'cancelled' }
  | { kind: 'no-ui' };

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * Why `written` can't be a path inside a draft, or null when it can: relative,
 * `/`-separated, each segment plain (letters, digits, `.`, `_`, `-`, not
 * starting with `.` or `-`), so no `..`, no hidden file, no absolute path and
 * no backslash.
 */
export function draftPathProblem(written: string): string | null {
  if (typeof written !== 'string' || written.length === 0) return 'A file needs a path.';
  if (written.length > 200) return `"${written.slice(0, 40)}…" is too long for a path.`;
  const segments = written.split('/');
  if (segments.length > 6 || !segments.every((s) => SEGMENT.test(s))) {
    return `"${written}" must be a relative path of plain names (letters, digits, ".", "_", "-"), with "/" between them.`;
  }
  return null;
}
