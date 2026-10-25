/**
 * `minerva plugin new <id> --kind <kind>` (#2653) and `--mcp node|python`
 * (#2650): a plugin with one working contribution, ready to install, and
 * passing `minerva plugin check` as written (CI holds that).
 *
 * A declarative kind (`skill`, `type`, `query`, `template`, `csl`, `theme`)
 * writes one file into its point's folder. A code kind (`view`, `command`,
 * #2833) writes a page or a logic module and a `code` section. `mcp` writes the smallest plugin
 * that uses every part of the MCP tier: a server with one read-only tool and
 * one that writes (so Minerva asks before each call), a setting passed in as
 * the server's environment, a skill scoped to the server's tools (#2649), and
 * a test that drives the server over stdio.
 *
 * Every point a plugin can contribute to has a kind (`SCAFFOLD_KIND_POINTS`),
 * and `scaffold.test.ts` fails when a point opens without one.
 *
 * The templates are real files under `scaffold-templates/`, bundled at build
 * time like the stock skills, so the CLI needs nothing from disk: `kinds/<kind>/`
 * for a declarative kind, `code/<kind>/` for a code kind, `common/` and
 * `<runtime>/` for `mcp`.
 * `__PLUGIN_ID__` and `__PLUGIN_NAME__` are replaced in every path and file,
 * the name escaped for a JSON or XML file; `plugin.json` is built here.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PLUGIN_MANIFEST, type PluginContributionPoint } from '../../shared/plugins/format';
import semver from 'semver';
import { validatePluginManifest } from './manifest';
import { PLUGIN_API_VERSION } from '../../shared/plugins/api';
import { writeDraftFiles } from './draft-files';

export const SCAFFOLD_RUNTIMES = ['node', 'python'] as const;
export type ScaffoldRuntime = (typeof SCAFFOLD_RUNTIMES)[number];

/** The point each declarative kind contributes to, and what it is. */
export const SCAFFOLD_KIND_POINTS = {
  skill: { point: 'skills', what: 'a skill that sums a note up in three points' },
  type: { point: 'object-types', what: 'an object type with a status, a due date and notes' },
  query: { point: 'saved-queries', what: 'a saved SPARQL query listing notes and their tags' },
  template: { point: 'note-templates', what: 'a note template' },
  csl: { point: 'csl-styles', what: 'an author-date citation style' },
  theme: { point: 'themes', what: 'a dark colour theme' },
  inspection: { point: 'inspections', what: 'an inspection, as a SHACL shape, for notes with no tags' },
} as const satisfies Record<string, { point: PluginContributionPoint; what: string }>;

/**
 * The kinds that are plugin code (#2833): a page and its query, or logic run
 * in the worker host. Each writes its files and a `code` section; nothing in
 * `contributes`.
 */
export const SCAFFOLD_CODE_KINDS = {
  view: { what: 'a sidebar panel listing the notes tagged #todo, which a click opens' },
  command: { what: 'a command that title-cases the selected text, in the palette and the editor\'s menu' },
} as const;
type CodeKind = keyof typeof SCAFFOLD_CODE_KINDS;

export const SCAFFOLD_KINDS = [
  ...Object.keys(SCAFFOLD_KIND_POINTS) as (keyof typeof SCAFFOLD_KIND_POINTS)[],
  ...Object.keys(SCAFFOLD_CODE_KINDS) as CodeKind[],
  'mcp',
] as const;
export type ScaffoldKind = (typeof SCAFFOLD_KINDS)[number];

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
  /** Default `mcp` when a `runtime` is given. */
  kind?: ScaffoldKind | undefined;
  /** The server's language; required for `mcp`, and only for it. */
  runtime?: ScaffoldRuntime | undefined;
  /** Shown in Settings → Plugins. Defaults to the id in title case. */
  name?: string | undefined;
}

/** What was asked can't be made: a bad id or name, or the folder exists. */
export class ScaffoldRefusal extends Error {}

export function isScaffoldRuntime(value: string): value is ScaffoldRuntime {
  return (SCAFFOLD_RUNTIMES as readonly string[]).includes(value);
}

