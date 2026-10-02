import fs from 'node:fs/promises';
import path from 'node:path';
import * as notebaseFs from './fs';
import {
  relocateWikiLinks,
  rewriteRelativeMarkdownLinks,
} from './link-rewriting';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { isIndexable } from '../../shared/indexable-files';
import { isIgnoredEntry } from '../../shared/ignored-dirs';
import { logger } from '../../shared/logger';
import { rewriteViewFolders } from '../../shared/objects/view-folder-rename';

async function listIndexableFiles(rootPath: string, relDir: string): Promise<string[]> {
  const results: string[] = [];
  const absDir = path.join(rootPath, relDir);
  try {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (isIgnoredEntry(entry.name)) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...await listIndexableFiles(rootPath, rel));
      } else if (isIndexable(entry.name)) {
        results.push(rel);
      }
    }
  } catch { /* directory may not exist */ }
  return results;
}

/**
 * List every file (any extension) under `relDir`, used to build the
 * markdown-rewrites map. The wiki-link rewriter cares only about
 * indexable notes, but markdown image refs can target .png/.svg/.csv
 * etc — those need to be in the rewrites map so a sibling note's
 * `![alt](pic.png)` gets re-relativized when the folder moves.
 */
export async function listAllFiles(rootPath: string, relDir: string): Promise<string[]> {
  const results: string[] = [];
  const absDir = path.join(rootPath, relDir);
  try {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (isIgnoredEntry(entry.name)) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...await listAllFiles(rootPath, rel));
      } else {
        results.push(rel);
      }
    }
  } catch { /* directory may not exist */ }
  return results;
}

/**
 * The wiki-link half of every note relocation — single rename, folder
 * move/rename, the LLM refactor proposals' preview and apply, and merge
 * (`merge.ts`) — in one place (#2456). Must be called BEFORE anything moves:
 * it snapshots what each link resolves to now and what it will resolve to
 * after `moves` lands, and returns a rewriter that retargets every link that
 * resolved to a moved note (by path, basename, slug or alias) and re-spells
 * any link the move would otherwise make resolve somewhere else.
 *
 * `carryAliases` is false for a merge, where the source's frontmatter — and
 * so its aliases — is dropped.
 */
export function wikiLinkRelocator(
  rootPath: string,
  moves: ReadonlyMap<string, string>,
  opts: { carryAliases: boolean } = { carryAliases: true },
): (content: string) => { content: string; rewritten: number } {
  if (moves.size === 0) return (content) => ({ content, rewritten: 0 });
  const { before, after } = graph.relocationLinkIndexes(projectContext(rootPath), moves, opts);
  const reloc = { moves, before, after };
  return (content) => relocateWikiLinks(content, reloc);
}

/** A note refactor (move/rename) that can't proceed — collision, no-op, an
 *  unsupported folder move, etc. Carries a user-facing reason (#911). */
export class RefactorError extends Error {
  constructor(message: string) { super(message); this.name = 'RefactorError'; }
}

export interface AffectedNote {
  /** Pre-apply path of the note whose content changes. */
  path: string;
  before: string;
  after: string;
  /** True for the note being moved itself (relative links re-relativized). */
  isMoved: boolean;
}

export interface RenamePlan {
  fromPath: string;
  toPath: string;
  /** Every note whose content changes if this refactor is applied — the moved
   *  note (re-relativized links) plus other notes (inbound link rewrites). */
  affectedNotes: AffectedNote[];
  warnings: string[];
}

/**
 * Compute what a note move/rename would do — the destination, and every note
 * whose links would be rewritten, with before/after — **without writing
 * anything** (#911). Drives the proposal preview's blast radius, and is the
 * pre-flight guardrail check. Uses the same rewriter helpers as
 * `renameWithLinkRewrites`, so the preview matches the commit.
 *
 * Notes only (folder moves are out of scope for the proposal path).
 */
