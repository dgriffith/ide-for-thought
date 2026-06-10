import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import { rebuildMenu } from '../menu';
import { executeTool, prepareConversationTool } from '../tools/executor';
import { getSkillCatalog } from '../skills/loader';
import { reloadAndRegisterSkills, reapplyMenuConfig } from '../skills/register';
import { pickAndImportSkill, removeUserSkill, revealSkillsFolder, type ImportedSkill } from '../skills/manage';
import { getMenuConfig, saveMenuConfig } from '../skills/menu-config-store';
import { toSkillInfo, type SkillCatalogInfo } from '../../shared/skills/types';
import type { MenuConfig } from '../../shared/skills/menu-config';
import { getSettings, saveSettings } from '../llm/settings';
import type { ToolExecutionRequest, LLMSettings } from '../../shared/tools/types';
import { winFromEvent } from './helpers';

export function registerTools(): void {
  // Tools for Thought
  const activeAbortControllers = new Map<number, AbortController>();

  ipcMain.handle(Channels.TOOL_EXECUTE, async (e, request: ToolExecutionRequest) => {
    const win = winFromEvent(e);
    const controller = new AbortController();
    activeAbortControllers.set(win.id, controller);

    try {
      const result = await executeTool(
        request,
        (chunk: string) => {
          if (!win.isDestroyed()) {
            win.webContents.send(Channels.TOOL_STREAM, chunk);
          }
        },
        controller.signal,
      );
      return result;
    } finally {
      activeAbortControllers.delete(win.id);
    }
  });

  ipcMain.handle(Channels.TOOL_CANCEL, (e) => {
    const win = winFromEvent(e);
    const controller = activeAbortControllers.get(win.id);
    if (controller) {
      controller.abort();
      activeAbortControllers.delete(win.id);
    }
  });

  ipcMain.handle(Channels.TOOL_PREPARE_CONVERSATION, (_e, request: ToolExecutionRequest) =>
    prepareConversationTool(request));

  // Skills (#622). Returns serializable metadata only — prompt bodies stay in
  // main and are rendered at prepare/execute time (Phase 3).
  ipcMain.handle(Channels.SKILLS_LIST, async (): Promise<SkillCatalogInfo> => {
    const cat = await getSkillCatalog();
    return { skills: cat.skills.map(toSkillInfo), errors: cat.errors, config: getMenuConfig() };
  });
  ipcMain.handle(Channels.SKILLS_RELOAD, async (): Promise<SkillCatalogInfo> => {
    // Re-scan files, re-sync the registry, and rebuild the menu so newly
    // added/removed skills appear without a restart.
    const cat = await reloadAndRegisterSkills();
    rebuildMenu();
    return { skills: cat.skills.map(toSkillInfo), errors: cat.errors, config: getMenuConfig() };
  });
  ipcMain.handle(Channels.SKILLS_MENU_CONFIG_SET, async (_e, config: MenuConfig): Promise<MenuConfig> => {
    // Persist, re-sync the registry under the new config (disabled skills
    // drop out, overrides re-home, order changes), then rebuild the native
    // menu. The renderer re-applies the same config to its own registry.
    const saved = await saveMenuConfig(config);
    reapplyMenuConfig(await getSkillCatalog());
    rebuildMenu();
    return saved;
  });
  ipcMain.handle(Channels.SKILLS_IMPORT, async (e): Promise<ImportedSkill | null> => {
    const win = winFromEvent(e);
    const imported = await pickAndImportSkill(win);
    if (imported) {
      await reloadAndRegisterSkills();
      rebuildMenu();
    }
    return imported;
  });
  ipcMain.handle(Channels.SKILLS_REMOVE, async (_e, id: string): Promise<void> => {
    await removeUserSkill(id);
    await reloadAndRegisterSkills();
    rebuildMenu();
  });
  ipcMain.handle(Channels.SKILLS_REVEAL, async (): Promise<void> => {
    await revealSkillsFolder();
  });

  ipcMain.handle(Channels.TOOL_GET_SETTINGS, () => getSettings());

  ipcMain.handle(Channels.TOOL_SET_SETTINGS, (_e, settings: LLMSettings) => saveSettings(settings));
}
