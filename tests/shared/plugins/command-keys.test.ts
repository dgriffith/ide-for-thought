/**
 * Plugin commands' keys (#2879): one spelling for an accelerator, Minerva's
 * own keys out of reach, and between plugins the first claim kept — the rule
 * main's menu and the renderer's keymap both apply.
 */
import { describe, it, expect } from 'vitest';
import { minervaKeys, normalizeAccelerator, resolvePluginKeys } from '../../../src/shared/plugins/command-keys';

describe('normalizeAccelerator (#2879)', () => {
  it('spells modifiers one way, in one order, the key in upper case', () => {
    expect(normalizeAccelerator('Shift+Alt+CmdOrCtrl+l')).toBe('CmdOrCtrl+Alt+Shift+L');
    expect(normalizeAccelerator('Cmd+Option+b')).toBe('CmdOrCtrl+Alt+B');
    expect(normalizeAccelerator('CmdOrCtrl+F5')).toBe('CmdOrCtrl+F5');
    expect(normalizeAccelerator('CmdOrCtrl+/')).toBe('CmdOrCtrl+/');
  });
  it('refuses a key without CmdOrCtrl, an unknown modifier or key, and a repeat', () => {
    for (const bad of ['L', 'Alt+L', 'CmdOrCtrl+Super+L', 'CmdOrCtrl+Enter', 'CmdOrCtrl+', 'CmdOrCtrl+Shift+Shift+L', 'CmdOrCtrl+LL']) {
      expect(normalizeAccelerator(bad), bad).toBeNull();
    }
  });
});

describe('minervaKeys (#2879)', () => {
  it('holds its commands\' keys and the menu roles\'', () => {
    for (const k of ['CmdOrCtrl+N', 'CmdOrCtrl+S', 'CmdOrCtrl+Shift+W', 'CmdOrCtrl+B', 'CmdOrCtrl+C', 'CmdOrCtrl+Z', 'CmdOrCtrl+Q']) {
      expect(minervaKeys().has(k), k).toBe(true);
    }
    expect(minervaKeys().has('CmdOrCtrl+Alt+B')).toBe(false);
  });
});

describe('resolvePluginKeys (#2879)', () => {
  const cmd = (pluginId: string, commandId: string, key?: string) => ({ pluginId, pluginName: pluginId.toUpperCase(), commandId, title: commandId, ...(key ? { key } : {}) });
  it('the first plugin to claim a key keeps it; a later one is a conflict naming who has it', () => {
    const r = resolvePluginKeys([cmd('a', 'one', 'CmdOrCtrl+Alt+B'), cmd('b', 'two', 'Alt+CmdOrCtrl+b'), cmd('b', 'three', 'CmdOrCtrl+Alt+K'), cmd('c', 'none')]);
    expect([...r.keys]).toEqual([['a/one', 'CmdOrCtrl+Alt+B'], ['b/three', 'CmdOrCtrl+Alt+K']]);
    expect(r.conflicts).toEqual([{ pluginId: 'b', commandId: 'two', title: 'two', key: 'CmdOrCtrl+Alt+B', takenBy: 'A' }]);
  });
  it('never hands out a key Minerva uses, whatever a plugin says', () => {
    expect(resolvePluginKeys([cmd('a', 'save', 'CmdOrCtrl+S')]).keys.size).toBe(0);
  });
});
