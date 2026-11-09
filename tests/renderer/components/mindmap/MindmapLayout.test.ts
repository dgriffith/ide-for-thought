/**
 * @vitest-environment jsdom
 *
 * The Mindmap layout (#2966): a type's notes under the view's root by their
 * parent property; a click and a right-click handed to the view (its
 * selection and note menu), Enter opening; and in a tab, Tab making a child
 * note, a drag reparenting (the selection with it), ⌘[ to the top, F2
 * renaming, ⌘Z undoing — none of it in an embed.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

const ops = vi.hoisted(() => ({
  createChildNote: vi.fn(async () => 'New.md'), reparentNotes: vi.fn(async () => ['x']), undoReparent: vi.fn(async () => []), renameNoteTo: vi.fn(async () => 'Renamed.md'),
}));
vi.mock('../../../../src/renderer/lib/app/mindmap-notes', () => ops);
vi.mock('../../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: () => {} }));
vi.mock('../../../../src/renderer/lib/stores/object-types.svelte', () => ({ objectTypesStore: { types: [] } }));
import MindmapLayout from '../../../../src/renderer/lib/components/type-view/MindmapLayout.svelte';
import type { LayoutView } from '../../../../src/renderer/lib/components/type-view/layout-view';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
beforeEach(() => { for (const f of Object.values(ops)) f.mockClear(); try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => cleanup());

const PARENT = { name: 'parent', type: 'link-to-type', targetType: 'task', label: 'Parent' };
const row = (path: string, parent: string | null) => ({ path, title: path.replace('.md', ''), values: { parent }, cover: null });
const ROWS = [row('Launch.md', null), row('Build.md', 'Launch.md'), row('Market.md', 'Launch.md'), row('Code.md', 'Build.md')];

function fakeView(over: Partial<LayoutView> = {}): LayoutView {
  return {
    type: { id: 'task', label: 'Task', classLocalName: 'Task', properties: [PARENT], source: 'thoughtbase' },
    properties: [PARENT], sorted: ROWS, instances: ROWS,
    linkPath: (_p: unknown, v: string | null) => v, isSelected: (p: string) => p === 'Build.md' || p === 'Market.md',
    onRowClick: vi.fn(), onRowContextMenu: vi.fn(), onOpenNote: vi.fn(), readOnly: false, rowMenu: true,
    ...over,
  } as unknown as LayoutView;
}
async function draw(view = fakeView()) {
  const r = render(MindmapLayout, { view });
  await waitFor(() => expect(r.container.querySelectorAll('[role="treeitem"]').length).toBe(5));
  const item = (label: string) => r.container.querySelector<SVGGElement>(`[aria-label="${label}"]`)!;
  return { ...r, item, view };
}

describe('the Mindmap layout (#2966)', () => {
  it('draws the type\'s notes under the view by their parent; the view\'s selection marked', async () => {
    const { container, item } = await draw();
    expect([...container.querySelectorAll('[role="treeitem"]')].map((e) => `${e.getAttribute('aria-level')} ${e.getAttribute('aria-label')}`))
      .toEqual(['1 Task', '2 Launch', '3 Build', '4 Code', '3 Market']);
    expect(item('Build').getAttribute('aria-selected')).toBe('true');
    expect(item('Code').getAttribute('aria-selected')).toBe('false');
  });

  it('a click and a right-click go to the view; Enter opens', async () => {
    const { item, view } = await draw();
    await fireEvent.click(item('Code'), { metaKey: true });
    await fireEvent.contextMenu(item('Market'));
    await fireEvent.keyDown(item('Launch'), { key: 'Enter' });
    expect((view.onRowClick as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toBe('Code.md');
    expect(((view.onRowClick as ReturnType<typeof vi.fn>).mock.calls[0]![0] as MouseEvent).metaKey).toBe(true);
    expect((view.onRowContextMenu as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toBe('Market.md');
  });

  it('Tab makes a child note under the node; the view\'s root makes one at the top', async () => {
    const { item } = await draw();
    await fireEvent.keyDown(item('Build'), { key: 'Tab' });
    await fireEvent.keyDown(item('Task'), { key: 'Tab' });
    expect(ops.createChildNote.mock.calls.map((c) => [(c[0] as { parent: unknown }).parent, (c[0] as { parentProperty: string }).parentProperty]))
      .toEqual([[{ path: 'Build.md', title: 'Build' }, 'parent'], [null, 'parent']]);
  });

  it('a drag onto a node reparents — the whole selection when the dragged note is in it; ⌘[ to the parent\'s parent; ⌘Z undoes', async () => {
    const { item, container } = await draw();
    const svg = container.querySelector('svg')!;
    const code = item('Code');
    code.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 60, width: 60, x: 0, y: 0, toJSON: () => ({}) });
    document.elementFromPoint = () => code;
    await fireEvent.pointerDown(item('Market'), { button: 0, clientX: 100, clientY: 100 });
    await fireEvent.pointerMove(svg, { clientX: 30, clientY: 10 });
    await fireEvent.pointerUp(svg);
    // Market is selected with Build — but Build holds Code, and nothing goes under itself.
    expect(ops.reparentNotes).not.toHaveBeenCalled();
    await fireEvent.keyDown(item('Code'), { key: '[', metaKey: true });
    expect(ops.reparentNotes).toHaveBeenLastCalledWith([{ path: 'Code.md', title: 'Code' }], 'parent', { path: 'Launch.md', title: 'Launch' });
    await fireEvent.keyDown(item('Code'), { key: 'z', metaKey: true });
    expect(ops.undoReparent).toHaveBeenCalled();
  });

  it('a drag of a note not in the selection moves just it', async () => {
    const { item, container } = await draw(fakeView({ isSelected: () => false }));
    const svg = container.querySelector('svg')!;
    const build = item('Build');
    build.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 60, width: 60, x: 0, y: 0, toJSON: () => ({}) });
    document.elementFromPoint = () => build;
    await fireEvent.pointerDown(item('Market'), { button: 0, clientX: 100, clientY: 100 });
    await fireEvent.pointerMove(svg, { clientX: 30, clientY: 10 });
    await fireEvent.pointerUp(svg);
    expect(ops.reparentNotes).toHaveBeenCalledWith([{ path: 'Market.md', title: 'Market' }], 'parent', { path: 'Build.md', title: 'Build' });
  });

  it('in an export: a still SVG of the hierarchy, folded as it\'s left, no toolbar (#2967)', async () => {
    localStorage.setItem('minerva.mindmap-view:task', JSON.stringify({ folded: ['Build.md'] }));
    const r = render(MindmapLayout, { view: fakeView({ exportMode: true, readOnly: true }) });
    const svg = await waitFor(() => { const s = r.container.querySelector('.mm-export svg'); expect(s).not.toBeNull(); return s!; });
    expect(svg.getAttribute('aria-label')).toBe('Task by Parent');
    expect([...svg.querySelectorAll('tspan')].map((t) => t.textContent)).toEqual(['Task', 'Launch', 'Build', 'Market']); // Code folded away
    expect(r.container.querySelector('[role="tree"]')).toBeNull();
    expect(r.container.textContent).not.toContain('Left to right');
  });

  it('in an embed it edits nothing', async () => {
    const { item } = await draw(fakeView({ readOnly: true }));
    await fireEvent.keyDown(item('Build'), { key: 'Tab' });
    await fireEvent.keyDown(item('Code'), { key: '[', metaKey: true });
    expect(ops.createChildNote).not.toHaveBeenCalled();
    expect(ops.reparentNotes).not.toHaveBeenCalled();
  });
});
