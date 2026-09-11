/**
 * `mcp_call` (#2028) — the dispatcher tool. `callServerTool` is mocked so
 * this exercises input validation, content-flattening, and error mapping
 * without a real MCP transport.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServerStatus } from '../../../../src/shared/mcp-servers';

const registryMocks = vi.hoisted(() => ({ callServerTool: vi.fn() }));
vi.mock('../../../../src/main/mcp-servers/registry', () => registryMocks);

import { mcpCall, describeMcpCatalog } from '../../../../src/main/llm/tools/mcp-call';

const ctx = { rootPath: '/tmp/does-not-matter' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mcp_call run()', () => {
  it('requires a non-empty server name', async () => {
    const res = await mcpCall.run(ctx, { tool: 't' }, {});
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/`server`/);
  });

  it('requires a non-empty tool name', async () => {
    const res = await mcpCall.run(ctx, { server: 's' }, {});
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/`tool`/);
  });

  it('flattens text content blocks and forwards args, defaulting to {}', async () => {
    registryMocks.callServerTool.mockResolvedValue({
      content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }],
      isError: false,
    });
    const res = await mcpCall.run(ctx, { server: 's', tool: 't' }, {});
    expect(registryMocks.callServerTool).toHaveBeenCalledWith('s', 't', {});
    expect(res).toEqual({ content: 'first\nsecond', isError: false });
  });

  it('passes args through and preserves the isError flag from the tool result', async () => {
    registryMocks.callServerTool.mockResolvedValue({
      content: [{ type: 'text', text: 'failed upstream' }],
      isError: true,
    });
    const res = await mcpCall.run(ctx, { server: 's', tool: 't', args: { x: 1 } }, {});
    expect(registryMocks.callServerTool).toHaveBeenCalledWith('s', 't', { x: 1 });
    expect(res).toEqual({ content: 'failed upstream', isError: true });
  });

  it('renders a placeholder for non-text content blocks', async () => {
    registryMocks.callServerTool.mockResolvedValue({
      content: [{ type: 'image', data: 'base64...' }],
      isError: false,
    });
    const res = await mcpCall.run(ctx, { server: 's', tool: 't' }, {});
    expect(res.content).toBe('[non-text content: image]');
  });

  it('catches a protocol-level throw (e.g. unknown server/tool) as an error result', async () => {
    registryMocks.callServerTool.mockRejectedValue(new Error('no such MCP server: s'));
    const res = await mcpCall.run(ctx, { server: 's', tool: 't' }, {});
    expect(res).toEqual({ content: 'mcp_call failed: no such MCP server: s', isError: true });
  });
});

describe('describeMcpCatalog', () => {
  const connected: McpServerStatus = {
    id: 'id-1',
    name: 'github',
    enabled: true,
    descriptor: { kind: 'stdio', command: 'gh-mcp' },
    status: 'connected',
    tools: [
      {
        name: 'create_issue',
        description: 'File a new issue.',
        inputSchema: { type: 'object', properties: { repo: {}, title: {}, body: {} }, required: ['repo', 'title'] },
        annotations: { readOnlyHint: false },
      },
      {
        name: 'list_issues',
        description: 'List open issues.',
        inputSchema: { type: 'object', properties: { repo: {} }, required: ['repo'] },
        annotations: { readOnlyHint: true },
      },
    ],
  };

  it('returns empty string when no server is connected with tools', () => {
    expect(describeMcpCatalog([])).toBe('');
    expect(describeMcpCatalog([{ ...connected, status: 'disconnected' }])).toBe('');
    expect(describeMcpCatalog([{ ...connected, tools: [] }])).toBe('');
  });

  it('renders required/optional params and a read-only-vs-write hint per tool', () => {
    const text = describeMcpCatalog([connected]);
    expect(text).toContain('github/create_issue: File a new issue. (params: repo, title, body?) [may modify external state]');
    expect(text).toContain('github/list_issues: List open issues. (params: repo) [read-only]');
  });
});
