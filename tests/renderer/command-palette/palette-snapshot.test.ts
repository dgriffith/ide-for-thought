/**
 * The command palette's whole list, pinned (#2625): every command's id, title,
 * category, shortcut, enablement (nothing open, and everything open), and
 * which action it runs. Taken before the palette moved onto the command
 * registry, so a refactor that changes any of it shows up as a snapshot diff.
 */
import { describe, it, expect } from 'vitest';
import { buildCommandRegistry, type CommandDeps } from '../../../src/renderer/lib/command-palette/registry';

const PREDICATES = new Set(['hasProject', 'hasNote', 'hasActiveNoteTab', 'canGoBack', 'canGoForward']);

/** Deps whose predicates all answer `open`, and whose actions record their name. */
function deps(open: boolean, ran: string[]): CommandDeps {
  return new Proxy({} as CommandDeps, {
    get: (_t, key: string) => {
      if (PREDICATES.has(key)) return () => open;
      if (key === 'currentTheme') return () => 'dark';
      return (...args: unknown[]) => { ran.push(args.length ? `${key}(${args.map((a) => JSON.stringify(a)).join(', ')})` : key); };
    },
  });
}

function describePalette(open: boolean): string {
  const ran: string[] = [];
  return buildCommandRegistry(deps(open, ran)).map((c) => {
    ran.length = 0;
    void c.run();
    return `${c.id} | ${c.title} | ${c.category} | ${c.keybinding ?? '-'} | ${c.enabled ? 'enabled' : 'disabled'} → ${ran.join('; ')}`;
  }).join('\n');
}

describe('the command palette (#2625)', () => {
  it('with nothing open', () => {
    expect(describePalette(false)).toMatchSnapshot();
  });
  it('with a thoughtbase, a note tab and history both ways', () => {
    expect(describePalette(true)).toMatchSnapshot();
  });
});
