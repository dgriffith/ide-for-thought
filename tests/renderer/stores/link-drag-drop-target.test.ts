/**
 * @vitest-environment jsdom
 *
 * A pointer drag of a note (`link-drag`, #1129) that ends over a plugin view
 * — not an editor — is handed to it (#2827): the view's host carries
 * `data-note-drop-target` and receives NOTE_DROP_EVENT with the note.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getLinkDrag, NOTE_DROP_EVENT, type NoteDropDetail } from '../../../src/renderer/lib/stores/link-drag.svelte';

const pointer = (type: string, x: number, y: number) =>
  window.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y, button: 0 }));

afterEach(() => { document.body.innerHTML = ''; });

function dragNoteTo(over: Element | null, item = { kind: 'note' as const, path: 'notes/a.md', label: 'A' }) {
  document.elementFromPoint = () => over;
  getLinkDrag().start(item, Object.assign(new Event('pointerdown'), { clientX: 0, clientY: 0, button: 0 }) as PointerEvent);
  pointer('pointermove', 40, 40);
  pointer('pointerup', 40, 40);
}

describe('link-drag hands a note to a drop target (#2827)', () => {
  it('dispatches the note to the target under the pointer', () => {
    const target = document.createElement('div');
    target.dataset.noteDropTarget = '';
    const inner = document.createElement('span');
    target.append(inner);
    document.body.append(target);
    const got: NoteDropDetail[] = [];
    target.addEventListener(NOTE_DROP_EVENT, (e) => got.push((e as CustomEvent<NoteDropDetail>).detail));
    dragNoteTo(inner);
    expect(got).toEqual([{ paths: ['notes/a.md'], clientX: 40, clientY: 40 }]);
  });

  it('does nothing over anything else, or for a source', () => {
    const target = document.createElement('div');
    target.dataset.noteDropTarget = '';
    document.body.append(target);
    const got: unknown[] = [];
    target.addEventListener(NOTE_DROP_EVENT, (e) => got.push(e));
    dragNoteTo(document.body);
    dragNoteTo(target, { kind: 'source', sourceId: 's1', label: 'S' } as never);
    expect(got).toEqual([]);
  });
});
