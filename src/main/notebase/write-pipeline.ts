/**
 * The 6-step write pipeline used everywhere a server-side flow saves a
 * note (#341). Before extraction this sequence was open-coded in five
 * IPC handlers, which silently drifted: REFACTOR_AUTO_TAG and
 * REFACTOR_AUTO_LINK_APPLY had no heading-rename detection, so a tool
 * that rewrote a heading couldn't prompt for incoming-link rewrites
 * the way a direct edit does.
 *
 * The pipeline:
 *   1. mark the path so the watcher's deduplication skips it
 *   2. write the file to disk
 *   3. re-run graph indexing (returns a heading-rename candidate if the
 *      edit looks like a rename of an anchored heading)
 *   4. re-run search indexing
 *   5. persist the search index (graph.ttl is a cold snapshot, #348)
 *   6. broadcast NOTEBASE_REWRITTEN so open editors refresh
 *   7. broadcast NOTEBASE_HEADING_RENAME_SUGGESTED if step 3 surfaced a
 *      rename candidate
 *
 * Callers inject the broadcast / mark hooks so tests can record what
 * fired without standing up Electron.
 */

import * as notebaseFs from './fs';
import * as graph from '../graph/index';
import * as search from '../search/index';
import { projectContext } from '../project-context-types';
import type { HeadingRenameCandidate } from '../graph/index';

export interface WritePipelineHooks {
  /** Called before the on-disk write so the watcher's dedup map can
   *  silence the about-to-fire change event. */
  markPathHandled: (relativePath: string) => void;
  /** Called after persistence with the list of paths that should
   *  refresh in open editors (NOTEBASE_REWRITTEN). */
  broadcastRewritten: (rootPath: string, paths: string[]) => void;
  /** Called when the graph reindex flagged a heading edit as a likely
   *  rename — the renderer pops a confirmation that routes back through
   *  NOTEBASE_RENAME_ANCHOR. */
  broadcastHeadingRename: (rootPath: string, candidate: HeadingRenameCandidate) => void;
}

export interface WritePipelineOpts {
  /** Skip the NOTEBASE_REWRITTEN broadcast. Used when:
   *   - the renderer initiated the write and already has the new content;
   *   - a batch caller (e.g. inbound auto-link apply) will emit one
   *     broadcast for every touched path at the end of its loop.
   */
  suppressRewrittenBroadcast?: boolean;
  /** Skip search.persist. Used by batch callers that will persist once
   *  after the loop. */
  skipPersist?: boolean;
}

export interface WriteAndReindexResult {
  headingRenameCandidate?: HeadingRenameCandidate;
}

export async function writeAndReindex(
  rootPath: string,
  relativePath: string,
  content: string,
  hooks: WritePipelineHooks,
  opts: WritePipelineOpts = {},
): Promise<WriteAndReindexResult> {
  const ctx = projectContext(rootPath);
  hooks.markPathHandled(relativePath);
  await notebaseFs.writeFile(rootPath, relativePath, content);
  const { headingRenameCandidate } = await graph.indexNote(ctx, relativePath, content);
  search.indexNote(ctx, relativePath, content);
  if (!opts.skipPersist) {
    await search.persist(ctx);
  }
  if (!opts.suppressRewrittenBroadcast) {
    hooks.broadcastRewritten(rootPath, [relativePath]);
  }
  if (headingRenameCandidate) {
    hooks.broadcastHeadingRename(rootPath, headingRenameCandidate);
  }
  return { headingRenameCandidate };
}
