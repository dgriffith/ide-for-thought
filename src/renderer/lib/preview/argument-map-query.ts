/**
 * Pure query-building + transform logic for the `:::argument` embed (#907).
 * No DOM, no `api.*` calls — `ArgumentMap.svelte` / `argument-map-renderer.ts`
 * own the IPC + mounting; this module is the part worth unit-testing without
 * either. Mirrors the split `compute-output-sanitize.ts` / `html-preview-csp.ts`
 * already use for the same reason.
 *
 * Traversal strategy: N sequential 1-hop queries (one per depth level), not a
 * SPARQL 1.1 property path. Comunica (the engine behind `api.graph.query`,
 * see `src/main/graph/state.ts`) almost certainly supports property paths,
 * but nothing in this codebase has exercised one yet — every existing SPARQL
 * string here (see `src/main/graph/health-checks.ts`) is a flat
 * `?x predicate ?y` triple pattern. A 1-hop-at-a-time query keeps the same
 * proven shape, gives free per-node hop distance (no separate BFS pass
 * needed), and bounds cleanly: `MAX_DEPTH` queries total, ever, regardless of
 * how deep the user's slider goes within that bound.
 *
 * Relation directionality (confirmed against `health-checks.ts`'s
 * `checkEvidenceGaps`): the SUBJECT is the supporting/attacking component,
 * the OBJECT is what it supports/attacks — `?grounds thought:supports ?claim`,
 * not the reverse. So finding "what argues FOR/AGAINST this claim" means
 * querying incoming edges: `?node <relation> ?claim`.
 */

import { WIKI_LINK_RE, parseWikiInner } from '../../../shared/wiki-link';

/** Relation predicates (local names, `thought:` prefix implied) this embed
 *  traverses. Deliberately the full set the issue names, not a curated
 *  subset — an edge in an unclassified relation still renders (as "other"),
 *  it just doesn't get support/attack/qualify coloring. */
export const SUPPORT_RELATIONS = ['supports', 'grounds', 'corroborates', 'presupposes', 'refines'] as const;
export const ATTACK_RELATIONS = ['challenges', 'rebuts', 'contradicts'] as const;
export const QUALIFY_RELATIONS = ['qualifies'] as const;
export const ALL_RELATIONS = [...SUPPORT_RELATIONS, ...ATTACK_RELATIONS, ...QUALIFY_RELATIONS] as const;

export type RelationKind = 'support' | 'attack' | 'qualify' | 'other';

export function classifyRelation(relation: string): RelationKind {
  if ((SUPPORT_RELATIONS as readonly string[]).includes(relation)) return 'support';
  if ((ATTACK_RELATIONS as readonly string[]).includes(relation)) return 'attack';
  if ((QUALIFY_RELATIONS as readonly string[]).includes(relation)) return 'qualify';
  return 'other';
}

/** Toulmin role classes worth labeling a node with when present — a node
 *  need not carry one of these (most don't, today — see module doc on
 *  `ArgumentMap.svelte`); the relation alone is enough to place it. */
const ROLE_TYPES = ['Grounds', 'Warrant', 'Backing', 'Qualifier', 'Rebuttal', 'Claim'] as const;

export const MAX_DEPTH = 4;

/** SPARQL string-literal escaping (backslash and double-quote) — the
 *  interpolated value here is a user's note path, not a query the user
 *  wrote, but it costs nothing to not be the one unescaped interpolation
 *  in this codebase's SPARQL call sites. */
function escapeSparqlLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Extract the bare wiki-link target from a `:::argument` directive body —
 *  `[[Some Claim]]`, `[[notes/claim.md]]`, `[[Some Claim|display]]`. Returns
 *  null when the body has no wiki-link at all (a plain path/URI is not
 *  supported in v1 — every claim IS a note, so a wiki-link is always
 *  available). Only the first link in the body is used. */
export function parseFocusRef(body: string): string | null {
  WIKI_LINK_RE.lastIndex = 0;
  const match = WIKI_LINK_RE.exec(body);
  if (!match) return null;
  return parseWikiInner(match[1]!).target;
}

/** Resolve a note's relativePath to its graph URI + label. One row expected;
 *  `dc:title` and `thought:label` are both optional-bound; `labelFor` below
 *  prefers `thought:label` when present (the ontology's apparent intent for
 *  a thought-component's canonical display label) and falls back to
 *  `dc:title` — which is what `propose_claims`-authored claims actually
 *  carry today (frontmatter `title:` → `dc:title`; nothing sets
 *  `thought:label` yet). */
