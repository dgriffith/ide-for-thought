/**
 * `register-templates.ts` handler coverage (#1901).
 *
 * `tests/architecture/ipc-registrar-coverage.test.ts` named this registrar as
 * one of two (with `register-refactor`, now covered separately) reached only
 * by the shared `no-project-contract.test.ts` — which asserts TEMPLATES_GET's
 * no-project throw and its null/found/error branches, but never exercises
 * TEMPLATES_LIST or TEMPLATES_SAVE_AS at all. This file drives all three
 * channels against a real temp thoughtbase and the real `notebase/templates`
 * module (only `electron`/`./helpers` are stubbed), so it's an actual test of
 * behavior rather than another shallow import.
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

vi.mock('../../../src/main/ipc/helpers', () => ({
  withRootPathOr:
    <A extends unknown[], R>(fallback: R, fn: (rootPath: string, ...a: A) => R) =>
    (_e: unknown, ...args: A) => {
      if (!state.root) return fallback;
      return fn(state.root, ...args);
    },
  withRootPath:
    <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
    (_e: unknown, ...args: A) => {
      if (!state.root) throw new Error('No project open');
      return fn(state.root, ...args);
    },
}));

import { registerTemplates } from '../../../src/main/ipc/register-templates';
import { Channels } from '../../../src/shared/channels';

registerTemplates();

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);
/** `call` wrapped so a SYNCHRONOUS return/throw (withRootPathOr/withRootPath
 *  fire before any async body runs) is assertable with `resolves`/`rejects`
 *  the same way as an async handler's. */
const callAsync = async (channel: string, ...args: unknown[]) => call(channel, ...args);

describe('register-templates.ts (#1901)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-templates-'));
    await fs.mkdir(path.join(dir, '.minerva'), { recursive: true });
    state.root = dir;
  });

  afterEach(async () => {
    state.root = null;
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe('TEMPLATES_LIST', () => {
    it('returns [] with no project open, without touching the filesystem', async () => {
      state.root = null;
      await expect(callAsync(Channels.TEMPLATES_LIST)).resolves.toEqual([]);
    });

    it('returns [] when the templates folder does not exist yet', async () => {
      await expect(call(Channels.TEMPLATES_LIST)).resolves.toEqual([]);
    });

    it('lists .md files sorted by name, skipping non-.md and dotfiles', async () => {
      const templatesDir = path.join(dir, '.minerva', 'templates');
      await fs.mkdir(templatesDir, { recursive: true });
      await fs.writeFile(path.join(templatesDir, 'Zebra.md'), '# Zebra', 'utf-8');
      await fs.writeFile(path.join(templatesDir, 'Apple.md'), '# Apple', 'utf-8');
      await fs.writeFile(path.join(templatesDir, 'notes.txt'), 'not a template', 'utf-8');
      await fs.writeFile(path.join(templatesDir, '.hidden.md'), '# hidden', 'utf-8');

      const result = await call(Channels.TEMPLATES_LIST);

      expect(result).toEqual([
        { name: 'Apple', filename: 'Apple.md' },
        { name: 'Zebra', filename: 'Zebra.md' },
      ]);
    });
  });

  describe('TEMPLATES_SAVE_AS', () => {
    it('writes the template file and returns its sanitized name', async () => {
      const result = await call(Channels.TEMPLATES_SAVE_AS, 'My Template', '# {{title}}');

      expect(result).toEqual({ name: 'My Template', filename: 'My Template.md' });
      const onDisk = await fs.readFile(path.join(dir, '.minerva', 'templates', 'My Template.md'), 'utf-8');
      expect(onDisk).toBe('# {{title}}');
    });

    it('sanitizes a raw name containing slashes and a redundant .md extension', async () => {
      const result = await call(Channels.TEMPLATES_SAVE_AS, 'sub/dir/Weekly.md', '# Weekly');

      expect(result).toEqual({ name: 'sub-dir-Weekly', filename: 'sub-dir-Weekly.md' });
    });

    it('throws with no project open rather than silently doing nothing', async () => {
      state.root = null;
      await expect(callAsync(Channels.TEMPLATES_SAVE_AS, 'X', 'body')).rejects.toThrow('No project open');
    });
  });
});