export async function planRename(rootPath: string, fromPath: string, toPath: string): Promise<RenamePlan> {
  if (fromPath === toPath) throw new RefactorError('The source and destination are the same.');
  if (!isIndexable(fromPath) || !fromPath.endsWith('.md')) {
    throw new RefactorError('Only note (.md) files can be moved or renamed this way.');
  }
  if (!toPath.endsWith('.md')) throw new RefactorError('The destination must be a .md note path.');

  // Safe-path (throws on traversal / hidden / ignored dirs). Same check the
  // commit performs via notebaseFs.rename.
  notebaseFs.assertSafePath(rootPath, fromPath);
  notebaseFs.assertSafePath(rootPath, toPath);

  let stat: import('node:fs').Stats;
  try {
    stat = await fs.stat(path.join(rootPath, fromPath));
  } catch {
    throw new RefactorError(`The note to move no longer exists: ${fromPath}`);
  }
  if (stat.isDirectory()) throw new RefactorError('Folder moves are not supported here — move a single note.');
  if (await notebaseFs.fileExists(rootPath, toPath)) {
    throw new RefactorError(`A file already exists at the destination: ${toPath}`);
  }

  const mdRewrites = new Map([[fromPath, toPath]]);
  const relocate = wikiLinkRelocator(rootPath, mdRewrites);

  const affectedNotes: AffectedNote[] = [];
  for (const currentPath of await listIndexableFiles(rootPath, '')) {
    const isMoved = currentPath === fromPath;
    let content: string;
    try { content = await notebaseFs.readFile(rootPath, currentPath); } catch { continue; }

    let rewritten = relocate(content).content;
    rewritten = rewriteRelativeMarkdownLinks(
      rewritten,
      isMoved ? fromPath : currentPath,
      isMoved ? toPath : currentPath,
      mdRewrites,
    );
    if (rewritten !== content) {
      affectedNotes.push({ path: currentPath, before: content, after: rewritten, isMoved });
    }
  }
  return { fromPath, toPath, affectedNotes, warnings: [] };
}

/**
 * Folder generalization of {@link planRename} (#911 follow-up): compute what
 * moving/renaming a whole folder would do — every note that moves (its own
 * relative links re-relativized) plus every note that links *into* the folder
 * (inbound wiki-links rewritten) — **without writing anything**. Returns the
 * same `RenamePlan` shape as `planRename`, so the draft, the review card, and
 * the proposal's pre-image capture all reuse it unchanged. Uses the same
 * rewriter helpers + folder rewrite-map construction as
 * `renameWithLinkRewrites`, so the preview matches the commit.
 *
 * Moved notes are always included in `affectedNotes` (even when their content
 * doesn't change) so the apply can capture every relocated note's pre-image.
 */
export async function planFolderRename(rootPath: string, fromDir: string, toDir: string): Promise<RenamePlan> {
  const from = fromDir.replace(/\/+$/, '');
  const to = toDir.replace(/\/+$/, '');
  if (!from) throw new RefactorError('Cannot move the project root.');
  if (from === to) throw new RefactorError('The source and destination are the same.');
  if (to.startsWith(`${from}/`)) throw new RefactorError('Cannot move a folder into itself.');

  notebaseFs.assertSafePath(rootPath, from);
  notebaseFs.assertSafePath(rootPath, to);

  let stat: import('node:fs').Stats;
  try { stat = await fs.stat(path.join(rootPath, from)); }
  catch { throw new RefactorError(`The folder to move no longer exists: ${from}`); }
  if (!stat.isDirectory()) throw new RefactorError('That path is a note, not a folder — use a note move instead.');
  // Destination must not already exist.
  let destExists = true;
  try { await fs.stat(path.join(rootPath, to)); } catch { destExists = false; }
  if (destExists) throw new RefactorError(`Something already exists at the destination: ${to}`);

  // Wiki-link + markdown-link rewrite maps, built exactly as
  // `renameWithLinkRewrites` does for a directory.
  const descendants = await listIndexableFiles(rootPath, from);
  const moves = new Map<string, string>();
  for (const d of descendants) moves.set(d, to + d.slice(from.length));
  const mdRewrites = new Map<string, string>();
  for (const d of await listAllFiles(rootPath, from)) {
    mdRewrites.set(d, to + d.slice(from.length));
  }
  const relocate = wikiLinkRelocator(rootPath, moves);

  const movedSet = new Set(descendants);
  const affectedNotes: AffectedNote[] = [];
  for (const currentPath of await listIndexableFiles(rootPath, '')) {
    const isMoved = movedSet.has(currentPath);
    let content: string;
    try { content = await notebaseFs.readFile(rootPath, currentPath); } catch { continue; }

    let rewritten = relocate(content).content;
    // A moved note's authored relative links resolve against its OLD location;
    // the new location is its mapped destination.
    const newEquivalent = isMoved ? to + currentPath.slice(from.length) : currentPath;
    rewritten = rewriteRelativeMarkdownLinks(rewritten, currentPath, newEquivalent, mdRewrites);
    // Folder-scoped views follow the folder (#2535).
    rewritten = rewriteViewFolders(rewritten, from, to);

    if (rewritten !== content || isMoved) {
      affectedNotes.push({ path: currentPath, before: content, after: rewritten, isMoved });
    }
  }
  return { fromPath: from, toPath: to, affectedNotes, warnings: [] };
}

