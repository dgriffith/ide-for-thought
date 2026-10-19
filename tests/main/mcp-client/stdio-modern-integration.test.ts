/**
 * stdio transport against a REAL modern-era MCP server — the reference
 * implementation from 2.0.0 on, which answers `server/discover`. Until it
 * shipped, the modern path was tested only against mocks. Pinned alongside
 * the legacy fixture (`tests/helpers/mcp-fixture.ts`).
 */
import { it, expect } from 'vitest';
import { StdioTransport } from '../../../src/main/mcp-client/stdio-transport';
import { skipIfNoMcpFixture, MCP_MODERN_FIXTURE_PACKAGE } from '../../helpers/mcp-fixture';

skipIfNoMcpFixture('stdio transport vs. a real modern MCP server', () => {
  it('connects, resolves modern era, lists real tools, and calls one', async () => {
    const transport = new StdioTransport({ kind: 'stdio', command: 'npx', args: ['-y', MCP_MODERN_FIXTURE_PACKAGE, 'stdio'] });
    try {
      await transport.connect();
      expect(transport.era).toBe('modern');

      const tools = await transport.listTools();
      expect(tools.some((t) => t.name === 'echo')).toBe(true);

      const result = await transport.callTool('echo', { message: 'hello, modern era' });
      expect(result.isError).toBe(false);
      expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('hello, modern era') });
    } finally {
      await transport.close();
    }
  }, 30_000);
});
