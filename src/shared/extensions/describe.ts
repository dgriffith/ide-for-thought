/**
 * What an agent reads about Minerva's extension points (#2619): one list and
 * one description per point, shared by the in-app LLM tools
 * (`llm/tools/extension-points.ts`) and `minerva mcp` (`src/cli/mcp.ts`), so an
 * external coding agent sees exactly what the in-app model sees — the same
 * descriptions and the same JSON.
 *
 * The descriptions lead with the ladder, cheapest rung first, so the answer to
 * "how do I…" starts with a setting or a skill, not a plugin or a source change.
 */
import { EXTENSION_POINTS, RUNGS, type ExtensionPoint, type Rung } from './points';

const LADDER =
  'Minerva is extended on a ladder, cheapest rung first: setting → skill → object-type → ' +
  'query-view (a saved query or note template) → plugin → mcp (an MCP server: code, out of ' +
  'process) → source (changing Minerva itself). Reach for the LOWEST rung that does the job — ' +
  'most "can Minerva do X?" answers are a skill or an object type, not code.';

export const LIST_EXTENSION_POINTS_DESCRIPTION =
  `List the extension points: the seams something can be added to Minerva through. ${LADDER} ` +
  'Each entry gives its id, rung, how a new contribution is picked up (load path) and a one-line ' +
  'description. Pass `rung` for one rung, or `open_only: true` for just the points that take a ' +
  'contribution today (the rest are `source` seams: built-ins only, until plugins load). ' +
  'Call describe_extension_point for one point\'s contract and links. Read-only.';

export const DESCRIBE_EXTENSION_POINT_DESCRIPTION =
  'Describe one extension point by id: its rung, its contract (the file format a contribution ' +
  'takes and the code that validates it, or for a source seam the registry built-ins register ' +
  'in), its load path, where contributions may come from and go, and links to its authoring docs, ' +
  'a worked example and its test harness. Links are paths in Minerva\'s source repository. ' +
  `${LADDER} Read-only.`;

/** The tools' input schemas — one copy, for both surfaces. */
export const LIST_EXTENSION_POINTS_SCHEMA = {
  type: 'object' as const,
  properties: {
    rung: { type: 'string', description: 'Optional: one rung — setting, skill, object-type, query-view, plugin, mcp, source.' },
    open_only: { type: 'boolean', description: 'Optional: only the points that take a contribution today.' },
  },
  // Filters only; called with no arguments it lists everything.
  required: [] as string[],
};

export const DESCRIBE_EXTENSION_POINT_SCHEMA = {
  type: 'object' as const,
  properties: { id: { type: 'string', description: 'The extension point id, from list_extension_points.' } },
  required: ['id'],
};

export interface ExtensionPointSummary {
  id: string;
  label: string;
  rung: Rung;
  loadPath: ExtensionPoint['loadPath'];
  description: string;
}

const POINTS = EXTENSION_POINTS as readonly ExtensionPoint[];

/** The list, optionally one rung's or only those open to contributions — ladder order. */
export function listExtensionPoints(filter: { rung?: string; openOnly?: boolean } = {}):
  { ok: true; points: ExtensionPointSummary[] } | { ok: false; error: string } {
  if (filter.rung !== undefined && !(RUNGS as readonly string[]).includes(filter.rung)) {
    return { ok: false, error: `Unknown rung "${filter.rung}". Rungs, cheapest first: ${RUNGS.join(', ')}.` };
  }
  const rank = (r: Rung) => RUNGS.indexOf(r);
  const points = POINTS
    .filter((p) => filter.rung === undefined || p.rung === filter.rung)
    .filter((p) => !filter.openOnly || p.rung !== 'source')
    .slice()
    .sort((a, b) => rank(a.rung) - rank(b.rung))
    .map(({ id, label, rung, loadPath, description }) => ({ id, label, rung, loadPath, description }));
  return { ok: true, points };
}

/** One point in full, or an error naming the ids there are. */
export function describeExtensionPoint(id: string):
  { ok: true; point: ExtensionPoint } | { ok: false; error: string } {
  const point = POINTS.find((p) => p.id === id);
  if (!point) {
    return { ok: false, error: `No extension point "${id}". Ids: ${POINTS.map((p) => p.id).join(', ')}.` };
  }
  return { ok: true, point };
}
