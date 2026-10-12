/**
 * A declarative health check (#2627, epic #2622): a SPARQL query and a message
 * template. Each result row is one finding.
 *
 * This is the form a plugin will contribute a check in (#2615): data, not
 * code — the query runs read-only through the graph's own `queryGraphRows`,
 * with the standard prefixes injected, and the templates only interpolate
 * the row's bound values. (SHACL shapes are the later step.)
 *
 * `{{var}}` in `message` / `suggestedAction` is replaced by the row's `?var`;
 * an unbound variable renders as the empty string.
 */
import type { Inspection, InspectionType } from '../../shared/inspections';
import { INSPECTIONS } from '../../shared/inspections';

export interface SparqlCheckDef {
  kind: 'sparql';
  /** The catalog type every finding gets; its severity comes from the catalog. */
  type: InspectionType;
  /** A SELECT. Prefixes are injected; omit the PREFIX lines. */
  query: string;
  /** The variable naming the node a finding is about (`Inspection.nodeUri`). */
  subject: string;
  /** The variable holding its display label (`Inspection.nodeLabel`). */
  label: string;
  /** The variable holding the note's relative path, when the node lives in one. */
  notePath?: string;
  message: string;
  suggestedAction?: string;
}

/** Fill `{{var}}` slots from a result row. */
export function fillTemplate(template: string, row: Record<string, string | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => row[name] ?? '');
}

/** Turn a query's rows into findings. */
export function findingsFromRows(def: SparqlCheckDef, rows: Array<Record<string, string | undefined>>): Inspection[] {
  const severity = INSPECTIONS.find((i) => i.type === def.type)!.severity;
  return rows.map((row, i) => {
    const notePath = def.notePath ? row[def.notePath] : undefined;
    return {
      id: `${def.type}-${i}`,
      type: def.type,
      severity,
      nodeUri: row[def.subject] ?? '',
      nodeLabel: row[def.label] ?? '',
      message: fillTemplate(def.message, row),
      ...(def.suggestedAction ? { suggestedAction: fillTemplate(def.suggestedAction, row) } : {}),
      ...(notePath ? { notePath } : {}),
    };
  });
}

/** Run a declarative check: its query through `query`, its rows into findings. */
export async function runSparqlCheck(
  def: SparqlCheckDef,
  query: (sparql: string) => Promise<Array<Record<string, string | undefined>>>,
): Promise<Inspection[]> {
  return findingsFromRows(def, await query(def.query));
}
