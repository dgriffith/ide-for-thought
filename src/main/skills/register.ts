/**
 * Registers compiled skills into the shared tool registry in the main process
 * (#625), so the executor (`getTool`) and the dynamic menus pick them up
 * alongside the hardcoded tools. Tracks which ids it added so a reload can
 * cleanly replace the previous set without disturbing hardcoded tools.
 */

import { registerTool, unregisterTool } from '../../shared/tools/registry';
import { compileSkill } from './compile';
import { getSkillCatalog, reloadSkillCatalog } from './loader';
import type { SkillCatalog } from '../../shared/skills/types';

const registeredSkillIds = new Set<string>();

function applyCatalog(catalog: SkillCatalog): void {
  // Drop the previously-registered skills (never hardcoded tools), then add
  // the fresh set. Safe to run repeatedly.
  for (const id of registeredSkillIds) unregisterTool(id);
  registeredSkillIds.clear();
  for (const skill of catalog.skills) {
    registerTool(compileSkill(skill));
    registeredSkillIds.add(skill.id);
  }
  if (catalog.errors.length > 0) {
    for (const err of catalog.errors) {
      console.warn(`[skills] ${err.source}:${err.label} — ${err.message} (${err.filePath})`);
    }
  }
}

/** Load (cached) and register skills. Call once during app startup, before
 *  menus are built. */
export async function registerSkillsAtStartup(): Promise<SkillCatalog> {
  const catalog = await getSkillCatalog();
  applyCatalog(catalog);
  return catalog;
}

/** Re-scan skill files and re-sync the registry. Returns the fresh catalog so
 *  the caller can rebuild the menu. */
export async function reloadAndRegisterSkills(): Promise<SkillCatalog> {
  const catalog = await reloadSkillCatalog();
  applyCatalog(catalog);
  return catalog;
}
