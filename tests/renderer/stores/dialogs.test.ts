/**
 * @vitest-environment jsdom
 *
 * Dialog store (#670) — the behavioral safety net for the prompt/confirm
 * primitives extracted from App.svelte. Verifies each `show*` resolves on the
 * matching resolve/cancel method, and that confirm-suppression short-circuits.
 * jsdom is needed only for the confirm-suppression store's localStorage.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getDialogStore, __resetDialogsForTests } from '../../../src/renderer/lib/stores/dialogs.svelte';
import { getConfirmSuppressionStore } from '../../../src/renderer/lib/stores/confirm-suppression.svelte';

function installFakeLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
      get length() { return store.size; },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
    },
    configurable: true,
  });
}
installFakeLocalStorage();

beforeEach(() => {
  localStorage.clear();
  getConfirmSuppressionStore().clearAll();
  __resetDialogsForTests();
});

describe('dialog store — prompt', () => {
  it('shows a prompt and resolves with the confirmed value', async () => {
    const d = getDialogStore();
    const p = d.showPrompt('Rename to?', 'old-name');
    expect(d.prompt).not.toBeNull();
    expect(d.prompt!.message).toBe('Rename to?');
    expect(d.prompt!.initial).toBe('old-name');
    d.confirmPrompt('new-name');
    expect(await p).toBe('new-name');
    expect(d.prompt).toBeNull();
  });

  it('resolves null on cancel', async () => {
    const d = getDialogStore();
    const p = d.showPrompt('Name?', { suggestions: ['a', 'b'] });
    expect(d.prompt!.suggestions).toEqual(['a', 'b']);
    d.cancelPrompt();
    expect(await p).toBeNull();
    expect(d.prompt).toBeNull();
  });
});

describe('dialog store — confirm', () => {
  it('resolves true on confirm, false on cancel', async () => {
    const d = getDialogStore();
    const p1 = d.showConfirm('Delete it?', 'delete-note', 'Delete');
    expect(d.confirm!.confirmLabel).toBe('Delete');
    d.confirmConfirm(false);
    expect(await p1).toBe(true);

    const p2 = d.showConfirm('Delete it?', 'delete-note', 'Delete');
    d.cancelConfirm();
    expect(await p2).toBe(false);
  });

  it('short-circuits to true (no dialog) when the key is suppressed', async () => {
    const d = getDialogStore();
    // First confirm with "don't ask again" suppresses the key.
    const p = d.showConfirm('Delete it?', 'delete-note', 'Delete');
    d.confirmConfirm(true);
    expect(await p).toBe(true);
    // Second call resolves immediately without opening a dialog.
    const p2 = d.showConfirm('Delete it?', 'delete-note', 'Delete');
    expect(d.confirm).toBeNull();
    expect(await p2).toBe(true);
  });

  it('does not suppress when "don\'t ask again" is unchecked', async () => {
    const d = getDialogStore();
    const p = d.showConfirm('Delete it?', 'delete-note', 'Delete');
    d.confirmConfirm(false);
    await p;
    const p2 = d.showConfirm('Delete it?', 'delete-note', 'Delete');
    expect(d.confirm).not.toBeNull(); // dialog shown again
    d.cancelConfirm();
    await p2;
  });
});

describe('dialog store — snippet picker & open-target', () => {
  it('snippet picker resolves with the picked template, null on cancel', async () => {
    const d = getDialogStore();
    const tpl = { name: 'Daily', path: 'templates/daily.md' } as never;
    const p = d.showSnippetPicker([tpl]);
    expect(d.snippet!.templates).toHaveLength(1);
    d.pickSnippet(tpl);
    expect(await p).toBe(tpl);

    const p2 = d.showSnippetPicker([tpl]);
    d.cancelSnippet();
    expect(await p2).toBeNull();
  });

  it('open-target resolves with each choice', async () => {
    const d = getDialogStore();
    for (const choice of ['this', 'new', 'cancel'] as const) {
      const p = d.askOpenTarget('Open where?');
      expect(d.openTarget).not.toBeNull();
      d.resolveOpenTarget(choice);
      expect(await p).toBe(choice);
      expect(d.openTarget).toBeNull();
    }
  });
});
