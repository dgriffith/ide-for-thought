// Apply/rollback for proposal payloads, split out of `approval.ts` (#1083).
//
// Each payload kind self-registers a handler (apply + rollback + optional
// affectsNodes) into `HANDLERS`. Adding a new kind means adding a `register({…})`
// block here — no `switch` to edit in two places, and no edit to `approval.ts`.
// The set of registered kinds IS the authoritative "wired" set
// (`wiredPayloadKinds()`); a kind defined on the type but not registered
// (`source`, `saved-query`) is rejected at propose time and throws if applied.

import * as graph from '../graph/index';
import * as notebaseFs from '../notebase/fs';
import * as search from '../search/index';
import * as vectors from '../embeddings/vector-store';
import { markPathHandled } from '../notebase/path-dedup';
import { planRename, planFolderRename, renameWithLinkRewrites, listAllFiles } from '../notebase/rename';
import type { PathTransition } from '../notebase/rename';
import { isIndexable } from '../notebase/indexable-files';
import { setSourceProperties, readMeta, sourceMetaPath, restoreSourceMeta } from '../sources/source-meta-write';
import type { ProjectContext } from '../project-context-types';
import type { AppliedRecord, PayloadOf, ProposalPayload } from './proposal-types';
import { applyTurtle } from './proposal-persistence';
import { logger } from '../../shared/logger';

/**
 * Everything the approval engine needs to know about one payload kind: how to
 * apply it (returning the rollback data), how to undo it, and which node URIs
 * it introduces (for trust-integrity aggregation). Registered handlers are the
 * routing table — the per-kind divergence that used to live in two `switch`
 * statements now lives in one object per kind.
 */
interface PayloadHandler<K extends ProposalPayload['kind'], RollbackData = unknown> {
  kind: K;
  /** Apply the side-effect; return the rollback data `rollback` consumes.
   *  The return type is the handler's `RollbackData` param — inferred from
   *  this annotation and threaded into `rollback` below, so an apply/rollback
   *  shape mismatch is a compile error instead of an invisible `as` cast. */
  apply(ctx: ProjectContext, payload: PayloadOf<K>): Promise<RollbackData>;
  /** Undo a previously-applied payload using the data `apply` returned. */
  rollback(ctx: ProjectContext, rollbackData: RollbackData): Promise<void>;
  /** URIs this payload introduces/affects, aggregated onto the proposal's
   *  `thought:affectsNode` triples so the trust-integrity query can pin
   *  LLM-attributed components to their approval. Omitted for kinds that
   *  touch no addressable node. Evaluated at propose time (before apply). */
  affectsNodes?(ctx: ProjectContext, payload: PayloadOf<K>): string[];
}

const HANDLERS = new Map<ProposalPayload['kind'], PayloadHandler<ProposalPayload['kind']>>();

// K and RollbackData are BOTH inferred from the handler literal (K from `kind`,
// RollbackData from `apply`'s return) — so call sites pass no explicit type
// args and `rollback` sees the exact shape `apply` returned.
function register<K extends ProposalPayload['kind'], RollbackData>(
  handler: PayloadHandler<K, RollbackData>,
): void {
  // The cast is safe: the map is keyed by kind and only ever read back through
  // the matching payload's kind, so the payload a handler receives is exactly
  // its PayloadOf<K>.
  HANDLERS.set(handler.kind, handler as unknown as PayloadHandler<ProposalPayload['kind']>);
}

/** The kinds that have a registered apply/rollback handler — the authoritative
 *  "wired" set. `source` / `saved-query` are defined on the type but not
 *  registered, so they're absent here. */
export function wiredPayloadKinds(): ReadonlySet<ProposalPayload['kind']> {
  return new Set(HANDLERS.keys());
}

/** Aggregate every URI a bundle introduces, delegating the per-kind logic to
 *  each payload's registered `affectsNodes`. graph-triples carry their own
 *  list; `note` / `note-rewrite` translate to the note's IRI. */
