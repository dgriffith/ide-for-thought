/**
 * `FORMATTER_SAVE_SETTINGS` project guard (#1894).
 *
 * This handler used to be `withRootPathOr(undefined, …)` — its own success
 * return is also `undefined`, so a save with no project open resolved exactly
 * like a save that actually wrote the file. `register-refactor.ts` has no
 * other test coverage today; rather than build out full coverage for every
 * handler in the file, this mocks its other dependencies down to no-ops and
 * drives just the two formatter-settings handlers registerRefactor() wires.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const { handlers, state } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  state: { root: null as string | null },
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
    rootPathFromEvent: () => state.root,
    withRootPath:
      <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A) => {
        if (!state.root) throw new Error('No project open');
        return fn(state.root, ...args);
      },
    persistIndexes: vi.fn(),
    broadcastRewritten: vi.fn(),
    hooks: {},
  };
});

// Everything else register-refactor.ts imports is unrelated to the formatter
// settings handlers — stub it to a no-op so the module loads without pulling
// in electron/graph/LLM machinery this test doesn't exercise.
vi.mock('../../../src/main/notebase/write-pipeline', () => ({ writeAndReindex: vi.fn() }));
vi.mock('../../../src/main/history', () => ({ runWithHistorySource: vi.fn() }));
vi.mock('../../../src/main/window-manager', () => ({ markPathHandled: vi.fn() }));
vi.mock('../../../src/main/llm/auto-tag', () => ({ runAutoTag: vi.fn(), applyAutoTag: vi.fn() }));
vi.mock('../../../src/main/llm/auto-link', () => ({
  suggestLinksTo: vi.fn(),
  fileAutoLinkOutbound: vi.fn(),
  suggestLinksInbound: vi.fn(),
  fileAutoLinkInbound: vi.fn(),
}));
vi.mock('../../../src/main/formatter/orchestrator', () => ({
  formatNoteContent: vi.fn(),
  formatFile: vi.fn(),
  formatFolder: vi.fn(),
}));
vi.mock('../../../src/main/notebase/fs', () => ({}));

import { registerRefactor } from '../../../src/main/ipc/register-refactor';
import { Channels } from '../../../src/shared/channels';

registerRefactor();

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

describe('formatter settings handlers (#1894)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-formatter-'));
    await fs.mkdir(path.join(dir, '.minerva'), { recursive: true });
    state.root = dir;
  });

  afterEach(async () => {
    state.root = null;
    await fs.rm(dir, { recursive: true, force: true });
  });

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
