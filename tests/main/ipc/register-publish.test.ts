/**
 * @vitest-environment node
 *
 * Main-process coverage for `register-publish.ts` (#1840).
 *
 * Export + publish is the one path that writes files OUTSIDE the thoughtbase,
 * so what this registrar does with its arguments matters more than usual. It
 * drives the real `registerPublish()` with the publish engine mocked and pins:
 *
 *   - the #1631 guard: every project-scoped handler THROWS with no project,
 *     while the two connection checks (S3 / GitHub) and the exporter listing
 *     deliberately work without one — they don't read the thoughtbase;
 *   - `PUBLISH_RESOLVE_PLAN` strips `content`/`frontmatter` off every input
 *     before it crosses IPC (the preview needs paths and kinds, not the text
 *     of every file in the project) and only forwards the options the caller
 *     actually set;
 *   - `PUBLISH_RUN_EXPORT` opens the destination picker only when the renderer
 *     didn't already choose one, and a cancelled picker means `null` and
 *     nothing written — `null`'s ONE documented meaning here (#1631 rule 5);
 *   - `PUBLISH_TO_GIT` is a sanctioned `{ ok, … }` union (CLAUDE.md rule 3):
 *     auth / network / non-fast-forward come back as `{ ok: false, error }`
 *     carrying the raw git message rather than a stringified rejection.
 *
 * `withRootPath*` are re-implemented in the helpers mock with the real
 * semantics (helpers.ts drags in electron + graph/search/vectors, so it can't
 * be imported here); what's under test is WHICH wrapper each handler picked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ROOT = '/vault';
/** What `rootPathFromEvent` reports; null models "no project open". */
let openProject: string | null = ROOT;

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  win: { id: 1, isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } },
  // electron
  showOpenDialog: vi.fn(),
  getVersion: vi.fn(() => '1.2.3'),
  // publish engine
  listExporters: vi.fn(),
  getExporter: vi.fn(),
  resolvePlan: vi.fn(),
  runExport: vi.fn(),
  publishTarget: vi.fn(),
  checkS3Connection: vi.fn(),
  checkGitHubToken: vi.fn(),
  // csl
  buildCitationAudit: vi.fn(),
  getMergedStyles: vi.fn(),
  getMergedLocales: vi.fn(),
  // project config
  getPublishTargets: vi.fn(),
  upsertPublishTarget: vi.fn(),
  removePublishTarget: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { h.handlers.set(channel, fn); } },
  dialog: { showOpenDialog: h.showOpenDialog },
  app: { getVersion: h.getVersion },
}));

