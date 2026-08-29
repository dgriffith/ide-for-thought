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
import { applyMenuConfig } from '../../shared/skills/menu-config';
import { getMenuConfig, loadMenuConfig } from './menu-config-store';
import { logger } from '../../shared/logger';

const registeredSkillIds = new Set<string>();

function applyCatalog(catalog: SkillCatalog): void {
  // Drop the previously-registered skills (never hardcoded tools), then add
  // the fresh set. Safe to run repeatedly.
  for (const id of registeredSkillIds) unregisterTool(id);
  registeredSkillIds.clear();
  // Honor the per-machine menu config: disabled skills are skipped entirely
  // (off the menu, palette and slash), menu overrides change their category,
  // and the configured order becomes the registration order.
  const live = applyMenuConfig(catalog.skills, getMenuConfig());
  for (const skill of live) {
    registerTool(compileSkill(skill));
    registeredSkillIds.add(skill.id);
  }
  if (catalog.errors.length > 0) {
    for (const err of catalog.errors) {
      logger('skills').warn(`${err.source}:${err.label} — ${err.message} (${err.filePath})`);
    }
  }
}

/** Load (cached) and register skills. Call once during app startup, before
 *  menus are built. */
export async function registerSkillsAtStartup(): Promise<SkillCatalog> {
  await loadMenuConfig();
  const catalog = await getSkillCatalog();
  applyCatalog(catalog);
  return catalog;
}

/** Re-apply the current catalog with the current (already-loaded) menu config.
 *  Call after the config changes so the registry and menus reflect it. */
export function reapplyMenuConfig(catalog: SkillCatalog): void {
  applyCatalog(catalog);
}

/** Re-scan skill files and re-sync the registry. Returns the fresh catalog so
 *  the caller can rebuild the menu. */
export async function reloadAndRegisterSkills(): Promise<SkillCatalog> {
  const catalog = await reloadSkillCatalog();
  applyCatalog(catalog);
  return catalog;
}
