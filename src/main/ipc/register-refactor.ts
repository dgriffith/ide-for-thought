import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import { writeAndReindex } from '../notebase/write-pipeline';
import { markPathHandled } from '../window-manager';
import { runAutoTag, applyAutoTag } from '../llm/auto-tag';
import {
  suggestLinksTo,
  fileAutoLinkOutbound,
  suggestLinksInbound,
  fileAutoLinkInbound,
} from '../llm/auto-link';
import {
  formatNoteContent,
  formatFile as formatFileOnDisk,
  formatFolder as formatFolderOnDisk,
} from '../formatter/orchestrator';
import type { FormatSettings } from '../../shared/formatter/engine';
import type { AutoLinkSuggestion } from '../../shared/refactor/auto-link';
import type { AutoLinkInboundSuggestion } from '../../shared/refactor/auto-link-inbound';
import { appendSeeAlsoLink } from '../../shared/refactor/see-also';
import * as notebaseFs from '../notebase/fs';
import { rootPathFromEvent, persistIndexes, broadcastRewritten, hooks } from './helpers';

export function registerRefactor(): void {
  // Auto-tag is two-phase (#940): SUGGEST asks the LLM for tags and writes
  // NOTHING; the renderer shows a review dialog; APPLY routes the accepted tags
  // through the approval engine. This closes the historical bypass where the
  // one-shot handler wrote directly with no proposal record.
  ipcMain.handle(Channels.REFACTOR_AUTO_TAG_SUGGEST, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const plan = await runAutoTag(rootPath, relativePath);
    return { added: plan.added };
  });

  ipcMain.handle(
    Channels.REFACTOR_AUTO_TAG_APPLY,
    async (e, relativePath: string, acceptedTags: string[]) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');
      if (!Array.isArray(acceptedTags) || acceptedTags.length === 0) return { applied: [] };
      const { applied, rewrittenPaths } = await applyAutoTag(rootPath, relativePath, acceptedTags);
      // The approval engine wrote the note; broadcast so an open editor reloads
      // the new frontmatter (approval.ts stays Electron-free and returns paths).
      broadcastRewritten(rootPath, rewrittenPaths);
      return { applied };
    },
  );

  ipcMain.handle(Channels.REFACTOR_AUTO_LINK_SUGGEST, async (e, activeRelPath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return suggestLinksTo(rootPath, activeRelPath);
  });

  // Accept a semantic "suggested link" (#840): file `[[target]]` under the
  // active note's "See also" section. Unlike AutoLink, semantic neighbors share
  // no anchor word, so it appends rather than inlining. Idempotent.
  ipcMain.handle(Channels.REFACTOR_APPLY_SUGGESTED_LINK, async (e, activeRelPath: string, targetRelPath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const content = await notebaseFs.readFile(rootPath, activeRelPath);
    const { content: next, changed } = appendSeeAlsoLink(content, targetRelPath);
    if (changed) await writeAndReindex(rootPath, activeRelPath, next, hooks);
    return { changed };
  });

  ipcMain.handle(
    Channels.REFACTOR_AUTO_LINK_APPLY,
    async (e, activeRelPath: string, accepted: AutoLinkSuggestion[]) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');

      // Route the rewrite through the approval engine (#941) rather than
      // writing directly. broadcastRewritten reloads an open editor from the
      // paths the approval apply returns.
      const { applied, skipped, rewrittenPaths } = await fileAutoLinkOutbound(
        rootPath,
        activeRelPath,
        accepted,
      );
      broadcastRewritten(rootPath, rewrittenPaths);
      return { applied, skipped };
    },
  );

  ipcMain.handle(Channels.REFACTOR_AUTO_LINK_INBOUND_SUGGEST, async (e, activeRelPath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return suggestLinksInbound(rootPath, activeRelPath);
  });

  // Formatter (issue #153)
  ipcMain.handle(
    Channels.FORMATTER_FORMAT_CONTENT,
    (e, content: string, settings: FormatSettings, relativePath?: string) =>
      formatNoteContent(content, settings, relativePath, rootPathFromEvent(e) ?? undefined),
  );

  // Project-scoped formatter settings (#154). Stored in .minerva/formatter.json
  // so rule choices travel with the thoughtbase in git.
  ipcMain.handle(Channels.FORMATTER_LOAD_SETTINGS, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { enabled: {}, configs: {} };
    try {
      const p = path.join(rootPath, '.minerva', 'formatter.json');
      const data = await fs.readFile(p, 'utf-8');
      const parsed = JSON.parse(data) as { enabled?: Record<string, boolean>; configs?: Record<string, unknown> };
      return {
        enabled: (parsed?.enabled && typeof parsed.enabled === 'object') ? parsed.enabled : {},
        configs: (parsed?.configs && typeof parsed.configs === 'object') ? parsed.configs : {},
      };
    } catch { return { enabled: {}, configs: {} }; }
  });

  ipcMain.handle(Channels.FORMATTER_SAVE_SETTINGS, async (e, settings: FormatSettings) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
    const p = path.join(rootPath, '.minerva', 'formatter.json');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(settings, null, 2), 'utf-8');
  });

  ipcMain.handle(
    Channels.FORMATTER_FORMAT_FILE,
    async (e, relativePath: string, settings: FormatSettings) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');
      const result = await formatFileOnDisk(rootPath, relativePath, settings);
      const touched = result.changed
        ? [relativePath, ...result.cascadedPaths]
        : result.cascadedPaths;
      if (touched.length > 0) {
        for (const p of touched) markPathHandled(p);
        await persistIndexes(rootPath);
        broadcastRewritten(rootPath, touched);
      }
      return result;
    },
  );

  ipcMain.handle(
    Channels.FORMATTER_FORMAT_FOLDER,
    async (e, relDir: string, settings: FormatSettings) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');
      const summary = await formatFolderOnDisk(rootPath, relDir ?? '', settings);
      const touched = [...summary.changedPaths, ...summary.cascadedPaths];
      if (touched.length > 0) {
        for (const p of touched) markPathHandled(p);
        await persistIndexes(rootPath);
        broadcastRewritten(rootPath, touched);
      }
      return summary;
    },
  );

  ipcMain.handle(
    Channels.REFACTOR_AUTO_LINK_INBOUND_APPLY,
    async (e, activeRelPath: string, accepted: AutoLinkInboundSuggestion[]) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');

      // Route through the approval engine (#941): all touched source notes are
      // filed as ONE note_rewrite proposal (atomic — a partial failure rolls the
      // whole batch back) and applied. broadcastRewritten emits a single
      // NOTEBASE_REWRITTEN for every rewritten source so open editors reload.
      const { applied, skipped, rewrittenPaths } = await fileAutoLinkInbound(
        rootPath,
        activeRelPath,
        accepted,
      );
      broadcastRewritten(rootPath, rewrittenPaths);
      return { applied, skipped, touchedPaths: rewrittenPaths };
    },
  );
}