export function isScaffoldKind(value: string): value is ScaffoldKind {
  return (SCAFFOLD_KINDS as readonly string[]).includes(value);
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function titleCase(id: string): string {
  return id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Every file of the new plugin, by its path inside the plugin folder. */
export function scaffoldPluginFiles(opts: ScaffoldOptions): Map<string, string> {
  const kind: ScaffoldKind = opts.kind ?? (opts.runtime ? 'mcp' : 'skill');
  if (kind === 'mcp' && !opts.runtime) throw new ScaffoldRefusal(`An MCP plugin needs a language: ${SCAFFOLD_RUNTIMES.join(' or ')}.`);
  if (kind !== 'mcp' && opts.runtime) throw new ScaffoldRefusal(`A language is only for an MCP plugin, not a ${kind}.`);
  const name = opts.name?.trim() || titleCase(opts.id);
  const fill = (text: string, file: string) => {
    const shownName = file.endsWith('.json') ? JSON.stringify(name).slice(1, -1) : /\.(csl|xml)$/.test(file) ? escapeXml(name) : name;
    return text.replaceAll('__PLUGIN_ID__', opts.id).replaceAll('__PLUGIN_NAME__', shownName);
  };
  const files = new Map<string, string>();
  const take = (folder: string) => {
    const prefix = `./scaffold-templates/${folder}/`;
    for (const [key, text] of Object.entries(TEMPLATES)) {
      if (!key.startsWith(prefix)) continue;
      const rel = key.slice(prefix.length).replaceAll('__PLUGIN_ID__', opts.id);
      files.set(rel, fill(text, rel));
    }
  };

  let manifest: Record<string, unknown>;
  if (kind === 'mcp') {
    const server = SERVER[opts.runtime!];
    manifest = {
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
    take('common');
    take(opts.runtime!);
  } else if (kind === 'view' || kind === 'command') {
    take(`code/${kind}`);
    const { what } = SCAFFOLD_CODE_KINDS[kind];
    manifest = {
      id: opts.id,
      name,
      version: '0.1.0',
      minerva: SCAFFOLD_MINERVA_RANGE,
      description: `${what.charAt(0).toUpperCase()}${what.slice(1)}, to start from.`,
      contributes: {},
      code: kind === 'view'
        ? {
          capabilities: ['notes:read', 'graph:query', 'ui'],
          api: CODE_API_RANGE,
          views: [{ id: 'notes', title: name, place: 'left-sidebar', entry: 'panel/index.html', query: 'panel/notes.rq' }],
        }
        : {
          capabilities: ['notes:read'],
          api: CODE_API_RANGE,
          worker: 'logic.js',
          commands: [{ id: 'title-case', title: 'Title Case Selection', when: 'selection', editorMenu: true, run: { handler: 'titleCase' } }],
        },
    };
    files.set('README.md', codeReadme(kind, opts.id, name, [...files.keys()].sort()));
  } else {
    const { point, what } = SCAFFOLD_KIND_POINTS[kind];
    take(`kinds/${kind}`);
    const contributed = [...files.keys()].sort();
    manifest = {
      id: opts.id,
      name,
      version: '0.1.0',
      minerva: SCAFFOLD_MINERVA_RANGE,
      description: `${what.charAt(0).toUpperCase()}${what.slice(1)}, to start from.`,
      contributes: { [point]: contributed },
    };
    files.set('README.md', kindReadme(kind, opts.id, name, contributed));
  }
  // The manifest's own checker, so a bad id or name is refused here, with the
  // words Settings → Plugins would use, rather than after it's written.
  const checked = validatePluginManifest(manifest, {
    folder: opts.id,
    appVersion: semver.minVersion(SCAFFOLD_MINERVA_RANGE)!.version,
  });
  if (!checked.ok) throw new ScaffoldRefusal(checked.problems.join('\n'));

  files.set(PLUGIN_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The plugin API a code scaffold is written for: this Minerva's, and later minors (#2826). */
const CODE_API_RANGE = `^${PLUGIN_API_VERSION}`;

function codeReadme(kind: CodeKind, id: string, name: string, files: string[]): string {
  return `# ${name}

A Minerva plugin made by \`minerva plugin new ${id} --kind ${kind}\`: ${SCAFFOLD_CODE_KINDS[kind].what}.
It's plugin code, run sandboxed inside Minerva: it reaches only what its
\`code.capabilities\` in \`plugin.json\` say, through the plugin API
(\`/@minerva/plugin-api.js\`, which Minerva serves to every plugin).

${files.map((f) => `- \`${f}\``).join('\n')}
- \`plugin.json\` declares it: its capabilities, and its \`code\` section.

The format, the API and what each capability allows are in Minerva's
docs/authoring-plugins.md (plugin code).

## Try it

1. \`minerva plugin check .\` puts it through what Minerva does with it.
2. Settings → Plugins → **Install from folder…**, and pick this folder.
   Minerva asks before its code runs, and again whenever its files change.
`;
}

const KIND_DOCS: Record<Exclude<ScaffoldKind, 'mcp' | CodeKind>, string> = {
  skill: 'docs/authoring-skills.md',
  type: 'docs/authoring-types.md',
  query: 'docs/authoring-plugins.md (saved queries)',
  template: 'docs/authoring-plugins.md (note templates)',
  csl: 'docs/authoring-plugins.md (citation styles)',
  theme: 'docs/authoring-plugins.md (themes)',
  inspection: 'docs/authoring-plugins.md (inspections)',
};

function kindReadme(kind: Exclude<ScaffoldKind, 'mcp' | CodeKind>, id: string, name: string, files: string[]): string {
  return `# ${name}

A Minerva plugin made by \`minerva plugin new ${id} --kind ${kind}\`: ${SCAFFOLD_KIND_POINTS[kind].what}.

- \`plugin.json\` declares the plugin and what it contributes.
${files.map((f) => `- \`${f}\` is the contribution. Make it yours; the format is in Minerva's ${KIND_DOCS[kind]}.`).join('\n')}

## Try it

1. \`minerva plugin check .\` puts it through what Minerva does with it.
2. Settings → Plugins → **Install from folder…**, and pick this folder. (Or
   link it into \`~/.minerva/plugins/${id}\` to work on it in place.)

Add more contributions by listing them in \`plugin.json\`'s \`contributes\`.
`;
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
    await writeDraftFiles(folder, [...files].map(([p, content]) => ({ path: p, content })));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new ScaffoldRefusal(`${folder} already exists; pick another id or folder.`, { cause: e });
    throw e;
  }
  return { folder, files: [...files.keys()] };
}
