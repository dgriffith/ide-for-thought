import { describe, it, expect } from 'vitest';
import {
  emptyMenuConfig,
  normalizeMenuConfig,
  isSkillEnabled,
  effectiveMenu,
  skillsForMenu,
  applyMenuConfig,
  type MenuConfig,
  type MenuItemLike,
} from '../../src/shared/skills/menu-config';

const item = (id: string, menu: MenuItemLike['menu']): MenuItemLike => ({ id, menu });

const items: MenuItemLike[] = [
  item('learning.a', 'Learning'),
  item('learning.b', 'Learning'),
  item('learning.c', 'Learning'),
  item('research.x', 'Research'),
  item('analysis.z', 'Analysis'),
];

describe('defaults (no config)', () => {
  const cfg = emptyMenuConfig();

  it('treats every skill as enabled in its declared menu', () => {
    expect(isSkillEnabled('learning.a', cfg)).toBe(true);
    expect(effectiveMenu(item('learning.a', 'Learning'), cfg)).toBe('Learning');
  });

  it('keeps catalog order within a menu', () => {
    expect(skillsForMenu(items, cfg, 'Learning').map((s) => s.id)).toEqual([
      'learning.a',
      'learning.b',
      'learning.c',
    ]);
  });

  it('applyMenuConfig groups Learning → Research → Analysis', () => {
    expect(applyMenuConfig(items, cfg).map((s) => s.id)).toEqual([
      'learning.a',
      'learning.b',
      'learning.c',
      'research.x',
      'analysis.z',
    ]);
  });
});

describe('enabled flag', () => {
  it('filters disabled skills out of the functional surfaces', () => {
    const cfg: MenuConfig = {
      skills: { 'learning.b': { enabled: false, menu: 'Learning' } },
      order: emptyMenuConfig().order,
    };
    expect(isSkillEnabled('learning.b', cfg)).toBe(false);
    expect(skillsForMenu(items, cfg, 'Learning').map((s) => s.id)).toEqual([
      'learning.a',
      'learning.c',
    ]);
    expect(applyMenuConfig(items, cfg).map((s) => s.id)).not.toContain('learning.b');
  });

  it('still shows disabled skills when includeDisabled is set (settings UI)', () => {
    const cfg: MenuConfig = {
      skills: { 'learning.b': { enabled: false, menu: 'Learning' } },
      order: emptyMenuConfig().order,
    };
    expect(skillsForMenu(items, cfg, 'Learning', true).map((s) => s.id)).toEqual([
      'learning.a',
      'learning.b',
      'learning.c',
    ]);
  });
});

describe('menu override', () => {
  it('re-homes a skill and rewrites its menu field', () => {
    const cfg: MenuConfig = {
      skills: { 'learning.b': { enabled: true, menu: 'Analysis' } },
      order: emptyMenuConfig().order,
    };
    expect(effectiveMenu(item('learning.b', 'Learning'), cfg)).toBe('Analysis');
    expect(skillsForMenu(items, cfg, 'Learning').map((s) => s.id)).toEqual([
      'learning.a',
      'learning.c',
    ]);
    const moved = skillsForMenu(items, cfg, 'Analysis');
    expect(moved.map((s) => s.id)).toEqual(['analysis.z', 'learning.b']);
    expect(moved.find((s) => s.id === 'learning.b')?.menu).toBe('Analysis');
  });
});

describe('ordering', () => {
  it('honors an explicit order, appending unlisted skills', () => {
    const cfg: MenuConfig = {
      skills: {},
      order: { Learning: ['learning.c', 'learning.a'], Research: [], Analysis: [] },
    };
    expect(skillsForMenu(items, cfg, 'Learning').map((s) => s.id)).toEqual([
      'learning.c',
      'learning.a',
      'learning.b', // unlisted → appended, catalog order
    ]);
  });
});

describe('normalizeMenuConfig', () => {
  it('returns defaults for junk input', () => {
    expect(normalizeMenuConfig(null)).toEqual(emptyMenuConfig());
    expect(normalizeMenuConfig('nope')).toEqual(emptyMenuConfig());
    expect(normalizeMenuConfig(42)).toEqual(emptyMenuConfig());
  });

  it('drops invalid menus and non-string order entries', () => {
    const out = normalizeMenuConfig({
      skills: {
        good: { enabled: false, menu: 'Research' },
        badMenu: { enabled: true, menu: 'Nonsense' },
        empty: {},
      },
      order: { Learning: ['a', 5, 'b'], Bogus: ['x'] },
    });
    expect(out.skills.good).toEqual({ enabled: false, menu: 'Research' });
    // invalid menu is kept as an enabled-only override (declared menu used at apply time)
    expect(out.skills.badMenu).toEqual({ enabled: true });
    expect(out.skills.empty).toBeUndefined();
    expect(out.order.Learning).toEqual(['a', 'b']);
    expect((out.order as Record<string, unknown>).Bogus).toBeUndefined();
  });

  it('an enabled-only override leaves the declared menu intact', () => {
    const out = normalizeMenuConfig({ skills: { 'x.y': { enabled: false } } });
    expect(out.skills['x.y']).toEqual({ enabled: false });
    expect(effectiveMenu(item('x.y', 'Learning'), out)).toBe('Learning');
  });
});
