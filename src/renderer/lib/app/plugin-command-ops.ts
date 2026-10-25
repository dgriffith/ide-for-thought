/**
 * Running a plugin's command (#2643): from the palette or the editor's
 * right-click menu. What the command runs on — the active note and its
 * selection — goes to main, which decides what happens (`plugin-commands.ts`)
 * and says what to do next:
 *
 * - a handler's result: `replaceSelection` replaces the text the command ran
 *   on, as one change the editor can undo — and only if that text is still
 *   selected, so a command that took a while can't overwrite what the user
 *   typed meanwhile; `announce` is shown and spoken;
 * - a skill, a query or a view, run the way the palette runs them.
 *
 * A command that fails says so, naming the plugin (the error comes from main).
 */
import { api } from '../ipc/client';
import { getToastStore } from '../stores/toasts.svelte';
import { codePluginsStore } from '../stores/code-plugins.svelte';
import { logger } from '../../../shared/logger';

interface EditorRef {
  getSelectionRange(): { from: number; to: number } | null;
  getSelectedText(): string;
  /** Replace `from`–`to` with `text` if it still reads `expected`; whether it did. */
  replaceRangeIfUnchanged(from: number, to: number, expected: string, text: string): boolean;
}

export interface PluginCommandOpsCtx {
  getEditorComponent(): EditorRef | undefined;
  /** The note open in the active tab, or null. */
  getActiveNotePath(): string | null;
  runSkill(id: string): void;
  openQuery(text: string): void;
  openView(pluginId: string, viewId: string): void;
}

export function createPluginCommandOps(ctx: PluginCommandOpsCtx) {
  const toasts = getToastStore();

  async function runPluginCommand(pluginId: string, commandId: string): Promise<void> {
    const found = codePluginsStore.allCommands().find((c) => c.pluginId === pluginId && c.command.id === commandId);
    const title = found?.command.title ?? commandId;
    const editor = ctx.getEditorComponent();
    const note = ctx.getActiveNotePath();
    const range = note ? editor?.getSelectionRange() ?? null : null;
    const selection = range ? editor!.getSelectedText() : '';
    try {
      const action = await api.plugins.runCommand(pluginId, commandId, {
        ...(note ? { note } : {}),
        ...(selection ? { selection } : {}),
      });
      switch (action.kind) {
        case 'skill': ctx.runSkill(action.skill); return;
        case 'query': ctx.openQuery(action.text); return;
        case 'view': ctx.openView(pluginId, action.view); return;
        case 'result': {
          if (action.replaceSelection !== undefined) {
            const applied = range !== null && editor !== undefined
              && editor.replaceRangeIfUnchanged(range.from, range.to, selection, action.replaceSelection);
            if (!applied) {
              toasts.push({ message: `"${title}" didn't change the note: the selection changed while it ran.` });
              return;
            }
          }
          if (action.announce) toasts.push({ message: action.announce });
          return;
        }
      }
    } catch (e) {
      logger('plugins').warn(`plugin command ${pluginId}/${commandId} failed:`, e);
      toasts.push({ message: e instanceof Error ? stripIpcPrefix(e.message) : `"${title}" failed.` });
    }
  }

  return { runPluginCommand };
}

/** Electron prefixes a handler's error with where it came from; the user wants the message. */
function stripIpcPrefix(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}
