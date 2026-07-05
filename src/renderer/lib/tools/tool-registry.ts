import { registerTool, unregisterTool } from '../../../shared/tools/registry';
import { menuToCategory, type SkillInfo } from '../../../shared/skills/types';
import type { ThinkingToolDef } from '../../../shared/tools/types';

// Re-export registry functions for renderer use
export { getAllToolInfos, getToolInfosByCategory, getTool, getSlashCommands } from '../../../shared/tools/registry';

/**
 * Skills are loaded from disk in the main process (#625). The renderer learns
 * about them via `api.skills.list()` and registers their metadata here so the
 * tool panel, command palette and slash commands treat them like any other
 * tool. The build* closures live in main and run at prepare/execute time — the
 * renderer never invokes them, so these stubs are never called.
 */
export function skillInfoToToolDef(info: SkillInfo): ThinkingToolDef {
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
    buildPrompt: () => '', // never invoked in the renderer
  };
}

const registeredSkillIds = new Set<string>();

/** Replace the previously-registered skill infos with a fresh set. Hardcoded
 *  tools (registered via the static import above) are left untouched. */
export function registerSkillInfos(infos: SkillInfo[]): void {
  for (const id of registeredSkillIds) unregisterTool(id);
  registeredSkillIds.clear();
  for (const info of infos) {
    registerTool(skillInfoToToolDef(info));
    registeredSkillIds.add(info.id);
  }
}
