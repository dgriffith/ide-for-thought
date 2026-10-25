/**
 * Plugin inspections written as code (#2831): the check's query runs first
 * and its notes are the call's scope; the call only reads; the answer becomes
 * findings of the check's one type; and a check that misses its deadline,
 * throws or answers nonsense is one finding against the plugin, never a
 * rejection. Running beside the other checks is `health-checks.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginInspection } from '../../src/shared/plugins/format';

const h = vi.hoisted(() => ({
  active: [] as { pluginId: string; name: string; inspection: PluginInspection }[],
  shapeTypes: [] as string[],
  invoke: vi.fn(),
  query: vi.fn(),
}));
vi.mock('../../src/main/plugins/code-plugins', () => ({ activePluginInspections: () => h.active }));
vi.mock('../../src/main/plugins/inspection-shapes', () => ({ pluginInspections: () => ({ catalog: h.shapeTypes.map((type) => ({ type })) }) }));
vi.mock('../../src/main/plugin-sessions', () => ({ runDeclaredPluginQuery: h.query }));
vi.mock('../../src/main/graph', () => ({ noteUriFor: (_ctx: unknown, p: string) => `https://tb.example/${p}` }));
vi.mock('../../src/main/plugin-worker-host', async () => {
  const { PluginCallError } = await import('../../src/main/plugins/broker');
  class PluginDeadlineError extends PluginCallError {}
  return { invokePluginLogic: h.invoke, PluginDeadlineError };
});

import { pluginCodeChecks, pluginCodeInspectionDefs, PLUGIN_INSPECTION_CAPABILITIES } from '../../src/main/plugin-inspections';
import { PluginDeadlineError } from '../../src/main/plugin-worker-host';
import { PluginCallError } from '../../src/main/plugins/broker';
import { projectContext } from '../../src/main/project-context-types';
import { silenceLogTags } from '../helpers/quiet-logs';

silenceLogTags('plugins');

const CHECK: PluginInspection = { id: 'skipped-heading', label: 'Skipped headings', description: 'Jumps.', severity: 'info', query: 'notes.rq', run: { handler: 'skippedHeadings' } };
const ctx = projectContext('/tb');
const QUERY = { columns: ['note'], rows: [{ note: 'https://tb.example/a.md' }], notes: { 'https://tb.example/a.md': 'a.md', 'https://tb.example/b.md': 'b.md' }, truncated: false, error: null };
const run = () => pluginCodeChecks()[0]!.run(ctx);

beforeEach(() => {
  h.active = [{ pluginId: 'outline', name: 'Outline', inspection: CHECK }];
  h.shapeTypes = [];
  h.invoke.mockReset();
  h.query.mockReset().mockResolvedValue(QUERY);
});

describe('plugin code checks (#2831)', () => {
  it('runs the query, scopes the call to its notes, read-only, and turns the answer into findings', async () => {
    h.invoke.mockResolvedValue({ findings: [
      { note: 'a.md', message: ' Jumps from H1 to H3. ', suggestedAction: 'Make it an H2.' },
      { node: 'https://tb.example/concept#x', label: 'X', message: 'A node.' },
    ] });
    expect(pluginCodeChecks().map((c) => c.type)).toEqual(['plugin:outline/skipped-heading']);
    expect(await run()).toEqual([
      { id: 'plugin:outline/skipped-heading-0', type: 'plugin:outline/skipped-heading', severity: 'info', nodeUri: 'https://tb.example/a.md', nodeLabel: 'a', message: 'Jumps from H1 to H3.', suggestedAction: 'Make it an H2.', notePath: 'a.md' },
      { id: 'plugin:outline/skipped-heading-1', type: 'plugin:outline/skipped-heading', severity: 'info', nodeUri: 'https://tb.example/concept#x', nodeLabel: 'X', message: 'A node.' },
    ]);
    expect(h.query).toHaveBeenCalledWith('outline', '/tb', 'notes.rq', 'inspection skipped-heading');
    expect(h.invoke).toHaveBeenCalledWith('outline', 'skippedHeadings', { check: 'skipped-heading', query: QUERY },
      { rootPath: '/tb', scope: ['a.md', 'b.md'], capabilities: PLUGIN_INSPECTION_CAPABILITIES, deadlineMs: 10_000 });
    expect(PLUGIN_INSPECTION_CAPABILITIES).toEqual(['notes:read', 'graph:query']);
  });

  it('hands a check with no query nothing, with nothing in scope', async () => {
    h.active = [{ pluginId: 'outline', name: 'Outline', inspection: { ...CHECK, query: undefined } as unknown as PluginInspection }];
    h.invoke.mockResolvedValue({ findings: [] });
    expect(await run()).toEqual([]);
    expect(h.query).not.toHaveBeenCalled();
    expect(h.invoke).toHaveBeenCalledWith('outline', 'skippedHeadings', { check: 'skipped-heading', query: null }, expect.objectContaining({ scope: [] }));
  });

  it('reports a missed deadline as one finding against the plugin, not a failure', async () => {
    h.invoke.mockRejectedValue(new PluginDeadlineError('Outline didn\'t answer "skippedHeadings" within 10s, so it was stopped.'));
    expect(await run()).toEqual([{
      id: 'plugin:outline/skipped-heading-failed', type: 'plugin:outline/skipped-heading', severity: 'warning',
      nodeUri: 'minerva-plugin://outline/', nodeLabel: 'Outline',
      message: 'Outline\'s "Skipped headings" check didn\'t finish in 10 s, so it was stopped. Its findings are missing from this run.',
    }]);
  });

  it.each([
    [new PluginCallError('Outline: the parser choked'), 'failed: Outline: the parser choked.'],
    [{ findings: 'none' }, 'failed: it returned something that isn\'t a list of findings ("findings" must be a list).'],
    [{ findings: [{ message: 'x' }] }, 'must name a "note" or a "node"'],
    [{ findings: [{ note: '.minerva/secrets.json', message: 'x' }] }, 'findings[0].note must be a note\'s path'],
    [{ findings: [{ node: 'not an iri', message: 'x' }] }, 'findings[0].node must be an IRI'],
    [{ findings: [{ note: 'a.md', message: 'x', fix: { kind: 'delete' } }] }, 'unknown field "fix"'],
    [{ findings: [], write: true }, 'unknown field "write"'],
  ])('reports a throw or a bad answer (%j) as one finding', async (outcome, words) => {
    if (outcome instanceof Error) h.invoke.mockRejectedValue(outcome);
    else h.invoke.mockResolvedValue(outcome);
    const found = await run();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: 'plugin:outline/skipped-heading', severity: 'warning', nodeLabel: 'Outline' });
    expect(found[0]!.message).toContain(words);
  });

  it('keeps the first 200 findings', async () => {
    h.invoke.mockResolvedValue({ findings: Array.from({ length: 250 }, (_, i) => ({ note: `n${i}.md`, message: 'x' })) });
    expect(await run()).toHaveLength(200);
  });

  it('lists each check in Settings under its plugin, and leaves out one a shape of the plugin already names', () => {
    expect(pluginCodeInspectionDefs()).toEqual([{
      type: 'plugin:outline/skipped-heading', label: 'Skipped headings', description: 'Jumps.', group: 'plugins', severity: 'info', plugin: { id: 'outline', name: 'Outline' },
    }]);
    h.shapeTypes = ['plugin:outline/skipped-heading'];
    expect(pluginCodeInspectionDefs()).toEqual([]);
    expect(pluginCodeChecks()).toEqual([]);
  });
});

describe('installPluginInspections (#2831)', () => {
  it('fills the slot the sweep and Settings read', async () => {
    const slot = await import('../../src/main/plugin-code-checks');
    const { installPluginInspections } = await import('../../src/main/plugin-inspections');
    expect(slot.pluginCodeChecks()).toEqual([]);
    installPluginInspections();
    expect(slot.pluginCodeChecks().map((c) => c.type)).toEqual(['plugin:outline/skipped-heading']);
    expect(slot.pluginCodeInspectionDefs().map((d) => d.type)).toEqual(['plugin:outline/skipped-heading']);
    slot.setPluginCodeChecks(null);
    expect(slot.pluginCodeInspectionDefs()).toEqual([]);
  });
});
