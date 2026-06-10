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

/**
 * The query for the slash menu, or null when the composer isn't a slash-command
 * in progress. We only trigger when the *entire* composer is a single
 * `/token` (letters / digits / hyphen, no spaces or newlines) — so a `/` inside
 * a normal sentence, or once the user types past the command, doesn't pop the
 * menu. `/` alone yields an empty-string query (show everything).
 */
export function slashQueryFromComposer(text: string): string | null {
  const m = /^\/([\w-]*)$/.exec(text);
  return m ? m[1].toLowerCase() : null;
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
