/**
 * @vitest-environment node
 *
 * A plugin ships an MCP server (#2646): declared in plugin.json, its program
 * inside the plugin folder, run only once the user turns it on (the IPC
 * handler asks natively — see register-mcp-servers.test.ts), with the
 * plugin's settings in its environment. A new plugin version is a new server
 * — off until approved again, and its tools' "don't ask again" grants don't
 * carry over — while a changed setting only restarts it. Turning the plugin
 * off or removing it stops the server.
 *
 * End to end against the Word Tools example: a real `node` process.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePluginMcpServers } from '../../../src/main/plugins/mcp-schema';
import { readPluginPackage } from '../../../src/main/plugins/package';
import { _disablePluginsForTests, enablePlugins, reloadPluginScan } from '../../../src/main/plugins/registry';
import { removePlugin, setPluginEnabled } from '../../../src/main/plugins/lifecycle';
import { savePluginSettings } from '../../../src/main/plugins/settings';
import { loadPluginRecords } from '../../../src/main/plugins/state';
import { writePlugin } from '../../helpers/plugins';
import { silenceLogTags } from '../../helpers/quiet-logs';

// The user's own servers file lives in the real home folder: keep it out.
vi.mock('../../../src/main/mcp-servers/config-store', () => ({
  getStoredServers: async () => [],
  addStoredServer: vi.fn(),
  removeStoredServer: vi.fn(),
  setStoredServerEnabled: vi.fn(),
  updateStoredServer: vi.fn(),
}));

import {
  callServerTool,
  connectServer,
  listServerStatuses,
  reconcilePluginServers,
  removeServer,
  setServerEnabled,
  updateServer,
} from '../../../src/main/mcp-servers/registry';
import { _setLocalMcpServersOnForTests } from '../../../src/main/mcp-servers/registry';

// These run stdio servers, which need Local MCP servers on (#2891).
_setLocalMcpServersOnForTests(true);
import { allowTool, configureMcpToolPermissionsPath, isToolAllowed } from '../../../src/main/mcp-servers/tool-permissions';
import { getPluginScan } from '../../../src/main/plugins/registry';
import { loadSkillCatalog } from '../../../src/main/skills/loader';
import { compileSkill } from '../../../src/main/skills/compile';
import { buildConversationTools, executeNotebaseTool } from '../../../src/main/llm/tools/registry';
import { shutdownAllMcpClients } from '../../../src/main/mcp-client';

silenceLogTags('plugins', 'secrets', 'mcp-confirm', 'mcp-servers');

const FIXTURE = path.resolve(__dirname, '..', '..', 'fixtures', 'plugins', 'word-tools');
const ID = 'plugin:word-tools/words';

describe('validatePluginMcpServers (#2646)', () => {
  const settings = [{ key: 'apiToken', title: 'API token', kind: 'secret' as const }];

  it('reads a server, titled by its key when untitled', () => {
    const problems: string[] = [];
    expect(validatePluginMcpServers({ words: { command: 'bin/server', env: { TOKEN: 'x-${settings.apiToken}' } } }, settings, problems))
      .toEqual([{ key: 'words', title: 'words', command: 'bin/server', args: [], env: { TOKEN: 'x-${settings.apiToken}' } }]);
    expect(problems).toEqual([]);
  });

  it.each([
    ['an absolute command', { s: { command: '/bin/sh' } }, /"command" must be a file in the plugin folder/],
    ['a command up and out', { s: { command: '../../bin/sh' } }, /"command" must be a file in the plugin folder/],
    ['an interpreter with an inline script', { s: { command: 'node', args: ['-e', 'require("child_process")'] } }, /the first argument must be the script/],
    ['an interpreter with no script', { s: { command: 'python3' } }, /the first argument must be the script/],
    ['an undeclared setting', { s: { command: 'bin/x', env: { T: '${settings.nope}' } } }, /names the setting "nope", which the plugin doesn't declare/],
    ['a bad env name', { s: { command: 'bin/x', env: { 'A-B': 'x' } } }, /"A-B" isn't an environment variable name/],
    ['a cwd of its own', { s: { command: 'bin/x', cwd: '/' } }, /unknown field "cwd"/],
    ['not an object', [], /"mcpServers" must be an object/],
  ])('refuses %s', (_what, raw, msg) => {
    const problems: string[] = [];
    validatePluginMcpServers(raw, settings, problems);
    expect(problems.join('\n')).toMatch(msg);
  });
});

describe('a plugin server\'s program must be inside the plugin (#2646)', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-mcp-pkg-'))); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const server = (spec: unknown) => ({ mcpServers: { s: spec } });

  it('accepts the example', async () => {
    expect((await readPluginPackage(FIXTURE, '4.0.0')).ok).toBe(true);
  });

  it.each([
    ['a missing script', { command: 'node', args: ['server/gone.js'] }, /"server\/gone\.js" doesn't exist/],
    ['a program it doesn\'t carry', { command: 'bash' }, /"bash" doesn't exist/],
    ['a folder', { command: 'server' }, /"server" isn't a file/],
    ['a link out of the plugin', { command: 'node', args: ['server/out.js'] }, /leaves the plugin folder/],
  ])('refuses %s', async (_what, spec, msg) => {
    const root = writePlugin(tmp, 'p', {}, { 'server/real.js': '' }, server(spec));
    fs.symlinkSync('/etc/hosts', path.join(root, 'server', 'out.js'));
    const r = await readPluginPackage(root, '4.0.0');
    expect(r.ok ? '' : r.error.problems.join('\n')).toMatch(msg);
  });

  it('a plugin that only ships a server needs no files', async () => {
    const root = writePlugin(tmp, 'q', {}, { 'server/real.js': '' }, server({ command: 'node', args: ['server/real.js'] }));
    expect((await readPluginPackage(root, '4.0.0')).ok).toBe(true);
  });
});

describe('the Word Tools plugin\'s server, end to end (#2646)', () => {
  let tmp: string;
  let dir: string;

  beforeEach(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-mcp-')));
    dir = path.join(tmp, 'plugins');
    fs.cpSync(FIXTURE, path.join(dir, 'word-tools'), { recursive: true });
    configureMcpToolPermissionsPath(path.join(tmp, 'mcp-tool-permissions.json'));
    enablePlugins({ appVersion: '4.0.0', dir });
    await reloadPluginScan();
  });
  afterEach(async () => {
    await reconcilePluginServers(); // stops what's left, after the plugins are gone below
    _disablePluginsForTests();
    await reconcilePluginServers();
    await shutdownAllMcpClients();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const status = async () => (await listServerStatuses()).find((s) => s.id === ID);

  it('is listed, off, with its plugin — and installing ran nothing', async () => {
    expect(await status()).toMatchObject({
      name: 'word-tools.words', enabled: false, status: 'disconnected', tools: [],
      plugin: { id: 'word-tools', name: 'Word Tools', version: '1.0.0', title: 'Word counting' },
      descriptor: { kind: 'stdio', command: 'node', args: [path.join(dir, 'word-tools', 'server', 'index.js')], cwd: path.join(dir, 'word-tools') },
    });
  });

  it('can\'t be connected, edited or removed around its approval', async () => {
    await expect(connectServer(ID)).rejects.toThrow(/Turn "word-tools.words" on first/);
    await expect(updateServer(ID, { name: 'x' })).rejects.toThrow(/comes with a plugin/);
    await expect(removeServer(ID)).rejects.toThrow(/comes with a plugin/);
    expect((await status())!.status).toBe('disconnected');
  });

  it('turned on, it runs: its tools are advertised and callable through the gate', async () => {
    await setServerEnabled(ID, true);
    const s = (await status())!;
    expect(s).toMatchObject({ enabled: true, status: 'connected' });
    expect(s.tools.map((t) => t.name)).toEqual(['count_words', 'greet']);
    // Read-only: runs with no UI.
    const counted = await callServerTool('word-tools.words', 'count_words', { text: 'one two three' }, null);
    expect(counted).toMatchObject({ kind: 'called', result: { content: [{ type: 'text', text: '3' }] } });
    // Not read-only: refused where there's no UI to confirm.
    expect(await callServerTool('word-tools.words', 'greet', { name: 'Ada' }, null)).toEqual({ kind: 'declined', reason: 'no-ui' });
    // The approval is recorded per machine, beside the plugin's other state.
    expect((await loadPluginRecords(dir))['word-tools']!.mcpApproved).toEqual({ words: s.plugin!.identity });
  });

  it('gets its settings in its environment; a changed setting restarts it without asking again', async () => {
    await setServerEnabled(ID, true);
    const confirm = async () => ({ allow: true as const, remember: false });
    const greet = async () => {
      const r = await callServerTool('word-tools.words', 'greet', { name: 'Ada' }, confirm);
      return r.kind === 'called' ? (r.result.content[0] as { text: string }).text : r.reason;
    };
    expect(await greet()).toBe('Hello, Ada. (API token: not set)');
    const manifest = (await import('../../../src/main/plugins/registry')).loadedPluginScan().plugins[0]!.manifest;
    await savePluginSettings(dir, manifest, { apiToken: 'tok-123', greeting: 'Bonjour' });
    await reconcilePluginServers();
    expect((await status())!.enabled).toBe(true);
    expect(await greet()).toBe('Bonjour, Ada. (API token: set)');
  });

  it('a new plugin version is a new server: off until approved again, and its grants don\'t carry over', async () => {
    await setServerEnabled(ID, true);
    const before = (await status())!.plugin!.identity;
    allowTool(before, 'word-tools.words', 'greet');
    const manifestPath = path.join(dir, 'word-tools', 'plugin.json');
    fs.writeFileSync(manifestPath, fs.readFileSync(manifestPath, 'utf-8').replace('"version": "1.0.0"', '"version": "1.1.0"'));
    await reloadPluginScan();
    await reconcilePluginServers();
    const after = (await status())!;
    expect(after).toMatchObject({ enabled: false, status: 'disconnected' });
    expect(after.plugin!.identity).not.toBe(before);
    expect(isToolAllowed(after.plugin!.identity, 'greet')).toBe(false);
  });

  it('turning the plugin off stops its server; on again, the approval still stands', async () => {
    await setServerEnabled(ID, true);
    await setPluginEnabled(dir, 'word-tools', false);
    await reloadPluginScan();
    await reconcilePluginServers();
    expect(await status()).toBeUndefined();
    await setPluginEnabled(dir, 'word-tools', true);
    await reloadPluginScan();
    await reconcilePluginServers();
    expect(await status()).toMatchObject({ enabled: true, status: 'connected' });
  });

  it('removing the plugin stops its server and forgets the approval', async () => {
    await setServerEnabled(ID, true);
    await removePlugin(dir, 'word-tools');
    await reloadPluginScan();
    await reconcilePluginServers();
    expect(await status()).toBeUndefined();
    expect((await loadPluginRecords(dir))['word-tools']).toBeUndefined();
  });

  it('turned off, it stops and the approval is withdrawn', async () => {
    await setServerEnabled(ID, true);
    await setServerEnabled(ID, false);
    expect(await status()).toMatchObject({ enabled: false, status: 'disconnected' });
    expect((await loadPluginRecords(dir))['word-tools']?.mcpApproved).toBeUndefined();
  });

  describe('a plugin skill calls its own server\'s tools (#2649)', () => {
    const scopeOfSkill = async () => {
      const cat = await loadSkillCatalog(path.join(tmp, 'no-user-skills'), await getPluginScan());
      expect(cat.errors).toEqual([]);
      return compileSkill(cat.skills.find((s) => s.id === 'word-tools.word-count')!).mcpScope;
    };

    it('its tools: [mcp:words/count_words] scopes its conversation to that one tool', async () => {
      expect(await scopeOfSkill()).toEqual({ 'word-tools.words': ['count_words'] });
    });

    it('the conversation\'s catalog lists only that tool; a normal conversation\'s lists them all', async () => {
      await setServerEnabled(ID, true);
      const mcpCallDescription = async (mcpScope?: Record<string, string[] | null>) =>
        (await buildConversationTools({ mcpScope })).find((t) => t.name === 'mcp_call')?.description ?? '';
      const scoped = await mcpCallDescription(await scopeOfSkill());
      expect(scoped).toContain('word-tools.words/count_words');
      expect(scoped).not.toContain('word-tools.words/greet');
      const everything = await mcpCallDescription();
      expect(everything).toContain('word-tools.words/greet');
      // Scoped to a server that isn't running: no mcp_call at all.
      expect((await buildConversationTools({ mcpScope: { 'other.server': null } })).some((t) => t.name === 'mcp_call')).toBe(false);
    });

    it('a call outside the scope is refused before it reaches the server; inside, the gates still hold', async () => {
      await setServerEnabled(ID, true);
      const ctx = { rootPath: tmp, mcpScope: (await scopeOfSkill())! };
      const confirmMcpCall = vi.fn(async () => ({ allow: true as const, remember: false }));
      const outside = await executeNotebaseTool(ctx, 'mcp_call', { server: 'word-tools.words', tool: 'greet', args: { name: 'Ada' } }, { confirmMcpCall });
      expect(outside).toMatchObject({ isError: true });
      expect(outside.content).toMatch(/refused word-tools\.words\/greet: .* only word-tools\.words\/count_words\. Nothing was sent/);
      expect(confirmMcpCall).not.toHaveBeenCalled();
      const inside = await executeNotebaseTool(ctx, 'mcp_call', { server: 'word-tools.words', tool: 'count_words', args: { text: 'a b c d' } });
      expect(inside).toMatchObject({ content: '4', isError: false });
    });
  });
});
