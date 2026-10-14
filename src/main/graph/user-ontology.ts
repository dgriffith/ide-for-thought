/**
 * A thoughtbase's own vocabularies, loaded beside the built-in ontology (#2788).
 *
 * Turtle files imported in Settings → Ontology live in
 * `<thoughtbase>/.minerva/ontology/`. Each is checked whole
 * (`user-ontology-check.ts`) and, if accepted, loaded into the store in a named
 * graph of its own — `urn:x-minerva:ontology:<file>` — and listed in
 * `ontologyStatements`, so `serializeUserGraph` leaves it out of `graph.ttl`
 * exactly as it leaves out the bundled ontology. From there:
 *
 * - its prefixes join every query's prologue (`injectSparqlPrefixes`) and the
 *   editor's completion, with its classes and properties
 *   (`schemaForCompletion`);
 * - its text goes to the model inside `describe_graph_schema`, delimited as
 *   thoughtbase content — a shared thoughtbase's file is someone else's input.
 *
 * Loaded at project open and on every rebuild; Settings → Ontology re-reads
 * the folder when it opens (`syncVocabularies`), so a file edited outside the
 * app is picked up there too. A refused file is skipped and reported, never
 * half-loaded, and never stops the graph loading.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as $rdf from 'rdflib';
import type { Quad, Term } from 'n3';
import { createProjectStore } from '../project-store';
import type { ProjectContext } from '../project-context-types';
import { getState, type GraphState } from './state';
import { emitGraphChanged } from './graph-events';
import {
  USER_ONTOLOGY_DIR,
  type VocabularyImportPreview,
  type VocabularyPrefix,
  type VocabularyStatus,
  type VocabularyTerm,
} from '../../shared/ontology-vocabularies';
import {
  acceptVocabulary,
  checkVocabulary,
  emptyAccepted,
  type CheckedVocabulary,
} from './user-ontology-check';

/** All of a thoughtbase's vocabularies together. */
export const MAX_TOTAL_VOCABULARY_BYTES = 4 * 1024 * 1024;

/** The named graph each accepted file loads into. */
const GRAPH_PREFIX = 'urn:x-minerva:ontology:';

interface AcceptedFile { file: string; text: string; checked: CheckedVocabulary }

export interface LoadedVocabularies {
  /** Every `.ttl` in the folder, in name order, as checked. */
  statuses: VocabularyStatus[];
  accepted: AcceptedFile[];
}

interface VocabularyState {
  loaded: LoadedVocabularies;
  /** What was loaded, so a sync that finds the same files does nothing. */
  digest: string;
  /** The graphs it occupies in the store. */
  graphs: string[];
  /** The one Import Turtle… awaiting confirmation. */
  pending: { id: string; file: string; text: string } | null;
}

const vocabularyStore = createProjectStore<VocabularyState>();

const EMPTY: LoadedVocabularies = { statuses: [], accepted: [] };

function isFsError(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === 'object' && e !== null && 'code' in e;
}

/** The `.ttl` files in `.minerva/ontology/`, by name. Links are skipped: a vocabulary is a file the thoughtbase holds. */
async function readVocabularyFiles(rootPath: string): Promise<Array<{ file: string; text?: string; error?: string }>> {
  const dir = path.join(rootPath, USER_ONTOLOGY_DIR);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (!isFsError(e)) throw e;
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return [];
    // Reported, not thrown: an unreadable folder must not stop the graph loading.
    return [{ file: USER_ONTOLOGY_DIR, error: `The folder couldn't be read (${e.code ?? 'error'}).` }];
  }
  const files = entries
    .filter((d) => d.isFile() && !d.name.startsWith('.') && d.name.toLowerCase().endsWith('.ttl'))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
  return Promise.all(files.map(async (file) => {
    try {
      return { file, text: await fs.readFile(path.join(dir, file), 'utf-8') };
    } catch (e) {
      if (!isFsError(e)) throw e;
      return { file, error: `It couldn't be read (${e.code ?? 'error'}).` };
    }
  }));
}

