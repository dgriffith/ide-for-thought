/**
 * The feature-dialog store, extracted from App.svelte (#2236, epic #2241).
 *
 * `dialogs.svelte.ts` recorded at #670 why these ~19 flags stayed in App:
 * "Feature-specific dialogs … close over feature handlers and aren't general
 * primitives." The ops-bag pattern removed that constraint, and the flags came
 * out. What's worth testing is the small amount of behaviour that isn't a bare
 * boolean — the pairings and payloads that used to be enforced only by two
 * adjacent assignment statements in a 2,000-line component:
 *
 *   - Settings carries a tab, and closing has to clear it. In App those were
 *     two separate `$state` variables and two separate assignments in an
 *     `onClose` handler; opening Settings from a different entry point after
 *     one that passed `'ai'` would have shown the AI tab again if either
 *     assignment were ever missed.
 *   - The payload-carrying dialogs (type editor, save query, safe delete)
 *     round-trip an object, not a flag.
 *
 * This imports the real store module rather than mocking it (the exception
 * CLAUDE.md describes for testing a store's own logic), so it owns a scoped
 * reset for exactly the state it touches — module-level runes are a singleton
 * per worker.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getFeatureDialogStore } from '../../../src/renderer/lib/stores/feature-dialogs.svelte';

const d = getFeatureDialogStore();

beforeEach(() => {
  // Scoped reset — no blanket `reset()` on the store itself, per CLAUDE.md's
  // "mock the module, don't add a reset API" note (#1944).
  d.closeSettings();
  d.setOnboarding(false);
  d.setThoughtbaseProperties(false);
  d.setEditSavedViews(false);
  d.setEditSavedQueries(false);
  d.setAbout(false);
  d.setShortcuts(false);
  d.setGotoLine(false);
  d.setGotoNote(false);
  d.setCommandPalette(false);
  d.setPublish(false);
  d.setExportGroup(null);
  d.setMergePickerSource(null);
  d.setAttachEvidenceExcerptId(null);
  d.setTypeEditor(null);
  d.setSaveQuery(null);
  d.setSafeDelete(null);
  d.setFindInNotes(null);
});

describe('settings — the flag and its tab move together', () => {
  it('opens with no tab by default', () => {
    d.openSettings();
    expect(d.settings).toBe(true);
    expect(d.settingsTab).toBeUndefined();
  });

  it('opens on a requested tab', () => {
    d.openSettings('ai');
    expect(d.settings).toBe(true);
    expect(d.settingsTab).toBe('ai');
  });

  it('clears the tab on close, so the next open does not inherit it', () => {
    // The actual bug shape this prevents: App set `settingsInitialTab = 'ai'`
    // and `showSettings = true` as two statements, and cleared both in an
    // unrelated `onClose`. A later open from the menu would land on the AI tab.
    d.openSettings('ai');
    d.closeSettings();
    expect(d.settingsTab).toBeUndefined();

    d.openSettings();
    expect(d.settingsTab).toBeUndefined();
  });
});

describe('toggles', () => {
  it('gotoNote toggles both ways', () => {
    expect(d.gotoNote).toBe(false);
    d.toggleGotoNote();
    expect(d.gotoNote).toBe(true);
    d.toggleGotoNote();
    expect(d.gotoNote).toBe(false);
  });

  it('commandPalette toggles both ways', () => {
    d.toggleCommandPalette();
    expect(d.commandPalette).toBe(true);
    d.toggleCommandPalette();
    expect(d.commandPalette).toBe(false);
  });

  it('a toggle composes with an explicit set', () => {
    d.setGotoNote(true);
    d.toggleGotoNote();
    expect(d.gotoNote).toBe(false);
  });
});

describe('payload-carrying dialogs round-trip their request', () => {
  it('type editor carries the initial value and the note to promote', () => {
    const initial = { id: 'book', label: 'Book' } as never;
    d.setTypeEditor({ initial, promoteNotePath: 'notes/a.md' });
    expect(d.typeEditor).toEqual({ initial, promoteNotePath: 'notes/a.md' });
    d.setTypeEditor(null);
    expect(d.typeEditor).toBeNull();
  });

  it('save query carries its own resolve callbacks', () => {
    // The callbacks belong to whoever asked for the save (the query panel), so
    // they ride along with the request rather than being rebuilt by the host.
    let confirmed: unknown = null;
    d.setSaveQuery({
      initialName: 'My Query',
      initialScope: 'project',
      onConfirm: (args) => { confirmed = args; },
      onCancel: () => {},
    });
    d.saveQuery?.onConfirm({ name: 'Renamed', scope: 'global' });
    expect(confirmed).toEqual({ name: 'Renamed', scope: 'global' });
  });

  it('safe delete carries the deferred deletion, and it does not run on its own', () => {
    // `proceed` is the work the user is being warned about — holding it must
    // not perform it. Only the dialog's "Delete anyway" calls it.
    let ran = false;
    d.setSafeDelete({
      selectionCount: 2,
      targets: ['a.md', 'b.md'],
      blockers: [],
      proceed: () => { ran = true; },
    });
    expect(ran).toBe(false);
    expect(d.safeDelete?.targets).toEqual(['a.md', 'b.md']);

    d.safeDelete?.proceed();
    expect(ran).toBe(true);
  });

  it('nullable payloads model "closed" as null, not as an empty object', () => {
    d.setExportGroup('notes');
    expect(d.exportGroup).toBe('notes');
    d.setExportGroup(null);
    expect(d.exportGroup).toBeNull();

    d.setMergePickerSource('notes/from.md');
    expect(d.mergePickerSource).toBe('notes/from.md');
    d.setMergePickerSource(null);
    expect(d.mergePickerSource).toBeNull();

    d.setAttachEvidenceExcerptId('ex-1');
    expect(d.attachEvidenceExcerptId).toBe('ex-1');
    d.setAttachEvidenceExcerptId(null);
    expect(d.attachEvidenceExcerptId).toBeNull();
  });

  it('find-in-notes distinguishes its two modes from closed', () => {
    expect(d.findInNotes).toBeNull();
    d.setFindInNotes('find');
    expect(d.findInNotes).toBe('find');
    d.setFindInNotes('replace');
    expect(d.findInNotes).toBe('replace');
    d.setFindInNotes(null);
    expect(d.findInNotes).toBeNull();
  });
});

describe('dialogs are independent', () => {
  it('opening one leaves the others closed', () => {
    // They were 19 separate variables in App and are 19 separate runes here;
    // this pins that the refactor didn't accidentally couple any of them
    // through a shared object.
    d.setAbout(true);
    expect(d.about).toBe(true);
    expect(d.shortcuts).toBe(false);
    expect(d.publish).toBe(false);
    expect(d.settings).toBe(false);
    expect(d.gotoNote).toBe(false);
  });
});
