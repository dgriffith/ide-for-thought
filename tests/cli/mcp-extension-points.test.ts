/**
 * The extension-point tools say the same thing in the app and over
 * `minerva mcp` (#2619): same descriptions, same input schemas, same answer.
 */
import { describe, it, expect } from 'vitest';
import { MCP_TOOLS } from '../../src/cli/mcp';
import { listExtensionPoints, describeExtensionPoint } from '../../src/main/llm/tools/extension-points';
import type { Engine } from '../../src/cli/engine';
import type { ToolContext } from '../../src/main/llm/tools/types';

const mcp = (name: string) => MCP_TOOLS.find((t) => t.name === name)!;
const noEngine = {} as Engine;
const noCtx = {} as ToolContext;

describe('extension-point tools: app and MCP agree (#2619)', () => {
  for (const tool of [listExtensionPoints, describeExtensionPoint]) {
    it(`${tool.definition.name}: same description and schema`, () => {
      const remote = mcp(tool.definition.name);
      expect(remote.description).toBe(tool.definition.description);
      expect(remote.inputSchema).toEqual(tool.definition.input_schema);
    });
  }

  const cases: Array<[string, Record<string, unknown>]> = [
    ['list_extension_points', {}],
    ['list_extension_points', { rung: 'skill' }],
    ['list_extension_points', { open_only: true }],
    ['describe_extension_point', { id: 'object-types' }],
  ];
  for (const [name, args] of cases) {
    it(`${name}(${JSON.stringify(args)}): same answer`, async () => {
      const local = name === 'list_extension_points' ? listExtensionPoints : describeExtensionPoint;
      const inApp = await local.run(noCtx, args);
      const remote = await mcp(name).run(noEngine, args, { proposedBy: 'mcp:test' });
      expect(inApp.isError).toBe(false);
      expect(remote.ok).toBe(true);
      expect(JSON.parse(inApp.content)).toEqual(remote.ok && remote.data);
    });
  }

  it('an unknown id is an error on both', async () => {
    const inApp = await describeExtensionPoint.run(noCtx, { id: 'nope' });
    const remote = await mcp('describe_extension_point').run(noEngine, { id: 'nope' }, { proposedBy: 'mcp:test' });
    expect(inApp.isError).toBe(true);
    expect(remote.ok).toBe(false);
    expect(!remote.ok && remote.error).toBe(inApp.content);
  });
});