export interface RenameWithLinksOptions {
  /** Called for every relative path we're about to touch so the watcher can dedupe. Optional. */
  markPathHandled?: (relativePath: string) => void;
  /** Called with (relativePath, content) after each reindex so additional indexes (e.g. search) can update. Optional. */
  reindexHook?: (relativePath: string, content: string) => void;
  /** Called with relativePath after each removal from the graph. Optional. */
  removeHook?: (relativePath: string) => void;
}

export interface PathTransition {
  old: string;
  new: string;
}

export interface RenameResult {
  /** One transition per renamed indexable file (a single entry for file renames; many for folder renames). */
  transitions: PathTransition[];
  /** Paths of OTHER notes whose content was rewritten by the pass. */
  rewrittenPaths: string[];
  /** Set for a folder rename/move (#2535), so open folder-scoped view tabs
   *  can follow. Kept out of `transitions`, which rollback replays file by file. */
  folder?: PathTransition;
}

/**
 * Rename a note file or folder and rewrite every wiki-link in the thoughtbase
 * that pointed at the old location.
 *
 * Callers are responsible for persisting the graph after this resolves.
 */
export async function renameWithLinkRewrites(
  rootPath: string,
  oldRelPath: string,
  newRelPath: string,
  opts: RenameWithLinksOptions = {},
): Promise<RenameResult> {
  const { markPathHandled, reindexHook, removeHook } = opts;
  const ctx = projectContext(rootPath);

  // Determine whether this is a directory rename BEFORE the fs.rename call
  // so we can enumerate descendants at the old location.
  const oldStat = await fs.stat(path.join(rootPath, oldRelPath));
  const isDirectory = oldStat.isDirectory();

  // Every relocated note: old relativePath → new relativePath.
  const moves = new Map<string, string>();
  if (isDirectory) {
    const descendants = await listIndexableFiles(rootPath, oldRelPath);
    for (const d of descendants) moves.set(d, newRelPath + d.slice(oldRelPath.length));
  } else if (isIndexable(oldRelPath)) {
    moves.set(oldRelPath, newRelPath);
  }

  // Markdown-link rewrites map: full-path → full-path. Covers every
  // file moved by this rename (indexable or not), since a sibling
  // note's `![alt](pic.png)` needs re-relativizing when `pic.png`
  // moves alongside it. The wiki-link map above is a strict subset
  // of this one (md-files only, with the `.md` suffix stripped).
  const mdRewrites = new Map<string, string>();
  if (isDirectory) {
    const descendants = await listAllFiles(rootPath, oldRelPath);
    for (const d of descendants) {
      mdRewrites.set(d, newRelPath + d.slice(oldRelPath.length));
    }
  } else {
    mdRewrites.set(oldRelPath, newRelPath);
  }

  // Snapshot link resolution and the referring notes BEFORE renaming, while
  // the graph still describes the pre-rename thoughtbase.
  const relocate = wikiLinkRelocator(rootPath, moves);
  const referringNotes = new Set<string>();
  for (const oldPath of moves.keys()) {
    for (const p of graph.findNotesLinkingTo(ctx, oldPath)) referringNotes.add(p);
  }

  markPathHandled?.(oldRelPath);
  markPathHandled?.(newRelPath);
  await notebaseFs.rename(rootPath, oldRelPath, newRelPath);

  // Re-index the renamed file(s) at their new location, recording transitions.
  const transitions: PathTransition[] = [];
  if (isDirectory) {
    const newFiles = await listIndexableFiles(rootPath, newRelPath);
    for (const f of newFiles) {
      const oldEquivalent = oldRelPath + f.slice(newRelPath.length);
      if (isIndexable(oldEquivalent)) {
        graph.removeNote(ctx, oldEquivalent);
        removeHook?.(oldEquivalent);
      }
      if (isIndexable(f)) {
        const content = await notebaseFs.readFile(rootPath, f);
        await graph.indexNote(ctx, f, content);
        reindexHook?.(f, content);
        transitions.push({ old: oldEquivalent, new: f });
      }
    }
  } else if (isIndexable(oldRelPath)) {
    graph.removeNote(ctx, oldRelPath);
    removeHook?.(oldRelPath);
    const content = await notebaseFs.readFile(rootPath, newRelPath);
    await graph.indexNote(ctx, newRelPath, content);
    reindexHook?.(newRelPath, content);
    transitions.push({ old: oldRelPath, new: newRelPath });
  }

  // Rewrite links across the project. Two rewriters run in one pass over
  // every indexable note:
  //   - wiki-link rewriter (resolution-driven, #2456): retargets links that
  //     resolved to a moved note, and re-spells links to OTHER notes that
  //     the move would make ambiguous — the latter aren't in
  //     `referringNotes`, so this can't be limited to it.
  //   - markdown-link rewriter: authored relative paths can target moved
  //     files OR live inside a moved file — both directions need
  //     re-relativization, and the graph doesn't index markdown-link edges.
  // Both passes share a single read/write cycle per file so we don't
  // double-write notes that both passes would touch.
  const rewrittenPaths: string[] = [];
  const allNotes = await listIndexableFiles(rootPath, '');
  for (const currentPath of allNotes) {
    // The note's path BEFORE the rename. For files moved as part of
    // this rename, that's their pre-rename location; otherwise it's
    // unchanged. Markdown links are resolved against the OLD source
    // location since that's where the author wrote them.
    const oldEquivalent = isDirectory && currentPath.startsWith(`${newRelPath}/`)
      ? oldRelPath + currentPath.slice(newRelPath.length)
      : currentPath === newRelPath
        ? oldRelPath
        : currentPath;

    let content: string;
    try {
      content = await notebaseFs.readFile(rootPath, currentPath);
    } catch (err) {
      logger('rename').error(`Read for rewrite failed for ${currentPath}:`, err instanceof Error ? err.message : err);
      continue;
    }

    let rewritten = relocate(content).content;

    // Markdown-link pass — applies whenever the source moved (so all
    // its relative links need re-relativizing) OR a target moved (so
    // a link in this note may need its target updated). The rewriter
    // itself is a fast no-op when neither condition fires for this
    // file's content.
    rewritten = rewriteRelativeMarkdownLinks(
      rewritten,
      oldEquivalent,
      currentPath,
      mdRewrites,
    );
    // Folder-scoped ```object-view embeds follow the folder (#2535) — same
    // pass, same write, so the rename's undo covers them too.
    if (isDirectory) rewritten = rewriteViewFolders(rewritten, oldRelPath, newRelPath);

    if (rewritten !== content) {
      try {
        markPathHandled?.(currentPath);
        await notebaseFs.writeFile(rootPath, currentPath, rewritten);
        await graph.indexNote(ctx, currentPath, rewritten);
        reindexHook?.(currentPath, rewritten);
        rewrittenPaths.push(currentPath);
      } catch (err) {
        logger('rename').error(`Link rewrite failed for ${currentPath}:`, err instanceof Error ? err.message : err);
      }
    } else if (referringNotes.has(oldEquivalent)) {
      // Text didn't change but this note refers to the moved target —
      // an alias-form link like `[[JFK]]` whose underlying alias map
      // now points at the new URI (#494). The link text itself doesn't
      // need a rewrite, but the graph triple it materialised at last
      // index time still references the OLD note URI. Reindex (no
      // write) so resolveTargetByAlias re-runs against the just-
      // rebuilt aliasMap and emits a triple pointing at <new>.
      try {
        await graph.indexNote(ctx, currentPath, content);
        reindexHook?.(currentPath, content);
      } catch (err) {
        logger('rename').error(`Alias-sweep reindex failed for ${currentPath}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return { transitions, rewrittenPaths, ...(isDirectory ? { folder: { old: oldRelPath, new: newRelPath } } : {}) };
}
