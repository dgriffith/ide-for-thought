/**
 * stdio transport against a REAL modern-era MCP server — the reference
 * implementation from 2.0.0 on, which answers `server/discover`. Until it
 * shipped, the modern path was tested only against mocks. Pinned alongside
 * the legacy fixture (`tests/helpers/mcp-fixture.ts`).
 *
 * The era probe gets a long timeout here. Its real 5s budget is a production
 * trade-off: a server that hasn't answered by then gets the legacy handshake,
 * which 2.0.0 also accepts. A cold `npx` fetch under the coverage job's load
 * took longer than 5s, so the probe fell back and this test read `legacy`. What's
 * under test is the modern path, not how fast the runner is.
 */
import { it, expect, beforeEach, afterEach } from 'vitest';
import { StdioTransport } from '../../../src/main/mcp-client/stdio-transport';
import { _setEraProbeTimeoutMsForTests } from '../../../src/main/mcp-client/era';
import { skipIfNoMcpFixture, MCP_MODERN_FIXTURE_PACKAGE } from '../../helpers/mcp-fixture';

skipIfNoMcpFixture('stdio transport vs. a real modern MCP server', () => {
  beforeEach(() => { _setEraProbeTimeoutMsForTests(45_000); });
  afterEach(() => { _setEraProbeTimeoutMsForTests(null); });

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
  }, 60_000);
});
