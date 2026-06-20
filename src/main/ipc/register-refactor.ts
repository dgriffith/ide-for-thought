import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import { writeAndReindex } from '../notebase/write-pipeline';
import { markPathHandled } from '../window-manager';
import { runAutoTag } from '../llm/auto-tag';
import {
  suggestLinksTo,
  applyAutoLinkToSuggestions,
  suggestLinksInbound,
  applyInboundSuggestions,
} from '../llm/auto-link';
import {
  formatNoteContent,
  formatFile as formatFileOnDisk,
  formatFolder as formatFolderOnDisk,
} from '../formatter/orchestrator';
import type { FormatSettings } from '../../shared/formatter/engine';
import type { AutoLinkSuggestion } from '../../shared/refactor/auto-link';
import type { AutoLinkInboundSuggestion } from '../../shared/refactor/auto-link-inbound';
import { rootPathFromEvent, persistIndexes, broadcastRewritten, hooks } from './helpers';

export function registerRefactor(): void {
  ipcMain.handle(Channels.REFACTOR_AUTO_TAG, async (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');

    const plan = await runAutoTag(rootPath, relativePath);
    if (!plan.content) return { added: [] };

    // Route through the canonical 6-step write pipeline so heading-rename
    // detection fires uniformly with direct edits (#341 — this site
    // historically open-coded a 5-step variant that skipped step 6).
    await writeAndReindex(rootPath, relativePath, plan.content, hooks);
    return { added: plan.added };
  });

  ipcMain.handle(Channels.REFACTOR_AUTO_LINK_SUGGEST, async (e, activeRelPath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return suggestLinksTo(rootPath, activeRelPath);
  });

  ipcMain.handle(
    Channels.REFACTOR_AUTO_LINK_APPLY,
    async (e, activeRelPath: string, accepted: AutoLinkSuggestion[]) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) throw new Error('No project open');

      const { content, applied, skipped } = await applyAutoLinkToSuggestions(
        rootPath,
        activeRelPath,
        accepted,
      );
      if (applied.length === 0) return { applied, skipped };

      // 6-step pipeline (#341).
      await writeAndReindex(rootPath, activeRelPath, content, hooks);
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

      const { applied, skipped, touchedPaths, updatedContents } = await applyInboundSuggestions(
        rootPath,
        activeRelPath,
        accepted,
      );

      // 6-step pipeline (#341), batched: each touched source goes through
      // writeAndReindex with broadcast/persist suppressed so the loop emits
      // a single NOTEBASE_REWRITTEN at the end. Heading-rename detection
      // still fires per-file via the hooks.
      for (const [source, content] of updatedContents) {
        await writeAndReindex(rootPath, source, content, hooks, {
          suppressRewrittenBroadcast: true,
          skipPersist: true,
        });
      }
      if (touchedPaths.length > 0) {
        await persistIndexes(rootPath);
        broadcastRewritten(rootPath, touchedPaths);
      }

      return { applied, skipped, touchedPaths };
    },
  );
}
