/**
 * `minerva plugin check <folder>` (#2654): put a plugin through what Minerva
 * would do with it, and say how each part did. Built for an author (or the
 * coding agent writing the plugin) before anyone installs it, and run in
 * Minerva's own CI over the worked examples.
 *
 * Everything happens in a scratch folder: the plugin is installed into a
 * scratch plugins folder (the real install, so a link or a refused file
 * fails here as it would in Settings → Plugins), and every thoughtbase is a
 * copy. Nothing in `~/.minerva/` is written, and a thoughtbase the user names
 * is only read.
 *
 * The stages are those in `shared/plugins/check.ts`:
 * - **package**: `readPluginPackage` (manifest, paths, containment), then
 *   `installPluginFromFolder`;
 * - **contributions**: each file is in its registry with this plugin's
 *   provenance, or the registry's reason it isn't;
 * - **thoughtbases**: against each fixture (`fixtures.ts`), plus any named:
 *   every skill renders for every note, with the note's text only ever in
 *   the user turn; every type indexes and types the notes that use it; every
 *   saved query runs, and an SQL one reading past the registered tables
 *   (#2442) is flagged;
 * - **mcp**: each server started and its tools listed, read-only or asking
 *   first. Only with `runServers`: that runs the plugin's code;
 * - **uninstall**: removing it leaves nothing in any registry, the graph, the
 *   MCP list, the plugins folder or its settings.
 *
 * It uses the plugin registry, so it refuses to run where plugins are
 * already loaded (inside the app); the CLI is a process of its own.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PluginCheckItem, PluginCheckReport, PluginCheckStage, PluginCheckStatus } from '../../shared/plugins/check';
import type { PluginManifest, PluginPackage } from '../../shared/plugins/format';
import { UNTRUSTED_TAG } from '../../shared/untrusted-content';
import { pluginThemeMode } from '../../shared/theme';
import { readPluginPackage } from '../plugins/package';
import { installPluginFromFolder, removePlugin } from '../plugins/lifecycle';
import { disablePlugins, enablePlugins, pluginsEnabled, reloadPluginScan } from '../plugins/registry';
import { pluginThemes } from '../plugins/themes';
import { pluginInspections } from '../plugins/inspection-shapes';
import { runShaclChecks } from '../graph/shacl/run';
import { pluginServerDecls } from '../plugins/mcp-servers';
import { pluginSettingsFile } from '../plugins/settings';
import { loadSkillCatalog } from '../skills/loader';
import { compileSkill } from '../skills/compile';
import { loadTypeCatalog } from '../types/loader';
import { listPluginQueries } from '../saved-query-files';
import { listTemplates } from '../notebase/templates';
import { deriveLocaleId, deriveStyleId, getMergedLocales, getMergedStyles } from '../publish/csl/user-assets';
import { disposeProject, getTypeInstances, indexAllNotes, initGraph, queryGraph } from '../graph';
import { disposeProject as disposeTables, initTablesDb, runNoteQuery } from '../sources/tables';
import { connectMcpServer } from '../mcp-client';
import { projectContext } from '../project-context-types';
import { buildCheckThoughtbases, type CheckThoughtbase } from './fixtures';

export interface PluginCheckOptions {
  /** The Minerva version the plugin's `minerva` range is checked against. */
  appVersion: string;
  /** More thoughtbases to run against, as well as the built-in two. Copied, never touched. */
  thoughtbases?: readonly string[];
  /** Start each MCP server and list its tools. Runs the plugin's code. */
  runServers?: boolean;
  /** Where the scratch folder goes (default: the system temp folder). */
  scratchParent?: string;
}

/** Notes rendered per skill per thoughtbase: enough to take each shape, bounded for a big thoughtbase. */
const NOTES_PER_THOUGHTBASE = 12;
const SERVER_TIMEOUT_MS = 20_000;

