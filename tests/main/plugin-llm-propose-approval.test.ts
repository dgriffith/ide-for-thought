/**
 * @vitest-environment node
 *
 * A plugin's model request (#2858) through the real approval engine: what the
 * model proposes lands as PENDING proposals, stamped with the plugin and the
 * model, and nothing is written until the user approves; the write guard is
 * armed throughout, so a filing that skipped the engine would throw here.
 * Only the dialog, the windows and the model are scripted.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useGraphProject } from '../helpers/temp-project';
import { silenceLogTags } from '../helpers/quiet-logs';

silenceLogTags('approval');

const h = vi.hoisted(() => ({ answer: '' }));
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, app: {} }));
vi.mock('../../src/main/native-confirm', () => ({ confirmNative: async () => ({ confirmed: true, checked: false }) }));
vi.mock('../../src/main/window-manager', () => ({ windowsForProject: () => [{ id: 1 }] }));
vi.mock('../../src/main/plugins/registry', () => ({ activePluginsDir: () => '/nonexistent/plugins' }));
vi.mock('../../src/main/llm/index', () => ({
  complete: async (_user: string, opts: { onUsage: (u: unknown, m: string) => void }) => {
    opts.onUsage({ inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'claude-opus-5');
    return h.answer;
  },
}));

import { pluginLlmDeps } from '../../src/main/plugin-llm-deps';
import { proposeForPlugin, _resetPluginLlmLimitsForTests } from '../../src/main/plugin-llm-propose';
import { approveProposal, listProposals } from '../../src/main/llm/approval';
import { describeProposer } from '../../src/shared/provenance';

const project = useGraphProject('minerva-plugin-llm-');
const identity = { id: 'tidy', name: 'Tidy', version: '1.2.0', capabilities: ['notes:read' as const, 'llm:propose' as const] };

describe('llm.propose through the approval engine (#2858)', () => {
  it('files pending proposals the user approves; nothing is written before', async () => {
    _resetPluginLlmLimitsForTests();
    fs.writeFileSync(path.join(project.root, 'a.md'), '---\nstatus: draft\n---\n# A\n');
    h.answer = JSON.stringify({
      summary: 'Tidied',
      changes: [
        { setProperties: 'a.md', properties: { status: 'done' } },
        { create: 'b.md', content: '# B\n' },
        { create: '.minerva/config.json', content: '{}' },
      ],
    });
    const r = await proposeForPlugin(pluginLlmDeps(() => null), identity, project.root, {
      prompt: 'Tidy.', notes: [{ path: 'a.md', content: '---\nstatus: draft\n---\n# A\n' }],
    });
    expect(r.proposals).toEqual([{ kind: 'setProperties', path: 'a.md' }, { kind: 'create', path: 'b.md' }]);
    expect(r.leftOut).toHaveLength(1);

    const pending = await listProposals(project.ctx, 'pending');
    expect(pending.map((p) => p.operationType).sort()).toEqual(['component_creation', 'note_rewrite']);
    for (const p of pending) {
      expect(p.proposedBy).toBe('plugin:tidy@1.2.0+llm:claude-opus-5');
      expect(p.note).toMatch(/— Tidy, via claude-opus-5, 15 tokens$/);
    }
    expect(describeProposer(pending[0]!.proposedBy)).toMatchObject({ kind: 'plugin', label: 'tidy (plugin, claude-opus-5)', external: true });
    expect(fs.readFileSync(path.join(project.root, 'a.md'), 'utf8')).toContain('status: draft');
    expect(fs.existsSync(path.join(project.root, 'b.md'))).toBe(false);

    for (const p of pending) await approveProposal(project.ctx, p.uri);
    expect(fs.readFileSync(path.join(project.root, 'a.md'), 'utf8')).toContain('status: done');
    expect(fs.readFileSync(path.join(project.root, 'b.md'), 'utf8')).toBe('# B\n');
  });
});
