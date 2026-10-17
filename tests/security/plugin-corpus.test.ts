/**
 * @vitest-environment node
 *
 * The negative plugin corpus (#2655): each misbehaving plugin in
 * `tests/helpers/hostile-plugins.ts` is refused, or loads and is contained.
 * `PLUGIN_CORPUS` there is the table; this is the proof. Most cases run
 * through `minerva plugin check` (#2654), which is how an author would meet
 * them; the rest drive the seam directly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The user's own MCP servers file lives in the real home folder: keep it out.
vi.mock('../../src/main/mcp-servers/config-store', () => ({
  getStoredServers: async () => [],
  addStoredServer: vi.fn(),
  removeStoredServer: vi.fn(),
  setStoredServerEnabled: vi.fn(),
  updateStoredServer: vi.fn(),
}));

import { checkPlugin } from '../../src/main/plugin-check/check';
import type { PluginCheckReport } from '../../src/shared/plugins/check';
import { installPluginFromFolder } from '../../src/main/plugins/lifecycle';
import { disablePlugins, enablePlugins, loadedPluginScan, reloadPluginScan } from '../../src/main/plugins/registry';
import { pluginSettingsFile, pluginSettingsForTemplates, readPluginSettings, savePluginSettings } from '../../src/main/plugins/settings';
import { secretStorageStatus } from '../../src/main/secret-storage';
import { loadTypeCatalog } from '../../src/main/types/loader';
import { loadSkillCatalog } from '../../src/main/skills/loader';
import { compileSkill } from '../../src/main/skills/compile';
import { initTablesDb, runNoteQuery, disposeProject as disposeTables } from '../../src/main/sources/tables';
import { projectContext } from '../../src/main/project-context-types';
import { callServerTool, connectServer, listServerStatuses, reconcilePluginServers, setServerEnabled } from '../../src/main/mcp-servers/registry';
import { configureMcpToolPermissionsPath } from '../../src/main/mcp-servers/tool-permissions';
import { shutdownAllMcpClients } from '../../src/main/mcp-client';
import { UNTRUSTED_TAG } from '../../src/shared/untrusted-content';
import {
  PLUGIN_CANARY,
  buildDeepTemplatePlugin,
  buildDuplicateIdPlugins,
  buildEscapingPathPlugin,
  buildHugeSkillPlugin,
  buildInjectingSkillPlugin,
  buildLyingReadOnlyServerPlugin,
  buildMinervaReadingQueryPlugin,
  buildSecretSettingPlugin,
  buildShadowStockTypePlugin,
  buildSymlinkOutPlugin,
} from '../helpers/hostile-plugins';
import { silenceLogTags } from '../helpers/quiet-logs';

silenceLogTags('plugins', 'graph', 'tables', 'config', 'mcp-servers', 'mcp-confirm', 'secrets', 'types');

let tmp: string;
let src: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-corpus-')));
  src = path.join(tmp, 'src');
  fs.mkdirSync(src);
});
afterEach(() => {
  disablePlugins();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const check = (folder: string) => checkPlugin(folder, { appVersion: '4.0.0', scratchParent: tmp });
const failed = (r: PluginCheckReport, stage: string) => r.items.filter((i) => i.stage === stage && i.status === 'fail').map((i) => i.detail ?? '').join('\n');

/** Install `folders` into a fresh plugins folder and turn the registry on. */
async function installed(...folders: string[]): Promise<string> {
  const dir = path.join(tmp, 'plugins');
  for (const f of folders) await installPluginFromFolder(dir, f, '4.0.0');
  enablePlugins({ appVersion: '4.0.0', dir });
  await reloadPluginScan();
  return dir;
}

describe('refused (#2655)', () => {
  it('escaping-path: a path climbing out of the plugin', async () => {
    const r = await check(buildEscapingPathPlugin(src));
    expect(r.ok).toBe(false);
    expect(failed(r, 'package')).toMatch(/may not contain "\.\."/);
  });

  it('symlink-out: a contributed file linking outside the plugin', async () => {
    const r = await check(buildSymlinkOutPlugin(src));
    expect(failed(r, 'package')).toMatch(/leaves the plugin folder/);
    expect(JSON.stringify(r)).not.toContain(PLUGIN_CANARY);
  });

  it('shadow-stock: a type with a stock type\'s id', async () => {
    const r = await check(buildShadowStockTypePlugin(src));
    expect(failed(r, 'contributions')).toMatch(/book/);
    expect(r.ok).toBe(false);
  });

  it('duplicate-ids: the second plugin to claim an id is refused, naming the first', async () => {
    const [first, second] = buildDuplicateIdPlugins(src);
    await installed(first, second);
    const cat = await loadTypeCatalog(path.join(tmp, 'tb'), loadedPluginScan());
    expect(cat.types.filter((t) => t.id === 'specimen').map((t) => t.plugin?.id)).toEqual(['first-claim']);
    expect(cat.errors.filter((e) => e.label.startsWith('second-claim')).map((e) => e.message).join('\n')).toMatch(/first-claim/);
  });

  it('huge-skill: a contributed file over 1 MB', async () => {
    const r = await check(buildHugeSkillPlugin(src));
    expect(failed(r, 'package')).toMatch(/at most 1 MB/);
  });

  it('deep-template: {{#if}} nested thousands deep is a parse error, not a stack overflow', async () => {
    const r = await check(buildDeepTemplatePlugin(src));
    expect(failed(r, 'contributions')).toMatch(/nest more than 32 deep/);
    expect(failed(r, 'contributions')).not.toMatch(/call stack/);
  });
});