export function buildFocusQuery(relativePath: string): string {
  const path = escapeSparqlLiteral(relativePath);
  return `SELECT ?focus ?title ?label WHERE {
  ?focus minerva:relativePath "${path}" .
  OPTIONAL { ?focus dc:title ?title }
  OPTIONAL { ?focus thought:label ?label }
} LIMIT 1`;
}

export interface FocusRow {
  focus?: string;
  title?: string;
  label?: string;
}

export function labelFor(row: { title?: string; label?: string }, fallback: string): string {
  return row.label || row.title || fallback;
}

/** One hop's query: every node in `frontier` that ANY node points an argued
 *  relation at. `frontier` is the set of node URIs discovered at the
 *  previous depth (the focus itself for hop 1). */
export function buildHopQuery(frontier: readonly string[]): string {
  const values = frontier.map((uri) => `<${uri}>`).join(' ');
  const relations = ALL_RELATIONS.map((r) => `thought:${r}`).join(', ');
  const roleTypes = ROLE_TYPES.map((t) => `thought:${t}`).join(', ');
  return `SELECT ?node ?relation ?target ?title ?label ?notePath ?roleType WHERE {
  VALUES ?target { ${values} }
  ?node ?relation ?target .
  FILTER(?relation IN (${relations}))
  OPTIONAL { ?node dc:title ?title }
  OPTIONAL { ?node thought:label ?label }
  OPTIONAL { ?node minerva:relativePath ?notePath }
  OPTIONAL { ?node rdf:type ?roleType . FILTER(?roleType IN (${roleTypes})) }
}`;
}

export interface HopRow {
  node?: string;
  relation?: string;
  target?: string;
  title?: string;
  label?: string;
  notePath?: string;
  roleType?: string;
}

export interface ArgumentNode {
  uri: string;
  label: string;
  notePath: string | null;
  /** Bare local name of a Toulmin role type (`Grounds`, `Warrant`, …), when
   *  the node happens to carry one. Most nodes today won't — see module doc. */
  roleType: string | null;
  /** Relation this node reaches its parent through, and that relation's
   *  kind. A node reached via more than one relation keeps whichever was
   *  found first (BFS order — closest/first hop wins). */
  relation: string;
  kind: RelationKind;
  /** Hop distance from the focus (1 = points directly at it). */
  hop: number;
  /** The URI this node points AT — the focus itself for hop 1, or whichever
   *  hop-(N-1) node it argues into for deeper hops. Lets the diagram draw a
   *  real tree (grounds → warrant → claim) instead of every node spoking
   *  straight to the focus. */
  parentUri: string;
}

/**
 * Fold a hop's raw rows into deduplicated `ArgumentNode`s, skipping any node
 * already known at an earlier (shorter) hop — a node can be reachable via
 * more than one path; the shortest one is what a depth filter should honor.
 */
