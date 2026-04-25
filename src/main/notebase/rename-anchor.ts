import * as notebaseFs from './fs';
import { rewriteAnchorInLinks } from './link-rewriting';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';

export interface RenameAnchorOptions {
  markPathHandled?: (relativePath: string) => void;
  reindexHook?: (relativePath: string, content: string) => void;
}

export interface RenameAnchorResult {
  rewrittenPaths: string[];
}

/**
 * Rewrite every `[[targetPath#oldSlug]]` wiki-link in the thoughtbase to
 * point at `newSlug`. Called when a user confirms a heading-rename
 * suggestion. Returns the list of notes whose content changed so the
 * caller can emit a NOTEBASE_REWRITTEN notification.
 */
export async function renameAnchor(
  rootPath: string,
  targetRelativePath: string,
  oldSlug: string,
  newSlug: string,
  opts: RenameAnchorOptions = {},
): Promise<RenameAnchorResult> {
  const { markPathHandled, reindexHook } = opts;
  const ctx = projectContext(rootPath);

  const referringNotes = graph.findNotesLinkingToAnchor(ctx, targetRelativePath, oldSlug);
  const rewrittenPaths: string[] = [];

  for (const notePath of referringNotes) {
    try {
      const content = await notebaseFs.readFile(rootPath, notePath);
      const rewritten = rewriteAnchorInLinks(content, targetRelativePath, oldSlug, newSlug);
      if (rewritten === content) continue;
      markPathHandled?.(notePath);
      await notebaseFs.writeFile(rootPath, notePath, rewritten);
      await graph.indexNote(ctx, notePath, rewritten);
      reindexHook?.(notePath, rewritten);
      rewrittenPaths.push(notePath);
    } catch (err) {
      console.error(`[minerva] Anchor rewrite failed for ${notePath}:`, err instanceof Error ? err.message : err);
    }
  }

  return { rewrittenPaths };
}
