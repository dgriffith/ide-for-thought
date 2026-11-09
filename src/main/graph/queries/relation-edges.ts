/**
 * The edges between notes that aren't typed wiki-links (#2957, the graph's one
 * edge model): what `outgoingLinks` / `backlinks` leave to the graph.
 *
 * - **Argument relations** (`thought:supports`, `rebuts`, `challenges`, …) in
 *   both of their forms (#2230): a typed note's frontmatter (`supports:` on a
 *   Claim) relates two notes directly; a hand-written ```turtle block relates
 *   two claim nodes, which belong to the notes whose named graph describes
 *   them — the indexer parses a note's Turtle into the note's own graph. Either
 *   way the edge is drawn between the two notes. Indexed once per walk
 *   (`argumentEdgeIndex`): the relations are a handful of predicates, so one
 *   pass over them is cheaper than a scan per note.
 * - **Link properties and other frontmatter links** — a frontmatter value
 *   naming another note (`types:<property>` for a `link-to-type` property,
 *   else the key's own predicate): per note, out of it and into it
 *   (`frontmatterEdges`).
 * - **Tags** (`noteTags`) — the tags a note carries.
 *
 * Read-only; the walk (`neighborhood.ts`) gives each edge its kind through
 * `shared/graph/edge-kinds.ts`.
 */
import * as $rdf from 'rdflib';
import type { ProjectContext } from '../../project-context-types';
import { LINK_TYPES } from '../../../shared/link-types';
import { getState, MINERVA, DC, THOUGHT, noteUri, linkPredicate, stripFragment, type GraphState } from '../state';
import { inboundStatements } from './inbound-links';

/** An edge between two notes, by the predicate that made it. */
export interface RelationEdge {
  source: string;
  target: string;
  /** The predicate's IRI — its kind is `edgeKindForPredicate`'s. */
  predicate: string;
}

/** The `thought:` relations drawn as argument edges (supports and rebuts among them). */
const ARGUMENT_LOCALS = ['supports', 'rebuts', 'challenges', 'grounds', 'qualifies', 'refines', 'presupposes', 'exemplifies', 'contrasts'];
const ARGUMENT_PREDICATES = new Set(ARGUMENT_LOCALS.map((l) => THOUGHT(l).value));
/** Typed wiki-link predicates: the walk already has those from `outgoingLinks` / `backlinks`. */
const LINK_PREDICATES = new Set(LINK_TYPES.map((lt) => linkPredicate(lt).value));

/** The note `node` is, or belongs to: its own path, else the note whose graph describes it (a Turtle claim). */
function noteOf(state: GraphState, node: { termType: string; value: string }): string | null {
  if (node.termType !== 'NamedNode') return null;
  const own = noteFor(state, $rdf.sym(stripFragment(node.value)));
  if (own) return own;
  const described = state.store.statementsMatching(node as $rdf.NamedNode, undefined, undefined)[0];
  const graph = described?.why;
  return graph && graph.termType === 'NamedNode' ? noteFor(state, graph) : null;
}

/** The relative path of a note node, or null when it isn't a note (a folder, a tag, an image). */
function noteFor(state: GraphState, sym: $rdf.NamedNode): string | null {
  const p = state.store.statementsMatching(sym, MINERVA('relativePath'), undefined)[0]?.object.value;
  return p && p.endsWith('.md') ? p : null;
}

/**
 * Every argument edge between two notes, by note path (an edge listed under
 * both of its ends), in both forms — see the header. Self-edges (two claims in
 * one note) are dropped.
 */
