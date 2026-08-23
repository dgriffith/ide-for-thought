/**
 * "No project open" is a failure, not an absence (#1841 / the #1631 IPC error
 * convention in CLAUDE.md).
 *
 * These five handlers used to answer `withRootPathOr(null, …)` — so a caller
 * that got `null` couldn't tell "the graph has no such source" from "there's no
 * thoughtbase open at all", and FORMATTER_LOAD_SETTINGS additionally handed back
 * its defaults when `.minerva/formatter.json` was corrupt. This file pins the
 * converted contract for all five together:
 *
 *   - no project open        → rejects with "No project open"
 *   - the thing isn't there  → `null` (its ONE remaining meaning)
 *   - a real IO/parse error  → rejects (never a sentinel, never defaults)
 *
 * Style follows register-bookmarks.test.ts: only electron + the project-scoping
 * helpers are mocked, and the mocked `withRootPath` / `withRootPathOr` reproduce
 * the real wrappers' semantics — so a handler that regressed back to
 * `withRootPathOr(null, …)` would resolve `null` here and fail the assertion.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const { handlers, state, domain } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  state: { root: null as string | null },
  domain: {
    getSourceDetail: vi.fn(),
    getExcerptSource: vi.fn(),
    getProposal: vi.fn(),
    readTemplate: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  Notification: Object.assign(vi.fn(), { isSupported: () => false }),
  BrowserWindow: { fromWebContents: () => null },
  app: { getPath: () => os.tmpdir() },
  shell: {},
}));

// Keep the REAL readJsonFileOr (it's what FORMATTER_LOAD_SETTINGS now leans on);
// only the project-scoping wrappers are stubbed, with the real semantics, so we
// can steer/clear the open project.
vi.mock('../../../src/main/ipc/helpers', async () => {
  const { readJsonFileOr } = await import('../../../src/main/ipc/read-json');
  return {
    readJsonFileOr,
    rootPathFromEvent: () => state.root,
    withRootPath:
      <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A) => {
        if (!state.root) throw new Error('No project open');
        return fn(state.root, ...args);
      },
    withRootPathOr:
      <A extends unknown[], R>(fallback: R, fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A) => (state.root ? fn(state.root, ...args) : fallback),
    withRootPathWin:
      <A extends unknown[], R>(fn: (rootPath: string, win: unknown, ...a: A) => R) =>
      (_e: unknown, ...args: A) => {
        if (!state.root) throw new Error('No project open');
        return fn(state.root, null, ...args);
      },
    winFromEvent: () => null,
    persistIndexes: vi.fn(),
    broadcastRewritten: vi.fn(),
    hooks: {},
  };
});

// Domain modules the handlers delegate to — stubbed so the test exercises the
// project-scoping contract, not the graph/approval engines.
vi.mock('../../../src/main/graph/index', () => ({
  getSourceDetail: domain.getSourceDetail,
  getExcerptSource: domain.getExcerptSource,
  queryGraph: vi.fn(),
  setBaseUri: vi.fn(),
  indexAllNotes: vi.fn(),
  schemaForCompletion: vi.fn(),
  getAliasMap: vi.fn(),
  getAliasEntries: vi.fn(),
  getAllFrontmatterKeys: vi.fn(),
}));
vi.mock('../../../src/main/search/index', () => ({ indexAllNotes: vi.fn() }));
vi.mock('../../../src/main/sources/tables', () => ({
  runQuery: vi.fn(), listTables: vi.fn(), registerAllCsvs: vi.fn(), registerAllNoteTables: vi.fn(),
}));
vi.mock('../../../src/main/graph/health-checks', () => ({ getInspections: vi.fn(), runAllChecks: vi.fn() }));
vi.mock('../../../src/main/project-config', () => ({ patchProjectConfig: vi.fn(), readProjectConfig: () => ({}) }));
vi.mock('../../../src/main/graph/rebase-guard', () => ({ checkRebase: vi.fn() }));
vi.mock('../../../src/main/llm/attach-evidence', () => ({ proposeExcerptEvidence: vi.fn() }));
vi.mock('../../../src/main/config/inspection-settings', () => ({
  getInspectionSettings: vi.fn(), saveInspectionSettings: vi.fn(),
}));
vi.mock('../../../src/main/project-context-types', () => ({ projectContext: (root: string) => ({ rootPath: root }) }));

vi.mock('../../../src/main/llm/approval', () => ({
  getProposal: domain.getProposal,
  listProposals: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  expireProposals: vi.fn(),
}));

vi.mock('../../../src/main/notebase/templates', () => ({
  readTemplate: domain.readTemplate,
  listTemplates: vi.fn(),
  saveTemplate: vi.fn(),
}));

// register-refactor's LLM / formatter / write-pipeline neighbours.
vi.mock('../../../src/main/notebase/write-pipeline', () => ({ writeAndReindex: vi.fn() }));
vi.mock('../../../src/main/history', () => ({ runWithHistorySource: vi.fn() }));
vi.mock('../../../src/main/window-manager', () => ({ markPathHandled: vi.fn() }));
vi.mock('../../../src/main/llm/auto-tag', () => ({ runAutoTag: vi.fn(), applyAutoTag: vi.fn() }));
vi.mock('../../../src/main/llm/auto-link', () => ({
  suggestLinksTo: vi.fn(), fileAutoLinkOutbound: vi.fn(),
  suggestLinksInbound: vi.fn(), fileAutoLinkInbound: vi.fn(),
}));
vi.mock('../../../src/main/formatter/orchestrator', () => ({
  formatNoteContent: vi.fn(), formatFile: vi.fn(), formatFolder: vi.fn(),
}));
vi.mock('../../../src/main/notebase/fs', () => ({ readFile: vi.fn(), writeFile: vi.fn() }));

import { registerGraph } from '../../../src/main/ipc/register-graph';
import { registerProposals } from '../../../src/main/ipc/register-proposals';
import { registerTemplates } from '../../../src/main/ipc/register-templates';
import { registerRefactor } from '../../../src/main/ipc/register-refactor';
import { Channels } from '../../../src/shared/channels';

registerGraph();
registerProposals();
registerTemplates();
registerRefactor();

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);
/** `call` wrapped so a SYNCHRONOUS throw (withRootPath fires before the async
 *  body runs) is assertable with the same `rejects` matcher as an async one. */
