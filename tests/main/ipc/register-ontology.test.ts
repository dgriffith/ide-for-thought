/**
 * @vitest-environment node
 *
 * `register-ontology.ts` (#2788): Settings → Ontology's four channels, driven
 * through the real registrar against a real graph in a temp thoughtbase. Only
 * Electron (the picker) and the project guard are stubbed.
 *
 * Pins: the project guard (listing with no thoughtbase is an empty list,
 * everything else throws); a cancelled picker writes nothing and returns null;
 * the picker refuses an oversized file before reading it; import is review
 * then commit, by id, never a renderer-chosen path; remove acts only on a
 * plain file name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  showOpenDialog: vi.fn(),
  openProject: null as string | null,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { h.handlers.set(channel, fn); } },
  dialog: { showOpenDialog: h.showOpenDialog },
}));

vi.mock('../../../src/main/ipc/helpers', () => ({
  withRootPath:
    <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => {
        if (!h.openProject) throw new Error('No project open');
        return fn(h.openProject, ...args);
      },
  withRootPathOr:
    <A extends unknown[], R>(fallback: R, fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => (h.openProject ? fn(h.openProject, ...args) : fallback),
  withRootPathWin:
    <A extends unknown[], R>(fn: (rootPath: string, win: unknown, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => {
        if (!h.openProject) throw new Error('No project open');
        return fn(h.openProject, { id: 1 }, ...args);
      },
}));

import { registerOntology } from '../../../src/main/ipc/register-ontology';
import { Channels } from '../../../src/shared/channels';
import { initGraph, disposeProject } from '../../../src/main/graph/index';
import { projectContext } from '../../../src/main/project-context-types';
import { MAX_VOCABULARY_BYTES } from '../../../src/main/graph/user-ontology-check';
import type { VocabularyImportPreview, VocabularyStatus } from '../../../src/shared/ontology-vocabularies';

registerOntology();

/** Async, so a guard that throws synchronously arrives as a rejection — as it does over IPC. */
const call = async <T>(channel: string, ...args: unknown[]): Promise<T> => await (h.handlers.get(channel)!({}, ...args) as Promise<T>);

const LAB = '@prefix lab: <https://lab.example/ns#> .\nlab:Sample a <http://www.w3.org/2000/01/rdf-schema#Class> .\n';

let root: string;
let picked: string;

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-register-ontology-')));
  picked = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-picked-')), 'Lab.ttl');
  fs.writeFileSync(picked, LAB);
  h.openProject = root;
  h.showOpenDialog.mockReset().mockResolvedValue({ canceled: false, filePaths: [picked] });
  await initGraph(projectContext(root));
});

afterEach(() => {
  disposeProject(projectContext(root));
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(path.dirname(picked), { recursive: true, force: true });
});

describe('register-ontology (#2788)', () => {
  it('registers its four channels', () => {
    for (const ch of [Channels.ONTOLOGY_LIST, Channels.ONTOLOGY_PICK_IMPORT, Channels.ONTOLOGY_IMPORT, Channels.ONTOLOGY_REMOVE]) {
      expect(h.handlers.has(ch)).toBe(true);
    }
  });

  it('with no thoughtbase open, the list is empty and every change throws', async () => {
    h.openProject = null;
    expect(await call(Channels.ONTOLOGY_LIST)).toEqual([]);
    await expect(call(Channels.ONTOLOGY_PICK_IMPORT)).rejects.toThrow('No project open');
    await expect(call(Channels.ONTOLOGY_IMPORT, 'x')).rejects.toThrow('No project open');
    await expect(call(Channels.ONTOLOGY_REMOVE, 'a.ttl')).rejects.toThrow('No project open');
  });

  it('a cancelled picker writes nothing and answers null', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await call(Channels.ONTOLOGY_PICK_IMPORT)).toBeNull();
    expect(fs.existsSync(path.join(root, '.minerva', 'ontology'))).toBe(false);
  });

  it('pick reviews without saving; import commits that review by id; remove takes it out', async () => {
    const preview = await call<VocabularyImportPreview>(Channels.ONTOLOGY_PICK_IMPORT);
    expect(h.showOpenDialog).toHaveBeenCalledWith({ id: 1 }, expect.objectContaining({ filters: [{ name: 'Turtle', extensions: ['ttl'] }] }));
    expect(preview).toMatchObject({ file: 'lab.ttl', replaces: false, status: { ok: true, prefixes: [{ prefix: 'lab' }] } });
    expect(fs.existsSync(path.join(root, '.minerva', 'ontology', 'lab.ttl'))).toBe(false);

    const statuses = await call<VocabularyStatus[]>(Channels.ONTOLOGY_IMPORT, preview.id);
    expect(statuses).toMatchObject([{ file: 'lab.ttl', ok: true }]);
    expect(await call(Channels.ONTOLOGY_LIST)).toMatchObject([{ file: 'lab.ttl', ok: true }]);

    expect(await call(Channels.ONTOLOGY_REMOVE, 'lab.ttl')).toEqual([]);
    expect(fs.existsSync(path.join(root, '.minerva', 'ontology', 'lab.ttl'))).toBe(false);
  });

  it('import takes an id, not a path', async () => {
    await expect(call(Channels.ONTOLOGY_IMPORT, picked)).rejects.toThrow(/no longer waiting/);
  });

  it('refuses an oversized pick before reading it', async () => {
    fs.writeFileSync(picked, `# ${'x'.repeat(MAX_VOCABULARY_BYTES)}\n`);
    await expect(call(Channels.ONTOLOGY_PICK_IMPORT)).rejects.toThrow(/Lab\.ttl is \d+ KB; a vocabulary may be at most 1024 KB/);
  });

  it('remove acts only on a plain file name', async () => {
    await expect(call(Channels.ONTOLOGY_REMOVE, '../graph.ttl')).rejects.toThrow(/isn't a vocabulary file name/);
  });
});
