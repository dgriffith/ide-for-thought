/**
 * Ctrl+Alt is AltGr off macOS (#2986): no shortcut Minerva or a built-in
 * plugin has there may catch the characters AltGr types.
 */
import { describe, it, expect } from 'vitest';
import { capturesAltGr } from '../../src/shared/altgr';
import { COMMANDS, commandKey } from '../../src/shared/commands';
import { corePlugins } from '../../src/main/plugins/core';

describe('capturesAltGr', () => {
  it('Ctrl+Alt with a key that types, with or without Shift, in any spelling', () => {
    for (const a of ['CmdOrCtrl+Alt+Q', 'Ctrl+Alt+e', 'Alt+CommandOrControl+7', 'CmdOrCtrl+Alt+Shift+S', 'Control+Option+[', 'CmdOrCtrl+Alt+Plus', 'CmdOrCtrl+Alt++']) {
      expect(capturesAltGr(a), a).toBe(true);
    }
  });

  it('not without both modifiers, nor with a key that types nothing', () => {
    for (const a of ['CmdOrCtrl+Q', 'Alt+Q', 'CmdOrCtrl+Shift+Q', 'CmdOrCtrl+Alt+Left', 'CmdOrCtrl+Alt+F4', 'CmdOrCtrl+Alt+Delete']) {
      expect(capturesAltGr(a), a).toBe(false);
    }
  });
});

describe('Minerva\'s own keys off macOS', () => {
  it('no command\'s key on Windows and Linux catches AltGr', () => {
    const offending = COMMANDS.flatMap((c) => {
      const key = commandKey(c, false);
      return key && capturesAltGr(key) ? [`${c.id}: ${key}`] : [];
    });
    expect(offending).toEqual([]);
  });

  it('no editor key does either (CodeMirror spells Ctrl+Alt Mod-Alt)', () => {
    const offending = COMMANDS.flatMap((c) => {
      const key = 'editor' in c && 'key' in c.editor ? c.editor.key : undefined;
      return key && capturesAltGr(key.replace(/Mod/g, 'Ctrl').replace(/-/g, '+')) ? [`${c.id}: ${key}`] : [];
    });
    expect(offending).toEqual([]);
  });

  it('macOS keeps its keys: keyOffMac only changes the other platforms', () => {
    const sidebar = COMMANDS.find((c) => c.id === 'view.toggleSidebar')!;
    expect(commandKey(sidebar, true)).toBe('CmdOrCtrl+Alt+B');
    expect(commandKey(sidebar, false)).toBe('CmdOrCtrl+Shift+E');
  });

  it('a built-in plugin\'s command keys off macOS don\'t catch AltGr either', () => {
    const offending = corePlugins().flatMap((p) => (p.manifest.code?.commands ?? []).flatMap((c) => {
      const key = c.keyOffMac ?? c.key;
      return key && capturesAltGr(key) ? [`${p.manifest.id}/${c.id}: ${key}`] : [];
    }));
    expect(offending).toEqual([]);
  });
});
