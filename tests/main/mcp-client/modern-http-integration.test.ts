/**
 * Modern-era (2026-07-28) transport against a hand-built fixture server
 * (#2029) — no real server speaks this era yet, so `mcp-modern-fixture.ts`
 * stands in. Exercises the full stack through the public `connectMcpServer`
 * facade rather than constructing `ModernHttpTransport` directly, so this
 * also proves era detection correctly routes to it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { connectMcpServer } from '../../../src/main/mcp-client/client';
import { McpProtocolError } from '../../../src/main/mcp-client/errors';
import { startModernFixture, type ModernFixtureServer } from '../../helpers/mcp-modern-fixture';

let fixture: ModernFixtureServer | null = null;

afterEach(async () => {
  await fixture?.close();
  fixture = null;
});

describe('modern-era transport vs. a hand-built fixture (#2029)', () => {
  it('era resolves to modern, and tools/list works over both its JSON and SSE response shapes', async () => {
    fixture = await startModernFixture();
    const client = await connectMcpServer({ kind: 'http', url: fixture.url });
    expect(client.era).toBe('modern');

    const firstCall = await client.listTools(); // fixture responds as plain JSON on the 1st call
    const secondCall = await client.listTools(); // and as SSE on the 2nd
    expect(firstCall.map((t) => t.name)).toEqual(secondCall.map((t) => t.name));
    expect(firstCall.some((t) => t.name === 'get-time')).toBe(true);

    await client.close();
  });

  it('drives a real input_required → complete MRTR round-trip through callTool', async () => {
    fixture = await startModernFixture();
    const client = await connectMcpServer({ kind: 'http', url: fixture.url });
    const result = await client.callTool('needs-input', {});
    expect(result).toEqual({ content: [{ type: 'text', text: 'mrtr-done' }], isError: false });
    await client.close();
  });

  it('a HeaderMismatch response surfaces as McpProtocolError with code -32020', async () => {
    fixture = await startModernFixture();
    const client = await connectMcpServer({ kind: 'http', url: fixture.url });
    await expect(client.callTool('trigger-header-mismatch', {})).rejects.toMatchObject({
      constructor: McpProtocolError,
      code: -32020,
    });
    await client.close();
  });
});
