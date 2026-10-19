/**
 * Gate for MCP client integration tests that spawn a REAL third-party
 * server (#2029) — `@modelcontextprotocol/server-everything`, the official
 * reference implementation. Mirrors `python-kernel.test.ts`'s
 * `pythonAvailable()`/`skipIfNoPython` shape: the suite skips itself rather
 * than fails when the fixture can't be resolved (no network / npm registry
 * unreachable) — locally. Under CI a skip would read as a pass, so
 * `tests/main/mcp-client/mcp-fixture-gate.test.ts` hard-asserts the fixture
 * is available there (#2365).
 *
 * **Pinned, because the era is a property of the version.** Up to 1.0.0 it
 * speaks the LEGACY era on both `stdio` and `streamableHttp`, the shape most
 * published MCP servers speak. 2.0.0 (2026-10-19) answers `server/discover`
 * over stdio, i.e. MODERN. The name used to be unversioned, so `npx` took
 * whatever was latest and the legacy suites failed on every run the morning
 * 2.0.0 shipped, with nothing in this repo changed. Bump either pin
 * deliberately, after checking which era the new version speaks.
 */
import { execSync } from 'node:child_process';
import { describe } from 'vitest';

/** The legacy-era fixture. */
export const MCP_FIXTURE_PACKAGE = '@modelcontextprotocol/server-everything@1.0.0';

/** The modern-era fixture: the first real server we can test that path against. */
export const MCP_MODERN_FIXTURE_PACKAGE = '@modelcontextprotocol/server-everything@2.0.0';

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