const callAsync = async (channel: string, ...args: unknown[]) => call(channel, ...args);

const enoent = (): NodeJS.ErrnoException =>
  Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });

describe('no-project contract (#1841)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-noproj-'));
    await fs.mkdir(path.join(dir, '.minerva'), { recursive: true });
    state.root = dir;
  });
  afterEach(async () => {
    state.root = null;
    await fs.rm(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('with no project open, every one of them rejects', () => {
    beforeEach(() => { state.root = null; });

    it.each([
      [Channels.GRAPH_SOURCE_DETAIL, ['paxos']],
      [Channels.GRAPH_EXCERPT_SOURCE, ['ex-1']],
      [Channels.PROPOSAL_DETAIL, ['minerva:proposal/1']],
      [Channels.TEMPLATES_GET, ['Meeting.md']],
      [Channels.FORMATTER_LOAD_SETTINGS, []],
    ])('%s throws "No project open" instead of answering null/defaults', async (channel, args) => {
      await expect(callAsync(channel, ...args)).rejects.toThrow(/No project open/);
    });

    it('none of them reached its domain module', async () => {
      await expect(callAsync(Channels.GRAPH_SOURCE_DETAIL, 'paxos')).rejects.toThrow();
      await expect(callAsync(Channels.PROPOSAL_DETAIL, 'u')).rejects.toThrow();
      await expect(callAsync(Channels.TEMPLATES_GET, 'a.md')).rejects.toThrow();
      expect(domain.getSourceDetail).not.toHaveBeenCalled();
      expect(domain.getProposal).not.toHaveBeenCalled();
      expect(domain.readTemplate).not.toHaveBeenCalled();
    });
  });

  describe('with a project open, `null` keeps its one meaning: not found', () => {
    it('GRAPH_SOURCE_DETAIL passes through the graph\'s null', async () => {
      domain.getSourceDetail.mockReturnValue(null);
      await expect(callAsync(Channels.GRAPH_SOURCE_DETAIL, 'nope')).resolves.toBeNull();
      expect(domain.getSourceDetail).toHaveBeenCalledWith({ rootPath: dir }, 'nope');
    });

    it('GRAPH_EXCERPT_SOURCE passes through the graph\'s null', async () => {
      domain.getExcerptSource.mockReturnValue(null);
      await expect(callAsync(Channels.GRAPH_EXCERPT_SOURCE, 'nope')).resolves.toBeNull();
    });

    it('PROPOSAL_DETAIL passes through the approval store\'s null', async () => {
      domain.getProposal.mockReturnValue(null);
      await expect(callAsync(Channels.PROPOSAL_DETAIL, 'minerva:proposal/gone')).resolves.toBeNull();
    });

    it('TEMPLATES_GET returns the body when the template is there', async () => {
      domain.readTemplate.mockResolvedValue('# {{title}}');
      await expect(callAsync(Channels.TEMPLATES_GET, 'Meeting.md')).resolves.toBe('# {{title}}');
    });

    it('TEMPLATES_GET returns null ONLY for a deleted template (ENOENT)', async () => {
      domain.readTemplate.mockRejectedValue(enoent());
      await expect(callAsync(Channels.TEMPLATES_GET, 'Gone.md')).resolves.toBeNull();
    });

    it('TEMPLATES_GET rethrows a real failure rather than calling it "not found"', async () => {
      domain.readTemplate.mockRejectedValue(new Error('Invalid template filename: ../etc/passwd'));
      await expect(callAsync(Channels.TEMPLATES_GET, '../etc/passwd')).rejects.toThrow(/Invalid template filename/);
    });
  });

  describe('FORMATTER_LOAD_SETTINGS separates "never saved" from "broken"', () => {
    const settingsPath = () => path.join(dir, '.minerva', 'formatter.json');

    it('returns empty house-style defaults when the file was never written', async () => {
      await expect(callAsync(Channels.FORMATTER_LOAD_SETTINGS))
        .resolves.toEqual({ enabled: {}, configs: {} });
    });

    it('returns the persisted rule choices', async () => {
      await fs.writeFile(
        settingsPath(),
        JSON.stringify({ enabled: { 'trim-trailing': true }, configs: { 'wrap': { width: 80 } } }),
        'utf-8',
      );
      await expect(callAsync(Channels.FORMATTER_LOAD_SETTINGS)).resolves.toEqual({
        enabled: { 'trim-trailing': true },
        configs: { 'wrap': { width: 80 } },
      });
    });

    it('rejects on corrupt JSON instead of masquerading as defaults', async () => {
      await fs.writeFile(settingsPath(), '{ "enabled": {', 'utf-8');
      // The user's rule choices are still on disk, mangled. Silently answering
      // `{ enabled: {}, configs: {} }` would let the next save overwrite them.
      await expect(callAsync(Channels.FORMATTER_LOAD_SETTINGS)).rejects.toThrow();
    });

    it('coerces a structurally-wrong (but valid JSON) payload to empty maps', async () => {
      await fs.writeFile(settingsPath(), JSON.stringify({ enabled: 'yes', configs: 7 }), 'utf-8');
      await expect(callAsync(Channels.FORMATTER_LOAD_SETTINGS))
        .resolves.toEqual({ enabled: {}, configs: {} });
    });
  });
});
