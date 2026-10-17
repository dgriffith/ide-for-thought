/**
 * `minerva plugin new --mcp node|python` (#2650): a plugin with a working
 * stdio MCP server, ready to install.
 *
 * What it writes is the smallest plugin that uses every part of the MCP tier:
 * a server with one read-only tool and one that writes (so Minerva asks before
 * each call), a setting passed in as the server's environment, a skill scoped
 * to the server's tools (#2649), and a test that drives the server over stdio.
 *
 * The templates are real files under `scaffold-templates/`, bundled at build
 * time like the stock skills, so the CLI needs nothing from disk. `common/`
 * goes into both runtimes. `__PLUGIN_ID__` and `__PLUGIN_NAME__` are replaced
 * in every file; `plugin.json` is built here, so the name can't break its JSON.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PLUGIN_MANIFEST } from '../../shared/plugins/format';
import semver from 'semver';
import { validatePluginManifest } from './manifest';

export const SCAFFOLD_RUNTIMES = ['node', 'python'] as const;
export type ScaffoldRuntime = (typeof SCAFFOLD_RUNTIMES)[number];

/** The oldest Minerva that reads a plugin's `mcpServers`. */
export const SCAFFOLD_MINERVA_RANGE = '>=3.0.0';

const TEMPLATES = import.meta.glob('./scaffold-templates/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const SERVER: Record<ScaffoldRuntime, { command: string; script: string; label: string }> = {
  node: { command: 'node', script: 'server/index.js', label: 'Node' },
  python: { command: 'python3', script: 'server/server.py', label: 'Python' },
};

export interface ScaffoldOptions {
  id: string;
  runtime: ScaffoldRuntime;
  /** Shown in Settings → Plugins. Defaults to the id in title case. */
  name?: string | undefined;
}

/** What was asked can't be made: a bad id or name, or the folder exists. */
export class ScaffoldRefusal extends Error {}

export function isScaffoldRuntime(value: string): value is ScaffoldRuntime {
  return (SCAFFOLD_RUNTIMES as readonly string[]).includes(value);
}

function titleCase(id: string): string {
  return id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Every file of the new plugin, by its path inside the plugin folder. */
export function scaffoldPluginFiles(opts: ScaffoldOptions): Map<string, string> {
  const name = opts.name?.trim() || titleCase(opts.id);
  const server = SERVER[opts.runtime];
  const manifest = {
    id: opts.id,
    name,
    version: '0.1.0',
    minerva: SCAFFOLD_MINERVA_RANGE,
    description: `An MCP server (${server.label}) with a read-only tool and one that asks first, and a skill that uses them.`,
    contributes: { skills: ['skills/memos.md'] },
    settings: {
      memoFile: {
        type: 'string',
        title: 'Memo file',
        description: `Where add_memo keeps memos, one JSON object per line. Leave it blank for ~/.${opts.id}/memos.jsonl.`,
      },
    },
    mcpServers: {
      memos: {
        title: 'Memos',
        command: server.command,
        args: [server.script],
        env: { MEMO_FILE: '${settings.memoFile}' },
      },
    },
  };
  // The manifest's own checker, so a bad id or name is refused here, with the
  // words Settings → Plugins would use, rather than after it's written.
  const checked = validatePluginManifest(manifest, {
    folder: opts.id,
    appVersion: semver.minVersion(SCAFFOLD_MINERVA_RANGE)!.version,
  });
  if (!checked.ok) throw new ScaffoldRefusal(checked.problems.join('\n'));

  const fill = (text: string) => text.replaceAll('__PLUGIN_ID__', opts.id).replaceAll('__PLUGIN_NAME__', name);
  const files = new Map<string, string>();
  for (const folder of ['common', opts.runtime]) {
    const prefix = `./scaffold-templates/${folder}/`;
    for (const [key, text] of Object.entries(TEMPLATES)) {
      if (key.startsWith(prefix)) files.set(key.slice(prefix.length), fill(text));
    }
  }

  files.set(PLUGIN_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Write a new plugin into `<parent>/<id>/` (the folder must be named for the
 * plugin) and return that folder. Refuses a folder that already exists, so it
 * never overwrites anyone's work.
 */
export async function writeScaffold(parent: string, opts: ScaffoldOptions): Promise<{ folder: string; files: string[] }> {
  const files = scaffoldPluginFiles(opts);
  const folder = path.join(parent, opts.id);
  await fs.mkdir(parent, { recursive: true });
  try {
    await fs.mkdir(folder, { recursive: false });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new ScaffoldRefusal(`${folder} already exists; pick another id or folder.`, { cause: e });
    throw e;
  }
  for (const [rel, text] of files) {
    const target = path.join(folder, ...rel.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text, { flag: 'wx' });
  }
  return { folder, files: [...files.keys()] };
}
