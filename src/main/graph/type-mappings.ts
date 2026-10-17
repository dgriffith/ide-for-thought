/**
 * Object types mapped onto a thoughtbase's own vocabularies (#2792).
 *
 * A type's `externalClass:` and a property's `predicate:` are CURIEs, resolved
 * against the standard prefixes and the imported vocabularies' (`resolveCurie`).
 * Two consequences live here, in their own module because both need the
 * rebuild and the vocabularies, which already import each other's neighbours:
 *
 * - **Importing or removing a vocabulary changes what types map to.** A
 *   property's predicate is baked in when a note is indexed and a type class's
 *   `rdfs:subClassOf` when the catalog is materialized, so a change to the
 *   prefix set that a type's CURIE depends on reindexes the thoughtbase. Most
 *   imports touch no type, and cost nothing more than they did.
 * - **A CURIE that resolves to nothing is reported**, beside the catalog's
 *   other problems, instead of the mapping silently not applying.
 */
import type { ProjectContext } from '../project-context-types';
import type { TypeCatalog, TypeLoadError } from '../../shared/objects/type-def';
import type { VocabularyStatus } from '../../shared/ontology-vocabularies';
import { STANDARD_PREFIXES, getState, resolveCurie } from './state';
import { indexAllNotes } from './indexers/rebuild';
import {
  commitVocabularyImport as commitImport,
  removeVocabulary as remove,
  syncVocabularies as sync,
  vocabularyPrefixes,
} from './user-ontology';

const STANDARD = new Set(STANDARD_PREFIXES.map(([p]) => p));

/** Every CURIE a catalog's types use, with what declares it. */
function typeCuries(catalog: TypeCatalog): Array<{ curie: string; type: TypeCatalog['types'][number]; where: string }> {
  const out: Array<{ curie: string; type: TypeCatalog['types'][number]; where: string }> = [];
  for (const t of catalog.types) {
    if (t.externalClass) out.push({ curie: t.externalClass, type: t, where: 'externalClass' });
    for (const p of t.properties) if (p.predicate) out.push({ curie: p.predicate, type: t, where: `property "${p.name}" predicate` });
  }
  return out;
}

const prefixOf = (curie: string) => (curie.includes(':') ? curie.slice(0, curie.indexOf(':')) : '');

/** Type mappings that don't apply: a CURIE with a prefix that's neither standard nor imported. */
export function typeMappingProblems(ctx: ProjectContext, catalog: TypeCatalog): TypeLoadError[] {
  const prefixes = vocabularyPrefixes(ctx);
  return typeCuries(catalog)
    .filter(({ curie }) => !resolveCurie(curie, prefixes))
    .map(({ curie, type, where }) => ({
      source: type.source,
      filePath: type.filePath,
      label: type.label,
      message: prefixOf(curie)
        ? `${where} "${curie}": "${prefixOf(curie)}:" isn't a standard prefix or one this thoughtbase imports (Settings → Ontology), so the mapping doesn't apply`
        : `${where} "${curie}" isn't a CURIE (prefix:term), so the mapping doesn't apply`,
    }));
}

/** Run a vocabulary change; reindex if a type's CURIE resolves differently after it. */
async function reindexingIfMappingsMove(ctx: ProjectContext, change: () => Promise<VocabularyStatus[]>): Promise<VocabularyStatus[]> {
  const key = () => JSON.stringify(vocabularyPrefixes(ctx).map((p) => [p.prefix, p.iri]).sort());
  const before = key();
  const statuses = await change();
  const state = getState(ctx);
  if (!state || key() === before) return statuses;
  const affected = typeCuries(state.typeCatalog).some(({ curie }) => !STANDARD.has(prefixOf(curie)) && prefixOf(curie) !== '');
  if (affected) await indexAllNotes(ctx);
  return statuses;
}

/** {@link sync}, reindexing when the prefixes a type maps onto changed. */
export function syncVocabularies(ctx: ProjectContext): Promise<VocabularyStatus[]> {
  return reindexingIfMappingsMove(ctx, () => sync(ctx));
}

/** {@link commitImport}, reindexing when the new prefixes complete a type's mapping. */
export function commitVocabularyImport(ctx: ProjectContext, id: string): Promise<VocabularyStatus[]> {
  return reindexingIfMappingsMove(ctx, () => commitImport(ctx, id));
}

/** {@link remove}, reindexing when a type's mapping loses its prefix. */
export function removeVocabulary(ctx: ProjectContext, file: string): Promise<VocabularyStatus[]> {
  return reindexingIfMappingsMove(ctx, () => remove(ctx, file));
}
