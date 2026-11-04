/**
 * Legacy Streamable HTTP transport against a REAL third-party MCP server
 * (#2029) — the official reference implementation's `streamableHttp` mode,
 * spawned on an ephemeral-ish port via `PORT` (confirmed to be honored by
 * hand-probing the server before writing this transport).
 */
import { it, expect, afterEach } from 'vitest';
import { spawnSync, type ChildProcess } from 'node:child_process';
import spawn from 'cross-spawn';
import { LegacyHttpTransport } from '../../../src/main/mcp-client/http/legacy-http-transport';
import { skipIfNoMcpFixture, MCP_FIXTURE_PACKAGE } from '../../helpers/mcp-fixture';

const PORT = 41823; // arbitrary, unlikely to collide with a dev server
const URL_ = `http://127.0.0.1:${PORT}/mcp`;

let serverProcess: ChildProcess | null = null;

async function waitForServerReady(proc: ChildProcess, timeoutMs = 45_000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server-everything did not report ready in time')), timeoutMs);
    // The ready message goes to stderr, not stdout — verified by hand.
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes('listening on port')) {
        clearTimeout(timer);
        proc.stdout?.off('data', onData);
        proc.stderr?.off('data', onData);
        resolve();
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

afterEach(async () => {
  if (serverProcess) {
    // On Windows `npx` runs under cmd.exe, and signalling that leaves the
    // server holding the port — take the whole tree down instead.
    if (process.platform === 'win32' && serverProcess.pid) {
      spawnSync('taskkill', ['/pid', String(serverProcess.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      serverProcess.kill('SIGTERM');
    }
    serverProcess = null;
  }
});

skipIfNoMcpFixture('legacy Streamable HTTP transport vs. a real legacy MCP server (#2029)', () => {
  it('connects, resolves legacy era, session round-trips, lists/calls real tools', async () => {
    // cross-spawn, as the app's own stdio transport (#2980): `npx` is a `.cmd`
    // shim on Windows, which plain spawn can't run (ENOENT).
    serverProcess = spawn('npx', ['-y', MCP_FIXTURE_PACKAGE, 'streamableHttp'], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServerReady(serverProcess);

    const transport = new LegacyHttpTransport({ kind: 'http', url: URL_ });
    try {
      await transport.connect();
      expect(transport.era).toBe('legacy');

      const tools = await transport.listTools();
      expect(tools.some((t) => t.name === 'echo')).toBe(true);

      const result = await transport.callTool('echo', { message: 'hello over http' });
      expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('hello over http') });
    } finally {
      await transport.close();
    }
    // As long as the stdio integration tests allow a cold `npx` start.
  }, 60_000);
});
