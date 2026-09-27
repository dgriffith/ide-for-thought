/**
 * CI hard-assert for the MCP fixture gate (#2365).
 *
 * `skipIfNoMcpFixture` turns the real-server integration suites
 * (`stdio-integration`, `legacy-http-integration`) into `describe.skip` when
 * `npx` can't resolve the fixture — which reads as a pass. A registry hiccup,
 * a runner-image change, or someone renaming the package would silently
 * vanish that coverage with no signal. Same reasoning, and same shape, as the
 * Python module gate in `python-kernel.test.ts` (#2056) and the embedding
 * model gate (#1925): under CI the fixture MUST be available; locally the
 * suites may legitimately skip (offline laptop), so this passes there.
 */
import { describe, expect, it } from 'vitest';
import { MCP_FIXTURE_PACKAGE, mcpFixtureAvailable } from '../../helpers/mcp-fixture';

describe('MCP fixture gate (#2365)', () => {
  it(`${MCP_FIXTURE_PACKAGE} resolves under CI so the integration suites run`, () => {
    if (!process.env.CI) {
      expect.soft(true).toBe(true);
      return;
    }
    expect(
      mcpFixtureAvailable(),
      'the MCP integration suites would skip silently — check npm registry access on the runner',
    ).toBe(true);
  }, 60_000);
});
