/**
 * @vitest-environment jsdom
 *
 * Command palette helpers (#463) — scoring + accelerator
 * formatting + recent-list persistence. The recent-list assertions
 * need jsdom's localStorage; the rest of the suite is environment-
 * agnostic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  scoreCommand,
  firstLetterMatch,
  camelCaseMatch,
  fuzzyMatch,
} from '../../src/renderer/lib/command-palette/scoring';
import { formatAccelerator } from '../../src/renderer/lib/command-palette/format-accelerator';
import { loadRecent, recordRecent } from '../../src/renderer/lib/command-palette/recent';

// Replace the jsdom localStorage with a clean in-memory backing store
// so we don't fight whatever partial stub the renderer harness sets
// up. The recent-list logic only uses get/set/removeItem.
function installFakeLocalStorage() {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
}
installFakeLocalStorage();

describe('scoreCommand', () => {
  it('returns 100 for an exact substring match of the title', () => {
    expect(scoreCommand('New Note', 'File', 'new')).toBe(100);
    expect(scoreCommand('Toggle Sidebar', 'View', 'side')).toBe(100);
  });

  it('beats title-substring against category-substring', () => {
    expect(scoreCommand('New Note', 'File', 'fil')).toBe(80);
  });

  it('first-letter match scores 90 ("nn" → "New Note")', () => {
    expect(scoreCommand('New Note', 'File', 'nn')).toBe(90);
  });

  it('camelCase match scores 85', () => {
    expect(scoreCommand('AutoLinkInbound', 'Refactor', 'ali')).toBe(85);
  });

  it('returns 0 for no match', () => {
    expect(scoreCommand('New Note', 'File', 'xyz')).toBe(0);
  });

  it('treats empty query as a pass-through (1)', () => {
    expect(scoreCommand('Anything', 'Any', '')).toBe(1);
  });

  it('honours stopwords in first-letter match', () => {
    // "Toggle the Sidebar" → words ['Toggle', 'Sidebar'] after
    // dropping "the".  "ts" should match.
    expect(firstLetterMatch('Toggle the Sidebar', 'ts')).toBe(true);
  });
});

describe('fuzzyMatch', () => {
  it('matches scattered characters in order', () => {
    expect(fuzzyMatch('toggle sidebar', 'tsb')).toBe(true);
  });
  it('fails when chars are out of order', () => {
    expect(fuzzyMatch('toggle sidebar', 'bts')).toBe(false);
  });
  it('matches empty query trivially', () => {
    expect(fuzzyMatch('anything', '')).toBe(true);
  });
});

describe('camelCaseMatch', () => {
  it('matches against capital-letter peaks', () => {
    expect(camelCaseMatch('AutoLinkInbound', 'ali')).toBe(true);
    expect(camelCaseMatch('AutoLinkInbound', 'aln')).toBe(false);
  });
});

describe('formatAccelerator', () => {
  it('formats macOS modifiers as glyphs', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+P', true)).toBe('⌘ ⇧ P');
    expect(formatAccelerator('Cmd+S', true)).toBe('⌘ S');
    expect(formatAccelerator('Alt+Up', true)).toBe('⌥ ↑');
  });
  it('formats non-mac modifiers as words', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+P', false)).toBe('Ctrl Shift P');
    expect(formatAccelerator('Cmd+S', false)).toBe('Ctrl S');
  });
  it('normalises arrow / enter / esc keys to glyphs', () => {
    expect(formatAccelerator('CmdOrCtrl+Return', true)).toBe('⌘ ↵');
    expect(formatAccelerator('Escape', true)).toBe('Esc');
  });
  it('returns empty string for empty input', () => {
    expect(formatAccelerator('', true)).toBe('');
  });
  it('passes unknown final keys through with case preserved when long', () => {
    expect(formatAccelerator('CmdOrCtrl+F1', true)).toBe('⌘ F1');
  });
});

describe('recent commands', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty when nothing is stored', () => {
    expect(loadRecent()).toEqual([]);
  });

  it('records most-recent-first, deduped', () => {
    expect(recordRecent('a')).toEqual(['a']);
    expect(recordRecent('b')).toEqual(['b', 'a']);
    expect(recordRecent('a')).toEqual(['a', 'b']);  // dedupe + move-to-front
  });

  it('caps at 10 entries', () => {
    for (let i = 0; i < 15; i++) recordRecent(`cmd-${i}`);
    const recent = loadRecent();
    expect(recent).toHaveLength(10);
    // Newest at front.
    expect(recent[0]).toBe('cmd-14');
  });

  it('tolerates malformed storage by returning []', () => {
    localStorage.setItem('minerva.commandPalette.recent', 'not json');
    expect(loadRecent()).toEqual([]);
  });

  it('tolerates non-array stored value by returning []', () => {
    localStorage.setItem('minerva.commandPalette.recent', JSON.stringify({ foo: 'bar' }));
    expect(loadRecent()).toEqual([]);
  });
});
