/**
 * Which plugins with code are on, as the renderer reads it (#2828), and what
 * their code adds: global views (#2640), live blocks (#2641) and commands
 * (#2643). Built-in plugins first, then installed ones (#2833) — the order
 * main resolves them in. Read from `plugins.list()`, and again whenever the
 * plugins change.
 *
 * An installed plugin counts as on only while it's enabled AND its code is
 * approved as the files it ships: one waiting for approval (`codeApproval`)
 * is off, which is also what main's scan says.
 *
 * Until the first answer lands every plugin counts as on, as
 * `computeLanguagesStore` does: a view that tries to draw a moment early
 * fails safe (the frame is refused a session), while a "turned off" line
 * flashing up for someone who has it on would be wrong.
 */
import { api } from '../ipc/client';
import { logger } from '../../../shared/logger';
import { resolvePluginKeys, type PluginKeyConflict } from '../../../shared/plugins/command-keys';
import type { PluginBlock, PluginCommand, PluginSummary, PluginView, PluginViewPlace } from '../../../shared/plugins/format';
import type { PluginBlockSyntax } from '../../../shared/live-blocks';

/** A global view an enabled plugin draws (#2640). */
export interface ActivePluginView {
  pluginId: string;
  pluginName: string;
  view: PluginView;
}

/** A command an enabled plugin adds (#2643). */
export interface ActivePluginCommand {
  pluginId: string;
  pluginName: string;
  command: PluginCommand;
}

interface CodePluginInfo {
  name: string;
  enabled: boolean;
  views: readonly PluginView[];
  blocks: readonly PluginBlock[];
  commands: readonly PluginCommand[];
}

let known = $state<ReadonlyMap<string, CodePluginInfo> | null>(null);
let started = false;

async function refresh(): Promise<void> {
  // A window with no plugins API at all is a partial test double: no answer,
  // so every plugin counts as on. A real API that fails is reported below.
  if (!api.plugins) return;
  try {
    const list = await api.plugins.list();
    const info = (p: PluginSummary): [string, CodePluginInfo] => [p.id, {
      name: p.name, enabled: p.enabled && !p.codeApproval, views: p.views ?? [], blocks: p.blocks ?? [], commands: p.commands ?? [],
    }];
    // An installed plugin can't take a built-in one's id (`package.ts`), so one map holds both.
    known = new Map([...list.core.map(info), ...list.installed.filter((p) => p.capabilities).map(info)]);
  } catch (e) {
    logger('plugins').warn('could not read which plugins with code are on:', e);
  }
}

function start(): void {
  if (started) return;
  started = true;
  // Not knowing which plugins are on must never break the view asking: the
  // answer stays "on" (see the header), and the failure is logged.
  try {
    void refresh();
    api.plugins?.onChanged(() => { void refresh(); });
  } catch (e) {
    logger('plugins').warn('could not follow which plugins with code are on:', e);
  }
}

export const codePluginsStore = {
  /** Whether plugin `id` (built in, or installed with code) is on. Reactive. */
  isOn(id: string): boolean {
    start();
    return known === null ? true : known.get(id)?.enabled ?? false;
  },
  /**
   * The global views the plugins that are on draw in `place` (#2640),
   * in the order Settings lists the plugins. Reactive. Unlike `isOn`, none
   * until the list has loaded: a panel can't be offered before it's known.
   */
  views(place: PluginViewPlace): ActivePluginView[] {
    return codePluginsStore.allViews().filter((v) => v.view.place === place);
  },
  /**
   * One global view, wherever it shows (#2640): what a plugin-view tab is
   * drawn from. `undefined` until the list has loaded; null when the plugin
   * is off or no longer has that view. Reactive.
   */
  view(pluginId: string, viewId: string): ActivePluginView | null | undefined {
    start();
    if (known === null) return undefined;
    const p = known.get(pluginId);
    const view = p?.enabled ? p.views.find((v) => v.id === viewId) : undefined;
    return view ? { pluginId, pluginName: p!.name, view } : null;
  },
  /** Every global view of the plugins that are on, wherever it shows (#2640): the palette's list. */
  allViews(): ActivePluginView[] {
    start();
    if (known === null) return [];
    return [...known].flatMap(([pluginId, p]) => (p.enabled ? p.views.map((view) => ({ pluginId, pluginName: p.name, view })) : []));
  },
  /**
   * The live blocks the plugins that are on draw (#2641), as the preview
   * resolves a fence or directive name against: the first plugin to claim a
   * name keeps it, in Settings' order — the rule an export applies in main
   * (`activePluginBlockSyntax`). None until the list has loaded. Reactive.
   */
  blockSyntax(): PluginBlockSyntax[] {
    start();
    if (known === null) return [];
    const taken = new Set<string>();
    const out: PluginBlockSyntax[] = [];
    for (const [pluginId, p] of known) {
      if (!p.enabled) continue;
      for (const b of p.blocks) {
        const key = b.fence !== undefined ? `fence:${b.fence}` : `directive:${b.directive}`;
        if (taken.has(key)) continue;
        taken.add(key);
        out.push({ pluginId, blockId: b.id, title: b.title, ...(b.fence !== undefined ? { fence: b.fence } : { directive: b.directive! }) });
      }
    }
    return out;
  },
  /** One live block's definition (#2641): its page, while its plugin is on. */
  block(pluginId: string, blockId: string): PluginBlock | null {
    start();
    const p = known?.get(pluginId);
    return p?.enabled ? p.blocks.find((b) => b.id === blockId) ?? null : null;
  },
  /** Every command of the plugins that are on (#2643), in Settings' order: the palette's and the editor menu's list. Reactive. */
  allCommands(): ActivePluginCommand[] {
    start();
    if (known === null) return [];
    return [...known].flatMap(([pluginId, p]) => (p.enabled ? p.commands.map((command) => ({ pluginId, pluginName: p.name, command })) : []));
  },
  /**
   * The keys plugin commands keep (#2879), by the rule main's menu uses
   * (`resolvePluginKeys`): the first plugin to claim a key has it. Reactive.
   */
  commandKeys(): { keys: Map<string, string>; conflicts: PluginKeyConflict[] } {
    return resolvePluginKeys(codePluginsStore.allCommands().map(({ pluginId, pluginName, command }) => ({
      pluginId, pluginName, commandId: command.id, title: command.title, ...(command.key ? { key: command.key } : {}),
    })));
  },
  /** Every command, with the key it kept (#2879): the palette's list. Reactive. */
  keyedCommands(): (ActivePluginCommand & { key?: string })[] {
    const { keys } = codePluginsStore.commandKeys();
    return codePluginsStore.allCommands().map((c) => {
      const key = keys.get(`${c.pluginId}/${c.command.id}`);
      return key ? { ...c, key } : c;
    });
  },
  /** Its name, for "turn on X" — the id until the list has loaded. */
  name(id: string): string {
    start();
    return known?.get(id)?.name ?? id;
  },
};
