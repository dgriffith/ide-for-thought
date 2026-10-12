/**
 * Gathering what's installed in each extension point (#2618): every source
 * read, attributed to the right supplier, one unreadable source costing only
 * its own entries, and nothing from an MCP server's connection details.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { silenceLogTags } from '../helpers/quiet-logs';

const h = vi.hoisted(() => ({ serversThrow: false }));

vi.mock('../../src/main/graph/index', () => ({ setExtensionContributions: vi.fn() }));
vi.mock('../../src/main/skills/loader', () => ({
  getSkillCatalog: async () => ({ skills: [
    { id: 'antithesize', name: 'Antithesize', source: 'stock' },
    { id: 'mine', name: 'Mine', source: 'user' },
  ] }),
}));
vi.mock('../../src/main/types/loader', () => ({
  loadTypeCatalog: async () => ({ types: [
    { id: 'place', label: 'Place', source: 'stock' },
    { id: 'recipe', label: 'Recipe', source: 'user' },
  ] }),
}));
vi.mock('../../src/main/saved-queries', () => ({
  listSavedQueries: () => [
    { id: 'q1', name: 'Open questions', scope: 'project', filePath: '/tb/.minerva/queries/open.rq' },
    { id: 'q2', name: 'Everywhere', scope: 'global', filePath: '/elsewhere/q.rq' },
  ],
}));
vi.mock('../../src/main/notebase/templates', () => ({ listTemplates: async () => [{ name: 'Daily', filename: 'Daily.md' }] }));
vi.mock('../../src/main/publish/csl/user-assets', () => ({
  getMergedStyles: async () => ({ labels: { apa: 'APA', mine: 'Mine' }, userIds: new Set(['mine']) }),
}));
vi.mock('../../src/main/mcp-servers/config-store', () => ({
  getStoredServers: async () => {
    if (h.serversThrow) throw new Error('corrupt mcp-servers.json');
    return [{ id: 's1', name: 'Files', enabled: true, descriptor: { transport: 'stdio', command: '/usr/bin/secret-cmd', args: ['--token', 'hunter2'] } }];
  },
}));

import { gatherContributions } from '../../src/main/extension-contributions';

describe('gatherContributions (#2618)', () => {
  silenceLogTags('project-context');
  beforeEach(() => { h.serversThrow = false; });

  it('reads every source and attributes each contribution', async () => {
    const found = await gatherContributions('/tb');
    const key = (point: string, id: string) => found.find((c) => c.point === point && c.id === id);
    expect(key('skills', 'antithesize')?.source).toBe('stock');
    expect(key('skills', 'mine')?.source).toBe('user');
    expect(key('object-types', 'recipe')?.source).toBe('thoughtbase');
    expect(key('saved-queries', 'q1')).toMatchObject({ source: 'thoughtbase', location: '.minerva/queries/open.rq' });
    expect(key('saved-queries', 'q2')?.source).toBe('user');
    expect(found.some((c) => c.point === 'saved-queries' && c.source === 'stock')).toBe(true);
    expect(key('note-templates', 'Daily.md')?.source).toBe('thoughtbase');
    expect(key('csl-styles', 'mine')?.source).toBe('thoughtbase');
    expect(key('csl-styles', 'apa')?.source).toBe('stock');
    expect(key('mcp-servers', 's1')).toMatchObject({ label: 'Files', source: 'user' });
  });

  it('never carries an MCP server\'s command, args or env', async () => {
    const text = JSON.stringify(await gatherContributions('/tb'));
    expect(text).not.toContain('secret-cmd');
    expect(text).not.toContain('hunter2');
  });

  it('omits only the source that failed', async () => {
    h.serversThrow = true;
    const found = await gatherContributions('/tb');
    expect(found.some((c) => c.point === 'mcp-servers')).toBe(false);
    expect(found.some((c) => c.point === 'skills')).toBe(true);
  });
});