/** Check a set of vocabularies in order, each against those accepted before it. */
function checkAll(files: Array<{ file: string; text?: string; error?: string }>): LoadedVocabularies {
  const accepted = emptyAccepted();
  const out: LoadedVocabularies = { statuses: [], accepted: [] };
  let total = 0;
  for (const { file, text, error } of files) {
    if (text === undefined) {
      out.statuses.push({ file, ok: false, problems: [error ?? 'It couldn\'t be read.'] });
      continue;
    }
    const checked = checkVocabulary(file, text, accepted);
    if (checked.status.ok) {
      const bytes = Buffer.byteLength(text, 'utf-8');
      if (total + bytes > MAX_TOTAL_VOCABULARY_BYTES) {
        out.statuses.push({ file, ok: false, problems: [`It would take this thoughtbase's vocabularies past ${MAX_TOTAL_VOCABULARY_BYTES / 1024 / 1024} MB.`] });
        continue;
      }
      total += bytes;
      acceptVocabulary(accepted, checked);
      out.accepted.push({ file, text, checked });
    }
    out.statuses.push(checked.status);
  }
  return out;
}

/** Read and check the folder. A refused file is reported, not thrown. */
export async function loadVocabularies(rootPath: string): Promise<LoadedVocabularies> {
  return checkAll(await readVocabularyFiles(rootPath));
}

function digestOf(loaded: LoadedVocabularies): string {
  const h = createHash('sha256');
  for (const a of loaded.accepted) h.update(a.file).update('\u0000').update(a.text).update('\u0000');
  for (const s of loaded.statuses) h.update(s.file).update(s.ok ? '+' : '-');
  return h.digest('hex');
}

function toRdf(term: Term): $rdf.NamedNode | $rdf.BlankNode | $rdf.Literal {
  switch (term.termType) {
    case 'NamedNode': return $rdf.sym(term.value);
    case 'BlankNode': return $rdf.blankNode(term.value);
    case 'Literal': return $rdf.literal(term.value, term.language || $rdf.sym(term.datatype.value));
    default: throw new Error(`Unexpected ${term.termType} in a vocabulary`);
  }
}

function toStatement(q: Quad, graph: $rdf.NamedNode): $rdf.Statement {
  return $rdf.st(
    toRdf(q.subject) as $rdf.NamedNode | $rdf.BlankNode,
    toRdf(q.predicate) as $rdf.NamedNode,
    toRdf(q.object),
    graph,
  );
}

/**
 * Put `loaded` in the store in place of whatever vocabularies were there, and
 * remember it for the prefix, completion and schema reads below. Called by
 * `initGraph` and the rebuild on a state not yet published, and by
 * {@link syncVocabularies} on the live one.
 */
export function applyVocabularies(ctx: ProjectContext, state: GraphState, loaded: LoadedVocabularies): void {
  const previous = vocabularyStore.get(ctx);
  for (const g of previous?.graphs ?? []) {
    state.store.removeMatches(undefined, undefined, undefined, $rdf.sym(g));
  }
  const added: $rdf.Statement[] = [];
  const graphs: string[] = [];
  for (const { file, checked } of loaded.accepted) {
    const graph = $rdf.sym(GRAPH_PREFIX + encodeURIComponent(file));
    graphs.push(graph.value);
    for (const q of checked.quads) {
      const st = toStatement(q, graph);
      state.store.add(st.subject, st.predicate, st.object, st.graph);
      added.push(st);
    }
  }
  // `serializeUserGraph` skips every graph `ontologyStatements` occupies.
  state.ontologyStatements = state.ontologyStatements
    .filter((st) => !(st.graph?.value ?? '').startsWith(GRAPH_PREFIX))
    .concat(added);
  vocabularyStore.set(ctx, { loaded, digest: digestOf(loaded), graphs, pending: previous?.pending ?? null });
}

/**
 * Re-read the folder, and reload the graph's vocabularies if what's there
 * changed — a file imported, removed, or edited outside the app. Returns the
 * folder as checked. Without a loaded graph it only checks.
 */
export async function syncVocabularies(ctx: ProjectContext): Promise<VocabularyStatus[]> {
  const loaded = await loadVocabularies(ctx.rootPath);
  const state = getState(ctx);
  if (!state) return loaded.statuses;
  if (vocabularyStore.get(ctx)?.digest !== digestOf(loaded)) {
    applyVocabularies(ctx, state, loaded);
    emitGraphChanged(ctx.rootPath);
  }
  return loaded.statuses;
}

function current(ctx: ProjectContext): LoadedVocabularies {
  return vocabularyStore.get(ctx)?.loaded ?? EMPTY;
}

