/**
 * Tag queries (#1838 — split by family out of `queries.ts`).
 *
 * Everything that answers a question keyed by TAG: the project-wide tag list
 * with its counts, the notes and sources carrying a given tag, the prefix
 * ("at or under this branch") variant the tag tree's parent rows need, and the
 * bare vocabulary.
 *
 * Read-only, like the rest of the query side: these walk the per-project store
 * from `../state` and never mutate it. `queries.ts` re-exports them, so
 * `import * as graph from './graph/index'` callers are unchanged.
 *
 * Note what is deliberately NOT here: `listAllSources` sits between these
 * functions in the old file but is a source query, not a tag one — it calls
 * `collectSourceMetadata` and belongs with the source-detail family when that
 * moves.
 */
import type * as $rdf from 'rdflib';
import type { ProjectContext } from '../../project-context-types';
import type { TagInfo, TaggedNote, TaggedSource } from '../../../shared/types';
import { getState, MINERVA, RDF, DC, tagUri } from '../state';

export function listTags(ctx: ProjectContext): TagInfo[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  // Bucket per tag-name into note vs source counts. A subject is a
  // source when it carries minerva:sourceId; otherwise we treat the
  // hasTag edge as belonging to a note (this matches what notesByTag
  // returns once the rdf:type filter has been applied).
  const buckets = new Map<string, { noteCount: number; sourceCount: number }>();
  const stmts = store.statementsMatching(undefined, MINERVA('hasTag'), undefined);
  for (const st of stmts) {
    const tagNode = st.object;
    const nameStmts = store.statementsMatching(tagNode as $rdf.NamedNode, MINERVA('tagName'), undefined);
    const name = nameStmts[0]?.object.value ?? tagNode.value;
    let bucket = buckets.get(name);
    if (!bucket) {
      bucket = { noteCount: 0, sourceCount: 0 };
      buckets.set(name, bucket);
    }
    const isSource = store.statementsMatching(st.subject, MINERVA('sourceId'), undefined).length > 0;
    if (isSource) bucket.sourceCount++;
    else bucket.noteCount++;
  }

  return [...buckets.entries()]
    .map(([tag, b]) => ({ tag, noteCount: b.noteCount, sourceCount: b.sourceCount }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * Notes with any tag at-or-under `prefix` (#466). Matches the literal
 * `prefix` and any tag that starts with `prefix/…` so clicking a
 * parent row in the tree returns the same set the cumulative count
 * promised. Deduped by relativePath since one note can carry multiple
 * matching tags.
 */
export function notesByTagPrefix(ctx: ProjectContext, prefix: string): TaggedNote[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const seen = new Map<string, TaggedNote>();
  const tagStmts = store.statementsMatching(undefined, MINERVA('hasTag'), undefined);
  for (const tagStmt of tagStmts) {
    const tagNode = tagStmt.object as $rdf.NamedNode;
    const nameStmts = store.statementsMatching(tagNode, MINERVA('tagName'), undefined);
    const name = nameStmts[0]?.object.value;
    if (!name) continue;
    if (name !== prefix && !name.startsWith(`${prefix}/`)) continue;
    const subject = tagStmt.subject;
    const isNote = store.statementsMatching(subject, RDF('type'), MINERVA('Note')).length > 0;
    if (!isNote) continue;
    const pathStmts = store.statementsMatching(subject, MINERVA('relativePath'), undefined);
    const relativePath = pathStmts[0]?.object.value ?? '';
    if (!relativePath || seen.has(relativePath)) continue;
    const titleStmts = store.statementsMatching(subject, DC('title'), undefined);
    seen.set(relativePath, {
      title: titleStmts[0]?.object.value ?? subject.value,
      relativePath,
    });
  }
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function notesByTag(ctx: ProjectContext, tag: string): TaggedNote[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const tagNode = tagUri(state, tag);
  const stmts = store.statementsMatching(undefined, MINERVA('hasTag'), tagNode);
  return stmts.flatMap((st) => {
    const subject = st.subject;
    // Sources also carry hasTag edges (body.md tags); filter them out —
    // sourcesByTag handles those.
    const isNote = store.statementsMatching(subject, RDF('type'), MINERVA('Note')).length > 0;
    if (!isNote) return [];
    const titleStmts = store.statementsMatching(subject, DC('title'), undefined);
    const pathStmts = store.statementsMatching(subject, MINERVA('relativePath'), undefined);
    const relativePath = pathStmts[0]?.object.value ?? '';
    if (!relativePath) return [];
    return [{
      title: titleStmts[0]?.object.value ?? subject.value,
      relativePath,
    }];
  });
}

export function sourcesByTag(ctx: ProjectContext, tag: string): TaggedSource[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const tagNode = tagUri(state, tag);
  const stmts = store.statementsMatching(undefined, MINERVA('hasTag'), tagNode);
  return stmts.flatMap((st) => {
    const subject = st.subject;
    const idStmts = store.statementsMatching(subject, MINERVA('sourceId'), undefined);
    const sourceId = idStmts[0]?.object.value;
    if (!sourceId) return [];
    const titleStmts = store.statementsMatching(subject, DC('title'), undefined);
    return [{
      sourceId,
      title: titleStmts[0]?.object.value ?? sourceId,
    }];
  });
}

export function allTags(ctx: ProjectContext): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;
  const tags = new Set<string>();
  const stmts = store.statementsMatching(undefined, RDF('type'), MINERVA('Tag'));
  for (const st of stmts) {
    const nameStmts = store.statementsMatching(st.subject, MINERVA('tagName'), undefined);
    if (nameStmts[0]) {
      tags.add(nameStmts[0].object.value);
    }
  }
  return [...tags].sort();
}