class Report {
  readonly items: PluginCheckItem[] = [];
  add(stage: PluginCheckStage, subject: string, status: PluginCheckStatus, detail?: string): void {
    this.items.push({ stage, subject, status, ...(detail ? { detail } : {}) });
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Copy a thoughtbase into the scratch folder, without what no check needs.
 * Like Minerva's own walkers (#2372), an entry the filesystem refuses (an
 * unreadable note or folder, a dangling link) is skipped, not fatal; links
 * are copied as links, never followed.
 */
async function copyThoughtbase(src: string, dest: string): Promise<void> {
  const SKIP = new Set(['.git', 'node_modules']);
  const walk = async (from: string, to: string): Promise<void> => {
    await fs.mkdir(to, { recursive: true });
    let entries;
    try { entries = await fs.readdir(from, { withFileTypes: true }); } catch (e) {
      if (from === src) throw e;
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const a = path.join(from, e.name);
      const b = path.join(to, e.name);
      try {
        if (e.isSymbolicLink()) await fs.symlink(await fs.readlink(a), b);
        else if (e.isDirectory()) await walk(a, b);
        else if (e.isFile()) await fs.copyFile(a, b);
      } catch (err) {
        if (!(err as NodeJS.ErrnoException).code) throw err;
      }
    }
  };
  await walk(src, dest);
}

async function markdownNotes(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= NOTES_PER_THOUGHTBASE) return;
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(abs);
    }
  };
  await walk(root);
  return out;
}

function outsideDelimiters(text: string): string {
  return text.replace(new RegExp(`<${UNTRUSTED_TAG}\\b[^>]*>[\\s\\S]*?</${UNTRUSTED_TAG}>`, 'g'), '');
}

// ── Stages ─────────────────────────────────────────────────────────────────

async function checkContributions(r: Report, plugin: PluginPackage, tb: CheckThoughtbase, noSkills: string): Promise<void> {
  const id = plugin.manifest.id;
  const ofPlugin = (o?: { id: string } | null) => o?.id === id;
  const scan = await reloadPluginScan();
  const skills = await loadSkillCatalog(noSkills, scan);
  const types = await loadTypeCatalog(tb.root, scan);
  const queries = listPluginQueries().filter((q) => ofPlugin(q.plugin));
  const templates = (await listTemplates(tb.root)).filter((t) => ofPlugin(t.plugin));
  const styles = await getMergedStyles(tb.root);
  const locales = await getMergedLocales(tb.root);
  const themes = pluginThemes();
  const inspections = pluginInspections();

  for (const c of plugin.contributions) {
    const file = c.kind === 'folder' ? path.join(c.absolutePath, 'SKILL.md') : c.absolutePath;
    const subject = c.path;
    switch (c.point) {
      case 'skills': {
        const skill = skills.skills.find((s) => s.source === 'plugin' && ofPlugin(s.plugin) && s.filePath === file);
        const errors = skills.errors.filter((e) => e.filePath === file).map((e) => e.message);
        if (skill) r.add('contributions', subject, 'pass', `skill "${skill.id}"`);
        else r.add('contributions', subject, 'fail', errors.join('; ') || 'not in the skill catalog');
        break;
      }
      case 'object-types': {
        const type = types.types.find((t) => t.source === 'plugin' && ofPlugin(t.plugin) && t.filePath === file);
        const errors = types.errors.filter((e) => e.filePath === file).map((e) => e.message);
        if (type) r.add('contributions', subject, 'pass', `type "${type.id}"`);
        else r.add('contributions', subject, 'fail', errors.join('; ') || 'not in the type catalog');
        break;
      }
      case 'saved-queries': {
        const q = queries.find((x) => path.resolve(x.filePath) === path.resolve(file));
        r.add('contributions', subject, q ? 'pass' : 'fail', q ? `${q.language} query "${q.name}"` : 'not in the saved queries (it couldn\'t be read)');
        break;
      }
      case 'note-templates': {
        const t = templates.find((x) => x.filename === path.basename(file));
        r.add('contributions', subject, t ? 'pass' : 'fail', t ? `template "${t.name}"` : 'not in the templates: a thoughtbase or another plugin has one of that name');
        break;
      }
      case 'csl-styles': {
        const isStyle = file.toLowerCase().endsWith('.csl');
        const loaded = isStyle
          ? ofPlugin(styles.pluginIds.get(deriveStyleId(path.basename(file))))
          : Object.hasOwn(locales.locales, deriveLocaleId(path.basename(file)));
        r.add('contributions', subject, loaded ? 'pass' : 'fail', loaded ? (isStyle ? 'citation style' : 'citation locale') : 'not loaded: it isn\'t valid CSL, or a bundled one has its id');
        break;
      }
      case 'themes': {
        const name = path.basename(c.path, path.extname(c.path));
        const theme = themes.themes.find((t) => t.mode === pluginThemeMode(id, name));
        const problem = themes.problems.find((p) => p.plugin === id && p.file === c.path);
        if (theme) r.add('contributions', subject, theme.warnings.length ? 'warn' : 'pass', theme.warnings.length ? `theme "${theme.label}": ${theme.warnings.join('; ')}` : `theme "${theme.label}"`);
        else r.add('contributions', subject, 'fail', problem?.problem ?? 'not in the themes');
        break;
      }
      case 'inspections': {
        // Loaded, then run against the thoughtbase it's checked with (#2642):
        // a shape that throws on someone else's notes reports nothing, which
        // the count says.
        const loaded = inspections.files.find((f) => f.id === `plugin:${id}/${c.path}`);
        const problems = inspections.problems.filter((p) => p.plugin === id && p.file === c.path).map((p) => p.problem);
        if (!loaded) { r.add('contributions', subject, 'fail', problems.join('; ') || 'not in the inspections'); break; }
        const ctx = projectContext(tb.root);
        let findings: number;
        try {
          await initGraph(ctx);
          await indexAllNotes(ctx);
          findings = (await runShaclChecks(ctx, [loaded.file], () => true)).length;
        } finally {
          disposeProject(ctx);
        }
        const checks = loaded.file.checks.length;
        r.add('contributions', subject, 'pass', `${checks} inspection${checks === 1 ? '' : 's'}; ${findings} finding${findings === 1 ? '' : 's'} in ${tb.name}`);
        break;
      }
      default:
        // Every point a plugin can contribute to is handled above; a new one
        // lands here until it is.
        r.add('contributions', subject, 'skip', `no load check for "${String(c.point)}" yet`);
    }
  }
}

