/**
 * @vitest-environment node
 *
 * The app's commands come from one registry (#2625, epic #2622):
 * `src/shared/commands.ts` declares each command once, the menu bar places
 * them by id, the palette lists them, and the renderer runs them from one
 * `Record<CommandId, …>` action table.
 *
 * The type system holds most of that — an undeclared id doesn't compile in
 * `command('…')`, and a declared command without an action doesn't compile in
 * the action table. This holds the two halves it can't see:
 *
 * - **No argument-free `send()` in the menu.** A menu item that sends a
 *   channel with no payload is a command that went around the registry: a
 *   second action, which the palette can't list and the action table can't
 *   test. Items with a payload (a theme mode, a recent path, an exporter, a
 *   stock query, a skill) stay channels.
 * - **Every command with a menu shape is placed.** A `menu` entry nothing
 *   places is a declaration that has quietly stopped being true.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { COMMANDS } from '../../src/shared/commands';

const ROOT = path.resolve(__dirname, '..', '..');
const menuSource = () => fs.readFileSync(path.join(ROOT, 'src', 'main', 'menu.ts'), 'utf-8');

describe('commands come from the registry (#2625)', () => {
  it('the menu sends no argument-free channel — those are registered commands', () => {
    const bare = [...menuSource().matchAll(/send\(Channels\.(\w+)\)/g)].map((m) => m[1]);
    expect(bare, 'declare it in src/shared/commands.ts and place it with command(id)').toEqual([]);
  });

  it('every command with a menu shape is placed in the menu bar', () => {
    const src = menuSource();
    const unplaced = COMMANDS
      .filter((c) => 'menu' in c)
      .map((c) => c.id)
      .filter((id) => !src.includes(`command('${id}'`));
    expect(unplaced, 'place it in menu.ts, or drop its `menu` entry').toEqual([]);
  });

  it('ids are unique', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});
