/**
 * Typed-property read-back (#1063). Projects a note's declared properties — the
 * schema of its type crossed with the values indexed on the note — for the
 * property form (#1066) and type-keyed renderers (#1071).
 *
 * A SPARQL projection over the instance: each declared property resolves to the
 * SAME predicate the indexer wrote it under (`resolveFrontmatterPredicate`), so
 * the read-back is robust to frontmatter-key aliasing (a Book's `author` and a
 * formatter-canonicalized `creator` both resolve to `dc:creator`). Declared-but-
 * empty properties come back with `value: null` so the form can show every field.
 */
import type { ProjectContext } from '../project-context-types';
import { getState } from './state';
import { noteUriFor, queryGraph } from './queries';
import { resolveFrontmatterPredicate } from './indexers';
import { toTypeInfo, type NoteTypedProperties } from '../../shared/objects/type-def';

export async function getNoteTypedProperties(
  ctx: ProjectContext,
  relativePath: string,
): Promise<NoteTypedProperties> {
  const state = getState(ctx);
  const noteIri = noteUriFor(ctx, relativePath);
  if (!state || !noteIri) return { type: null, properties: [] };

  // Resolve the note's type via its class edge (only domain classes carry
  // minerva:typeId, so this skips minerva:Note). First match wins.
  const { results: typeRows } = await queryGraph(
    ctx,
    `SELECT ?id WHERE { <${noteIri}> a ?c . ?c minerva:typeId ?id } LIMIT 1`,
  );
  const typeId = (typeRows as Array<{ id?: string }>)[0]?.id;
  const def = typeId ? state.typeCatalog.types.find((t) => t.id === typeId) : undefined;
  if (!def) return { type: null, properties: [] };

  // One pass over the note's predicate→value pairs, then map to declared props.
  const { results: rows } = await queryGraph(ctx, `SELECT ?p ?v WHERE { <${noteIri}> ?p ?v }`);
  const byPredicate = new Map<string, string>();
  for (const r of rows as Array<{ p?: string; v?: string }>) {
    if (r.p && r.v !== undefined && !byPredicate.has(r.p)) byPredicate.set(r.p, r.v);
  }

  const properties = def.properties.map((pd) => ({
    name: pd.name,
    type: pd.type,
    label: pd.label,
    options: pd.options,
    targetType: pd.targetType,
    value: byPredicate.get(resolveFrontmatterPredicate(pd.name).value) ?? null,
  }));

  return { type: toTypeInfo(def), properties };
}