async function checkSkills(r: Report, plugin: PluginPackage, tb: CheckThoughtbase, noSkills: string): Promise<void> {
  const { skills } = await loadSkillCatalog(noSkills, await reloadPluginScan());
  const mine = skills.filter((s) => s.source === 'plugin' && s.plugin?.id === plugin.manifest.id);
  if (mine.length === 0) return;
  const notes = await markdownNotes(tb.root);
  for (const skill of mine) {
    const subject = `skill ${skill.id} × ${tb.name}`;
    const def = compileSkill(skill);
    const leaks: string[] = [];
    try {
      for (const abs of notes) {
        const content = await fs.readFile(abs, 'utf-8');
        const rel = path.relative(tb.root, abs).split(path.sep).join('/');
        const ctx = { fullNoteContent: content, fullNoteTitle: path.basename(abs, '.md'), fullNotePath: rel, selectedText: content.slice(0, 200) };
        const system = def.buildSystemPrompt ? def.buildSystemPrompt(ctx) : def.buildPrompt(ctx);
        def.buildUserContext?.(ctx);
        if (def.buildFirstMessage) def.buildFirstMessage(ctx);
        if (tb.canary && outsideDelimiters(system).includes(tb.canary)) leaks.push(rel);
      }
    } catch (e) {
      r.add('thoughtbases', subject, 'fail', `rendering threw: ${message(e)}`);
      continue;
    }
    if (leaks.length) r.add('thoughtbases', subject, 'fail', `note text reached the system prompt undelimited (${leaks.join(', ')}); put it in a {{#context}} block`);
    else r.add('thoughtbases', subject, 'pass', `rendered for ${notes.length} note${notes.length === 1 ? '' : 's'}`);
  }
}

async function checkGraph(r: Report, plugin: PluginPackage, tb: CheckThoughtbase, writable: boolean): Promise<string[]> {
  const id = plugin.manifest.id;
  const types = (await loadTypeCatalog(tb.root, await reloadPluginScan())).types.filter((t) => t.source === 'plugin' && t.plugin?.id === id);
  const queries = listPluginQueries().filter((q) => q.plugin?.id === id);
  if (types.length === 0 && queries.length === 0) return [];
  // A note of each type, so indexing has something to type.
  if (writable) {
    for (const t of types) await fs.writeFile(path.join(tb.root, `plugin-check-${t.id}.md`), `---\ntype: ${t.id}\ntitle: A ${t.label}\n---\n# A ${t.label}\n`);
  }
  const ctx = projectContext(tb.root);
  try {
    await initGraph(ctx);
    await indexAllNotes(ctx);
    for (const t of types) {
      const subject = `type ${t.id} × ${tb.name}`;
      const { instances } = await getTypeInstances(ctx, t.id);
      if (!writable) r.add('thoughtbases', subject, 'pass', `indexed; ${instances.length} note${instances.length === 1 ? '' : 's'} of this type`);
      else if (instances.some((i) => i.path === `plugin-check-${t.id}.md`)) r.add('thoughtbases', subject, 'pass', 'indexed, and types a note that says it');
      else r.add('thoughtbases', subject, 'fail', 'a note with this type: wasn\'t typed as it');
    }
    let tablesReady = false;
    for (const q of queries) {
      const subject = `query ${q.name} × ${tb.name}`;
      if (q.language === 'sparql') {
        const res = await queryGraph(ctx, q.query);
        if (res.ok) r.add('thoughtbases', subject, 'pass', `${res.results.length} row${res.results.length === 1 ? '' : 's'}`);
        else r.add('thoughtbases', subject, 'fail', res.error);
        continue;
      }
      if (!tablesReady) { await initTablesDb(ctx); tablesReady = true; }
      const res = await runNoteQuery(ctx, q.query);
      if (res.ok) r.add('thoughtbases', subject, 'pass', `${res.rows.length} row${res.rows.length === 1 ? '' : 's'}`);
      else r.add('thoughtbases', subject, 'warn', `${res.error} (it runs from the Query panel, but not as a chart or query block)`);
    }
    return types.map((t) => t.id);
  } finally {
    disposeTables(ctx);
    disposeProject(ctx);
  }
}

