/**
 * stdio transport against a REAL third-party MCP server (#2029) — the
 * official reference implementation, spawned via `npx`. Proves the
 * transport actually works end-to-end, not just against mocks: real era
 * detection, a real tool list, and a real tool call.
 */
import { it, expect } from 'vitest';
import { StdioTransport } from '../../../src/main/mcp-client/stdio-transport';
import { skipIfNoMcpFixture, MCP_FIXTURE_PACKAGE } from '../../helpers/mcp-fixture';

skipIfNoMcpFixture('stdio transport vs. a real legacy MCP server (#2029)', () => {
  it('connects, resolves legacy era, lists real tools, and calls one', async () => {
    const transport = new StdioTransport({ kind: 'stdio', command: 'npx', args: ['-y', MCP_FIXTURE_PACKAGE, 'stdio'] });
    try {
      await transport.connect();
      expect(transport.era).toBe('legacy');

      const tools = await transport.listTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === 'echo')).toBe(true);

      const result = await transport.callTool('echo', { message: 'hello from #2029' });
      expect(result.isError).toBe(false);
      expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('hello from #2029') });
    } finally {
      await transport.close();
    }
  }, 30_000);
});
