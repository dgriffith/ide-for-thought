/**
 * Graph write / indexing layer — a facade (#671, split by family in #1624/
 * #1905/#2050).
 *
 * Every indexer lives in `./indexers/<family>.ts`; this file exists so that
 * `./index` and the handful of call sites that `import … from './indexers'`
 * don't have to know which family a function belongs to. It carries no logic
 * of its own — the same shape `graph/queries.ts` reached for the read side.
 *
 * The families, and what makes each one a family:
 *   - `note`       — the per-note entry point (`indexNote`/`removeNote`):
 *                    dispatches `.ttl`/`.csv`/`.py` to `note-files`/`tables`,
 *                    and owns everything markdown-specific (frontmatter,
 *                    tags, wiki links, aliases, heading-rename detection)
 *   - `note-files` — non-markdown note formats (`.ttl`/`.csv`/`.py`)
 *   - `frontmatter`— frontmatter value → RDF conversion, used by `note`
 *   - `source`     — source metadata (`.minerva/sources/<id>/meta.ttl`)
 *   - `excerpt`    — excerpts lifted from a source (`.minerva/excerpts/<id>.ttl`)
 *   - `tables`     — in-note CSVW tables + the DuckDB overlay indexers
 *   - `rebuild`    — the full-tree rebuild orchestrator (`indexAllNotes`):
 *                    ontology bootstrap, type-catalog reload, and the
 *                    proposal-preservation dance a from-scratch reset needs
 *
 * All store-mutating entry points run through the LLM write guard
 * (`checkLLMWriteGuard`), enforced inside each family, not here.
 */

// Note indexing lives in `./indexers/note` (#2050). Re-exported here so
// `./index` and every `import … from './indexers'` caller is unchanged.
export {
  indexNote, removeNote,
  type IndexNoteOptions, type HeadingRenameCandidate,
} from './indexers/note';

// Full-tree rebuild orchestration lives in `./indexers/rebuild` (#2050).
export {
  indexAllNotes, reloadTypeCatalog, addOntologyToStore,
  type IndexAllNotesOptions,
} from './indexers/rebuild';

// Frontmatter value → RDF conversion lives in `./indexers/frontmatter`
// (#1905). `resolveFrontmatterPredicate` has no external caller today (kept
// for parity with the pre-#2050 surface); `declaredPropertyPredicate` is used
// by `./note-properties`.
export { resolveFrontmatterPredicate, declaredPropertyPredicate } from './indexers/frontmatter';
