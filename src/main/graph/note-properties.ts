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
import {
  toTypeInfo,
  type NoteTypedProperties,
  type TypeInstancesResult,
  type TypeInstanceRow,
} from '../../shared/objects/type-def';

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

/**
 * Project every instance of a type with its declared-property values (#1070) —
 * the data behind the list/table/gallery multi-view. One SPARQL pass: each
 * declared property becomes an OPTIONAL column bound through the SAME predicate
 * the indexer wrote it under (`resolveFrontmatterPredicate`), so read-back is
 * robust to frontmatter-key aliasing, exactly like the single-note read-back.
 *
 * First row wins per note (a multi-valued frontmatter key can yield >1 binding);
 * mirrors `getNoteTypedProperties`' first-match-wins. No approval/write path —
 * a pure read over the already-indexed graph.
 */
export async function getTypeInstances(
  ctx: ProjectContext,
  typeId: string,
): Promise<TypeInstancesResult> {
  const state = getState(ctx);
  if (!state) return { type: null, instances: [] };
  const def = state.typeCatalog.types.find((t) => t.id === typeId);
  if (!def) return { type: null, instances: [] };

  // A stable column alias per declared property (?c0, ?c1, …) avoids clashes
  // when two properties happen to resolve to the same predicate IRI.
  const cols = def.properties.map((pd, i) => ({
    pd,
    alias: `c${i}`,
    predicate: resolveFrontmatterPredicate(pd.name).value,
  }));
  const optionals = cols
    .map((c) => `OPTIONAL { ?n <${c.predicate}> ?${c.alias} }`)
    .join('\n     ');
  const selectCols = cols.map((c) => `?${c.alias}`).join(' ');

  const { results } = await queryGraph(
    ctx,
    `SELECT ?path ?title ${selectCols} WHERE {
       ?n a types:${def.classLocalName} ; minerva:relativePath ?path .
       OPTIONAL { ?n dc:title ?title }
       ${optionals}
     } ORDER BY LCASE(?title) ?path`,
  );

  const seen = new Set<string>();
  const instances: TypeInstanceRow[] = [];
  for (const raw of results as Array<Record<string, string | undefined>>) {
    const path = raw.path;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const values: Record<string, string | null> = {};
    for (const c of cols) values[c.pd.name] = raw[c.alias] ?? null;
    instances.push({
      path,
      title: raw.title ?? (path.replace(/\.md$/i, '').split('/').pop() ?? path),
      values,
      cover: def.cover ? values[def.cover] ?? null : null,
    });
  }

  return { type: toTypeInfo(def), instances };
}