export function argumentEdgeIndex(ctx: ProjectContext): Map<string, RelationEdge[]> {
  const state = getState(ctx);
  const index = new Map<string, RelationEdge[]>();
  if (!state) return index;
  const seen = new Set<string>();
  for (const local of ARGUMENT_LOCALS) {
    for (const st of state.store.statementsMatching(undefined, THOUGHT(local), undefined)) {
      const source = noteOf(state, st.subject);
      const target = noteOf(state, st.object);
      if (!source || !target || source === target) continue;
      const edge = { source, target, predicate: st.predicate.value };
      const key = `${source}\u0000${target}\u0000${edge.predicate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const end of [source, target]) {
        const list = index.get(end);
        if (list) list.push(edge); else index.set(end, [edge]);
      }
    }
  }
  return index;
}

/**
 * The frontmatter-made edges out of and into a note: a value naming another
 * note, under a `link-to-type` property's `types:` predicate or the key's own.
 * Typed wiki-links and argument relations are left to their own queries.
 */
export function frontmatterEdges(ctx: ProjectContext, relativePath: string): RelationEdge[] {
  const state = getState(ctx);
  if (!state) return [];
  const sym = noteUri(state, relativePath);
  const counts = (predicate: string) => !LINK_PREDICATES.has(predicate) && !ARGUMENT_PREDICATES.has(predicate);
  const out: RelationEdge[] = [];
  for (const st of state.store.statementsMatching(sym, undefined, undefined)) {
    if (!counts(st.predicate.value) || st.object.termType !== 'NamedNode') continue;
    const target = noteFor(state, $rdf.sym(stripFragment(st.object.value)));
    if (target && target !== relativePath) out.push({ source: relativePath, target, predicate: st.predicate.value });
  }
  for (const st of inboundStatements(state, sym)) {
    if (!counts(st.predicate.value) || st.subject.termType !== 'NamedNode') continue;
    const source = noteFor(state, st.subject);
    if (source && source !== relativePath) out.push({ source, target: relativePath, predicate: st.predicate.value });
  }
  return out;
}

/**
 * Every note's IRI, to its path (#2958): what the whole graph looks a target up
 * in, once, instead of asking the store per statement — 22,000 store lookups
 * for 2,000 notes took 5 s.
 */
export function noteIriIndex(ctx: ProjectContext, paths: readonly string[]): Map<string, string> {
  const state = getState(ctx);
  const index = new Map<string, string>();
  if (!state) return index;
  for (const p of paths) index.set(noteUri(state, p).value, p);
  return index;
}

/**
 * A note's outgoing frontmatter edges only, with targets looked up in `notes`
 * (`noteIriIndex`): the whole graph's form of `frontmatterEdges`, which finds
 * each edge once, from its source.
 */
export function frontmatterOutEdges(ctx: ProjectContext, relativePath: string, notes: ReadonlyMap<string, string>): RelationEdge[] {
  const state = getState(ctx);
  if (!state) return [];
  const out: RelationEdge[] = [];
  for (const st of state.store.statementsMatching(noteUri(state, relativePath), undefined, undefined)) {
    if (st.object.termType !== 'NamedNode' || LINK_PREDICATES.has(st.predicate.value) || ARGUMENT_PREDICATES.has(st.predicate.value)) continue;
    const target = notes.get(stripFragment(st.object.value));
    if (target && target !== relativePath) out.push({ source: relativePath, target, predicate: st.predicate.value });
  }
  return out;
}

/** The tags a note carries, by name. */
export function noteTags(ctx: ProjectContext, relativePath: string): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const names: string[] = [];
  for (const st of state.store.statementsMatching(noteUri(state, relativePath), MINERVA('hasTag'), undefined)) {
    const name = state.store.statementsMatching(st.object as $rdf.NamedNode, MINERVA('tagName'), undefined)[0]?.object.value;
    if (name) names.push(name);
  }
  return names;
}

/** A note's display title (`dc:title`), else its filename stem. */
export function titleOf(ctx: ProjectContext, relativePath: string): string {
  const state = getState(ctx);
  const stem = relativePath.replace(/\.md$/i, '').split('/').pop() ?? relativePath;
  if (!state) return stem;
  return state.store.statementsMatching(noteUri(state, relativePath), DC('title'), undefined)[0]?.object.value ?? stem;
}
