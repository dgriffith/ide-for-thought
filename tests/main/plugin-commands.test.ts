/**
 * Running a plugin's command (#2643): what main decides from the manifest.
 * A handler runs in the worker host with the context as data and the note as
 * its scope, and only a well-formed answer reaches the renderer; a skill,
 * query or view is named back; a command that can't run here is refused,
 * naming the plugin. The worker host itself is `plugin-worker-host.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginCommand } from '../../src/shared/plugins/format';

const h = vi.hoisted(() => ({
  identity: null as Record<string, unknown> | null,
  commands: [] as PluginCommand[],
  invoke: vi.fn(),
  readQuery: vi.fn(),
}));
vi.mock('../../src/main/plugins/code-plugins', () => ({ codePluginIdentity: () => h.identity, codePluginCommands: () => h.commands }));
vi.mock('../../src/main/plugin-worker-host', () => ({ invokePluginLogic: h.invoke }));
vi.mock('../../src/main/plugin-sessions', () => ({ readDeclaredQuery: h.readQuery }));

import { runPluginCommand } from '../../src/main/plugin-commands';

const SORT: PluginCommand = { id: 'sort', title: 'Sort', when: 'selection', run: { handler: 'sortSelection' } };

beforeEach(() => {
  h.identity = { id: 'lab', name: 'Lab', version: '1.0.0', capabilities: ['notes:read'] };
  h.commands = [SORT];
  h.invoke.mockReset();
  h.readQuery.mockReset();
});

describe('runPluginCommand (#2643)', () => {
  it('runs a handler with the context as data and the note as its whole scope', async () => {
    h.invoke.mockResolvedValue({ replaceSelection: '- a\n- b', announce: 'Sorted.' });
    await expect(runPluginCommand('/tb', 'lab', 'sort', { note: 'list.md', selection: '- b\n- a' }))
      .resolves.toEqual({ kind: 'result', replaceSelection: '- a\n- b', announce: 'Sorted.' });
    expect(h.invoke).toHaveBeenCalledWith('lab', 'sortSelection', { command: 'sort', note: 'list.md', selection: '- b\n- a' }, { rootPath: '/tb', scope: ['list.md'] });
  });

  it('takes nothing back as nothing to do, and refuses an answer that is not a result', async () => {
    h.invoke.mockResolvedValue(undefined);
    await expect(runPluginCommand('/tb', 'lab', 'sort', { note: 'n.md', selection: 'x' })).resolves.toEqual({ kind: 'result' });
    for (const bad of [['x'], 'text', { replaceSelection: 3 }, { write: 'other.md' }, { announce: 'x'.repeat(201) }]) {
      h.invoke.mockResolvedValue(bad);
      await expect(runPluginCommand('/tb', 'lab', 'sort', { note: 'n.md', selection: 'x' }))
        .rejects.toThrow('Lab: "Sort" returned something that isn\'t a command\'s result.');
    }
  });

  it('names a skill, a view or a query back, reading the query from the plugin', async () => {
    h.commands = [
      { id: 's', title: 'S', when: 'project', run: { skill: 'steelman' } },
      { id: 'v', title: 'V', when: 'project', run: { view: 'queue' } },
      { id: 'q', title: 'Q', when: 'project', run: { query: 'open.rq' } },
    ];
    h.readQuery.mockResolvedValue('SELECT * WHERE { ?s ?p ?o }');
    await expect(runPluginCommand('/tb', 'lab', 's', {})).resolves.toEqual({ kind: 'skill', skill: 'steelman' });
    await expect(runPluginCommand('/tb', 'lab', 'v', {})).resolves.toEqual({ kind: 'view', view: 'queue' });
    await expect(runPluginCommand('/tb', 'lab', 'q', {})).resolves.toEqual({ kind: 'query', text: 'SELECT * WHERE { ?s ?p ?o }' });
    expect(h.readQuery).toHaveBeenCalledWith('lab', 'open.rq');
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("refuses a plugin that's off, a command it doesn't have, and one missing what it runs on", async () => {
    await expect(runPluginCommand('/tb', 'lab', 'nope', {})).rejects.toThrow('Lab has no command "nope".');
    await expect(runPluginCommand('/tb', 'lab', 'sort', { note: 'n.md' })).rejects.toThrow('"Sort" needs text selected.');
    await expect(runPluginCommand('/tb', 'lab', 'sort', { selection: 'x' })).rejects.toThrow('"Sort" needs a note open.');
    await expect(runPluginCommand('/tb', 'lab', 'sort', { note: '.minerva/secrets.json', selection: 'x' })).rejects.toThrow('"Sort" can\'t run on .minerva/secrets.json.');
    h.identity = null;
    await expect(runPluginCommand('/tb', 'lab', 'sort', {})).rejects.toThrow('"lab" is not an enabled plugin with code.');
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
