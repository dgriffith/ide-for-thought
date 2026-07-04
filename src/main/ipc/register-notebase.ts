import { ipcMain, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import * as notebaseFs from '../notebase/fs';
import { renameWithLinkRewrites } from '../notebase/rename';
import { mergeNotes, previewMergeNotes } from '../notebase/merge';
import { renameAnchor } from '../notebase/rename-anchor';
import { renameSource, renameExcerpt } from '../notebase/rename-source-excerpt';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { writeAndReindex } from '../notebase/write-pipeline';
import * as search from '../search/index';
import * as vectors from '../embeddings/vector-store';
import { clearRecentProjects } from '../recent-projects';
import { rebuildMenu } from '../menu';
import { createWindow, openProjectInWindow, closeProjectInWindow, markPathHandled, windowsForProject } from '../window-manager';
import { getOnboardingDismissed, setOnboardingDismissed } from '../project-config';
import { dropImport } from '../notebase/drop-import';
import { searchInNotes, replaceInNotes, type SearchOptions, type ReplaceSelection } from '../notebase/search-in-notes';
import { handle } from './typed-ipc';
import {
  winFromEvent,
  rootPathFromEvent,
  withRootPath,
  withRootPathOr,
  reindexFile,
  removeFromIndexes,
  listIndexableFiles,
  persistIndexes,
  broadcastRewritten,
  hooks,
} from './helpers';

export function registerNotebase(): void {
  handle(Channels.NOTEBASE_OPEN, async (e) => {
    const meta = await notebaseFs.openNotebase();
    if (meta) {
      const win = winFromEvent(e);
      await openProjectInWindow(win, meta.rootPath);
    }
    return meta;
  });

  handle(Channels.NOTEBASE_OPEN_PATH, async (e, rootPath: string) => {
    const win = winFromEvent(e);
    await openProjectInWindow(win, rootPath);
    return { rootPath, name: path.basename(rootPath) };
  });

  handle(Channels.NOTEBASE_NEW_PROJECT, async (e) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose location for new thoughtbase',
      buttonLabel: 'Create Thoughtbase',
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const rootPath = result.filePaths[0];
    const win = winFromEvent(e);
    await openProjectInWindow(win, rootPath);
    return { rootPath, name: path.basename(rootPath) };
  });

  handle(Channels.NOTEBASE_CLOSE, (e) => {
    const win = winFromEvent(e);
    closeProjectInWindow(win.id);
    return null;
  });

  // ── "…in new window" variants ─────────────────────────────────────────────
  // Renderer decides whether the user picked "this window" (existing IPCs) or
  // "new window" (these). The picker runs in main so we can parent it to the
  // invoking window for focus; the fresh window is created once the user
  // commits to a path.

  handle(Channels.NOTEBASE_OPEN_IN_NEW_WINDOW, async (e) => {
    const parentWin = winFromEvent(e);
    const result = await dialog.showOpenDialog(parentWin, {
      properties: ['openDirectory'],
      title: 'Open thoughtbase',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const rootPath = result.filePaths[0];
    const freshWin = createWindow();
    freshWin.webContents.once('did-finish-load', async () => {
      await openProjectInWindow(freshWin, rootPath);
      freshWin.webContents.send(Channels.PROJECT_OPENED, { rootPath, name: path.basename(rootPath) });
    });
    return { rootPath, name: path.basename(rootPath) };
  });

  handle(Channels.NOTEBASE_NEW_PROJECT_IN_NEW_WINDOW, async (e) => {
    const parentWin = winFromEvent(e);
    const result = await dialog.showOpenDialog(parentWin, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose location for new thoughtbase',
      buttonLabel: 'Create Thoughtbase',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const rootPath = result.filePaths[0];
    const freshWin = createWindow();
    freshWin.webContents.once('did-finish-load', async () => {
      await openProjectInWindow(freshWin, rootPath);
      freshWin.webContents.send(Channels.PROJECT_OPENED, { rootPath, name: path.basename(rootPath) });
    });
    return { rootPath, name: path.basename(rootPath) };
  });

  handle(Channels.NOTEBASE_OPEN_PATH_IN_NEW_WINDOW, (_e, rootPath: string) => {
    const freshWin = createWindow();
    freshWin.webContents.once('did-finish-load', async () => {
      await openProjectInWindow(freshWin, rootPath);
      freshWin.webContents.send(Channels.PROJECT_OPENED, { rootPath, name: path.basename(rootPath) });
    });
    return { rootPath, name: path.basename(rootPath) };
  });

  handle(Channels.RECENT_CLEAR, () => {
    clearRecentProjects();
    rebuildMenu();
  });

  handle(Channels.NOTEBASE_LIST_FILES, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return notebaseFs.listFiles(rootPath);
  });

  handle(Channels.NOTEBASE_READ_FILE, withRootPath(async (rootPath, relativePath: string) => {
    return notebaseFs.readFile(rootPath, relativePath);
  }));

  handle(Channels.NOTEBASE_READ_BINARY, withRootPath(async (rootPath, relativePath: string) => {
    // Pass the bytes back as a Buffer; Electron's structured-clone
    // bridge wraps it in a Uint8Array on the renderer side.
    return notebaseFs.readBinaryFile(rootPath, relativePath);
  }));

  handle(Channels.NOTEBASE_WRITE_BINARY, withRootPath(async (rootPath, relativePath: string, bytes: Uint8Array) => {
    // The renderer wraps payload as a Uint8Array; structured-clone
    // hands us a Buffer at this end. Either way `writeBinaryFile`
    // re-wraps as a strict Uint8Array view.
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    await notebaseFs.writeBinaryFile(rootPath, relativePath, view);
  }));

  handle(Channels.NOTEBASE_FILE_EXISTS, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return false;
    return notebaseFs.fileExists(rootPath, relativePath);
  });

  handle(Channels.NOTEBASE_WRITE_FILE, withRootPath(async (rootPath, relativePath: string, content: string) => {
    // Renderer-initiated save — it already has the content, so suppress
    // the rewritten broadcast (no need to tell the renderer it just wrote).
    await writeAndReindex(rootPath, relativePath, content, hooks, {
      suppressRewrittenBroadcast: true,
    });
  }));

  handle(Channels.NOTEBASE_CREATE_FILE, withRootPath(async (rootPath, relativePath: string) => {
    markPathHandled(relativePath);
    await notebaseFs.createFile(rootPath, relativePath);
    const ctx = projectContext(rootPath);
    await graph.indexNote(ctx, relativePath, '');
    search.indexNote(ctx, relativePath, '');
  }));

  handle(Channels.NOTEBASE_DELETE_FILE, withRootPath(async (rootPath, relativePath: string) => {
    markPathHandled(relativePath);
    await notebaseFs.deleteFile(rootPath, relativePath);
    removeFromIndexes(rootPath, relativePath);
    await persistIndexes(rootPath);
  }));

  handle(Channels.NOTEBASE_CREATE_FOLDER, withRootPath(async (rootPath, relativePath: string) => {
    await notebaseFs.createFolder(rootPath, relativePath);
  }));

  handle(Channels.NOTEBASE_DELETE_FOLDER, withRootPath(async (rootPath, relativePath: string) => {
    const files = await listIndexableFiles(rootPath, relativePath);
    await notebaseFs.deleteFolder(rootPath, relativePath);
    for (const f of files) removeFromIndexes(rootPath, f);
    await persistIndexes(rootPath);
  }));

  handle(Channels.NOTEBASE_RENAME, withRootPath(async (rootPath, oldRelPath: string, newRelPath: string) => {
    const ctx = projectContext(rootPath);
    const { transitions, rewrittenPaths } = await renameWithLinkRewrites(rootPath, oldRelPath, newRelPath, {
      markPathHandled,
      reindexHook: (relPath, content) => {
        if (relPath.endsWith(".md")) {
          search.indexNote(ctx, relPath, content);
          void vectors.indexNote(ctx, relPath, content); // #835
        }
      },
      removeHook: (relPath) => {
        search.removeNote(ctx, relPath);
        void vectors.removeNote(ctx, relPath); // #835
      },
    });

    // Broadcast to every window showing this project so their editor tabs
    // refresh paths and content instead of silently overwriting on next save.
    for (const targetWin of windowsForProject(rootPath)) {
      if (transitions.length > 0) {
        targetWin.webContents.send(Channels.NOTEBASE_RENAMED, transitions);
      }
      if (rewrittenPaths.length > 0) {
        targetWin.webContents.send(Channels.NOTEBASE_REWRITTEN, rewrittenPaths);
      }
    }

    await persistIndexes(rootPath);
  }));

  handle(Channels.NOTEBASE_MERGE_PREVIEW, withRootPath(async (rootPath, sourceRelPath: string, targetRelPath: string) => {
    return previewMergeNotes(rootPath, sourceRelPath, targetRelPath);
  }));

  handle(Channels.NOTEBASE_MERGE, withRootPath(async (rootPath, sourceRelPath: string, targetRelPath: string, separator?: string) => {
    const ctx = projectContext(rootPath);
    const result = await mergeNotes(rootPath, sourceRelPath, targetRelPath, {
      separator,
      markPathHandled,
      reindexHook: (relPath, content) => {
        if (relPath.endsWith(".md")) {
          search.indexNote(ctx, relPath, content);
          void vectors.indexNote(ctx, relPath, content); // #835
        }
      },
      removeHook: (relPath) => {
        search.removeNote(ctx, relPath);
        void vectors.removeNote(ctx, relPath); // #835
      },
    });
    // Broadcast: source disappeared (RENAMED with one transition signals
    // editor tabs to drop / reroute) plus the rewritten set so other
    // windows reload affected files.
    for (const targetWin of windowsForProject(rootPath)) {
      targetWin.webContents.send(Channels.NOTEBASE_RENAMED, [
        { old: sourceRelPath, new: '' /* sentinel: deletion */ },
      ]);
      if (result.rewrittenPaths.length > 0) {
        targetWin.webContents.send(Channels.NOTEBASE_REWRITTEN, [
          ...result.rewrittenPaths,
          targetRelPath,
        ]);
      } else {
        targetWin.webContents.send(Channels.NOTEBASE_REWRITTEN, [targetRelPath]);
      }
    }
    await persistIndexes(rootPath);
    return result;
  }));

  handle(Channels.NOTEBASE_RENAME_SOURCE, withRootPath(async (rootPath, oldId: string, newId: string) => {
    const ctx = projectContext(rootPath);
    const { rewrittenPaths } = await renameSource(rootPath, oldId, newId, {
      markPathHandled,
      reindexHook: (relPath, content) => {
        if (relPath.endsWith('.md')) search.indexNote(ctx, relPath, content);
      },
    });
    broadcastRewritten(rootPath, rewrittenPaths);
    await persistIndexes(rootPath);
    return { rewrittenPaths };
  }));

  handle(Channels.NOTEBASE_RENAME_EXCERPT, withRootPath(async (rootPath, oldId: string, newId: string) => {
    const ctx = projectContext(rootPath);
    const { rewrittenPaths } = await renameExcerpt(rootPath, oldId, newId, {
      markPathHandled,
      reindexHook: (relPath, content) => {
        if (relPath.endsWith('.md')) search.indexNote(ctx, relPath, content);
      },
    });
    broadcastRewritten(rootPath, rewrittenPaths);
    await persistIndexes(rootPath);
    return { rewrittenPaths };
  }));

  ipcMain.handle(
    Channels.NOTEBASE_RENAME_ANCHOR,
    withRootPath(async (rootPath, targetRelativePath: string, oldSlug: string, newSlug: string) => {
      const ctx = projectContext(rootPath);
      const { rewrittenPaths } = await renameAnchor(rootPath, targetRelativePath, oldSlug, newSlug, {
        markPathHandled,
        reindexHook: (relPath, content) => {
          if (relPath.endsWith('.md')) search.indexNote(ctx, relPath, content);
        },
      });

      // Same tab-refresh pipeline as #145 — open editors for rewritten notes
      // refresh in place so the next auto-save doesn't undo the anchor rewrite.
      if (rewrittenPaths.length > 0) {
        for (const targetWin of windowsForProject(rootPath)) {
          targetWin.webContents.send(Channels.NOTEBASE_REWRITTEN, rewrittenPaths);
        }
      }

      await persistIndexes(rootPath);
      return { rewrittenPaths };
    }),
  );

  handle(Channels.NOTEBASE_COPY, withRootPath(async (rootPath, srcRelPath: string, destRelPath: string) => {
    await notebaseFs.copyItem(rootPath, srcRelPath, destRelPath);
    const stat = await fs.stat(path.join(rootPath, destRelPath));
    if (stat.isDirectory()) {
      const files = await listIndexableFiles(rootPath, destRelPath);
      for (const f of files) await reindexFile(rootPath, f);
    } else {
      await reindexFile(rootPath, destRelPath);
    }
    await persistIndexes(rootPath);
  }));

  handle(Channels.NOTEBASE_SEARCH_IN_NOTES, async (e, opts: SearchOptions) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return searchInNotes(rootPath, opts);
  });

  handle(Channels.NOTEBASE_REPLACE_IN_NOTES, async (e, opts: SearchOptions & { replacement: string; selections: ReplaceSelection[] }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { changedPaths: [], replacedCount: 0 };
    const result = await replaceInNotes(rootPath, opts);
    if (result.changedPaths.length > 0) {
      // Re-index each rewritten file so the graph + search index stay in
      // sync, then tell open editor tabs to reload from disk.
      for (const rel of result.changedPaths) await reindexFile(rootPath, rel);
      await persistIndexes(rootPath);
      broadcastRewritten(rootPath, result.changedPaths);
    }
    return result;
  });

  handle(Channels.NOTEBASE_GET_ONBOARDING_DISMISSED, withRootPathOr(false, (rootPath) =>
    getOnboardingDismissed(rootPath)));

  handle(Channels.NOTEBASE_SET_ONBOARDING_DISMISSED, withRootPath((rootPath, dismissed: boolean) => {
    setOnboardingDismissed(rootPath, dismissed === true);
  }));

  ipcMain.handle(Channels.FILES_DROP_IMPORT, withRootPath(async (rootPath, targetFolder: string, localPaths: string[]) => {
    return await dropImport(rootPath, targetFolder ?? '', localPaths ?? []);
  }));
}
