/**
 * `llm.propose`'s real I/O (#2858): the allow is asked natively once per
 * plugin version, kept in plugins.json (or for this run, for a plugin with no
 * record), and asked again after an upgrade; the model is the user's default;
 * and a filing goes through `proposeWrite` in LLM context.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useTempDir } from '../helpers/temp-project';

const h = vi.hoisted(() => ({
  dir: '',
  windows: [] as unknown[],
  confirm: vi.fn(),
  complete: vi.fn(),
  proposeWrite: vi.fn(),
  inLlm: false,
}));
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, app: {} }));
vi.mock('../../src/main/native-confirm', () => ({ confirmNative: h.confirm }));
vi.mock('../../src/main/window-manager', () => ({ windowsForProject: () => h.windows }));
vi.mock('../../src/main/plugins/registry', () => ({ activePluginsDir: () => h.dir }));
vi.mock('../../src/main/llm/index', () => ({ complete: h.complete }));
vi.mock('../../src/main/llm/approval', () => ({ proposeWrite: async (...a: unknown[]) => { h.proposeWrite(h.inLlm, ...a); return null; } }));
vi.mock('../../src/main/graph/index', () => ({
  withLLMContext: async (fn: () => Promise<unknown>) => { h.inLlm = true; try { return await fn(); } finally { h.inLlm = false; } },
}));
vi.mock('../../src/main/project-context-types', () => ({ projectContext: (rootPath: string) => ({ rootPath }) }));

import { llmAllowQuestion, pluginLlmDeps } from '../../src/main/plugin-llm-deps';

const tmp = useTempDir('plugin-llm-deps-');
const identity = { id: 'tidy', name: 'Tidy', version: '1.2.0', capabilities: ['llm:propose' as const] };
const records = () => JSON.parse(fs.readFileSync(path.join(tmp.root, 'plugins.json'), 'utf8')).plugins;
const deps = () => pluginLlmDeps(() => null);

beforeEach(() => {
  h.dir = path.join(tmp.root, 'plugins');
  h.windows = [{ id: 1 }];
  h.confirm.mockReset();
  h.complete.mockReset();
  h.proposeWrite.mockReset();
  fs.writeFileSync(path.join(tmp.root, 'plugins.json'), JSON.stringify({ plugins: { tidy: { enabled: true, source: { kind: 'manual' } } } }));
});

describe('the allow (#2858)', () => {
  it('asks in main\'s own dialog once per version, keeping the answer in plugins.json', async () => {
    h.confirm.mockResolvedValue({ confirmed: true, checked: false });
    expect(await deps().allow(identity, '/tb')).toBe(true);
    expect(h.confirm).toHaveBeenCalledWith({ id: 1 }, llmAllowQuestion(identity));
    expect(records().tidy).toMatchObject({ enabled: true, llmAllowed: '1.2.0' });
    expect(await deps().allow(identity, '/tb')).toBe(true);
    expect(h.confirm).toHaveBeenCalledTimes(1);
    // An upgrade asks again.
    expect(await deps().allow({ ...identity, version: '1.3.0' }, '/tb')).toBe(true);
    expect(h.confirm).toHaveBeenCalledTimes(2);
  });

  it('a "no" is kept nowhere, so it asks next time', async () => {
    h.confirm.mockResolvedValue({ confirmed: false, checked: false });
    expect(await deps().allow(identity, '/tb')).toBe(false);
    expect(records().tidy.llmAllowed).toBeUndefined();
  });

  it('a plugin with no record is allowed for this run only', async () => {
    h.confirm.mockResolvedValue({ confirmed: true, checked: false });
    const core = { ...identity, id: 'built-in' };
    expect(await deps().allow(core, '/tb')).toBe(true);
    expect(await deps().allow(core, '/tb')).toBe(true);
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(records()['built-in']).toBeUndefined();
  });

  it('says what it costs and that nothing changes without review', () => {
    expect(llmAllowQuestion(identity)).toMatchObject({ message: 'Let Tidy ask the assistant?', confirmLabel: 'Allow' });
    expect(llmAllowQuestion(identity).detail).toMatch(/your model and API key[\s\S]*proposal for you to review/);
  });
});

describe('the rest (#2858)', () => {
  it('has a window only when one is open on the thoughtbase', () => {
    expect(deps().hasWindow('/tb')).toBe(true);
    h.windows = [];
    expect(deps().hasWindow('/tb')).toBe(false);
  });

  it('asks the user\'s default model, with the system prompt, and reports its usage', async () => {
    const usage = { inputTokens: 5, outputTokens: 6, cacheCreationTokens: 0, cacheReadTokens: 0 };
    h.complete.mockImplementation(async (_user: string, opts: { onUsage: (u: unknown, m: string) => void }) => { opts.onUsage(usage, 'claude-opus-5'); return 'answer'; });
    expect(await deps().complete('SYS', 'USER')).toEqual({ text: 'answer', usage, model: 'claude-opus-5' });
    expect(h.complete).toHaveBeenCalledWith('USER', expect.objectContaining({ system: 'SYS' }));
    expect(h.complete.mock.calls[0]![1]).not.toHaveProperty('model');
  });

  it('files through proposeWrite, in LLM context', async () => {
    const write = { operationType: 'note_rewrite' as const, payloads: [], note: 'n', proposedBy: 'plugin:tidy@1.2.0+llm:m' };
    await deps().file('/tb', write);
    expect(h.proposeWrite).toHaveBeenCalledWith(true, { rootPath: '/tb' }, write);
  });
});