export function foldHopRows(rows: readonly HopRow[], hop: number, known: ReadonlySet<string>): ArgumentNode[] {
  const seenThisHop = new Map<string, ArgumentNode>();
  for (const r of rows) {
    if (!r.node || !r.relation || !r.target || known.has(r.node) || seenThisHop.has(r.node)) continue;
    seenThisHop.set(r.node, {
      uri: r.node,
      label: labelFor(r, r.node),
      notePath: r.notePath ?? null,
      roleType: r.roleType ? r.roleType.split(/[#/]/).pop()! : null,
      relation: r.relation.split(/[#/]/).pop()!,
      kind: classifyRelation(r.relation.split(/[#/]/).pop()!),
      hop,
      parentUri: r.target,
    });
  }
  return [...seenThisHop.values()];
}

/** Nodes at or below `depth` — what the depth control actually filters,
 *  client-side, against the full already-fetched set (no re-query). */
export function filterByDepth(nodes: readonly ArgumentNode[], depth: number): ArgumentNode[] {
  return nodes.filter((n) => n.hop <= depth);
}

export function groupByKind(nodes: readonly ArgumentNode[]): Record<RelationKind, ArgumentNode[]> {
  const groups: Record<RelationKind, ArgumentNode[]> = { support: [], attack: [], qualify: [], other: [] };
  for (const n of nodes) groups[n.kind].push(n);
  return groups;
}

/** Defects scoped to the note paths present in the current neighborhood.
 *  `thought:defectIn`'s range is `minerva:Note`, not a specific component —
 *  a defect is attributed to the NOTE, not to one claim within it. */
export function buildDefectsQuery(notePaths: readonly string[]): string | null {
  const paths = [...new Set(notePaths)];
  if (paths.length === 0) return null;
  const values = paths.map((p) => `"${escapeSparqlLiteral(p)}"`).join(' ');
  return `SELECT ?defect ?defectLabel ?defectType ?notePath WHERE {
  ?note minerva:relativePath ?notePath .
  VALUES ?notePath { ${values} }
  ?defect thought:defectIn ?note .
  OPTIONAL { ?defect thought:defectLabel ?defectLabel }
  OPTIONAL { ?defect rdf:type ?defectType }
}`;
}

export interface DefectRow {
  defect?: string;
  defectLabel?: string;
  defectType?: string;
  notePath?: string;
}

export interface ArgumentDefect {
  uri: string;
  label: string;
  typeName: string | null;
  notePath: string;
}

export function parseDefectRows(rows: readonly DefectRow[]): ArgumentDefect[] {
  return rows
    .filter((r): r is DefectRow & { defect: string; notePath: string } => !!r.defect && !!r.notePath)
    .map((r) => ({
      uri: r.defect,
      label: r.defectLabel || (r.defectType ? r.defectType.split(/[#/]/).pop()! : 'Defect'),
      typeName: r.defectType ? r.defectType.split(/[#/]/).pop()! : null,
      notePath: r.notePath,
    }));
}

const MERMAID_CLASS_FOR: Record<RelationKind, string> = {
  support: 'argSupport',
  attack: 'argAttack',
  qualify: 'argQualify',
  other: 'argOther',
};

/** A stable, Mermaid-safe node id — Mermaid ids can't contain most
 *  punctuation, so the URI itself is never used directly, only as a
 *  dictionary key mapping to this generated id. */
function mermaidId(index: number): string {
  return `n${index}`;
}

/** Concrete (not `var(--x)`) colors for the four `classDef`s below — Mermaid
 *  parses `classDef`/`style` values with its own tiny grammar, not as CSS, and
 *  that grammar rejects `var(--sage)` outright ("got '(-'"), so the caller
 *  must resolve theme tokens to real colors before this is called.
 *  `ArgumentMap.svelte` does that from `getComputedStyle` (mirroring
 *  `mermaid-renderer.ts`'s `readThemeTokens`, oklch→hex included since
 *  mermaid's color lib can't parse `oklch()` either); this fallback only
 *  covers pure/test callers that don't care what the colors actually are. */
export interface ArgumentMermaidColors {
  support: string;
  attack: string;
  qualify: string;
  otherFill: string;
  otherBorder: string;
  otherText: string;
  onColoredText: string;
}

const FALLBACK_COLORS: ArgumentMermaidColors = {
  support: '#8ec07c',
  attack: '#e06c75',
  qualify: '#e5c07b',
  otherFill: '#3b3f4c',
  otherBorder: '#565f76',
  otherText: '#d3d8e0',
  onColoredText: '#1e1e2e',
};

/**
 * Build `graph TD` Mermaid source for the given (already depth-filtered)
 * node set, fed through the SAME hydration pipeline authored ` ```mermaid `
 * fences already use (`hydrateMermaidBlocks`) — no new rendering engine.
 */
export function buildArgumentMermaid(
  focusUri: string,
  focusLabel: string,
  nodes: readonly ArgumentNode[],
  colors: ArgumentMermaidColors = FALLBACK_COLORS,
): string {
  const lines: string[] = ['graph TD'];
  const idFor = new Map<string, string>([[focusUri, 'focus']]);
  lines.push(`  focus["${mermaidEscape(focusLabel)}"]`);

  nodes.forEach((n, i) => {
    idFor.set(n.uri, mermaidId(i));
  });

  for (const n of nodes) {
    const id = idFor.get(n.uri)!;
    const prefix = n.roleType ? `${n.roleType}: ` : '';
    lines.push(`  ${id}["${mermaidEscape(prefix + n.label)}"]`);
    // A real tree: this node draws to whichever node it actually argues
    // into (`parentUri`) — the focus for hop 1, an earlier hop's node for
    // deeper ones — so grounds → warrant → claim chains render as chains,
    // not every node spoking straight to the focus.
    const parentId = idFor.get(n.parentUri);
    if (parentId) lines.push(`  ${id} -->|${n.relation}| ${parentId}`);
    lines.push(`  class ${id} ${MERMAID_CLASS_FOR[n.kind]}`);
  }

  lines.push(`  classDef argSupport fill:${colors.support},stroke:${colors.support},color:${colors.onColoredText}`);
  lines.push(`  classDef argAttack fill:${colors.attack},stroke:${colors.attack},color:${colors.onColoredText}`);
  lines.push(`  classDef argQualify fill:${colors.qualify},stroke:${colors.qualify},color:${colors.onColoredText}`);
  lines.push(`  classDef argOther fill:${colors.otherFill},stroke:${colors.otherBorder},color:${colors.otherText}`);

  return lines.join('\n');
}

function mermaidEscape(text: string): string {
  return text.replace(/"/g, '&quot;').slice(0, 80);
}
