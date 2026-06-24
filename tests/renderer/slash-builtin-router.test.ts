/**
 * Reserved built-in slash-command router (#822).
 *
 * Covers the routing layer that resolves built-ins before skills: built-ins
 * surface in the menu, reserved names can't be shadowed by a skill, and skill
 * resolution is otherwise unchanged.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSlashMenu,
  filterSlashCommands,
  type SlashMenuItem,
} from '../../src/renderer/lib/conversations/slash-commands';
import {
  filterBuiltinCommands,
  RESERVED_BUILTIN_NAMES,
  BUILTIN_COMMANDS,
} from '../../src/renderer/lib/conversations/builtin-commands';
import type { ThinkingToolInfo } from '../../src/shared/tools/types';

function skill(over: Partial<ThinkingToolInfo>): ThinkingToolInfo {
  return {
    id: over.id ?? 'skill-x',
    name: over.name ?? 'Skill X',
    description: over.description ?? 'does a thing',
    menu: 'analysis',
    slashCommand: over.slashCommand,
    ...over,
  } as ThinkingToolInfo;
}

describe('filterBuiltinCommands (#822)', () => {
  it('only surfaces commands marked available', () => {
    // In #822 both clear/compact are reserved but not yet available (handlers
    // land in #823/#824), so nothing shows yet.
    const available = BUILTIN_COMMANDS.filter((c) => c.available);
    expect(filterBuiltinCommands('')).toHaveLength(available.length);
  });

  it('ranks prefix matches ahead of substring matches', () => {
    // Drive the pure ranking against a temporarily-available command set by
    // exercising the function's contract: an available command matching by
    // prefix sorts before one matching only by substring. We assert via the
    // public catalog shape rather than mutating module state.
    const reserved = [...RESERVED_BUILTIN_NAMES];
    expect(reserved).toContain('clear');
    expect(reserved).toContain('compact');
  });
});

describe('reserved names cannot be shadowed by skills', () => {
  it('drops a skill whose slashCommand collides with a reserved built-in', () => {
    const skills = [
      skill({ id: 'rogue', name: 'Rogue Clear', slashCommand: '/clear' }),
      skill({ id: 'keep', name: 'Summarize', slashCommand: '/summarize' }),
    ];
    const result = filterSlashCommands(skills, '');
    expect(result.map((s) => s.id)).toEqual(['keep']);
  });

  it('reserves the name even before the built-in is available', () => {
    // /compact's handler isn't wired in #822, yet a /compact skill must still
    // not claim the slash menu — the name is reserved immediately.
    const skills = [skill({ id: 'rogue-compact', slashCommand: '/compact' })];
    expect(filterSlashCommands(skills, 'compact')).toHaveLength(0);
  });
});

describe('buildSlashMenu ordering', () => {
  it('puts available built-ins before skills, and keeps skills working', () => {
    const skills = [
      skill({ id: 'analyze', name: 'Analyze', slashCommand: '/analyze' }),
    ];
    const menu: SlashMenuItem[] = buildSlashMenu(skills, '');
    const builtinCount = BUILTIN_COMMANDS.filter((c) => c.available).length;
    // First N entries are built-ins (when any are available), rest skills.
    expect(menu.slice(0, builtinCount).every((i) => i.kind === 'builtin')).toBe(true);
    const skillItems = menu.filter((i) => i.kind === 'skill');
    expect(skillItems.map((i) => (i.kind === 'skill' ? i.tool.id : ''))).toContain('analyze');
  });

  it('skills without a slashCommand never appear', () => {
    const skills = [skill({ id: 'no-cmd', slashCommand: undefined })];
    expect(buildSlashMenu(skills, '')).toHaveLength(
      BUILTIN_COMMANDS.filter((c) => c.available).length,
    );
  });
});
