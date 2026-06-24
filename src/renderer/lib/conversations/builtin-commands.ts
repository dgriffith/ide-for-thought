/**
 * Reserved built-in slash commands for the conversation composer (#822).
 *
 * The composer's `/` menu historically resolved a token only against the skill
 * registry. `/clear` and `/compact` are app-level conversation operations, not
 * skills, so they need a router that resolves *before* skill lookup. This
 * module is the data + pure matching for that layer; the panel wires selection
 * to a handler (the handlers themselves land in #823 / #824).
 *
 * `available: false` keeps a command's *name reserved* (a user skill can never
 * shadow it — see `slash-commands.ts`) while keeping it *out of the menu* until
 * its handler ships. #823 flips `clear`; #824 flips `compact`.
 */

export interface BuiltinCommand {
  /** Bare name without the leading slash, e.g. `clear`. Lowercase. */
  name: string;
  /** Display form, e.g. `/clear`. */
  slashCommand: string;
  /** One-line description shown in the slash menu. */
  description: string;
  /** Whether the handler is wired yet. Unavailable commands stay reserved
   *  (no skill can claim the name) but don't appear in the menu. */
  available: boolean;
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  {
    name: 'clear',
    slashCommand: '/clear',
    description: 'Archive this conversation and start a fresh one',
    available: true,
  },
  {
    name: 'compact',
    slashCommand: '/compact',
    description: 'Summarize earlier turns to shorten a long thread',
    available: false,
  },
];

/**
 * Every reserved built-in name — including not-yet-available ones — so a user
 * skill with a colliding `slashCommand` can't claim the name before its handler
 * ships. Built-in always wins.
 */
export const RESERVED_BUILTIN_NAMES: ReadonlySet<string> = new Set(
  BUILTIN_COMMANDS.map((c) => c.name),
);

/**
 * Filter + rank the *available* built-ins for a slash query. Same ranking shape
 * as the skill filter (prefix < substring), ties broken alphabetically, so the
 * merged menu sorts predictably. `query === ''` (bare `/`) shows them all.
 */
export function filterBuiltinCommands(query: string): BuiltinCommand[] {
  const q = query.toLowerCase();
  const scored: { cmd: BuiltinCommand; rank: number }[] = [];
  for (const cmd of BUILTIN_COMMANDS) {
    if (!cmd.available) continue;
    let rank: number;
    if (q === '') rank = 2;
    else if (cmd.name.startsWith(q)) rank = 0;
    else if (cmd.name.includes(q)) rank = 1;
    else continue;
    scored.push({ cmd, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.cmd.name.localeCompare(b.cmd.name));
  return scored.map((s) => s.cmd);
}