export function collectAffectsNodes(ctx: ProjectContext, payloads: ProposalPayload[]): string[] {
  const out = new Set<string>();
  for (const p of payloads) {
    const handler = HANDLERS.get(p.kind);
    const uris = handler?.affectsNodes?.(ctx, p);
    if (uris) for (const u of uris) out.add(u);
  }
  return [...out];
}

/**
 * Apply a proposal's payloads as a trusted bundle. File-system payloads run
 * first, triples last — so a triples parse failure can roll back FS effects
 * without needing an rdflib snapshot. On any failure the applied records are
 * walked in reverse and rolled back best-effort.
 */
export async function applyBundle(ctx: ProjectContext, payloads: ProposalPayload[]): Promise<AppliedRecord[]> {
  const ordered = [
    ...payloads.filter((p) => p.kind !== 'graph-triples'),
    ...payloads.filter((p) => p.kind === 'graph-triples'),
  ];

  // Everything a bundle applies is a *trusted* mutation. Wrapping the whole
  // apply (not just applyTurtle) means the graph writes inside each handler —
  // indexNote / indexSource / indexExcerpt — are exempt from the trust guard
  // even when the caller is in LLM context (e.g. an approve-handler wrapped in
  // enterLLMContext so the guard is armed on its non-approval writes, #944).
  graph.enterTrustedContext();
  const applied: AppliedRecord[] = [];
  try {
    for (const p of ordered) {
      const handler = HANDLERS.get(p.kind);
      if (!handler) {
        throw new Error(
          `Approval payload kind "${p.kind}" not yet wired (#418 ships graph-triples + note; later kinds land as needed).`,
        );
      }
      const rollbackData = await handler.apply(ctx, p);
      applied.push({ kind: p.kind, rollbackData });
    }
    return applied;
  } catch (err) {
    // Reverse-order rollback. Best-effort — log but don't mask the
    // original error.
    for (const a of [...applied].reverse()) {
      const handler = HANDLERS.get(a.kind);
      try { await handler?.rollback(ctx, a.rollbackData); }
      catch (rollbackErr) { logger('approval').warn(`rollback of ${a.kind} failed:`, rollbackErr); }
    }
    throw err;
  } finally {
    graph.exitTrustedContext();
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/** Rollback data shared by the rename-based handlers (note & folder refactor):
 *  the move endpoints plus verbatim pre-images to restore. */
interface RenameRollback {
  fromPath: string;
  toPath: string;
  preImages: Record<string, string>;
  transitions: PathTransition[];
  rewrittenPaths: string[];
}

register({
  kind: 'graph-triples',
  apply: async (ctx, p): Promise<null> => { await applyTurtle(ctx, p.turtle); return null; },
  // Triples ran last by construction — nothing after them to undo. Triples
  // rollback would require an rdflib snapshot; skipped per #418's
  // "triples-last" convention.
  rollback: async () => {},
  affectsNodes: (_ctx, p) => p.affectsNodeUris,
});

register({
  kind: 'note',
  apply: async (ctx, p): Promise<{ resolvedPath: string }> => {
    const finalPath = await resolveCollidingPath(ctx.rootPath, p.relativePath);
    // `writeFile` creates the file (and its parents) itself. A `createFile`
    // first would only touch an empty file into place — which the note's
    // history then has to record as its baseline, leaving every AI-filed note
    // with a junk empty first revision (#1158). Payloads apply sequentially, so
    // the write still claims the path before the next payload resolves its own.
    await notebaseFs.writeFile(ctx.rootPath, finalPath, p.content);
    await graph.indexNote(ctx, finalPath, p.content);
    if (p.backlink) {
      const noteUri = graph.noteUriFor(ctx, finalPath);
      if (noteUri) {
        await applyTurtle(
          ctx,
          `<${p.backlink.fromUri}> <${p.backlink.predicate}> <${noteUri}> .`,
        );
      }
    }
    return { resolvedPath: finalPath };
  },
  rollback: async (ctx, data) => {
    await safeDeleteFile(ctx, data.resolvedPath);
    graph.removeNote(ctx, data.resolvedPath);
  },
  affectsNodes: (ctx, p) => {
    const uri = graph.noteUriFor(ctx, p.relativePath);
    return uri ? [uri] : [];
  },
});

register({
  kind: 'excerpt',
  apply: async (ctx, p): Promise<{ excerptPath: string }> => {
    // #104: file a thought:Excerpt node so claim-extraction can anchor its
    // evidence. Mirrors the `note` case — write the .ttl then index directly
    // (rather than waiting on the chokidar watcher) so the graph reflects it
    // immediately for the claim notes' `[[quote::id]]` edges in the same bundle.
    const relativePath = `.minerva/excerpts/${p.excerptId}.ttl`;
    await notebaseFs.createFile(ctx.rootPath, relativePath);
    await notebaseFs.writeFile(ctx.rootPath, relativePath, p.excerptTtl);
    graph.indexExcerpt(ctx, p.excerptId, p.excerptTtl);
    return { excerptPath: relativePath };
  },
  rollback: async (ctx, data) => {
    await safeDeleteFile(ctx, data.excerptPath);
    // No graph.removeExcerpt today; rollback is best-effort and a reindex
    // reconciles any drift (same posture as the triples-last convention).
  },
});

register({
  kind: 'excerpt-evidence',
  apply: async (ctx, p): Promise<{ excerptId: string; excerptPath: string; before: string }> => {
    // Append the evidence edge to the excerpt's meta.ttl (durable + reference-
    // not-copy). Recompute against the CURRENT ttl, idempotently, so a
    // concurrent evidence edit isn't clobbered and re-attaching the same edge is
    // a no-op. Pre-image captured for verbatim rollback (mirrors note-rewrite).
    const excerptPath = `.minerva/excerpts/${p.excerptId}.ttl`;
    const before = await notebaseFs.readFile(ctx.rootPath, excerptPath);
    const line = `this: thought:${p.role} <${p.targetUri}> .`;
    const already = before.split('\n').some((l) => l.trim() === line);
    const next = already ? before : `${before.replace(/\n*$/, '')}\n${line}\n`;
    if (!already) {
      await notebaseFs.writeFile(ctx.rootPath, excerptPath, next);
      graph.indexExcerpt(ctx, p.excerptId, next);
    }
    return { excerptId: p.excerptId, excerptPath, before };
  },
  rollback: async (ctx, data) => {
    try {
      await notebaseFs.writeFile(ctx.rootPath, data.excerptPath, data.before);
      graph.indexExcerpt(ctx, data.excerptId, data.before);
    } catch { /* best-effort, a reindex reconciles */ }
  },
  affectsNodes: (_ctx, p) => p.affectsNodeUris,
});

register({
  kind: 'note-refactor',
  apply: async (ctx, p): Promise<RenameRollback> => {
    // Capture pre-images of every file the refactor will touch BEFORE applying,
    // so rollback can restore them verbatim (a reverse rename can mis-rewrite a
    // note that already linked to the destination). planRename also runs the
    // guardrails (collision / no-op / unsafe / folder) — it throws on violation.
    const plan = await planRename(ctx.rootPath, p.fromPath, p.toPath);
    const preImages: Record<string, string> = {
      [p.fromPath]: await notebaseFs.readFile(ctx.rootPath, p.fromPath),
    };
    for (const a of plan.affectedNotes) {
      if (!(a.path in preImages)) preImages[a.path] = a.before;
    }

    const { transitions, rewrittenPaths } = await renameWithLinkRewrites(ctx.rootPath, p.fromPath, p.toPath, {
      markPathHandled,
      reindexHook: (relPath, content) => {
        if (relPath.endsWith('.md')) {
          search.indexNote(ctx, relPath, content);
          void vectors.indexNote(ctx, relPath, content);
        }
      },
      removeHook: (relPath) => {
        search.removeNote(ctx, relPath);
        void vectors.removeNote(ctx, relPath);
      },
    });
    return { fromPath: p.fromPath, toPath: p.toPath, preImages, transitions, rewrittenPaths };
  },
  rollback: async (ctx, data) => {
    // Move the note back: drop the destination, then restore every captured
    // pre-image (the moved file at its original path + each rewritten note's
    // verbatim original content). Reindex each across graph/search/vectors.
    markPathHandled(data.toPath);
    await safeDeleteFile(ctx, data.toPath);
    graph.removeNote(ctx, data.toPath);
    search.removeNote(ctx, data.toPath);
    void vectors.removeNote(ctx, data.toPath);
    for (const [relPath, content] of Object.entries(data.preImages)) {
      try {
        markPathHandled(relPath);
        await notebaseFs.writeFile(ctx.rootPath, relPath, content);
        await graph.indexNote(ctx, relPath, content);
        search.indexNote(ctx, relPath, content);
        void vectors.indexNote(ctx, relPath, content);
      } catch (err) {
        logger('approval').warn(`note-refactor rollback restore failed for ${relPath}:`, err);
      }
    }
  },
});

register({
  kind: 'note-delete',
  apply: async (ctx, p): Promise<{ path: string; content: string }> => {
    // Capture the file content before deleting so rollback can recreate it
    // verbatim. markPathHandled suppresses the watcher's re-index of the
    // unlink (it still broadcasts NOTEBASE_FILE_DELETED so the renderer
    // closes the tab + refreshes the tree). De-index across graph/search/
    // vectors mirrors the manual delete path.
    const content = await notebaseFs.readFile(ctx.rootPath, p.path);
    markPathHandled(p.path);
    await notebaseFs.deleteFile(ctx.rootPath, p.path);
    graph.removeNote(ctx, p.path);
    search.removeNote(ctx, p.path);
    void vectors.removeNote(ctx, p.path);
    return { path: p.path, content };
  },
  rollback: async (ctx, data) => {
    // Recreate the deleted note from its captured pre-image and reindex.
    try {
      markPathHandled(data.path);
      await notebaseFs.createFile(ctx.rootPath, data.path);
      await notebaseFs.writeFile(ctx.rootPath, data.path, data.content);
      await graph.indexNote(ctx, data.path, data.content);
      search.indexNote(ctx, data.path, data.content);
      void vectors.indexNote(ctx, data.path, data.content);
    } catch (err) {
      logger('approval').warn(`note-delete rollback restore failed for ${data.path}:`, err);
    }
  },
});

register({
  kind: 'folder-refactor',
  apply: async (ctx, p): Promise<RenameRollback> => {
    // Capture pre-images of every note the folder move touches (relocated notes
    // + inbound-rewritten referrers) BEFORE applying. planFolderRename also runs
    // the guardrails (collision / into-self / not-a-folder) — it throws on
    // violation. Assets (images/pdfs) don't need pre-images: rollback moves the
    // whole folder back with a pure fs rename, relocating them verbatim.
    const plan = await planFolderRename(ctx.rootPath, p.fromPath, p.toPath);
    const preImages: Record<string, string> = {};
    for (const a of plan.affectedNotes) preImages[a.path] = a.before;

    const { transitions, rewrittenPaths } = await renameWithLinkRewrites(ctx.rootPath, p.fromPath, p.toPath, {
      markPathHandled,
      reindexHook: (relPath, content) => {
        if (relPath.endsWith('.md')) { search.indexNote(ctx, relPath, content); void vectors.indexNote(ctx, relPath, content); }
      },
      removeHook: (relPath) => { search.removeNote(ctx, relPath); void vectors.removeNote(ctx, relPath); },
    });
    return { fromPath: p.fromPath, toPath: p.toPath, preImages, transitions, rewrittenPaths };
  },
  rollback: async (ctx, data) => {
    // De-index the relocated notes at their new paths, move the whole folder
    // back with a pure fs rename (no link rewrite — the pre-images below undo
    // the link edits), then restore every captured pre-image verbatim.
    for (const t of data.transitions) {
      graph.removeNote(ctx, t.new); search.removeNote(ctx, t.new); void vectors.removeNote(ctx, t.new);
    }
    markPathHandled(data.fromPath);
    markPathHandled(data.toPath);
    try {
      await notebaseFs.rename(ctx.rootPath, data.toPath, data.fromPath);
    } catch (err) {
      logger('approval').warn(`folder-refactor rollback move-back failed for ${data.toPath} → ${data.fromPath}:`, err);
    }
    for (const [relPath, content] of Object.entries(data.preImages)) {
      try {
        markPathHandled(relPath);
        await notebaseFs.writeFile(ctx.rootPath, relPath, content);
        await graph.indexNote(ctx, relPath, content);
        search.indexNote(ctx, relPath, content);
        void vectors.indexNote(ctx, relPath, content);
      } catch (err) {
        logger('approval').warn(`folder-refactor rollback restore failed for ${relPath}:`, err);
      }
    }
  },
});

register({
  kind: 'folder-delete',
  apply: async (ctx, p): Promise<{ path: string; files: { path: string; bytes: Uint8Array }[] }> => {
    // Capture every file under the folder as bytes (round-trips notes AND
    // binary assets), de-index its notes, then remove the folder recursively.
    // The bytes let rollback recreate the whole tree verbatim.
    const files = await listAllFiles(ctx.rootPath, p.path);
    const captured: { path: string; bytes: Uint8Array }[] = [];
    for (const f of files) {
      captured.push({ path: f, bytes: await notebaseFs.readBinaryFile(ctx.rootPath, f) });
      markPathHandled(f);
      if (isIndexable(f)) { graph.removeNote(ctx, f); search.removeNote(ctx, f); void vectors.removeNote(ctx, f); }
    }
    markPathHandled(p.path);
    await notebaseFs.deleteFolder(ctx.rootPath, p.path);
    return { path: p.path, files: captured };
  },
  rollback: async (ctx, data) => {
    // Recreate each captured file (writeBinaryFile makes parent dirs), then
    // reindex the notes across graph/search/vectors.
    for (const f of data.files) {
      try {
        markPathHandled(f.path);
        await notebaseFs.writeBinaryFile(ctx.rootPath, f.path, f.bytes);
        if (isIndexable(f.path)) {
          const content = await notebaseFs.readFile(ctx.rootPath, f.path);
          await graph.indexNote(ctx, f.path, content);
          search.indexNote(ctx, f.path, content);
          void vectors.indexNote(ctx, f.path, content);
        }
      } catch (err) {
        logger('approval').warn(`folder-delete rollback restore failed for ${f.path}:`, err);
      }
    }
  },
});

register({
  kind: 'note-rewrite',
  apply: async (ctx, p): Promise<{ path: string; before: string }> => {
    // Overwrite an existing note in place (#936). Guardrails: must be a .md
    // note that already exists — readFile throws ENOENT for a missing file,
    // which propagates and rolls the bundle back (a rewrite of a nonexistent
    // note is a bug in the caller, not a note to create). Capture the prior
    // content as a pre-image for rollback, then write + reindex inline.
    // markPathHandled dedups the watcher's re-index of our own write; the
    // renderer refresh is driven by the IPC layer via NOTEBASE_REWRITTEN
    // (which consumes ApproveResult.rewrittenPaths), mirroring how the
    // bypassing auto-tag/set_properties paths broadcast today.
    if (!p.path.endsWith('.md')) {
      throw new Error(`note-rewrite: refusing to rewrite non-markdown path "${p.path}".`);
    }
    const before = await notebaseFs.readFile(ctx.rootPath, p.path);
    markPathHandled(p.path);
    await notebaseFs.writeFile(ctx.rootPath, p.path, p.content);
    await graph.indexNote(ctx, p.path, p.content);
    search.indexNote(ctx, p.path, p.content);
    void vectors.indexNote(ctx, p.path, p.content);
    return { path: p.path, before };
  },
  rollback: async (ctx, data) => {
    // Restore the note's captured pre-image and reindex (#936). Same posture
    // as note-delete rollback: best-effort, markPathHandled dedups the
    // watcher, reindex across graph/search/vectors.
    try {
      markPathHandled(data.path);
      await notebaseFs.writeFile(ctx.rootPath, data.path, data.before);
      await graph.indexNote(ctx, data.path, data.before);
      search.indexNote(ctx, data.path, data.before);
      void vectors.indexNote(ctx, data.path, data.before);
    } catch (err) {
      logger('approval').warn(`note-rewrite rollback restore failed for ${data.path}:`, err);
    }
  },
  affectsNodes: (ctx, p) => {
    // The rewritten note already exists, so it has a stable IRI. Tie it to
    // the proposal so the trust-integrity query can join an LLM-attributed
    // rewrite back to its approval, and so an established-note rewrite is
    // covered by the escalation check (#936).
    const uri = graph.noteUriFor(ctx, p.path);
    return uri ? [uri] : [];
  },
});

register({
  kind: 'source-meta',
  apply: async (ctx, p): Promise<{ sourceId: string; before: string }> => {
    // Upsert the proposed predicates into the source's meta.ttl (#943).
    // Capture the whole meta.ttl as a pre-image so rollback restores it
    // verbatim. setSourceProperties writes + reindexes; the .minerva/sources
    // watcher notifies the renderer (same path the direct write used).
    const before = await readMeta(sourceMetaPath(ctx.rootPath, p.sourceId));
    await setSourceProperties(ctx.rootPath, p.sourceId, p.updates);
    return { sourceId: p.sourceId, before };
  },
  rollback: async (ctx, data) => {
    // Restore the source's captured pre-image meta.ttl and reindex (#943).
    try {
      await restoreSourceMeta(ctx.rootPath, data.sourceId, data.before);
    } catch (err) {
      logger('approval').warn(`source-meta rollback restore failed for ${data.sourceId}:`, err);
    }
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Delete a file during rollback, swallowing a missing-file error. Rollback is
 *  best-effort and the target may already be gone (a later payload never landed,
 *  or the watcher/user removed it); a failed reverse-delete must not mask the
 *  original apply error. Shared by the note / excerpt / note-refactor rollbacks. */
async function safeDeleteFile(ctx: ProjectContext, relativePath: string): Promise<void> {
  try { await notebaseFs.deleteFile(ctx.rootPath, relativePath); }
  catch { /* file may already be gone */ }
}

/** Apply-time path dedup. Mirrors `resolveDropName` in drop-import. */
async function resolveCollidingPath(rootPath: string, relativePath: string): Promise<string> {
  const path = await import('node:path');
  const fs = await import('node:fs/promises');
  const dir = path.dirname(relativePath);
  const ext = path.extname(relativePath);
  const stem = path.basename(relativePath, ext);
  let candidate = relativePath;
  let suffix = 2;
  while (true) {
    try {
      await fs.access(path.join(rootPath, candidate));
      // exists → try next
      candidate = dir === '.'
        ? `${stem}-${suffix}${ext}`
        : `${dir}/${stem}-${suffix}${ext}`;
      suffix++;
      if (suffix > 99) throw new Error(`resolveCollidingPath: 99 collisions on ${relativePath}`);
    } catch (err) {
      // ENOENT — slot is free
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return candidate;
      throw err;
    }
  }
}
