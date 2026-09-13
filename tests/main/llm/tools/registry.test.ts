/**
 * `buildConversationTools`'s mcp_call handling (#2028) — `listServerStatuses`
 * is mocked so this covers the presence/absence decision and the appended
 * catalog text without a real MCP transport. The rest of the notebase
 * toolset's construction isn't re-tested here; it's exercised indirectly by
 * every other tool test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServerStatus } from '../../../../src/shared/mcp-servers';

const registryMocks = vi.hoisted(() => ({
  listServerStatuses: vi.fn(),
  callServerTool: vi.fn(),
}));
vi.mock('../../../../src/main/mcp-servers/registry', () => registryMocks);

import { buildConversationTools } from '../../../../src/main/llm/tools/registry';
import { registerTool, unregisterTool } from '../../../../src/shared/tools/registry';
import type { ThinkingToolDef } from '../../../../src/shared/tools/types';

beforeEach(() => {
  vi.clearAllMocks();
  registryMocks.listServerStatuses.mockResolvedValue([]);
});

const connectedWithTools: McpServerStatus = {
  id: 'id-1',
  name: 'github',
  enabled: true,
  descriptor: { kind: 'stdio', command: 'gh-mcp' },
  status: 'connected',
  tools: [
    { name: 'list_issues', description: 'List open issues.', inputSchema: { type: 'object', properties: { repo: {} }, required: ['repo'] } },
  ],
};

describe('buildConversationTools — mcp_call', () => {
  it('omits mcp_call when no MCP server is connected', async () => {
    registryMocks.listServerStatuses.mockResolvedValue([]);
    const tools = await buildConversationTools({});
    expect(tools.find((t) => t.name === 'mcp_call')).toBeUndefined();
  });

  it('omits mcp_call when a connected server has cached no tools', async () => {
    registryMocks.listServerStatuses.mockResolvedValue([{ ...connectedWithTools, tools: [] }]);
    const tools = await buildConversationTools({});
    expect(tools.find((t) => t.name === 'mcp_call')).toBeUndefined();
  });

  it('includes mcp_call with the live catalog appended once a server is connected with tools', async () => {
    registryMocks.listServerStatuses.mockResolvedValue([connectedWithTools]);
    const tools = await buildConversationTools({});
    const mcp = tools.find((t) => t.name === 'mcp_call');
    expect(mcp).toBeDefined();
    expect(mcp!.description).toContain('github/list_issues');
  });

  it('does not mutate the shared base definition across calls', async () => {
    registryMocks.listServerStatuses.mockResolvedValueOnce([connectedWithTools]).mockResolvedValueOnce([]);
    const withCatalog = await buildConversationTools({});
    const withoutServers = await buildConversationTools({});
    expect(withCatalog.find((t) => t.name === 'mcp_call')?.description).toContain('github/list_issues');
    expect(withoutServers.find((t) => t.name === 'mcp_call')).toBeUndefined();
  });
});

describe('buildConversationTools — run_skill (#2165)', () => {
  const runnableSkill: ThinkingToolDef = {
    id: 'test.registry-fixture-skill',
    name: 'Registry Fixture Skill',
    category: 'analysis',
    description: 'A fixture skill for buildConversationTools tests.',
    longDescription: 'Fixture.',
    context: ['fullNote'],
    outputMode: 'newNote',
    buildPrompt: (ctx) => ctx.fullNoteContent ?? '',
  };

  afterEach(() => {
    unregisterTool(runnableSkill.id);
  });

  it('is always present — the catalog is never empty while stock skills are registered', async () => {
    // In the real app, stock skills (skills/register.ts) are registered at
    // startup, so run_skill's catalog is never empty in practice. This test
    // registers one fixture directly to exercise that path without depending
    // on the stock skill catalog.
    registerTool(runnableSkill);
    const tools = await buildConversationTools({});
    const tool = tools.find((t) => t.name === 'run_skill');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('test.registry-fixture-skill');
  });

  it('omits run_skill when no skill is registered', async () => {
    const tools = await buildConversationTools({});
    expect(tools.find((t) => t.name === 'run_skill')).toBeUndefined();
  });

  it('does not mutate the shared base definition across calls', async () => {
    registerTool(runnableSkill);
    const withCatalog = await buildConversationTools({});
    unregisterTool(runnableSkill.id);
    const withoutSkills = await buildConversationTools({});
    expect(withCatalog.find((t) => t.name === 'run_skill')?.description).toContain('test.registry-fixture-skill');
    expect(withoutSkills.find((t) => t.name === 'run_skill')).toBeUndefined();
  });
});