async function checkServers(r: Report, plugin: PluginPackage, runServers: boolean): Promise<void> {
  const decls = (await pluginServerDecls()).filter((d) => d.plugin.id === plugin.manifest.id);
  for (const d of decls) {
    const subject = `server ${d.key}`;
    if (!runServers) {
      r.add('mcp', subject, 'skip', `not started: pass --run-servers to start it and list its tools (that runs ${[d.declared.command, ...(d.declared.args ?? [])].join(' ')})`);
      continue;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), SERVER_TIMEOUT_MS);
    try {
      const client = await connectMcpServer(d.resolved, { signal: abort.signal });
      try {
        const tools = await client.listTools(abort.signal);
        if (tools.length === 0) r.add('mcp', subject, 'warn', 'started, but offers no tools');
        else r.add('mcp', subject, 'pass', `started; ${tools.length} tool${tools.length === 1 ? '' : 's'}`);
        for (const t of tools) {
          const readOnly = t.annotations?.readOnlyHint === true;
          r.add('mcp', `tool ${d.key}/${t.name}`, t.description ? 'pass' : 'warn',
            `${readOnly ? 'read-only: runs without asking' : 'asks the user before each call'}${t.description ? '' : '; it has no description, which the model needs to pick it'}`);
        }
      } finally {
        await client.close();
      }
    } catch (e) {
      r.add('mcp', subject, 'fail', `couldn't start it or list its tools: ${message(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function checkUninstall(r: Report, manifest: PluginManifest, pluginsDir: string, tbs: CheckThoughtbase[], typed: Map<CheckThoughtbase, string[]>, noSkills: string): Promise<void> {
  const id = manifest.id;
  await removePlugin(pluginsDir, id);
  const scan = await reloadPluginScan();
  const residue: string[] = [];
  if ((await loadSkillCatalog(noSkills, scan)).skills.some((s) => s.plugin?.id === id)) residue.push('a skill');
  for (const tb of tbs) {
    if ((await loadTypeCatalog(tb.root, scan)).types.some((t) => t.plugin?.id === id)) residue.push(`a type (${tb.name})`);
    if (listPluginQueries().some((q) => q.plugin?.id === id)) residue.push('a saved query');
    if ((await listTemplates(tb.root)).some((t) => t.plugin?.id === id)) residue.push('a template');
    if ([...(await getMergedStyles(tb.root)).pluginIds.values()].some((o) => o.id === id)) residue.push('a citation style');
    const types = typed.get(tb) ?? [];
    if (types.length > 0) {
      const ctx = projectContext(tb.root);
      try {
        await initGraph(ctx);
        await indexAllNotes(ctx);
        for (const t of types) {
          const { type, instances } = await getTypeInstances(ctx, t);
          if (type || instances.length > 0) residue.push(`the type "${t}" in the graph (${tb.name})`);
        }
      } finally {
        disposeProject(ctx);
      }
    }
  }
  if (pluginThemes().themes.some((t) => t.plugin.id === id)) residue.push('a theme');
  if (pluginInspections().catalog.some((c) => c.plugin.id === id)) residue.push('an inspection');
  if ((await pluginServerDecls()).some((d) => d.plugin.id === id)) residue.push('an MCP server');
  const exists = (p: string) => fs.access(p).then(() => true, () => false);
  if (await exists(path.join(pluginsDir, id))) residue.push('its folder');
  try {
    const settings = JSON.parse(await fs.readFile(pluginSettingsFile(pluginsDir), 'utf-8')) as Record<string, unknown>;
    if (Object.hasOwn(settings, id)) residue.push('its settings');
  } catch { /* no settings file: nothing left there */ }
  try {
    const records = JSON.parse(await fs.readFile(path.join(pluginsDir, 'plugins.json'), 'utf-8')) as Record<string, unknown>;
    if (Object.hasOwn(records, id)) residue.push('its install record');
  } catch { /* no records file */ }
  const unique = [...new Set(residue)];
  r.add('uninstall', 'remove', unique.length ? 'fail' : 'pass', unique.length ? `left behind: ${unique.join(', ')}` : 'nothing left in any registry, the graph, the MCP list or the plugins folder');
}

// ── The check ──────────────────────────────────────────────────────────────

export async function checkPlugin(folder: string, opts: PluginCheckOptions): Promise<PluginCheckReport> {
  if (pluginsEnabled()) throw new Error('plugin check runs on its own, not where plugins are already loaded.');
  const r = new Report();
  const absFolder = path.resolve(folder);
  const finish = (plugin: string | null): PluginCheckReport => ({
    folder: absFolder, plugin, ok: r.items.every((i) => i.status !== 'fail'), items: r.items,
  });

  // ── package ──
  const read = await readPluginPackage(absFolder, opts.appVersion);
  if (!read.ok) {
    for (const p of read.error.problems) r.add('package', 'plugin.json', 'fail', p);
    return finish(read.error.label === read.error.folder ? null : read.error.label);
  }
  const { manifest } = read.plugin;
  const label = `${manifest.id}@${manifest.version}`;
  r.add('package', 'plugin.json', 'pass', `${manifest.name}: ${read.plugin.contributions.length} contribution${read.plugin.contributions.length === 1 ? '' : 's'}${manifest.mcpServers?.length ? `, ${manifest.mcpServers.length} MCP server${manifest.mcpServers.length === 1 ? '' : 's'}` : ''}`);

  const scratch = await fs.mkdtemp(path.join(opts.scratchParent ?? os.tmpdir(), 'minerva-plugin-check-'));
  const pluginsDir = path.join(scratch, 'plugins');
  const noSkills = path.join(scratch, 'no-user-skills');
  try {
    let installed: PluginPackage | null;
    try {
      // Its code is allowed in the scratch folder: nothing here is the user's (#2833).
      installed = await installPluginFromFolder(pluginsDir, absFolder, opts.appVersion, { approveCode: () => Promise.resolve(true) });
    } catch (e) {
      r.add('package', 'install', 'fail', message(e));
      return finish(label);
    }
    if (!installed) { r.add('package', 'install', 'fail', 'it wasn\'t installed'); return finish(label); }
    r.add('package', 'install', 'pass', 'installs into a plugins folder as Settings → Plugins would');

    enablePlugins({ appVersion: opts.appVersion, dir: pluginsDir });
    await reloadPluginScan();

    const builtIn = await buildCheckThoughtbases(path.join(scratch, 'fixtures'));
    const named: CheckThoughtbase[] = [];
    for (const [i, src] of (opts.thoughtbases ?? []).entries()) {
      const root = path.join(scratch, 'named', String(i), 'thoughtbase');
      try {
        await fs.mkdir(path.dirname(root), { recursive: true });
        await copyThoughtbase(path.resolve(src), root);
        named.push({ name: path.basename(path.resolve(src)), root });
      } catch (e) {
        r.add('thoughtbases', src, 'fail', `couldn't copy it to check against: ${message(e)}`);
      }
    }
    const tbs = [...builtIn, ...named];

    // ── contributions ──
    await checkContributions(r, installed, builtIn[0]!, noSkills);

    // ── thoughtbases ──
    const typed = new Map<CheckThoughtbase, string[]>();
    for (const tb of tbs) {
      try {
        await checkSkills(r, installed, tb, noSkills);
        typed.set(tb, await checkGraph(r, installed, tb, true));
      } catch (e) {
        r.add('thoughtbases', tb.name, 'fail', `the check against it threw: ${message(e)}`);
      }
    }

    // ── mcp ──
    await checkServers(r, installed, opts.runServers === true);

    // ── uninstall ──
    await checkUninstall(r, manifest, pluginsDir, tbs, typed, noSkills);
    return finish(label);
  } finally {
    disablePlugins();
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
