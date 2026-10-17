/**
 * @vitest-environment node
 *
 * A plugin skill naming its own plugin's MCP tools (#2649): `tools:` takes
 * `mcp:<server>` or `mcp:<server>/<tool>`, only in a plugin's skill and only
 * for a server that plugin ships; compiled, it's the scope main stores on the
 * conversation the skill opens — read from the skill in main, never from
 * what the renderer sends.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { parseSkill } from '../../../src/main/skills/parse';
import { compileSkill } from '../../../src/main/skills/compile';
import { create, load } from '../../../src/main/llm/conversation';
import { registerTool, unregisterTool } from '../../../src/shared/tools/registry';
import { useGraphProject } from '../../helpers/temp-project';

const skill = (tools: string) => `---
id: lab.count
name: Count
description: d
menu: Analysis
outputMode: openConversation
tools: ${tools}
---
Count.
`;
const SERVERS = new Set(['words', 'other']);
const parse = (tools: string, servers?: ReadonlySet<string>) =>
  parseSkill(skill(tools), servers ? 'plugin' : 'user', 'count.md', servers ? { readable: new Set(), secret: new Set() } : undefined, servers);

describe('mcp: entries in a skill\'s tools (#2649)', () => {
  it('a plugin skill may name its own servers, whole or one tool', () => {
    expect(parse('[mcp:words/count_words, mcp:other, ask_user]', SERVERS).errors).toEqual([]);
  });

  it.each([
    ['in a non-plugin skill', '[mcp:words]', undefined, /only a plugin's skills can name MCP tools/],
    ['a server the plugin doesn\'t ship', '[mcp:elsewhere/x]', SERVERS, /the plugin ships no MCP server "elsewhere"/],
    ['a malformed entry', '["mcp:words/a/b"]', SERVERS, /must be mcp:<server> or mcp:<server>\/<tool>/],
    ['another plugin\'s server, by its full name', '["mcp:word-tools.words"]', SERVERS, /must be mcp:<server>|ships no MCP server/],
  ])('refuses %s', (_what, tools, servers, msg) => {
    expect(parse(tools, servers).errors.join('\n')).toMatch(msg);
  });

  it('compiles to the scope: the plugin\'s server names, a whole server winning over its tools', () => {
    const r = parse('[mcp:words/count_words, mcp:words/greet, mcp:other, mcp:other/x, ask_user]', SERVERS);
    const def = compileSkill({ ...r.skill!, plugin: { id: 'lab', name: 'Lab', version: '1.0.0' } });
    expect(def.mcpScope).toEqual({ 'lab.words': ['count_words', 'greet'], 'lab.other': null });
    expect(def.requiresTools).toEqual(['ask_user']);
  });

  it('a skill naming no MCP tools has no scope', () => {
    const r = parse('[ask_user]', SERVERS);
    expect(compileSkill({ ...r.skill!, plugin: { id: 'lab', name: 'Lab', version: '1.0.0' } }).mcpScope).toBeUndefined();
  });
});

describe('the conversation a plugin skill opens carries its scope (#2649)', () => {
  const project = useGraphProject('minerva-conv-mcp-scope-');
  afterEach(() => { unregisterTool('lab.count'); });

  it('is read from the registered skill in main, and survives a reload', async () => {
    const r = parse('[mcp:words/count_words]', SERVERS);
    registerTool(compileSkill({ ...r.skill!, plugin: { id: 'lab', name: 'Lab', version: '1.0.0' } }));
    const conv = await create(project.root, { notePath: 'x.md' }, undefined, { skill: { id: 'lab.count', name: 'Count' } });
    expect(conv.mcpScope).toEqual({ 'lab.words': ['count_words'] });
    expect((await load(project.root, conv.id))?.mcpScope).toEqual({ 'lab.words': ['count_words'] });
  });

  it('a conversation from any other skill, or none, has no scope', async () => {
    expect((await create(project.root, { notePath: 'x.md' })).mcpScope).toBeUndefined();
    expect((await create(project.root, { notePath: 'x.md' }, undefined, { skill: { id: 'not-registered', name: 'X' } })).mcpScope).toBeUndefined();
  });
});
