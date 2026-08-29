/**
 * `register-refactor.ts` handler coverage (#1901).
 *
 * Covers all 12 channels the module registers at the IPC/delegation layer —
 * "does this handler call the right function with the right args and shape
 * the right response" — not the deep write-guard logic behind
 * REFACTOR_AUTO_TAG_APPLY / REFACTOR_AUTO_LINK_INBOUND_APPLY, which is a
 * separate concern proven against a real graph in
 * `tests/main/llm/auto-tag-auto-link-write-guard.test.ts` (mocking
 * `llm/auto-tag` / `llm/auto-link` wholesale here would make that guard a
 * no-op). FORMATTER_SAVE_SETTINGS / FORMATTER_LOAD_SETTINGS tests below
 * originated in the narrower `register-refactor-formatter.test.ts` (#1894);
 * this file supersedes it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const { handlers, state, mocks } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  state: { root: null as string | null },
  mocks: {
    runAutoTag: vi.fn(),
    applyAutoTag: vi.fn(),
    suggestLinksTo: vi.fn(),
    fileAutoLinkOutbound: vi.fn(),
    suggestLinksInbound: vi.fn(),
    fileAutoLinkInbound: vi.fn(),
    formatNoteContent: vi.fn(),
    formatFile: vi.fn(),
    formatFolder: vi.fn(),
    writeAndReindex: vi.fn(),
    markPathHandled: vi.fn(),
    persistIndexes: vi.fn(),
    broadcastRewritten: vi.fn(),
    readFile: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } },
}));

// Keep the REAL readJsonFileOr (FORMATTER_LOAD_SETTINGS's own #1841 contract);
// only stub the project-scoping wrapper so the root can be steered/cleared.
vi.mock('../../../src/main/ipc/helpers', async () => {
  const { readJsonFileOr } = await import('../../../src/main/ipc/read-json');
  return {
    readJsonFileOr,
    rootPathFromEvent: (e: { rootPath?: string | null }) => e?.rootPath ?? null,
    withRootPath:
      <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A) => {
        if (!state.root) throw new Error('No project open');
        return fn(state.root, ...args);
      },
    persistIndexes: mocks.persistIndexes,
    broadcastRewritten: mocks.broadcastRewritten,
    hooks: {},
  };
});

vi.mock('../../../src/main/notebase/write-pipeline', () => ({ writeAndReindex: mocks.writeAndReindex }));
vi.mock('../../../src/main/history', () => ({
  runWithHistorySource: (_opts: unknown, fn: () => unknown) => fn(),
}));
vi.mock('../../../src/main/window-manager', () => ({ markPathHandled: mocks.markPathHandled }));
vi.mock('../../../src/main/llm/auto-tag', () => ({
  runAutoTag: mocks.runAutoTag,
  applyAutoTag: mocks.applyAutoTag,
}));
vi.mock('../../../src/main/llm/auto-link', () => ({
  suggestLinksTo: mocks.suggestLinksTo,
  fileAutoLinkOutbound: mocks.fileAutoLinkOutbound,
  suggestLinksInbound: mocks.suggestLinksInbound,
  fileAutoLinkInbound: mocks.fileAutoLinkInbound,
}));
vi.mock('../../../src/main/formatter/orchestrator', () => ({
  formatNoteContent: mocks.formatNoteContent,
  formatFile: mocks.formatFile,
  formatFolder: mocks.formatFolder,
}));
vi.mock('../../../src/main/notebase/fs', () => ({ readFile: mocks.readFile }));

import { registerRefactor } from '../../../src/main/ipc/register-refactor';
import { Channels } from '../../../src/shared/channels';

registerRefactor();

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

describe('register-refactor.ts (#1901)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-refactor-'));
    await fs.mkdir(path.join(dir, '.minerva'), { recursive: true });
    state.root = dir;
    for (const m of Object.values(mocks)) m.mockReset();
  });

  afterEach(async () => {
    state.root = null;
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe('REFACTOR_AUTO_TAG_SUGGEST', () => {
    it('delegates to runAutoTag and returns only the added tags', async () => {
      mocks.runAutoTag.mockResolvedValue({ added: ['alpha', 'beta'], content: 'ignored' });

      const result = await call(Channels.REFACTOR_AUTO_TAG_SUGGEST, 'notes/x.md');

      expect(mocks.runAutoTag).toHaveBeenCalledWith(dir, 'notes/x.md');
      expect(result).toEqual({ added: ['alpha', 'beta'] });
    });
  });

  describe('REFACTOR_AUTO_TAG_APPLY', () => {
    it('short-circuits without calling applyAutoTag when acceptedTags is empty', async () => {
      const result = await call(Channels.REFACTOR_AUTO_TAG_APPLY, 'notes/x.md', []);

      expect(mocks.applyAutoTag).not.toHaveBeenCalled();
      expect(result).toEqual({ applied: [] });
    });

    it('applies tags and broadcasts the rewritten paths', async () => {
      mocks.applyAutoTag.mockResolvedValue({ applied: ['alpha'], rewrittenPaths: ['notes/x.md'] });

      const result = await call(Channels.REFACTOR_AUTO_TAG_APPLY, 'notes/x.md', ['alpha']);

      expect(mocks.applyAutoTag).toHaveBeenCalledWith(dir, 'notes/x.md', ['alpha']);
      expect(mocks.broadcastRewritten).toHaveBeenCalledWith(dir, ['notes/x.md']);
      expect(result).toEqual({ applied: ['alpha'] });
    });
  });

  describe('REFACTOR_AUTO_LINK_SUGGEST', () => {
    it('delegates to suggestLinksTo and returns its result verbatim', async () => {
      const suggestions = [{ anchorText: 'widgets', target: 'notes/widgets.md', rationale: 'r.' }];
      mocks.suggestLinksTo.mockResolvedValue(suggestions);

      const result = await call(Channels.REFACTOR_AUTO_LINK_SUGGEST, 'notes/active.md');

      expect(mocks.suggestLinksTo).toHaveBeenCalledWith(dir, 'notes/active.md');
      expect(result).toBe(suggestions);
    });
  });

  describe('REFACTOR_APPLY_SUGGESTED_LINK', () => {
    it('writes the note when a See-also link is newly appended', async () => {
      mocks.readFile.mockResolvedValue('# Active\n');

      const result = await call(Channels.REFACTOR_APPLY_SUGGESTED_LINK, 'notes/active.md', 'notes/target.md');

      expect(result).toEqual({ changed: true });
      expect(mocks.writeAndReindex).toHaveBeenCalledTimes(1);
      const [writtenRoot, writtenPath, writtenContent] = mocks.writeAndReindex.mock.calls[0];
      expect(writtenRoot).toBe(dir);
      expect(writtenPath).toBe('notes/active.md');
      expect(writtenContent).toContain('- [[notes/target]]');
    });

    it('is idempotent: does not write when the link already exists', async () => {
      mocks.readFile.mockResolvedValue('# Active\n\n## See also\n\n- [[notes/target]]\n');

      const result = await call(Channels.REFACTOR_APPLY_SUGGESTED_LINK, 'notes/active.md', 'notes/target.md');

      expect(result).toEqual({ changed: false });
      expect(mocks.writeAndReindex).not.toHaveBeenCalled();
    });
  });

  describe('REFACTOR_AUTO_LINK_APPLY', () => {
    it('delegates to fileAutoLinkOutbound and broadcasts the rewritten paths', async () => {
      mocks.fileAutoLinkOutbound.mockResolvedValue({
        applied: [{ anchorText: 'widgets' }],
        skipped: [],
        rewrittenPaths: ['notes/active.md'],
      });
      const accepted = [{ anchorText: 'widgets', target: 'notes/widgets.md', rationale: 'r.' }];

      const result = await call(Channels.REFACTOR_AUTO_LINK_APPLY, 'notes/active.md', accepted);

      expect(mocks.fileAutoLinkOutbound).toHaveBeenCalledWith(dir, 'notes/active.md', accepted);
      expect(mocks.broadcastRewritten).toHaveBeenCalledWith(dir, ['notes/active.md']);
      expect(result).toEqual({ applied: [{ anchorText: 'widgets' }], skipped: [] });
    });
  });

  describe('REFACTOR_AUTO_LINK_INBOUND_SUGGEST', () => {
    it('delegates to suggestLinksInbound and returns its result verbatim', async () => {
      const suggestions = [{ source: 'notes/a.md', anchorText: 'widgets', rationale: 'r.', contextSnippet: '' }];
      mocks.suggestLinksInbound.mockResolvedValue(suggestions);

      const result = await call(Channels.REFACTOR_AUTO_LINK_INBOUND_SUGGEST, 'notes/active.md');

      expect(mocks.suggestLinksInbound).toHaveBeenCalledWith(dir, 'notes/active.md');
      expect(result).toBe(suggestions);
    });
  });

  describe('REFACTOR_AUTO_LINK_INBOUND_APPLY', () => {
    it('delegates to fileAutoLinkInbound and broadcasts the rewritten paths', async () => {
      mocks.fileAutoLinkInbound.mockResolvedValue({
        applied: [{ source: 'notes/a.md' }],
        skipped: [],
        rewrittenPaths: ['notes/a.md'],
      });
      const accepted = [{ source: 'notes/a.md', anchorText: 'widgets', rationale: 'r.', contextSnippet: '' }];

      const result = await call(Channels.REFACTOR_AUTO_LINK_INBOUND_APPLY, 'notes/active.md', accepted);

      expect(mocks.fileAutoLinkInbound).toHaveBeenCalledWith(dir, 'notes/active.md', accepted);
      expect(mocks.broadcastRewritten).toHaveBeenCalledWith(dir, ['notes/a.md']);
      expect(result).toEqual({ applied: [{ source: 'notes/a.md' }], skipped: [], touchedPaths: ['notes/a.md'] });
    });
  });

  describe('FORMATTER_FORMAT_CONTENT', () => {
    it('delegates to formatNoteContent with the event-derived root path', async () => {
      mocks.formatNoteContent.mockReturnValue({ content: 'formatted', changed: true });
      const settings = { enabled: {}, configs: {} } as never;

      const result = handlers.get(Channels.FORMATTER_FORMAT_CONTENT)!(
        { rootPath: dir },
        'raw content',
        settings,
        'notes/x.md',
      );

      expect(mocks.formatNoteContent).toHaveBeenCalledWith('raw content', settings, 'notes/x.md', dir);
      expect(result).toEqual({ content: 'formatted', changed: true });
    });

    it('passes undefined when no project root is available on the event', () => {
      mocks.formatNoteContent.mockReturnValue({ content: 'raw content', changed: false });
      const settings = { enabled: {}, configs: {} } as never;

      handlers.get(Channels.FORMATTER_FORMAT_CONTENT)!({ rootPath: null }, 'raw content', settings, undefined);

      expect(mocks.formatNoteContent).toHaveBeenCalledWith('raw content', settings, undefined, undefined);
    });
  });

  describe('FORMATTER_FORMAT_FILE', () => {
    it('marks touched paths handled, persists indexes, and broadcasts when the file changed', async () => {
      mocks.formatFile.mockResolvedValue({ changed: true, cascadedPaths: ['notes/linked.md'] });

      const result = await call(Channels.FORMATTER_FORMAT_FILE, 'notes/x.md', {});

      expect(mocks.markPathHandled).toHaveBeenCalledWith('notes/x.md');
      expect(mocks.markPathHandled).toHaveBeenCalledWith('notes/linked.md');
      expect(mocks.persistIndexes).toHaveBeenCalledWith(dir);
      expect(mocks.broadcastRewritten).toHaveBeenCalledWith(dir, ['notes/x.md', 'notes/linked.md']);
      expect(result).toEqual({ changed: true, cascadedPaths: ['notes/linked.md'] });
    });

    it('does nothing extra when nothing changed and nothing cascaded', async () => {
      mocks.formatFile.mockResolvedValue({ changed: false, cascadedPaths: [] });

      await call(Channels.FORMATTER_FORMAT_FILE, 'notes/x.md', {});

      expect(mocks.markPathHandled).not.toHaveBeenCalled();
      expect(mocks.persistIndexes).not.toHaveBeenCalled();
      expect(mocks.broadcastRewritten).not.toHaveBeenCalled();
    });
  });

  describe('FORMATTER_FORMAT_FOLDER', () => {
    it('marks touched paths handled, persists indexes, and broadcasts changed + cascaded paths', async () => {
      mocks.formatFolder.mockResolvedValue({
        changedPaths: ['notes/a.md'],
        cascadedPaths: ['notes/b.md'],
      });

      const result = await call(Channels.FORMATTER_FORMAT_FOLDER, 'notes', {});

      expect(mocks.formatFolder).toHaveBeenCalledWith(dir, 'notes', {});
      expect(mocks.markPathHandled).toHaveBeenCalledWith('notes/a.md');
      expect(mocks.markPathHandled).toHaveBeenCalledWith('notes/b.md');
      expect(mocks.persistIndexes).toHaveBeenCalledWith(dir);
      expect(mocks.broadcastRewritten).toHaveBeenCalledWith(dir, ['notes/a.md', 'notes/b.md']);
      expect(result).toEqual({ changedPaths: ['notes/a.md'], cascadedPaths: ['notes/b.md'] });
    });

    it('defaults a nullish relDir to the project root', async () => {
      mocks.formatFolder.mockResolvedValue({ changedPaths: [], cascadedPaths: [] });

      await call(Channels.FORMATTER_FORMAT_FOLDER, undefined, {});

      expect(mocks.formatFolder).toHaveBeenCalledWith(dir, '', {});
    });
  });

  describe('formatter settings handlers (#1894)', () => {
    it('FORMATTER_SAVE_SETTINGS writes formatter.json for the open project', async () => {
      const settings = { enabled: { markdown: true }, configs: {} };
      await call(Channels.FORMATTER_SAVE_SETTINGS, settings);

      const written = JSON.parse(await fs.readFile(path.join(dir, '.minerva', 'formatter.json'), 'utf-8'));
      expect(written).toEqual(settings);
    });

    // #1894 — used to be `withRootPathOr(undefined, …)`; a save with no project
    // open silently resolved as if the write had happened.
    it('FORMATTER_SAVE_SETTINGS throws with no project rather than silently doing nothing', () => {
      state.root = null;
      expect(() => call(Channels.FORMATTER_SAVE_SETTINGS, { enabled: {}, configs: {} }))
        .toThrow('No project open');
    });

    it('FORMATTER_LOAD_SETTINGS returns defaults when formatter.json is absent', async () => {
      await expect(call(Channels.FORMATTER_LOAD_SETTINGS)).resolves.toEqual({ enabled: {}, configs: {} });
    });
  });
});
