/**
 * Core plugins (#2820, epic #2819): plugins that ship inside the signed app
 * and can be switched off on this machine, like Obsidian's core plugins.
 *
 * A core plugin is held to the same `plugin.json` format as any other, and
 * checked by the same validator. Minerva's signature vouches for it, so it
 * needs no install approval, and it can't be removed, only turned off. Its
 * state is a record in `plugins.json` beside the installed plugins' records
 * (`source: { kind: 'core' }`); a core plugin with no record has its
 * default state.
 *
 * Its wiring (IPC handlers, registry entries, processes) is the app's own
 * code, activated by the composition root (`core-plugins.ts`) only while the
 * plugin is on. Off means not wired up, not hidden. That's why this module
 * says what core plugins exist and whether each is on, and nothing about what
 * they do: `plugins/` importing the subsystems it switches would make a
 * package cycle of every one of them.
 *
 * A core plugin's id is reserved: a folder in `~/.minerva/plugins/` claiming
 * one is refused, so a third-party plugin can't stand in for a built-in one.
 */
import type { PluginManifest } from '../../shared/plugins/format';
import { validatePluginManifest } from './manifest';
import { loadPluginRecordsSync, updatePluginRecords, updatePluginRecordsSync, type PluginRecords } from './state';

export interface CorePluginDefinition {
  /** Its `plugin.json`, as written. */
  manifest: Record<string, unknown>;
  /** On or off on a machine that has never switched it. */
  defaultEnabled: boolean;
}

export interface CorePlugin {
  manifest: PluginManifest;
  defaultEnabled: boolean;
}

/** The core plugins, in the order Settings lists them. */
const CORE_PLUGIN_DEFINITIONS: readonly CorePluginDefinition[] = [
  {
    // Python cells (#2822): the one compute language that runs arbitrary code,
    // so it's off on a new install. SQL and SPARQL cells are read-only and
    // stay part of Minerva itself.
    manifest: {
      id: 'python',
      name: 'Python',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: 'Run Python code cells in notes, in an interpreter you choose: pandas, numpy, matplotlib and anything else you install.',
      contributes: {},
      code: { capabilities: ['process'] },
    },
    defaultEnabled: false,
  },
  {
    // The Kanban layout (#2828): the first view drawn by plugin code, in a
    // plugin frame (`plugins/kanban/`), on the plugin API like any plugin.
    // On by default: it was part of Minerva before, and it is safe — it reads
    // the notes a view shows and moves them between columns, nothing else.
    manifest: {
      id: 'kanban',
      name: 'Kanban',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: 'Show a type view as a board: a column per option of a choice property, cards you drag between them.',
      contributes: {},
      code: { capabilities: ['notes:read', 'notes:write-properties', 'ui'], api: '^1.5.0' },
    },
    defaultEnabled: true,
  },
  {
    // The Timeline layout (#2829), drawn the same way (`plugins/timeline/`).
    // It reads the notes a view shows and writes nothing to them: zooming
    // and panning change only the view's own range, through `view.setState`.
    manifest: {
      id: 'timeline',
      name: 'Timeline',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: 'Show a type view on a time axis: each dated note a point or a bar, zoomed and panned with the pointer or the keyboard.',
      contributes: {},
      code: { capabilities: ['notes:read', 'ui'], api: '^1.6.0' },
    },
    defaultEnabled: true,
  },
  {
    // The Calendar layout (#2829), drawn the same way (`plugins/calendar/`).
    // It reads the notes a view shows, and moves one to another day only by
    // asking Minerva (`view.reschedule`), which writes its dates with undo.
    manifest: {
      id: 'calendar',
      name: 'Calendar',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: 'Show a type view as a month grid: each dated note on its day, dragged to another day to reschedule it.',
      contributes: {},
      code: { capabilities: ['notes:read', 'notes:write-properties', 'ui'], api: '^1.7.0' },
    },
    defaultEnabled: true,
  },
  {
    // The Reading Queue (#2640): the worked example of a global view, a
    // panel fed by a query it declares (`plugins/reading-queue/public/queue.rq`).
    // It lists and opens the books and articles that query names, and marks
    // one read; it reads no note's text. Off by default: it adds a panel.
    manifest: {
      id: 'reading-queue',
      name: 'Reading Queue',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: "A sidebar panel of the books and articles you're reading and those still to read, each marked read with one click.",
      contributes: {},
      code: {
        capabilities: ['graph:query', 'notes:write-properties', 'ui'],
        api: '^1.8.0',
        views: [{ id: 'queue', title: 'Reading Queue', place: 'left-sidebar', entry: 'index.html', query: 'queue.rq', icon: 'bookmark' }],
      },
    },
    defaultEnabled: false,
  },
];

