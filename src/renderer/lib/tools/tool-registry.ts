import { registerTool, unregisterTool } from '../../../shared/tools/registry';
import { menuToCategory, type SkillInfo } from '../../../shared/skills/types';
import type { ThinkingToolMeta } from '../../../shared/tools/types';

// Re-export registry functions for renderer use. `getTool` is deliberately not
// among them (#2235): it hands back a `ThinkingToolMeta`, which is all this
// process has, and nothing in the renderer imports it — re-exporting it only
// invited the "call the builder" mistake the split just removed.
export { getAllToolInfos, getToolInfosByCategory, getSlashCommands } from '../../../shared/tools/registry';

/**
 * Skills are loaded from disk in the main process (#625). The renderer learns
 * about them via `api.skills.list()` and registers their metadata here so the
 * tool panel, command palette and slash commands treat them like any other
 * tool. The build* closures live in main and run at prepare/execute time.
 *
 * This returned a `ThinkingToolDef` until #2235, which meant inventing a
 * `buildPrompt: () => ''` to satisfy a required field the renderer has no way
 * to fill. The stub was harmless in itself and dangerous as a type: any
 * renderer code reaching `getTool(id)?.buildPrompt(ctx)` compiled cleanly and
 * silently produced an empty prompt. `ThinkingToolMeta` is what the renderer
 * actually has, so there is nothing left to stub and nothing left to call.
 *
 * The function itself stays, though — #2235 guessed it would delete along with
 * the stub, on the reading that `SkillInfo` already IS the meta type. It nearly
 * is, and the three places it isn't are exactly what this does: `menu`
 * (display-cased) becomes `category` (lowercase `ToolCategory`), `model`
 * becomes `preferredModel`, and a bare `web: boolean` becomes
 * `web: { defaultEnabled }`. That's a real adapter between two vocabularies,
 * not a wrapper that existed to hang the stub on.
 */
export function skillInfoToToolMeta(info: SkillInfo): ThinkingToolMeta {
  return {
    id: info.id,
    name: info.name,
    category: menuToCategory(info.menu),
    ...(info.group !== undefined ? { group: info.group } : {}),
    scope: info.scope,
    description: info.description,
    longDescription: info.longDescription,
    context: info.context,
    parameters: info.parameters,
    outputMode: info.outputMode,
    ...(info.outputNotePrefix !== undefined ? { outputNotePrefix: info.outputNotePrefix } : {}),
    ...(info.slashCommand !== undefined ? { slashCommand: info.slashCommand } : {}),
    ...(info.model !== undefined ? { preferredModel: info.model } : {}),
    web: { defaultEnabled: info.web },
    requiresSelection: info.requiresSelection,
    ...(info.requiresNote !== undefined ? { requiresNote: info.requiresNote } : {}),
  };
}

const registeredSkillIds = new Set<string>();

/** Replace the previously-registered skill infos with a fresh set. Hardcoded
 *  tools (registered via the static import above) are left untouched. */
export function registerSkillInfos(infos: SkillInfo[]): void {
  for (const id of registeredSkillIds) unregisterTool(id);
  registeredSkillIds.clear();
  for (const info of infos) {
    registerTool(skillInfoToToolMeta(info));
    registeredSkillIds.add(info.id);
  }
}
