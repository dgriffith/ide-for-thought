/**
 * Per-machine menu configuration (#630, part of #622).
 *
 * Skills declare a home menu (Learning / Research / Analysis) in their
 * frontmatter, but the user can, per machine, override three things:
 *
 *   - **enabled**: hide a skill from every surface (menu, palette, slash)
 *     without deleting its file. Stock skills can't be removed, so this is
 *     how you turn one off.
 *   - **menu**: move a skill into a different one of the fixed three.
 *   - **order**: arrange skills within a menu.
 *
 * The config is persisted as `~/.minerva/menu-config.json` (load/save live in
 * the main process — see src/main/skills/menu-config-store.ts). Everything in
 * this module is pure so both main (native menu + registry) and the renderer
 * (palette / slash / settings UI) apply identical rules.
 *
 * Defaults are implicit: a skill with no entry is enabled, in its declared
 * menu, appended after any explicitly-ordered skills. So a fresh install needs
 * no config file, and newly-added skills slot in sensibly.
 */

import { type SkillMenu, SKILL_MENUS } from './types';
import type { MenuConfig, MenuItemLike, SkillSetting } from './types';

// The config type shapes moved to the leaf `types.ts` to break the type-only
// cycle (#1091); re-exported here so existing `from './menu-config'` importers
// keep working unchanged.
export type { MenuConfig, MenuItemLike, SkillSetting } from './types';

export function emptyMenuConfig(): MenuConfig {
  return {
    skills: {},
    order: { Learning: [], Research: [], Analysis: [] },
  };
}

/** Coerce arbitrary parsed JSON into a valid MenuConfig, dropping junk. */
export function normalizeMenuConfig(raw: unknown): MenuConfig {
  const out = emptyMenuConfig();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;

  if (r.skills && typeof r.skills === 'object') {
    for (const [id, v] of Object.entries(r.skills as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const s = v as Record<string, unknown>;
      const menu = SKILL_MENUS.includes(s.menu as SkillMenu) ? (s.menu as SkillMenu) : undefined;
      // A setting is meaningful only if it carries an enabled flag or a valid
      // menu override; otherwise it's noise and the defaults already cover it.
      if (typeof s.enabled !== 'boolean' && !menu) continue;
      out.skills[id] = {
        enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
        menu: menu ?? 'Learning',
      };
      // If no valid menu was given, leave the override off by reusing the
      // declared menu at apply time — represented by deleting the menu hint.
      if (!menu) delete (out.skills[id] as Partial<SkillSetting>).menu;
    }
  }

  if (r.order && typeof r.order === 'object') {
    const ord = r.order as Record<string, unknown>;
    for (const menu of SKILL_MENUS) {
      const arr = ord[menu];
      if (Array.isArray(arr)) {
        out.order[menu] = arr.filter((x): x is string => typeof x === 'string');
      }
    }
  }

  return out;
}

export function isSkillEnabled(id: string, config: MenuConfig): boolean {
  return config.skills[id]?.enabled ?? true;
}

/** The menu a skill effectively lives in, honoring any override. */
export function effectiveMenu(item: MenuItemLike, config: MenuConfig): SkillMenu {
  return config.skills[item.id]?.menu ?? item.menu;
}

/**
 * All items whose effective menu is `menu`, in configured order, with their
 * `menu` field rewritten to the effective value. Pass `includeDisabled` for the
 * settings UI (which must show toggled-off skills); leave it false for the
 * functional surfaces (menu / palette / slash).
 *
 * Order: explicitly-ordered ids first (by their array position), then the
 * menu's *native* unlisted skills (declared here, catalog order), then skills
 * *moved in* via an override (appended, per #630's default). Ties preserve
 * catalog order — JS sort is stable.
 */
export function skillsForMenu<T extends MenuItemLike>(
  items: T[],
  config: MenuConfig,
  menu: SkillMenu,
  includeDisabled = false,
): T[] {
  const order = config.order[menu] ?? [];
  const matched = items.filter(
    (it) =>
      effectiveMenu(it, config) === menu &&
      (includeDisabled || isSkillEnabled(it.id, config)),
  );
  // rank tuple: [tier, sub] — lower sorts first.
  const rank = (it: MenuItemLike): [number, number] => {
    const i = order.indexOf(it.id);
    if (i !== -1) return [0, i]; // user placed it explicitly
    return [1, it.menu === menu ? 0 : 1]; // native before moved-in
  };
  return [...matched]
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1];
    })
    .map((it) => ({ ...it, menu }));
}

/**
 * Flat list of enabled skills across all three menus, each with its effective
 * menu, grouped Learning → Research → Analysis and ordered within. This is the
 * registration order for both the main and renderer tool registries.
 */
export function applyMenuConfig<T extends MenuItemLike>(items: T[], config: MenuConfig): T[] {
  return SKILL_MENUS.flatMap((menu) => skillsForMenu(items, config, menu, false));
}
