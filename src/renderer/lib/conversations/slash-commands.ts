/**
 * Slash-command launcher logic for the conversation composer (#648).
 *
 * The data layer already exists — `getSlashCommands()` returns the skills that
 * declared a `slashCommand`. These pure helpers decide when the `/` menu opens
 * (the composer holds a single leading slash-token) and how the list filters /
 * ranks against what's typed, so the panel wiring stays declarative and the
 * matching is unit-testable without a DOM.
 */

import type { ThinkingToolInfo } from '../../../shared/tools/types';
import { isSourceScoped } from '../../../shared/tools/types';
import {
  filterBuiltinCommands,
  RESERVED_BUILTIN_NAMES,
  type BuiltinCommand,
} from './builtin-commands';

/**
 * The query for the slash menu, or null when the composer isn't a slash-command
 * in progress. We only trigger when the *entire* composer is a single
 * `/token` (letters / digits / hyphen, no spaces or newlines) — so a `/` inside
 * a normal sentence, or once the user types past the command, doesn't pop the
 * menu. `/` alone yields an empty-string query (show everything).
 */
export function slashQueryFromComposer(text: string): string | null {
  const m = /^\/([\w-]*)$/.exec(text);
  return m ? m[1]!.toLowerCase() : null;
}

/** Bare command name (no leading slash), lowercased. */
function commandKey(info: ThinkingToolInfo): string {
  return (info.slashCommand ?? '').replace(/^\//, '').toLowerCase();
}

/**
 * Filter + rank slash-command skills for a query. Source-scoped skills (#103)
 * are excluded — they need an active source, not a conversation. Ranking:
 * command-prefix matches first, then command-substring, then name matches;
 * ties broken alphabetically by command so the list is stable.
 */
export function filterSlashCommands(
  items: ThinkingToolInfo[],
  query: string,
): ThinkingToolInfo[] {
  const q = query.toLowerCase();
  const scored: { info: ThinkingToolInfo; rank: number; key: string }[] = [];
  for (const info of items) {
    if (isSourceScoped(info)) continue;
    const key = commandKey(info);
    if (!key) continue;
    // A built-in command name is reserved — a user skill can never shadow it
    // (#822). Drop the colliding skill from the slash menu; the built-in wins.
    if (RESERVED_BUILTIN_NAMES.has(key)) continue;
    const name = info.name.toLowerCase();
    let rank: number;
    if (q === '') rank = 3;
    else if (key.startsWith(q)) rank = 0;
    else if (key.includes(q)) rank = 1;
    else if (name.includes(q)) rank = 2;
    else continue;
    scored.push({ info, rank, key });
  }
  scored.sort((a, b) => (a.rank - b.rank) || a.key.localeCompare(b.key));
  return scored.map((s) => s.info);
}

/**
 * A row in the composer slash menu — either a reserved built-in command or a
 * skill. The panel renders both uniformly and dispatches on `kind`: built-ins
 * route to their app-level handler, skills invoke as before (#822).
 */
export type SlashMenuItem =
  | { kind: 'builtin'; command: BuiltinCommand }
  | { kind: 'skill'; tool: ThinkingToolInfo };

/**
 * Build the full slash menu for a query: available built-ins first (so they're
 * discoverable and unambiguous), then matching skills with reserved names
 * already excluded. Ranking within each group is preserved from the underlying
 * filters; built-ins always sort ahead of skills.
 */
export function buildSlashMenu(skills: ThinkingToolInfo[], query: string): SlashMenuItem[] {
  const builtins: SlashMenuItem[] = filterBuiltinCommands(query).map((command) => ({
    kind: 'builtin',
    command,
  }));
  const skillItems: SlashMenuItem[] = filterSlashCommands(skills, query).map((tool) => ({
    kind: 'skill',
    tool,
  }));
  return [...builtins, ...skillItems];
}