/** The prefixes every query gets, beyond the standard ones. */
export function vocabularyPrefixes(ctx: ProjectContext): VocabularyPrefix[] {
  return current(ctx).accepted.flatMap((a) => a.checked.injected);
}

/** Every class and property the loaded vocabularies declare, for completion. */
export function vocabularyTerms(ctx: ProjectContext): { classes: VocabularyTerm[]; properties: VocabularyTerm[] } {
  const classes: VocabularyTerm[] = [];
  const properties: VocabularyTerm[] = [];
  for (const { checked } of current(ctx).accepted) {
    if (!checked.status.ok) continue;
    classes.push(...checked.status.classes);
    properties.push(...checked.status.properties);
  }
  return { classes, properties };
}

/** The loaded vocabularies' text, for `describe_graph_schema` to hand the model — delimited, as data. */
export function vocabulariesForSchema(ctx: ProjectContext): Array<{ file: string; turtle: string }> {
  return current(ctx).accepted.map(({ file, text }) => ({ file, turtle: text }));
}

// ── Import and remove (Settings → Ontology) ──────────────────────────────────

/** `My Lab Schema.TTL` → `my-lab-schema.ttl`. */
export function vocabularyFileName(sourceName: string): string {
  const stem = path.basename(sourceName).replace(/\.[^.]*$/, '').toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/-*\.-*/g, '.').replace(/^[-.]+|[-.]+$/g, '');
  return `${stem || 'vocabulary'}.ttl`;
}

/** A name {@link removeVocabulary} will act on: a plain `.ttl` file name, nothing else. */
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.ttl$/;

/**
 * Check a picked file against this thoughtbase's other vocabularies — those of
 * any other name; one of the same name is what it would replace — and hold
 * the text for {@link commitVocabularyImport}. Nothing is written.
 */
export async function previewVocabularyImport(
  ctx: ProjectContext,
  sourceName: string,
  text: string,
): Promise<VocabularyImportPreview> {
  const file = vocabularyFileName(sourceName);
  const onDisk = await readVocabularyFiles(ctx.rootPath);
  const others = onDisk.filter((f) => f.file !== file);
  const result = checkAll([...others, { file, text }]);
  const status = result.statuses.find((s) => s.file === file)!;
  const id = randomUUID();
  const slot = vocabularyStore.get(ctx);
  if (slot) slot.pending = { id, file, text };
  else vocabularyStore.set(ctx, { loaded: EMPTY, digest: '', graphs: [], pending: { id, file, text } });
  return { id, file, replaces: onDisk.some((f) => f.file === file), status };
}

/**
 * Save the previewed file — exactly the text that was checked — and load it.
 * Checked again first, against the folder as it is now; throws if it would
 * now be refused, or if `id` isn't the import awaiting confirmation.
 */
export async function commitVocabularyImport(ctx: ProjectContext, id: string): Promise<VocabularyStatus[]> {
  const pending = vocabularyStore.get(ctx)?.pending;
  if (!pending || pending.id !== id) throw new Error('That import is no longer waiting; choose the file again.');
  const others = (await readVocabularyFiles(ctx.rootPath)).filter((f) => f.file !== pending.file);
  const status = checkAll([...others, { file: pending.file, text: pending.text }]).statuses.find((s) => s.file === pending.file)!;
  if (!status.ok) throw new Error(`${pending.file} can't be imported: ${status.problems.join(' ')}`);
  const dir = path.join(ctx.rootPath, USER_ONTOLOGY_DIR);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, pending.file);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, pending.text, 'utf-8');
  await fs.rename(temp, target);
  const slot = vocabularyStore.get(ctx);
  if (slot) slot.pending = null;
  return syncVocabularies(ctx);
}

/** Delete one vocabulary and take its terms out of the graph. */
export async function removeVocabulary(ctx: ProjectContext, file: string): Promise<VocabularyStatus[]> {
  if (!FILE_NAME.test(file)) throw new Error(`"${file}" isn't a vocabulary file name.`);
  try {
    await fs.unlink(path.join(ctx.rootPath, USER_ONTOLOGY_DIR, file));
  } catch (e) {
    if (!(isFsError(e) && e.code === 'ENOENT')) throw e;
  }
  return syncVocabularies(ctx);
}
