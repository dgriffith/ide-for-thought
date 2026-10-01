/**
 * Fill a typed note's `{{prop}}` placeholders from its own frontmatter
 * (#2491, #2492) — the main-side entry point for writes the app makes on a
 * note's behalf: an approved `set_properties` and an LLM-drafted typed note.
 *
 * The type is read from the CONTENT, not the indexed graph, so an update that
 * sets `type:` and a property together fills against the new type. The rule
 * itself is `shared/objects/property-placeholders.ts`, shared with the
 * renderer's Properties panel so the three paths can't disagree.
 */
import { loadTypeCatalog } from './loader';
import { effectivePropertyDefs } from '../../shared/objects/inheritance';
import { fillNoteWithReport, noteTypeId } from '../../shared/objects/property-placeholders';

export async function fillTypedNotePlaceholders(
  rootPath: string,
  content: string,
): Promise<{ content: string; filled: string[] }> {
  const typeId = noteTypeId(content);
  if (!typeId || !content.includes('{{')) return { content, filled: [] };
  const catalog = await loadTypeCatalog(rootPath);
  const byId = new Map(catalog.types.map((t) => [t.id, t]));
  if (!byId.has(typeId)) return { content, filled: [] };
  return fillNoteWithReport(content, effectivePropertyDefs(typeId, byId).map((p) => p.name));
}
