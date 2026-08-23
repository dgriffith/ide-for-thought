/**
 * Graph read/query layer — a facade (#671, split by family in #1838).
 *
 * Every query lives in `./queries/<family>.ts`; this file exists so that
 * `graph/index` and the ~40 call sites that `import … from './queries'` don't
 * have to know which family a function belongs to. It carries no logic of its
 * own.
 *
 * The families, and what makes each one a family:
 *   - `tags`       — questions keyed by tag
 *   - `sources`    — questions about a source (detail, reading queue, citations)
 *   - `links`      — note-to-note edges, both directions
 *   - `references` — what points at a source / excerpt / anchor
 *   - `notes`      — a note's own identity: aliases, frontmatter keys, headings
 *   - `sparql`     — the engine surface: prefixes, completion schema, queryGraph
 *
 * The split is by QUESTION, not by table: `sources.ts` owns `listAllSources`
 * because it calls `collectSourceMetadata`, even though it sat among the tag
 * queries for years. Where a function goes is decided by what it needs, which
 * is why each extraction was checked in both directions before it moved.
 */

// Tag queries live in `./queries/tags` (#1838). Re-exported here so
// `graph/index` and every `import … from './queries'` caller is unchanged —
// the same facade shape `indexers.ts` uses for `./indexers/*`.
export {
  listTags,
  notesByTagPrefix,
  notesByTag,
  sourcesByTag,
  allTags,
} from './queries/tags';

// Source queries live in `./queries/sources` (#1838), same arrangement.
export {
  listAllSources,
  getSourceDetail,
  getReadingQueueSourceIds,
  sourcesByReadStatus,
  citationsForNote,
  getExcerptSource,
} from './queries/sources';

// `DAY_MS` moved with the reading-queue code that uses it; `llm/approval`
// imports it from here.
export { DAY_MS } from './queries/sources';
export type { ReadingQueueView } from './queries/sources';

// Link queries live in `./queries/links` (#1838), same arrangement.
export {
  noteTitle,
  sourceTitle,
  outgoingLinks,
  findDerivedNoteForCell,
  findNotesLinkingTo,
  backlinks,
  findExternalInboundLinks,
} from './queries/links';

// Note-identity lookups live in `./queries/notes` (#1838).
export {
  getAliasMap,
  aliasesForNote,
  getAliasEntries,
  getAllFrontmatterKeys,
  noteUriFor,
  headingsFor,
} from './queries/notes';
export type { AliasEntry } from './queries/notes';

// Reference lookups live in `./queries/references` (#1838).
export {
  findNotesCitingSource,
  findNotesQuotingExcerpt,
  termNotePaths,
  allNotePaths,
  findNotesLinkingToAnchor,
  findNotesLinkingToAnchorImpl,
} from './queries/references';

// SPARQL plumbing lives in `./queries/sparql` (#1838).
export {
  injectSparqlPrefixes,
  schemaForCompletion,
  queryGraph,
} from './queries/sparql';
export type { SchemaEntry, GraphSchema } from './queries/sparql';
