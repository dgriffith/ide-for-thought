import { ipcMain, dialog } from 'electron';
import { Channels } from '../../shared/channels';
import { DEFAULT_STYLE } from '../publish/csl/assets';
import { buildCitationAudit } from '../publish/csl/audit';
import { getMergedStyles, getMergedLocales } from '../publish/csl/user-assets';
import * as publish from '../publish';
import { rootPathFromEvent, winFromEvent } from './helpers';

export function registerPublish(): void {
  // ── Publication (#282) ─────────────────────────────────────────────────────

  ipcMain.handle(Channels.PUBLISH_LIST_EXPORTERS, () =>
    publish.listExporters().map((e) => ({
      id: e.id,
      label: e.label,
      // Default to the non-tree kinds when the exporter didn't declare —
      // tree is opt-in (only exporters that know how to walk wiki-link
      // closures should expose it as a scope in the dialog).
      acceptedKinds: e.acceptedKinds ?? ['single-note', 'folder', 'project'],
    })),
  );

  ipcMain.handle(Channels.PUBLISH_RESOLVE_PLAN, async (e, input: publish.ExportInput, opts?: {
    exporterId?: string;
    linkPolicy?: publish.LinkPolicy;
    citationStyle?: string;
    citationLocale?: string;
    forceInclude?: string[];
    forceExclude?: string[];
  }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const plan = await publish.resolvePlan(rootPath, input, {
      linkPolicy: opts?.linkPolicy,
      citationStyle: opts?.citationStyle,
      citationLocale: opts?.citationLocale,
      forceInclude: opts?.forceInclude,
      forceExclude: opts?.forceExclude,
    });
    // Strip `content` + `frontmatter` from the wire payload — the preview
    // only needs to audit paths, kinds, and exclusion reasons; loading
    // every file's text over IPC is wasteful.
    const exporter = opts?.exporterId ? publish.getExporter(opts.exporterId) : null;
    const audit = plan.citations
      ? buildCitationAudit(plan.inputs, plan.citations)
      : { bySource: [], missing: [] };
    // Project-scoped registry: bundled + user-imported (#302). Exposed
    // through the preview so the picker reflects whatever the user has
    // dropped in, without a separate roundtrip.
    const merged = await getMergedStyles(rootPath);
    const mergedLocales = await getMergedLocales(rootPath);
    return {
      exporterId: exporter?.id ?? '',
      exporterLabel: exporter?.label ?? '',
      inputs: plan.inputs.map((f) => ({
        relativePath: f.relativePath,
        kind: f.kind,
        title: f.title,
        overridden: f.overridden ?? false,
      })),
      excluded: plan.excluded,
      citations: {
        styleId: plan.citations?.styleId ?? DEFAULT_STYLE,
        localeId: plan.citations?.localeId ?? 'en-US',
        availableStyles: Object.keys(merged.styles).map((id) => ({
          id,
          label: merged.labels[id] ?? id,
        })),
        availableLocales: Object.keys(mergedLocales.locales).map((id) => ({ id, label: id })),
        bySource: audit.bySource,
        missing: audit.missing,
      },
    };
  });

  ipcMain.handle(Channels.PUBLISH_RUN_EXPORT, async (e, args: Omit<publish.RunExportInput, 'outputDir'> & { outputDir?: string }) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    let outputDir = args.outputDir;
    // When the renderer doesn't pass an outputDir, open a directory
    // picker here. Parents the dialog to the invoking window so it
    // behaves as a modal rather than a floating sheet.
    if (!outputDir) {
      const win = winFromEvent(e);
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose export destination',
        buttonLabel: 'Export here',
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      outputDir = result.filePaths[0];
    }
    return await publish.runExport(rootPath, { ...args, outputDir });
  });
}