describe('contained (#2655)', () => {
  it('injecting-skill: the note\'s text reaches the model only in the user turn, delimited', async () => {
    const r = await check(buildInjectingSkillPlugin(src));
    expect(r.items.filter((i) => i.stage === 'thoughtbases').map((i) => i.status)).toEqual(['pass', 'pass']);

    await installed(path.join(src, 'injecting-skill'));
    const { skills } = await loadSkillCatalog(path.join(tmp, 'no-user-skills'), loadedPluginScan());
    const def = compileSkill(skills.find((s) => s.id === 'injecting-skill.obey')!);
    const ctx = { fullNoteContent: `body ${PLUGIN_CANARY}`, fullNoteTitle: `title ${PLUGIN_CANARY}`, fullNotePath: 'n.md' };
    expect(def.buildSystemPrompt!(ctx)).not.toContain(PLUGIN_CANARY);
    const user = def.buildUserContext!(ctx);
    expect(user.replace(new RegExp(`<${UNTRUSTED_TAG}\\b[^>]*>[\\s\\S]*?</${UNTRUSTED_TAG}>`, 'g'), '')).not.toContain(PLUGIN_CANARY);
    expect(user).toContain(PLUGIN_CANARY);
  });

  it('reads-minerva: SQL reading .minerva/ is refused where it runs unasked, and flagged by plugin check', async () => {
    const r = await check(buildMinervaReadingQueryPlugin(src));
    expect(r.items.filter((i) => i.subject.startsWith('query Peek')).map((i) => i.status)).toEqual(['warn', 'warn']);

    // The template's query block runs on preview, through runNoteQuery: refused.
    const root = path.join(tmp, 'tb');
    fs.mkdirSync(path.join(root, '.minerva'), { recursive: true });
    fs.writeFileSync(path.join(root, '.minerva', 'secrets.json'), JSON.stringify({ key: PLUGIN_CANARY }));
    const ctx = projectContext(root);
    try {
      await initTablesDb(ctx);
      const res = await runNoteQuery(ctx, "SELECT * FROM read_text('.minerva/secrets.json')");
      expect(res.ok).toBe(false);
      expect(JSON.stringify(res)).not.toContain(PLUGIN_CANARY);
    } finally {
      disposeTables(ctx);
    }
  }, 60_000);

  it('lying-server: nothing runs until the user turns it on; then a tool marked read-only runs unasked (the documented residual risk)', async () => {
    configureMcpToolPermissionsPath(path.join(tmp, 'mcp-tool-permissions.json'));
    const dir = await installed(buildLyingReadOnlyServerPlugin(src));
    const wrote = path.join(tmp, 'liar-wrote.txt');
    await savePluginSettings(dir, loadedPluginScan().plugins[0]!.manifest, { liarFile: wrote });
    try {
      await reconcilePluginServers();
      const id = 'plugin:lying-server/liar';
      expect((await listServerStatuses()).find((s) => s.id === id)).toMatchObject({ enabled: false, status: 'disconnected' });
      await expect(connectServer(id)).rejects.toThrow(/on first/);
      expect(fs.existsSync(wrote)).toBe(false);

      // Approved (Settings asks natively first; see register-mcp-servers.test.ts).
      await setServerEnabled(id, true);
      const called = await callServerTool('lying-server.liar', 'peek', {}, null);
      expect(called.kind).toBe('called');
      expect(fs.readFileSync(wrote, 'utf-8')).toBe(PLUGIN_CANARY);
    } finally {
      disablePlugins();
      await reconcilePluginServers();
      await shutdownAllMcpClients();
    }
  }, 60_000);

  it('plaintext-secret: with no key store the secret is kept owner-only, the status says so, and no template can read it', async () => {
    const dir = await installed(buildSecretSettingPlugin(src));
    const manifest = loadedPluginScan().plugins[0]!.manifest;
    const view = await savePluginSettings(dir, manifest, { apiToken: PLUGIN_CANARY });
    expect(secretStorageStatus().encrypted).toBe(false);
    expect(fs.statSync(pluginSettingsFile(dir)).mode & 0o777).toBe(0o600);
    expect(view.secretsSet).toEqual({ apiToken: true });
    expect(JSON.stringify(await readPluginSettings(dir, manifest))).not.toContain(PLUGIN_CANARY);
    expect(JSON.stringify(pluginSettingsForTemplates(dir, manifest))).not.toContain(PLUGIN_CANARY);
  });
});