let definitions: readonly CorePluginDefinition[] = CORE_PLUGIN_DEFINITIONS;
let validated: CorePlugin[] | null = null;

/**
 * The core plugins, checked. A core manifest that doesn't validate is a bug
 * in this build, not a user's problem to read about, so it throws.
 */
export function corePlugins(): readonly CorePlugin[] {
  validated ??= definitions.map((def) => {
    const id = typeof def.manifest.id === 'string' ? def.manifest.id : '';
    const checked = validatePluginManifest(def.manifest, { folder: id, appVersion: '0.0.0', core: true });
    if (!checked.ok) throw new Error(`Core plugin "${id}" has an invalid manifest: ${checked.problems.join(' ')}`);
    return { manifest: checked.manifest, defaultEnabled: def.defaultEnabled };
  });
  return validated;
}

/** The core plugin with this id, if there is one. */
export function corePlugin(id: string): CorePlugin | undefined {
  return corePlugins().find((p) => p.manifest.id === id);
}

/** Whether `id` belongs to a core plugin, and so can't be installed. */
export function isCorePluginId(id: string): boolean {
  return corePlugin(id) !== undefined;
}

/** Whether a core plugin is on, given the records: its own, or its default. */
export function corePluginEnabled(records: PluginRecords, plugin: CorePlugin): boolean {
  const record = Object.hasOwn(records, plugin.manifest.id) ? records[plugin.manifest.id] : undefined;
  return record?.source.kind === 'core' ? record.enabled : plugin.defaultEnabled;
}

/** Every core plugin's state on this machine, read synchronously (startup). */
export function readCorePluginStates(pluginsDir: string): Map<string, boolean> {
  const records = loadPluginRecordsSync(pluginsDir);
  return new Map(corePlugins().map((p) => [p.manifest.id, corePluginEnabled(records, p)]));
}

/**
 * Record a core plugin as on or off, but only on a machine that has never
 * switched it: a one-time decision made at startup, synchronously (#2822).
 * Returns whether it wrote. A record already there, however it got there,
 * stands.
 */
export function adoptCorePluginState(pluginsDir: string, id: string, enabled: boolean): boolean {
  if (!isCorePluginId(id)) throw new Error(`No core plugin "${id}".`);
  let wrote = false;
  updatePluginRecordsSync(pluginsDir, (records) => {
    if (records[id]?.source.kind === 'core') return;
    records[id] = { enabled, source: { kind: 'core' } };
    wrote = true;
  });
  return wrote;
}

/** Whether this machine has ever switched a core plugin (has its record). */
export function hasCorePluginRecord(pluginsDir: string, id: string): boolean {
  const records = loadPluginRecordsSync(pluginsDir);
  return Object.hasOwn(records, id) && records[id]!.source.kind === 'core';
}

/** Switch a core plugin on or off on this machine. */
export async function setCorePluginEnabled(pluginsDir: string, id: string, enabled: boolean): Promise<void> {
  if (!isCorePluginId(id)) throw new Error(`No core plugin "${id}".`);
  await updatePluginRecords(pluginsDir, (records) => {
    records[id] = { enabled, source: { kind: 'core' } };
  });
}

/** Replace the core plugins; `null` puts the real ones back. Tests only. */
export function _setCorePluginsForTests(defs: readonly CorePluginDefinition[] | null): void {
  definitions = defs ?? CORE_PLUGIN_DEFINITIONS;
  validated = null;
}
