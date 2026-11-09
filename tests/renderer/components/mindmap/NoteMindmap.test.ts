/**
 * @vitest-environment jsdom
 *
 * A note as a mindmap (#2965), against a real CodeMirror view standing in for
 * the note's editor: each key's edit lands in the buffer as text and ⌘Z
 * undoes it; a drag reparents; a subtree's delete asks first; the editor's
 * cursor selects the node it's in and selecting a node moves the cursor; and
 * a note with frontmatter and fences keeps every byte the edit didn't touch.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history } from '@codemirror/commands';

const h = vi.hoisted(() => ({ confirm: vi.fn(async () => true), said: [] as string[] }));
vi.mock('../../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => ({ showConfirm: h.confirm }) }));
vi.mock('../../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: (m: string) => { h.said.push(m); } }));
import NoteMindmap from '../../../../src/renderer/lib/components/mindmap/NoteMindmap.svelte';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

let view: EditorView;
let r: ReturnType<typeof render>;
const text = () => view.state.doc.toString();

/** The map over an editor holding `doc`; every editor change is handed back to the map, as App does. */
async function open(doc: string, props: Record<string, unknown> = {}) {
  view = new EditorView({ state: EditorState.create({ doc, extensions: [history(), EditorView.updateListener.of((u) => { if (u.docChanged) void r?.rerender({ content: u.state.doc.toString() }); })] }), parent: document.body });
  r = render(NoteMindmap, { content: doc, title: 'Trip', stateKey: `test:${Math.random()}`, getView: () => view, beside: false, ...props });
  await waitFor(() => expect(r.container.querySelector('[role="treeitem"]')).not.toBeNull());
}
const items = () => [...r.container.querySelectorAll<SVGGElement>('[role="treeitem"]')];
const item = (label: string) => items().find((g) => g.getAttribute('aria-label') === label)!;
const key = (el: Element, k: string, mods: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(el, { key: k, ...mods });
async function typeName(name: string) {
  const input = await waitFor(() => { const i = r.container.querySelector<HTMLInputElement>('.mm-rename'); expect(i).not.toBeNull(); return i!; });
  await fireEvent.input(input, { target: { value: name } });
  await key(input, 'Enter');
  await waitFor(() => expect(r.container.querySelector('.mm-rename')).toBeNull());
}

beforeEach(() => { h.confirm.mockClear(); h.said = []; });
afterEach(() => { cleanup(); view?.destroy(); });

describe('a note as a mindmap (#2965)', () => {
  it('builds an outline from nothing by keys: Tab a child, Enter a sibling, each named in place', async () => {
    await open('');
    await key(item('Trip'), 'Tab');
    await typeName('Plan');
    expect(text()).toBe('# Plan\n');
    await key(item('Plan'), 'Tab');
    await typeName('Pack');
    await key(item('Pack'), 'Enter');
    await typeName('Book');
    await key(item('Book'), 'Tab');
    await typeName('Hotel');
    expect(text()).toBe('# Plan\n## Pack\n## Book\n### Hotel\n');
  });

  it('a new node left unnamed goes again', async () => {
    await open('# Plan\n');
    await key(item('Plan'), 'Tab');
    const input = await waitFor(() => { const i = r.container.querySelector<HTMLInputElement>('.mm-rename'); expect(i).not.toBeNull(); return i!; });
    expect(text()).toBe('# Plan\n## \n');
    await key(input, 'Escape');
    await waitFor(() => expect(text()).toBe('# Plan\n'));
  });

  it('F2 renames; Delete removes, asking first when there is a subtree; ⌘Z undoes each', async () => {
    await open('# Plan\n## Pack\n- socks\n## Book\n');
    await key(item('Book'), 'F2');
    await typeName('Bookings');
    expect(text()).toBe('# Plan\n## Pack\n- socks\n## Bookings\n');
    await key(item('Bookings'), 'z', { metaKey: true });
    expect(text()).toBe('# Plan\n## Pack\n- socks\n## Book\n');
    await key(item('socks'), 'Delete');
    expect(h.confirm).not.toHaveBeenCalled(); // a leaf just goes
    expect(text()).toBe('# Plan\n## Pack\n## Book\n');
    await key(item('Pack'), 'z', { metaKey: true });
    await key(item('Pack'), 'Delete');
    await waitFor(() => expect(text()).toBe('# Plan\n## Book\n'));
    expect(h.confirm).toHaveBeenCalledWith('Delete “Pack” and everything under it?', 'mindmap-delete-subtree', 'Delete');
  });

  it('⌘] demotes under the sibling before, ⌘[ promotes back', async () => {
    await open('# Plan\n## Pack\n## Book\n');
    await key(item('Book'), ']', { metaKey: true });
    expect(text()).toBe('# Plan\n## Pack\n### Book\n');
    await key(item('Book'), '[', { metaKey: true });
    expect(text()).toBe('# Plan\n## Pack\n## Book\n');
  });

  it('says why when an edit can\'t be made', async () => {
    await open('# Plan\n## Pack\n');
    await key(item('Pack'), ']', { metaKey: true });
    expect(h.said).toContain('There\'s nothing before it to go under.');
    expect(text()).toBe('# Plan\n## Pack\n');
  });

  it('dragging a node onto the middle of another moves it in, as its last child', async () => {
    await open('# Plan\n## Pack\n## Book\n## Go\n');
    const go = item('Go');
    const book = item('Book');
    book.getBoundingClientRect = () => ({ top: 100, bottom: 120, height: 20, left: 0, right: 80, width: 80, x: 0, y: 100, toJSON: () => ({}) });
    const svg = r.container.querySelector('svg')!;
    document.elementFromPoint = () => book;
    await fireEvent.pointerDown(go, { button: 0, clientX: 0, clientY: 0 });
    await fireEvent.pointerMove(svg, { clientX: 40, clientY: 110 });
    await fireEvent.pointerUp(svg, { clientX: 40, clientY: 110 });
    expect(text()).toBe('# Plan\n## Pack\n## Book\n### Go\n');
  });

  it('beside the editor: selecting a node moves the cursor to its line; the cursor selects its node', async () => {
    await open('# Plan\n## Pack\n- socks\n', { beside: true, cursorLine: 3 });
    await waitFor(() => expect(item('socks').getAttribute('aria-selected')).toBe('true'));
    await fireEvent.click(item('Pack'));
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe('## Pack');
  });

  it('keeps every byte the edit didn\'t touch: frontmatter, fences, directives and prose', async () => {
    const doc = '---\ntitle: Trip\n---\n\nIntro.\n\n# Plan\n\n```js\n# not a heading\n```\n\n:::note\nsomething\n:::\n\n## Pack\n';
    await open(doc);
    await key(item('Pack'), 'F2');
    await typeName('Packing');
    expect(text()).toBe(doc.replace('## Pack\n', '## Packing\n'));
  });
});