vi.mock('../../../src/main/ipc/helpers', () => ({
  withRootPath:
    <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => {
        if (!openProject) throw new Error('No project open');
        return fn(openProject, ...args);
      },
  withRootPathWin:
    <A extends unknown[], R>(fn: (rootPath: string, win: unknown, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => {
        if (!openProject) throw new Error('No project open');
        return fn(openProject, h.win, ...args);
      },
}));

// The publish barrel re-exports the whole engine; only what the registrar
// reaches for is stubbed, plus the real EXPORT_GROUPS table (it's a constant —
// stubbing it would make the group-metadata assertion tautological).
vi.mock('../../../src/main/publish', async () => {
  const { EXPORT_GROUPS } = await import('../../../src/main/publish/types');
  return {
    EXPORT_GROUPS,
    listExporters: h.listExporters,
    getExporter: h.getExporter,
    resolvePlan: h.resolvePlan,
    runExport: h.runExport,
    publishTarget: h.publishTarget,
    checkS3Connection: h.checkS3Connection,
  };
});
vi.mock('../../../src/main/publish/csl/audit', () => ({ buildCitationAudit: h.buildCitationAudit }));
vi.mock('../../../src/main/publish/csl/user-assets', () => ({
  getMergedStyles: h.getMergedStyles,
  getMergedLocales: h.getMergedLocales,
}));
vi.mock('../../../src/main/git/publish-git', () => ({ checkGitHubToken: h.checkGitHubToken }));
vi.mock('../../../src/main/project-config', () => ({
  getPublishTargets: h.getPublishTargets,
  upsertPublishTarget: h.upsertPublishTarget,
  removePublishTarget: h.removePublishTarget,
}));

import { registerPublish } from '../../../src/main/ipc/register-publish';
import { Channels } from '../../../src/shared/channels';
import { EXPORT_GROUPS } from '../../../src/main/publish/types';
import { DEFAULT_STYLE } from '../../../src/main/publish/csl/assets';

registerPublish();

const call = (channel: string, ...args: unknown[]): unknown => h.handlers.get(channel)!({}, ...args);
const callAsync = (channel: string, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve(call(channel, ...args));

beforeEach(() => {
  vi.resetAllMocks();
  openProject = ROOT;
  h.getVersion.mockReturnValue('1.2.3');
  h.listExporters.mockReturnValue([]);
  h.getMergedStyles.mockResolvedValue({ styles: { apa: '<xml/>' }, labels: { apa: 'APA' }, userIds: new Set() });
  h.getMergedLocales.mockResolvedValue({ locales: { 'en-US': '<xml/>' }, userIds: new Set() });
  h.buildCitationAudit.mockReturnValue({ bySource: [], missing: [] });
  h.getPublishTargets.mockReturnValue([]);
});

describe('register-publish — the #1631 project guard', () => {
  const throwers: [string, unknown[]][] = [
    [Channels.PUBLISH_RESOLVE_PLAN, [{ kind: 'project' }]],
    [Channels.PUBLISH_RUN_EXPORT, [{ exporterId: 'markdown', input: { kind: 'project' } }]],
    [Channels.PUBLISH_LIST_TARGETS, []],
    [Channels.PUBLISH_UPSERT_TARGET, [{ id: 't1', label: 'Site', exporter: 'site', kind: 'git' }]],
    [Channels.PUBLISH_REMOVE_TARGET, ['t1']],
    [Channels.PUBLISH_TO_GIT, ['t1']],
  ];

  it.each(throwers)('%s throws with no project open', (channel, args) => {
    openProject = null;
    expect(() => call(channel, ...args)).toThrow('No project open');
  });

  it('nothing is exported, published or saved when there is no project', () => {
    openProject = null;
    for (const [channel, args] of throwers) {
      try { call(channel, ...args); } catch { /* asserted above */ }
    }
    expect(h.runExport).not.toHaveBeenCalled();
    expect(h.publishTarget).not.toHaveBeenCalled();
    expect(h.upsertPublishTarget).not.toHaveBeenCalled();
    expect(h.removePublishTarget).not.toHaveBeenCalled();
    expect(h.showOpenDialog).not.toHaveBeenCalled();
  });

  it('PUBLISH_TO_GIT throws rather than reporting { ok: false } for a missing project', () => {
    // The union is for EXPECTED publish outcomes (auth, network, rejected
    // push). "There is no thoughtbase to publish" is not one of them, and
    // folding it in would put a nonsense message in the dialog.
    openProject = null;
    expect(() => call(Channels.PUBLISH_TO_GIT, 't1')).toThrow('No project open');
  });

  it('PUBLISH_LIST_EXPORTERS answers without a project — the registry is static', () => {
    openProject = null;
    h.listExporters.mockReturnValue([]);
    expect(call(Channels.PUBLISH_LIST_EXPORTERS)).toEqual([]);
  });

  it.each([
    [Channels.PUBLISH_CHECK_S3, [{ bucket: 'b' }], 'checkS3Connection'],
    [Channels.PUBLISH_CHECK_GITHUB, [{ token: 'ghp_x' }], 'checkGitHubToken'],
  ] as const)('%s runs without a project — it only tests credentials', async (channel, args, fn) => {
    openProject = null;
    h[fn].mockResolvedValue({ ok: true });
    await expect(callAsync(channel, ...args)).resolves.toEqual({ ok: true });
  });
});

describe('register-publish — PUBLISH_LIST_EXPORTERS', () => {
  it('carries the format-first menu metadata for each exporter', () => {
    h.listExporters.mockReturnValue([
      { id: 'markdown', label: 'Markdown (verbatim)', group: 'markdown', variantLabel: 'Verbatim', variantOrder: 1, acceptedKinds: ['single-note', 'folder', 'project', 'tree'] },
    ]);

    expect(call(Channels.PUBLISH_LIST_EXPORTERS)).toEqual([{
      id: 'markdown',
      label: 'Markdown (verbatim)',
      acceptedKinds: ['single-note', 'folder', 'project', 'tree'],
      group: EXPORT_GROUPS.markdown,
      variantLabel: 'Verbatim',
      variantOrder: 1,
    }]);
  });

  it('defaults an exporter that declared no kinds to the non-tree scopes', () => {
    // `tree` is opt-in: only exporters that know how to walk a wiki-link
    // closure should offer it, so the default must NOT include it.
    h.listExporters.mockReturnValue([{ id: 'pdf', label: 'PDF', group: 'pdf' }]);

    const [listed] = call(Channels.PUBLISH_LIST_EXPORTERS) as { acceptedKinds: string[]; variantOrder: number }[];
    expect(listed?.acceptedKinds).toEqual(['single-note', 'folder', 'project']);
    expect(listed?.acceptedKinds).not.toContain('tree');
    // An undeclared variant sorts first rather than becoming NaN/undefined in
    // the dialog's sort.
    expect(listed?.variantOrder).toBe(0);
  });

  it('drops the exporter function itself — only serialisable metadata crosses IPC', () => {
    h.listExporters.mockReturnValue([
      { id: 'html', label: 'HTML', group: 'html', run: () => { throw new Error('never'); } },
    ]);
    const [listed] = call(Channels.PUBLISH_LIST_EXPORTERS) as Record<string, unknown>[];
    expect(listed).not.toHaveProperty('run');
    expect(Object.keys(listed ?? {}).sort())
      .toEqual(['acceptedKinds', 'group', 'id', 'label', 'variantLabel', 'variantOrder']);
  });
});

describe('register-publish — PUBLISH_RESOLVE_PLAN', () => {
  const plan = (over: Record<string, unknown> = {}) => ({
    inputs: [
      { relativePath: 'a.md', kind: 'note', title: 'A', content: '# A\n\nlots of text', frontmatter: { tags: ['x'] } },
    ],
    excluded: [{ relativePath: 'draft.md', reason: 'excluded-by-frontmatter' }],
    ...over,
  });

  it('strips file bodies out of the preview payload', async () => {
    // Sending every file's text over IPC to render a list of paths is pure
    // waste on a project-scoped export.
    h.resolvePlan.mockResolvedValue(plan());
    h.getExporter.mockReturnValue({ id: 'markdown', label: 'Markdown' });

    const result = await callAsync(Channels.PUBLISH_RESOLVE_PLAN, { kind: 'project' }, { exporterId: 'markdown' }) as {
      inputs: Record<string, unknown>[]; excluded: unknown[]; exporterId: string; exporterLabel: string;
    };

    expect(result.inputs).toEqual([{ relativePath: 'a.md', kind: 'note', title: 'A', overridden: false }]);
    expect(result.excluded).toEqual([{ relativePath: 'draft.md', reason: 'excluded-by-frontmatter' }]);
    expect(result.exporterId).toBe('markdown');
    expect(result.exporterLabel).toBe('Markdown');
  });

  it('keeps an explicit include/exclude override visible in the preview', async () => {
    h.resolvePlan.mockResolvedValue(plan({
      inputs: [{ relativePath: 'a.md', kind: 'note', title: 'A', content: 'x', overridden: true }],
    }));
    const result = await callAsync(Channels.PUBLISH_RESOLVE_PLAN, { kind: 'project' }) as { inputs: { overridden: boolean }[] };
    expect(result.inputs[0]?.overridden).toBe(true);
  });

  it('forwards only the options the caller actually set', async () => {
    // Passing `undefined` through would override a resolved default with
    // nothing — `exactOptionalPropertyTypes` is on for a reason.
    h.resolvePlan.mockResolvedValue(plan());
    await callAsync(Channels.PUBLISH_RESOLVE_PLAN, { kind: 'project' }, { exporterId: 'markdown', citationStyle: 'ieee' });
    expect(h.resolvePlan).toHaveBeenCalledWith(ROOT, { kind: 'project' }, { citationStyle: 'ieee' });
  });

  it('passes no options at all when the caller gave none', async () => {
    h.resolvePlan.mockResolvedValue(plan());
    await callAsync(Channels.PUBLISH_RESOLVE_PLAN, { kind: 'single-note', relativePath: 'a.md' });
    expect(h.resolvePlan).toHaveBeenCalledWith(ROOT, { kind: 'single-note', relativePath: 'a.md' }, {});
  });

  it('forwards the force-include/exclude lists the preview checkboxes produce', async () => {
    h.resolvePlan.mockResolvedValue(plan());
    await callAsync(Channels.PUBLISH_RESOLVE_PLAN, { kind: 'project' }, {
      linkPolicy: 'rewrite', forceInclude: ['draft.md'], forceExclude: ['a.md'],
    });
    expect(h.resolvePlan).toHaveBeenCalledWith(ROOT, { kind: 'project' }, {
      linkPolicy: 'rewrite', forceInclude: ['draft.md'], forceExclude: ['a.md'],
    });
  });

  it('reports an empty citation audit and the default style when the plan has no citations', async () => {
    h.resolvePlan.mockResolvedValue(plan());

    const result = await callAsync(Channels.PUBLISH_RESOLVE_PLAN, { kind: 'project' }) as {
      citations: { styleId: string; localeId: string; bySource: unknown[]; missing: unknown[] };
      exporterId: string; exporterLabel: string;
    };

    // No citations in the plan means no audit to run at all…
    expect(h.buildCitationAudit).not.toHaveBeenCalled();
    expect(result.citations.bySource).toEqual([]);
    expect(result.citations.missing).toEqual([]);
    // …and the picker still needs a style selected, so it falls back.
    expect(result.citations.styleId).toBe(DEFAULT_STYLE);
    expect(result.citations.localeId).toBe('en-US');
    // No exporterId asked for → empty strings, not undefined: the dialog binds
    // these straight into its header.
    expect(result.exporterId).toBe('');
    expect(result.exporterLabel).toBe('');
    expect(h.getExporter).not.toHaveBeenCalled();
  });

  it('audits the citations against the plan inputs when there are some', async () => {
    h.resolvePlan.mockResolvedValue(plan({ citations: { styleId: 'ieee', localeId: 'en-GB' } }));
    h.buildCitationAudit.mockReturnValue({ bySource: [{ sourceId: 's1', count: 2 }], missing: [{ key: 'nope' }] });

    const result = await callAsync(Channels.PUBLISH_RESOLVE_PLAN, { kind: 'project' }) as {
      citations: { styleId: string; localeId: string; bySource: unknown[]; missing: unknown[] };
    };

    // The audit reads the FULL inputs (with content) — that's the only place
    // the citation keys live, and it's also why they can be stripped after.
    expect(h.buildCitationAudit).toHaveBeenCalledWith(
      [expect.objectContaining({ relativePath: 'a.md', content: '# A\n\nlots of text' })],
      { styleId: 'ieee', localeId: 'en-GB' },
    );
    expect(result.citations.styleId).toBe('ieee');
    expect(result.citations.localeId).toBe('en-GB');
    expect(result.citations.missing).toEqual([{ key: 'nope' }]);
  });

  it('offers the project-scoped style registry — bundled plus user-imported', async () => {
    // #302: the picker has to reflect whatever the user dropped into the
    // project, without a second roundtrip.
    h.resolvePlan.mockResolvedValue(plan());
    h.getMergedStyles.mockResolvedValue({
      styles: { apa: '<x/>', 'my-house-style': '<x/>' },
      labels: { apa: 'APA' },
      userIds: new Set(['my-house-style']),
    });
    h.getMergedLocales.mockResolvedValue({ locales: { 'en-US': '<x/>', 'de-DE': '<x/>' }, userIds: new Set() });

    const result = await callAsync(Channels.PUBLISH_RESOLVE_PLAN, { kind: 'project' }) as {
      citations: { availableStyles: { id: string; label: string }[]; availableLocales: { id: string; label: string }[] };
    };

    expect(h.getMergedStyles).toHaveBeenCalledWith(ROOT);
    expect(result.citations.availableStyles).toEqual([
      { id: 'apa', label: 'APA' },
      // A user style with no <title> falls back to its id rather than
      // rendering a blank row in the picker.
      { id: 'my-house-style', label: 'my-house-style' },
    ]);
    expect(result.citations.availableLocales).toEqual([
      { id: 'en-US', label: 'en-US' },
      { id: 'de-DE', label: 'de-DE' },
    ]);
  });
});

describe('register-publish — PUBLISH_RUN_EXPORT', () => {
  it('exports straight to a destination the renderer already chose', async () => {
    h.runExport.mockResolvedValue({ files: 3, outputDir: '/out' });

    await expect(callAsync(Channels.PUBLISH_RUN_EXPORT, { exporterId: 'markdown', input: { kind: 'project' }, outputDir: '/out' }))
      .resolves.toEqual({ files: 3, outputDir: '/out' });

    expect(h.showOpenDialog).not.toHaveBeenCalled();
    expect(h.runExport).toHaveBeenCalledWith(ROOT, { exporterId: 'markdown', input: { kind: 'project' }, outputDir: '/out' });
  });

  it('asks for a destination, parented to the invoking window, when none was given', async () => {
    // Parenting matters: an unparented picker floats as a sheet the user can
    // lose behind the main window.
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/picked'] });
    h.runExport.mockResolvedValue({ files: 1 });

    await callAsync(Channels.PUBLISH_RUN_EXPORT, { exporterId: 'markdown', input: { kind: 'project' } });

    expect(h.showOpenDialog).toHaveBeenCalledWith(h.win, expect.objectContaining({
      properties: ['openDirectory', 'createDirectory'],
    }));
    expect(h.runExport).toHaveBeenCalledWith(ROOT, { exporterId: 'markdown', input: { kind: 'project' }, outputDir: '/picked' });
  });

  it.each([
    ['cancelled', { canceled: true, filePaths: [] }],
    ['dismissed with no directory', { canceled: false, filePaths: [] }],
  ])('writes nothing when the picker is %s', async (_label, dialogResult) => {
    // `null` here means exactly one thing — the user backed out (#1631 rule 5).
    h.showOpenDialog.mockResolvedValue(dialogResult);
    await expect(callAsync(Channels.PUBLISH_RUN_EXPORT, { exporterId: 'markdown', input: { kind: 'project' } }))
      .resolves.toBeNull();
    expect(h.runExport).not.toHaveBeenCalled();
  });

  it('lets an export failure reject rather than dressing it up as a result', async () => {
    h.runExport.mockRejectedValue(new Error('EACCES /out'));
    await expect(callAsync(Channels.PUBLISH_RUN_EXPORT, { exporterId: 'markdown', input: { kind: 'project' }, outputDir: '/out' }))
      .rejects.toThrow('EACCES /out');
  });
});

describe('register-publish — publish targets', () => {
  it('PUBLISH_LIST_TARGETS reads the project config', () => {
    h.getPublishTargets.mockReturnValue([{ id: 't1', label: 'Site', exporter: 'site', kind: 'git' }]);
    expect(call(Channels.PUBLISH_LIST_TARGETS)).toEqual([{ id: 't1', label: 'Site', exporter: 'site', kind: 'git' }]);
    expect(h.getPublishTargets).toHaveBeenCalledWith(ROOT);
  });

  it('PUBLISH_UPSERT_TARGET answers with the list AFTER the save', () => {
    // The settings UI rebinds from this return value, so it has to be the
    // post-write state — re-reading rather than echoing the argument is what
    // makes a secret-stripping / normalising store visible to the caller.
    const target = { id: 't1', label: 'Site', exporter: 'site', kind: 'git' as const };
    const stored = [{ ...target, token: undefined }];
    h.upsertPublishTarget.mockImplementation(() => { h.getPublishTargets.mockReturnValue(stored); });

    expect(call(Channels.PUBLISH_UPSERT_TARGET, target)).toEqual(stored);
    expect(h.upsertPublishTarget).toHaveBeenCalledWith(ROOT, target);
  });

  it('PUBLISH_REMOVE_TARGET answers with the list AFTER the removal', () => {
    h.getPublishTargets.mockReturnValue([{ id: 't2', label: 'Other', exporter: 'site', kind: 'git' }]);
    expect(call(Channels.PUBLISH_REMOVE_TARGET, 't1'))
      .toEqual([{ id: 't2', label: 'Other', exporter: 'site', kind: 'git' }]);
    expect(h.removePublishTarget).toHaveBeenCalledWith(ROOT, 't1');
  });
});

describe('register-publish — PUBLISH_TO_GIT', () => {
  it('reports success with the transport result', async () => {
    h.publishTarget.mockResolvedValue({ commit: 'abc123', pushed: true });
    await expect(callAsync(Channels.PUBLISH_TO_GIT, 't1'))
      .resolves.toEqual({ ok: true, result: { commit: 'abc123', pushed: true } });
  });

  it('stamps the app version and defaults to a real push', async () => {
    h.publishTarget.mockResolvedValue({});
    await callAsync(Channels.PUBLISH_TO_GIT, 't1');
    // The version goes into the commit message, so a published site can be
    // traced back to the build that produced it.
    expect(h.publishTarget).toHaveBeenCalledWith(ROOT, 't1', { dryRun: false, version: '1.2.3' });
  });

  it('passes dryRun through for the preview, and createRepo only when asked', async () => {
    h.publishTarget.mockResolvedValue({});
    await callAsync(Channels.PUBLISH_TO_GIT, 't1', { dryRun: true, createRepo: { private: true } });
    expect(h.publishTarget).toHaveBeenCalledWith(ROOT, 't1', {
      dryRun: true, version: '1.2.3', createRepo: { private: true },
    });
  });

  it('turns an auth / network / rejected-push failure into { ok: false } with the raw message', async () => {
    // A sanctioned discriminated union (CLAUDE.md #1631 rule 3): the dialog
    // shows git's own words verbatim, which is what makes "non-fast-forward"
    // actionable. Honest caveat — the catch is unconditional, so a programming
    // error inside the transport also arrives as `{ ok: false }` rather than
    // surfacing as a crash.
    h.publishTarget.mockRejectedValue(new Error('failed to push some refs (non-fast-forward)'));
    await expect(callAsync(Channels.PUBLISH_TO_GIT, 't1'))
      .resolves.toEqual({ ok: false, error: 'failed to push some refs (non-fast-forward)' });
  });

  it('stringifies a non-Error rejection rather than showing "[object Object]"', async () => {
    h.publishTarget.mockRejectedValue('git exited with code 128');
    await expect(callAsync(Channels.PUBLISH_TO_GIT, 't1'))
      .resolves.toEqual({ ok: false, error: 'git exited with code 128' });
  });
});

describe('register-publish — connection checks', () => {
  it('PUBLISH_CHECK_S3 builds a throwaway target from the unsaved form', async () => {
    // Validating BEFORE saving is the point — the user shouldn't have to
    // persist a broken target to find out it's broken.
    h.checkS3Connection.mockResolvedValue({ ok: true });

    await callAsync(Channels.PUBLISH_CHECK_S3, {
      bucket: 'notes', endpoint: 'https://s3.example', region: 'eu-west-1',
      accessKeyId: 'AK', secretAccessKey: 'SK',
    });

    expect(h.checkS3Connection).toHaveBeenCalledWith(
      { id: 'check', label: 'check', exporter: '', kind: 's3', bucket: 'notes', endpoint: 'https://s3.example', region: 'eu-west-1' },
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
    );
  });

  it('PUBLISH_CHECK_S3 omits the optional fields the form left blank', async () => {
    // Sending `endpoint: undefined` would override the SDK's own default.
    h.checkS3Connection.mockResolvedValue({ ok: false, error: 'NoSuchBucket' });

    await expect(callAsync(Channels.PUBLISH_CHECK_S3, { bucket: 'notes' }))
      .resolves.toEqual({ ok: false, error: 'NoSuchBucket' });
    expect(h.checkS3Connection).toHaveBeenCalledWith(
      { id: 'check', label: 'check', exporter: '', kind: 's3', bucket: 'notes' },
      {},
    );
  });

  it('PUBLISH_CHECK_GITHUB tests the gh CLI / env fallback for a blank token', async () => {
    // Matches what the push itself would resolve, so "check" and "publish"
    // can't disagree about which credential is in play.
    h.checkGitHubToken.mockResolvedValue({ ok: true, login: 'octocat' });
    await callAsync(Channels.PUBLISH_CHECK_GITHUB, {});
    expect(h.checkGitHubToken).toHaveBeenCalledWith(undefined);
  });

  it('PUBLISH_CHECK_GITHUB tests the typed token when one was entered', async () => {
    h.checkGitHubToken.mockResolvedValue({ ok: false, error: 'Bad credentials' });
    await expect(callAsync(Channels.PUBLISH_CHECK_GITHUB, { token: 'ghp_x' }))
      .resolves.toEqual({ ok: false, error: 'Bad credentials' });
    expect(h.checkGitHubToken).toHaveBeenCalledWith('ghp_x');
  });
});
