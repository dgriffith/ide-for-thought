/**
 * A thoughtbase's own SHACL shapes (#2874): `.minerva/shapes/*.ttl`, run with
 * Minerva's and the plugins' as inspections ("every Book needs an author").
 *
 * They travel with a shared thoughtbase, so they are someone else's input —
 * which the shapes path was built for already (#2642): a file is refused
 * unless every query in it is a SELECT or an ASK, the graph it sees refuses
 * writes, it reaches no network, and each check is bounded, then stopped if
 * it runs long. Here, on top of that:
 *
 * - **limits on the folder**: at most `MAX_THOUGHTBASE_SHAPE_FILES` files and
 *   `MAX_THOUGHTBASE_SHAPE_BYTES` in all, read in name order; a file past
 *   either is refused, named, and the rest still load;
 * - **its words are data**: a finding's message and a check's name are text
 *   someone else wrote. The app shows them as text, and a conversation about
 *   a finding carries them delimited (`InspectionsPanel`), never as the
 *   user's own words.
 *
 * Read at each sweep, cheaply: the folder is listed and stat'ed, and only a
 * change to a file's name, size or mtime re-reads and re-parses.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createProjectStore } from '../../project-store';
import type { ProjectContext } from '../../project-context-types';
import type { ShapeInspectionDef, ThoughtbaseInspections } from '../../../shared/inspections';
import { parseShapesFile, type ShapesFile } from './shapes';
import { isStopped } from './run';
import { getState } from '../state';

/** Where they live, relative to the thoughtbase root. */
export const THOUGHTBASE_SHAPES_DIR = '.minerva/shapes';
/** The most shapes files a thoughtbase may carry. */
export const MAX_THOUGHTBASE_SHAPE_FILES = 16;
/** All of a thoughtbase's shapes files together, in bytes. */
export const MAX_THOUGHTBASE_SHAPE_BYTES = 1024 * 1024;

export interface ThoughtbaseShapes {
  files: Array<{ id: string; file: ShapesFile }>;
  problems: Array<{ file: string; problem: string }>;
}

const EMPTY: ThoughtbaseShapes = { files: [], problems: [] };

interface ShapesState { stamp: string; shapes: ThoughtbaseShapes }
const shapesStore = createProjectStore<ShapesState>();

/** The `.ttl` files in the folder, in name order, with what says whether they changed. */
async function listing(root: string): Promise<Array<{ name: string; abs: string; size: number; mtimeMs: number }>> {
  const dir = path.join(root, THOUGHTBASE_SHAPES_DIR);
  let names: string[];
  try {
    names = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.ttl') && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code) return [];
    throw e;
  }
  const out: Array<{ name: string; abs: string; size: number; mtimeMs: number }> = [];
  for (const name of names) {
    const abs = path.join(dir, name);
    try {
      const st = await fs.stat(abs);
      out.push({ name, abs, size: st.size, mtimeMs: st.mtimeMs });
    } catch (e) {
      if (!(e as NodeJS.ErrnoException).code) throw e;
      // Gone between the listing and the stat, or unreadable: as if it weren't there.
    }
  }
  return out;
}

/** Read and check every shapes file the thoughtbase carries. */
async function read(entries: Awaited<ReturnType<typeof listing>>): Promise<ThoughtbaseShapes> {
  const out: ThoughtbaseShapes = { files: [], problems: [] };
  const types = new Set<string>();
  let bytes = 0;
  for (const [i, e] of entries.entries()) {
    const refuse = (problem: string) => { out.problems.push({ file: e.name, problem }); };
    if (i >= MAX_THOUGHTBASE_SHAPE_FILES) { refuse(`a thoughtbase may carry at most ${MAX_THOUGHTBASE_SHAPE_FILES} shapes files`); continue; }
    if (bytes + e.size > MAX_THOUGHTBASE_SHAPE_BYTES) { refuse(`the thoughtbase's shapes files may be at most ${MAX_THOUGHTBASE_SHAPE_BYTES} bytes in all`); continue; }
    bytes += e.size;
    let text: string;
    try {
      text = await fs.readFile(e.abs, 'utf-8');
    } catch (err) {
      refuse(`it couldn't be read (${(err as NodeJS.ErrnoException).code ?? 'error'})`);
      continue;
    }
    const parsed = parseShapesFile(text, { kind: 'thoughtbase' });
    if (!parsed.ok) { for (const p of parsed.problems) refuse(p); continue; }
    const clash = parsed.file.checks.find((c) => types.has(c.type));
    if (clash) { refuse(`the shape ${clash.type} is already declared in another of the thoughtbase's files`); continue; }
    for (const c of parsed.file.checks) types.add(c.type);
    out.files.push({ id: `thoughtbase:${e.name}`, file: parsed.file });
  }
  return out;
}

/** The thoughtbase's shapes, read again only when a file in the folder changed. */
export async function thoughtbaseShapes(ctx: ProjectContext): Promise<ThoughtbaseShapes> {
  const entries = await listing(ctx.rootPath);
  if (entries.length === 0) return EMPTY;
  const stamp = entries.map((e) => `${e.name}\u0000${e.size}\u0000${e.mtimeMs}`).join('\u0001');
  const cached = shapesStore.get(ctx);
  if (cached?.stamp === stamp) return cached.shapes;
  const shapes = await read(entries);
  // Cached only while its graph is open: a read must not allocate a slot (#2240).
  if (getState(ctx)) shapesStore.set(ctx, { stamp, shapes });
  return shapes;
}

/** The thoughtbase's checks and refused files, as Settings lists them — a stopped check marked. */
export async function thoughtbaseInspections(ctx: ProjectContext): Promise<ThoughtbaseInspections> {
  const { files, problems } = await thoughtbaseShapes(ctx);
  const checks: ShapeInspectionDef[] = files.flatMap(({ file }) => file.checks.map((c) => ({
    type: c.type, label: c.label, description: c.description, group: c.group, severity: c.severity,
    ...(isStopped(file, c.type) ? { stopped: true } : {}),
  })));
  return { checks, problems };
}
