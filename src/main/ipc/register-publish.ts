import { dialog, app } from 'electron';
import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import { DEFAULT_STYLE } from '../publish/csl/assets';
import { buildCitationAudit } from '../publish/csl/audit';
import { getMergedStyles, getMergedLocales } from '../publish/csl/user-assets';
import * as publish from '../publish';
import {
  getPublishTargets,
  upsertPublishTarget,
  removePublishTarget,
  type PublishTarget,
} from '../project-config';
import { checkGitHubToken } from '../git/publish-git';
import { withRootPath, withRootPathWin } from './helpers';

export function registerPublish(): void {
  // ── Publication (#282) ─────────────────────────────────────────────────────

  handle(Channels.PUBLISH_LIST_EXPORTERS, () =>
    publish.listExporters().map((e) => ({
      id: e.id,
      label: e.label,
      // Default to the non-tree kinds when the exporter didn't declare —
      // tree is opt-in (only exporters that know how to walk wiki-link
      // closures should expose it as a scope in the dialog).
      acceptedKinds: e.acceptedKinds ?? ['single-note', 'folder', 'project'],
      // Format-first menu metadata (#: export-menu-redesign): the group the
      // dialog buckets this exporter under, plus its variant label/order for
      // groups where >1 exporter is valid at the same scope (Markdown).
      group: publish.EXPORT_GROUPS[e.group],
      variantLabel: e.variantLabel,
      variantOrder: e.variantOrder ?? 0,
    })),
  );

  handle(Channels.PUBLISH_RESOLVE_PLAN, withRootPath(async (rootPath, input: publish.ExportInput, opts?: {
    exporterId?: string;
    linkPolicy?: publish.LinkPolicy;
    citationStyle?: string;
    citationLocale?: string;
    forceInclude?: string[];
    forceExclude?: string[];
  }) => {
    const plan = await publish.resolvePlan(rootPath, input, {
      ...(opts?.linkPolicy !== undefined ? { linkPolicy: opts.linkPolicy } : {}),
      ...(opts?.citationStyle !== undefined ? { citationStyle: opts.citationStyle } : {}),
      ...(opts?.citationLocale !== undefined ? { citationLocale: opts.citationLocale } : {}),
      ...(opts?.forceInclude !== undefined ? { forceInclude: opts.forceInclude } : {}),
      ...(opts?.forceExclude !== undefined ? { forceExclude: opts.forceExclude } : {}),
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
  }));

  handle(Channels.PUBLISH_RUN_EXPORT, withRootPathWin(async (rootPath, win, args: Omit<publish.RunExportInput, 'outputDir'> & { outputDir?: string }) => {
    let outputDir = args.outputDir;
    // When the renderer doesn't pass an outputDir, open a directory
    // picker here. Parents the dialog to the invoking window so it
    // behaves as a modal rather than a floating sheet.
    if (!outputDir) {
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose export destination',
        buttonLabel: 'Export here',
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      outputDir = result.filePaths[0]!;
    }
    return await publish.runExport(rootPath, { ...args, outputDir });
  }));

  // ── Publish → git remote (#254) ────────────────────────────────────────────

  handle(Channels.PUBLISH_LIST_TARGETS, withRootPath((rootPath) => {
    return getPublishTargets(rootPath);
  }));

  handle(Channels.PUBLISH_UPSERT_TARGET, withRootPath((rootPath, target: PublishTarget) => {
    upsertPublishTarget(rootPath, target);
    return getPublishTargets(rootPath);
  }));

  handle(Channels.PUBLISH_REMOVE_TARGET, withRootPath((rootPath, id: string) => {
    removePublishTarget(rootPath, id);
    return getPublishTargets(rootPath);
  }));

  // Export + commit + push (or dry-run preview). Errors — auth, network,
  // non-fast-forward — come back as `{ ok: false, error }` carrying the raw
  // git message, so the dialog can show it verbatim rather than a stringified
  // rejection (#254 acceptance).
  handle(
    Channels.PUBLISH_TO_GIT,
    withRootPath(async (rootPath, targetId: string, opts?: { dryRun?: boolean }) => {
      try {
        // Dispatch by target kind (#1444). Git is the only transport today; S3
        // slots in behind the same seam. The channel stays PUBLISH_TO_GIT until
        // the S3 transport PR generalizes it.
        const result = await publish.publishTarget(rootPath, targetId, {
          dryRun: opts?.dryRun ?? false,
          version: app.getVersion(),
        });
        return { ok: true as const, result };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  // Validate S3 credentials/endpoint before saving a target (#1444). No rootPath
  // needed — HeadBucket only depends on the bucket + endpoint + credentials.
  handle(Channels.PUBLISH_CHECK_S3, (_e, config: {
    bucket: string; endpoint?: string; region?: string; accessKeyId?: string; secretAccessKey?: string;
  }) =>
    publish.checkS3Connection(
      {
        id: 'check', label: 'check', exporter: '', kind: 's3', bucket: config.bucket,
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        ...(config.region ? { region: config.region } : {}),
      },
      {
        ...(config.accessKeyId ? { accessKeyId: config.accessKeyId } : {}),
        ...(config.secretAccessKey ? { secretAccessKey: config.secretAccessKey } : {}),
      },
    ),
  );

  // Validate a GitHub token (#1508) — a blank token tests the gh CLI / env
  // fallback, matching what the push would resolve.
  handle(Channels.PUBLISH_CHECK_GITHUB, (_e, config: { token?: string }) =>
    checkGitHubToken(config.token),
  );
}
