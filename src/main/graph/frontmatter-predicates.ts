/**
 * Well-known frontmatter keys → canonical predicate IRIs.
 *
 * Users can write `author: Alice Smith` and have it land as `dc:creator`
 * instead of `minerva:meta-author`. Keys not in this map fall through to
 * `minerva:meta-<key>` the way they always did.
 *
 * Both the canonical key (e.g. `creator`) and common aliases (`author`,
 * `authors`) map to the same predicate so users aren't penalized for
 * minor spelling differences.
 */

export type FrontmatterNamespace = 'dc' | 'bibo' | 'schema' | 'thought' | 'prov';

export interface FrontmatterPredicate {
  ns: FrontmatterNamespace;
  local: string;
}

const DC = (local: string): FrontmatterPredicate => ({ ns: 'dc', local });
const BIBO = (local: string): FrontmatterPredicate => ({ ns: 'bibo', local });
const SCHEMA = (local: string): FrontmatterPredicate => ({ ns: 'schema', local });
const THOUGHT = (local: string): FrontmatterPredicate => ({ ns: 'thought', local });
const PROV = (local: string): FrontmatterPredicate => ({ ns: 'prov', local });

const MAP: Record<string, FrontmatterPredicate> = {
  // Dublin Core
  title: DC('title'),
  creator: DC('creator'),
  author: DC('creator'),
  authors: DC('creator'),
  description: DC('description'),
  abstract: DC('abstract'),
  publisher: DC('publisher'),
  language: DC('language'),
  lang: DC('language'),
  subject: DC('subject'),
  created: DC('created'),
  modified: DC('modified'),
  issued: DC('issued'),
  date: DC('issued'),
  year: DC('issued'),

  // BIBO (bibliographic)
  doi: BIBO('doi'),
  isbn: BIBO('isbn'),
  uri: BIBO('uri'),
  url: BIBO('uri'),
  pages: BIBO('pages'),
  pageRange: BIBO('pages'),
  volume: BIBO('volume'),
  issue: BIBO('issue'),
  numPages: BIBO('numPages'),

  // schema.org
  inContainer: SCHEMA('inContainer'),

  // thought:* (source-specific bits we define)
  accessedAt: THOUGHT('accessedAt'),
  archivedAt: THOUGHT('archivedAt'),
  // Argumentation predicates — surface in research-tool analysis notes
  // so a note like `supports: <claim-uri>` materialises a
  // thought:supports edge from the analysis note to the claim node.
  supports: THOUGHT('supports'),
  rebuts: THOUGHT('rebuts'),
  // Decompose-into-Claims surface (#408): claim notes carry these
  // frontmatter keys so the indexer materialises proper thought:*
  // edges without a separate triples payload. Kebab-case keys are
  // canonical; the camelCase aliases mirror existing convention.
  'claim-kind': THOUGHT('claimKind'),
  claimKind: THOUGHT('claimKind'),
  'source-text': THOUGHT('sourceText'),
  sourceText: THOUGHT('sourceText'),
  'extracted-by': THOUGHT('extractedBy'),
  extractedBy: THOUGHT('extractedBy'),
  'extracted-from': THOUGHT('extractedFrom'),
  extractedFrom: THOUGHT('extractedFrom'),
  // Parent decomposition note → source note. Lets queries surface
  // every decomposition the user has filed for a given passage.
  decomposes: THOUGHT('decomposes'),

  // prov:* (provenance — #244 derived notes)
  derived_from: PROV('wasDerivedFrom'),
  derived_at: PROV('generatedAtTime'),
  derived_from_cell: THOUGHT('derivedFromCell'),
};

export function mapFrontmatterKey(key: string): FrontmatterPredicate | null {
  return MAP[key] ?? null;
}
