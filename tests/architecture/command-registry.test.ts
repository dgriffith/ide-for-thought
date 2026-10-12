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
 * - **No two commands share a key.** Menu accelerators, the window keymap and
 *   the editor's CodeMirror keys are compared in one namespace (`Mod-k` is
 *   `CmdOrCtrl+K`). The pre-existing clashes are #2758; that list may only
 *   shrink.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { COMMANDS } from '../../src/shared/commands';
import { KEYMAP } from '../../src/renderer/lib/keymap/handle-keydown';

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

  it('every window-keymap row names a command that declares a key', () => {
    const keyless = KEYMAP.filter((r) => !('key' in COMMANDS.find((c) => c.id === r.command)!)).map((r) => r.command);
    expect(keyless).toEqual([]);
  });

  it('no two commands share a key, beyond the known clashes (#2758)', () => {
    // Pre-existing; #2758 decides who keeps each key. May only shrink.
    const KNOWN_KEY_CLASHES = [
      'mod+shift+w: file.closeProject, view.closeGroup',
      'mod+shift+v: edit.dictate, editor.dictate',
      'b+mod: view.toggleSidebar, editor.toggleBold',
      'i+mod+shift: research.ingestUrl, learning.openConversation',
      'k+mod: view.commandPalette, editor.insertLink',
    ];
    const ALIASES: Record<string, string> = { CmdOrCtrl: 'mod', Mod: 'mod' };
    const norm = (key: string, sep: string) =>
      key.split(sep).map((t) => ALIASES[t] ?? t.toLowerCase()).sort().join('+');
    const byKey = new Map<string, string[]>();
    for (const c of COMMANDS) {
      const keys: string[] = [];
      if ('key' in c) keys.push(norm(c.key, '+'));
      if ('editor' in c && 'key' in c.editor) keys.push(norm(c.editor.key, '-'));
      for (const k of keys) byKey.set(k, [...(byKey.get(k) ?? []), c.id]);
    }
    const clashes = [...byKey].filter(([, ids]) => ids.length > 1).map(([k, ids]) => `${k}: ${ids.join(', ')}`);
    expect(clashes.sort()).toEqual([...KNOWN_KEY_CLASHES].sort());
  });
});
