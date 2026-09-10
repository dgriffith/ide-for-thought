/**
 * Gate for MCP client integration tests that spawn a REAL third-party
 * server (#2029) — `@modelcontextprotocol/server-everything`, the official
 * reference implementation. Mirrors `python-kernel.test.ts`'s
 * `pythonAvailable()`/`skipIfNoPython` shape: the suite skips itself rather
 * than fails when the fixture can't be resolved (no network / npm registry
 * unreachable), so this stays opt-in for a CI environment without it.
 *
 * Verified (by hand, before writing the transport) to speak the LEGACY era
 * on both `stdio` and `streamableHttp` transports — exactly the real-world
 * shape essentially every published MCP server speaks today.
 */
import { execSync } from 'node:child_process';
import { describe } from 'vitest';

export const MCP_FIXTURE_PACKAGE = '@modelcontextprotocol/server-everything';

/** `--help` isn't a recognized transport name, so the launcher exits 1 after
 *  printing its usage banner — that banner (not the exit code) is the
 *  "npx successfully resolved and ran the package" signal. */
export function mcpFixtureAvailable(): boolean {
  try {
    const out = execSync(`npx -y ${MCP_FIXTURE_PACKAGE} --help`, {
      stdio: 'pipe',
      timeout: 30_000,
      encoding: 'utf-8',
    });
    return out.includes('Everything Server Launcher');
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ''}${e.stderr ?? ''}`.includes('Everything Server Launcher');
  }
}

export const skipIfNoMcpFixture = mcpFixtureAvailable() ? describe : describe.skip;
