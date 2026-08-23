import fs from 'node:fs/promises';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import { writeAndReindex } from '../notebase/write-pipeline';
import { runWithHistorySource } from '../history';
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
import { rootPathFromEvent, withRootPath, withRootPathOr, readJsonFileOr, persistIndexes, broadcastRewritten, hooks } from './helpers';
import { handle } from './typed-ipc';

export function registerRefactor(): void {
  // Auto-tag is two-phase (#940): SUGGEST asks the LLM for tags and writes
  // NOTHING; the renderer shows a review dialog; APPLY routes the accepted tags
  // through the approval engine. This closes the historical bypass where the
  // one-shot handler wrote directly with no proposal record.
  handle(Channels.REFACTOR_AUTO_TAG_SUGGEST, withRootPath(async (rootPath, relativePath: string) => {
    const plan = await runAutoTag(rootPath, relativePath);
    return { added: plan.added };
  }));

  handle(
    Channels.REFACTOR_AUTO_TAG_APPLY,
    withRootPath(async (rootPath, relativePath: string, acceptedTags: string[]) => {
      if (!Array.isArray(acceptedTags) || acceptedTags.length === 0) return { applied: [] };
      const { applied, rewrittenPaths } = await applyAutoTag(rootPath, relativePath, acceptedTags);
      // The approval engine wrote the note; broadcast so an open editor reloads
      // the new frontmatter (approval.ts stays Electron-free and returns paths).
      broadcastRewritten(rootPath, rewrittenPaths);
      return { applied };
    }),
  );

  handle(Channels.REFACTOR_AUTO_LINK_SUGGEST, withRootPath(async (rootPath, activeRelPath: string) => {
    return suggestLinksTo(rootPath, activeRelPath);
  }));

  // Accept a semantic "suggested link" (#840): file `[[target]]` under the
  // active note's "See also" section. Unlike AutoLink, semantic neighbors share
  // no anchor word, so it appends rather than inlining. Idempotent.
  handle(Channels.REFACTOR_APPLY_SUGGESTED_LINK, withRootPath(async (rootPath, activeRelPath: string, targetRelPath: string) => {
    const content = await notebaseFs.readFile(rootPath, activeRelPath);
    const { content: next, changed } = appendSeeAlsoLink(content, targetRelPath);
    if (changed) {
      await runWithHistorySource({ origin: 'edit', cause: 'Suggested link' }, () =>
        writeAndReindex(rootPath, activeRelPath, next, hooks));
    }
    return { changed };
  }));

  handle(
    Channels.REFACTOR_AUTO_LINK_APPLY,
    withRootPath(async (rootPath, activeRelPath: string, accepted: AutoLinkSuggestion[]) => {
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
    }),
  );

  handle(Channels.REFACTOR_AUTO_LINK_INBOUND_SUGGEST, withRootPath(async (rootPath, activeRelPath: string) => {
    return suggestLinksInbound(rootPath, activeRelPath);
  }));

  // Formatter (issue #153)
  handle(
    Channels.FORMATTER_FORMAT_CONTENT,
    (e, content: string, settings: FormatSettings, relativePath?: string) =>
      formatNoteContent(content, settings, relativePath, rootPathFromEvent(e) ?? undefined),
  );

  // Project-scoped formatter settings (#154). Stored in .minerva/formatter.json
  // so rule choices travel with the thoughtbase in git.
  type FormatterSettings = { enabled: Record<string, boolean>; configs: Record<string, unknown> };
  // Never written yet (ENOENT) → the house-style defaults, which is what an
  // empty settings file genuinely means. Anything else — corrupt JSON, an
  // unreadable file — throws rather than silently presenting itself as
  // "defaults", which is how a user's rule choices would vanish without a word
  // (#1841). `readJsonFileOr` draws exactly that line; `loadConfigFile` is the
  // wrong helper here because it reports-then-falls-back to defaults, which is
  // the masquerade we're removing. "No project open" throws too.
  handle(Channels.FORMATTER_LOAD_SETTINGS, withRootPath(async (rootPath): Promise<FormatterSettings> => {
    const p = path.join(rootPath, '.minerva', 'formatter.json');
    const parsed = await readJsonFileOr<{ enabled?: Record<string, boolean>; configs?: Record<string, unknown> }>(p, {});
    return {
      enabled: (parsed?.enabled && typeof parsed.enabled === 'object') ? parsed.enabled : {},
      configs: (parsed?.configs && typeof parsed.configs === 'object') ? parsed.configs : {},
    };
  }));

  handle(Channels.FORMATTER_SAVE_SETTINGS, withRootPathOr(undefined, async (rootPath, settings: FormatSettings) => {
    const p = path.join(rootPath, '.minerva', 'formatter.json');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(settings, null, 2), 'utf-8');
  }));

  handle(
    Channels.FORMATTER_FORMAT_FILE,
    withRootPath(async (rootPath, relativePath: string, settings: FormatSettings) => {
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
    }),
  );

  handle(
    Channels.FORMATTER_FORMAT_FOLDER,
    withRootPath(async (rootPath, relDir: string, settings: FormatSettings) => {
      const summary = await formatFolderOnDisk(rootPath, relDir ?? '', settings);
      const touched = [...summary.changedPaths, ...summary.cascadedPaths];
      if (touched.length > 0) {
        for (const p of touched) markPathHandled(p);
        await persistIndexes(rootPath);
        broadcastRewritten(rootPath, touched);
      }
      return summary;
    }),
  );

  handle(
    Channels.REFACTOR_AUTO_LINK_INBOUND_APPLY,
    withRootPath(async (rootPath, activeRelPath: string, accepted: AutoLinkInboundSuggestion[]) => {
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
    }),
  );
}
