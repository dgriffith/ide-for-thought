/**
 * @vitest-environment happy-dom
 *
 * The Graph layout (#2960), as the Graph plugin draws it: the view's notes as
 * nodes and its link properties as edges (a note outside the view muted, or
 * left out), the legend and Outside notes writing the view's own spec, and
 * the same pointer and keyboard as the other layouts — a click to the view's
 * selection, a right-click to the note menu, hover and focus to the preview —
 * plus the Table, its accessible equivalent, and the export.
 *
 * Cytoscape draws on a canvas happy-dom doesn't have: a fake records what it's
 * given and lets a test tap, right-click and hover a node.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen, within, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import Graph from '../../../plugins/graph/src/Graph.svelte';
import App from '../../../plugins/graph/src/App.svelte';
import type { PluginViewState } from '../../../plugin-api/index';
import { fakeMinerva } from '../kanban/fixtures';
import { graphViewModel, parseGraphEdges, parseGraphOutside } from '../../../src/shared/objects/graph-view';

type Handler = (evt: { target: FakeNode; originalEvent?: Partial<MouseEvent> }) => void;
interface FakeNode { id: () => string; classes: Set<string>; data: Record<string, unknown> }
const cy = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  nodes: new Map<string, { id: () => string; classes: Set<string>; data: Record<string, unknown> }>(),
  edges: [] as Array<{ data: Record<string, unknown>; classes: string[] }>,
  fit: 0,
}));
vi.mock('cytoscape', () => ({
  default: () => {
    const node = (id: string) => cy.nodes.get(id);
    const asNode = (n: FakeNode | undefined) => ({
      empty: () => !n, nonempty: () => !!n, id: () => n?.id() ?? '',
      position: () => ({ x: 0, y: 0 }),
      renderedBoundingBox: () => ({ x1: 10, y1: 20, w: 30, h: 12 }),
      toggleClass: (c: string, on: boolean) => { if (on) n?.classes.add(c); else n?.classes.delete(c); },
    });
    const core = {
      on: (event: string, _sel: string, fn: Handler) => { cy.handlers.set(event, fn); },
      batch: (fn: () => void) => fn(),
      elements: () => ({ remove: () => { cy.nodes.clear(); cy.edges = []; } }),
      add: (defs: Array<{ group: string; data: Record<string, unknown>; classes: string[] }>) => {
        for (const d of defs) {
          if (d.group === 'nodes') { const id = String(d.data['id']); cy.nodes.set(id, { id: () => id, classes: new Set(d.classes), data: d.data }); }
          else cy.edges.push({ data: d.data, classes: d.classes });
        }
      },
      nodes: () => ({ forEach: (fn: (n: ReturnType<typeof asNode>) => void) => { for (const n of cy.nodes.values()) fn(asNode(n)); } }),
      getElementById: (id: string) => asNode(node(id)),
      fit: () => { cy.fit++; }, zoom: () => 1, center: () => {}, resize: () => {}, destroy: () => {}, style: () => {},
      extent: () => ({ x1: -1000, x2: 1000, y1: -1000, y2: 1000 }),
    };
    return core;
  },
}));

beforeEach(() => {
  cy.handlers.clear(); cy.nodes.clear(); cy.edges = []; cy.fit = 0;
  vi.stubGlobal('Worker', class { onmessage = null; postMessage() {} terminate() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const PROPERTIES = [
  { name: 'status', type: 'enum', options: ['todo', 'done'] },
  { name: 'blocks', type: 'link-to-type', label: 'Blocks' },
  { name: 'parent', type: 'link-to-type', label: 'Parent' },
];
const link = (property: string, path: string, title: string) => ({ property, path, title });
const INSTANCES = [
  { path: 'a.md', title: 'Alpha', values: {}, fields: [], icon: { glyph: '✅', label: 'Task', color: '#c00' }, links: [link('blocks', 'b.md', 'Bravo'), link('parent', 'epic.md', 'The epic')] },
  { path: 'b.md', title: 'Bravo', values: {}, fields: [], icon: { glyph: '✅', label: 'Task' }, links: [link('blocks', 'c.md', 'Charlie')] },
  { path: 'c.md', title: 'Charlie', values: {}, fields: [] },
];

function viewState(over: Partial<PluginViewState> = {}): PluginViewState {
  return {
    layout: 'graph', type: { id: 'task', label: 'Task' }, properties: PROPERTIES, visible: null, instances: INSTANCES,
    sortColumn: null, sortDir: 'asc', spec: { edges: null, outside: null }, filters: [], week: { start: 1, numbers: false },
    readOnly: false, exportMode: false, selected: [], selectable: true, rowMenu: true,
    groupProperty: null, groups: [], movable: false, canUndoMove: false, lastMove: null,
    ...over,
  } as PluginViewState;
}

function draw(over: Partial<PluginViewState> = {}) {
  const api = fakeMinerva();
  const view = viewState(over);
  const model = graphViewModel(view.instances, view.properties, { edges: parseGraphEdges(view.spec['edges']), outside: parseGraphOutside(view.spec['outside']) });
  const r = render(Graph, { minerva: api.minerva, view, model });
  return { ...r, api, view };
}

const fire = (event: string, id: string, originalEvent: Partial<MouseEvent> = {}) =>
  cy.handlers.get(event)!({ target: cy.nodes.get(id) as FakeNode, originalEvent: { clientX: 50, clientY: 60, metaKey: false, ctrlKey: false, shiftKey: false, ...originalEvent } });

describe('nodes and edges (#2960)', () => {
  it("draws the view's notes, coloured by type, and the note outside it a link names, muted", () => {
    draw();
    expect([...cy.nodes.keys()]).toEqual(['a.md', 'b.md', 'c.md', 'epic.md']);
    expect(cy.nodes.get('epic.md')!.classes.has('outside')).toBe(true);
    expect(cy.nodes.get('epic.md')!.data['label']).toBe('The epic');
    expect(cy.nodes.get('a.md')!.data['color']).toBe('#c00'); // happy-dom has no canvas to resolve it with
    expect(cy.edges.map((e) => [e.data['source'], e.data['target'], e.classes.includes('outside')])).toEqual([
      ['a.md', 'b.md', false], ['a.md', 'epic.md', true], ['b.md', 'c.md', false],
    ]);
    expect(screen.getByText(/3 notes \+ 1 outside, 3 links/)).toBeTruthy();
  });

  it('outside: hide leaves it out; the checkbox writes the view\'s spec', async () => {
    const { api } = draw({ spec: { outside: 'hide' } });
    expect([...cy.nodes.keys()]).toEqual(['a.md', 'b.md', 'c.md']);
    const box = screen.getByRole('checkbox', { name: 'Outside notes' });
    expect((box as HTMLInputElement).checked).toBe(false);
    await fireEvent.click(box);
    expect(api.of('view.setState')).toEqual([{ patch: { outside: 'show' } }]);
  });

  it('the legend: a kind per link property with its count; turning one off writes edges, all on writes null', async () => {
    const { api } = draw();
    const legend = screen.getByRole('group', { name: 'Links drawn' });
    const blocks = within(legend).getByRole('button', { name: /Blocks 2/ });
    expect(blocks.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(blocks);
    expect(api.of('view.setState').at(-1)).toEqual({ patch: { edges: ['parent'] } });
    cleanup();
    const again = draw({ spec: { edges: ['parent'] } });
    expect(cy.edges.map((e) => e.data['target'])).toEqual(['epic.md']);
    await fireEvent.click(within(screen.getByRole('group', { name: 'Links drawn' })).getByRole('button', { name: /Blocks/ }));
    expect(again.api.of('view.setState').at(-1)).toEqual({ patch: { edges: null } });
  });

  it('an embed changes nothing: the legend is shown but not pressable, and there is no Outside notes', () => {
    draw({ readOnly: true, selectable: false });
    for (const b of within(screen.getByRole('group', { name: 'Links drawn' })).getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('checkbox', { name: 'Outside notes' })).toBeNull();
  });
});

describe('pointer: the view\'s selection, the note menu, the preview (#2960)', () => {
  it('a click goes to the view with its modifiers; a note outside the view opens instead', () => {
    const { api } = draw();
    fire('tap', 'b.md');
    fire('tap', 'c.md', { metaKey: true });
    fire('tap', 'epic.md');
    expect(api.of('view.click')).toEqual([
      { path: 'b.md', meta: false, ctrl: false, shift: false },
      { path: 'c.md', meta: true, ctrl: false, shift: false },
    ]);
    expect(api.of('ui.openNote')).toEqual([{ path: 'epic.md' }]);
  });

  it('selected notes are marked; right-clicking one opens the menu for the selection, another for itself', async () => {
    const { api } = draw({ selected: ['a.md', 'b.md'] });
    await tick();
    expect(cy.nodes.get('a.md')!.classes.has('selected')).toBe(true);
    expect(cy.nodes.get('c.md')!.classes.has('selected')).toBe(false);
    fire('cxttap', 'b.md');
    fire('cxttap', 'c.md');
    expect(api.of('ui.showNoteMenu')).toEqual([{ paths: ['a.md', 'b.md'], x: 50, y: 60 }, { paths: ['c.md'], x: 50, y: 60 }]);
  });

  it('no menu where the view has none', () => {
    const { api } = draw({ rowMenu: false });
    fire('cxttap', 'a.md');
    expect(api.of('ui.showNoteMenu')).toEqual([]);
  });

  it('hovering previews the note at its box; leaving hides it; an outside note says so', () => {
    const { api } = draw();
    fire('mouseover', 'a.md');
    fire('mouseout', 'a.md');
    fire('mouseover', 'epic.md');
    expect(api.of('ui.previewNote')[0]).toMatchObject({ path: 'a.md', width: 30, height: 12, via: 'pointer' });
    expect(api.of('ui.hidePreview')).toEqual([{ path: 'a.md', via: 'pointer' }]);
    expect(api.of('ui.previewNote')[1]).toMatchObject({ path: 'epic.md', extra: ['Not in this view'] });
  });
});

describe('the keyboard (#2960)', () => {
  it("moves through the notes in the view's order, announcing and previewing each; Enter opens, Space toggles", async () => {
    const { api } = draw();
    const canvas = screen.getByRole('application');
    await fireEvent.focus(canvas);
    expect(api.of('ui.announce').at(-1)).toEqual({ text: 'Alpha, Task, 2 links' });
    await fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(api.of('ui.announce').at(-1)).toEqual({ text: 'Bravo, Task, 2 links' });
    expect(api.of('ui.previewNote').at(-1)).toMatchObject({ path: 'b.md', via: 'focus' });
    await fireEvent.keyDown(canvas, { key: 'End' });
    expect(api.of('ui.announce').at(-1)).toEqual({ text: 'The epic, not in this view, 1 link' });
    await fireEvent.keyDown(canvas, { key: 'Home' });
    await fireEvent.keyDown(canvas, { key: 'Enter' });
    await fireEvent.keyDown(canvas, { key: ' ' });
    expect(api.of('view.click')).toEqual([{ path: 'a.md' }, { path: 'a.md', meta: true }]);
  });

  it('⇧+arrow extends the selection; ⌘A and Escape are the view\'s; Shift+F10 opens the menu', async () => {
    const { api } = draw({ selected: ['a.md'] });
    const canvas = screen.getByRole('application');
    await fireEvent.focus(canvas);
    await fireEvent.keyDown(canvas, { key: 'ArrowRight', shiftKey: true });
    expect(api.of('view.click')).toEqual([{ path: 'b.md', shift: true }]);
    await fireEvent.keyDown(canvas, { key: 'a', metaKey: true });
    await fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(api.of('view.selectAll')).toHaveLength(1);
    expect(api.of('view.clearSelection')).toHaveLength(1);
    await fireEvent.keyDown(canvas, { key: 'F10', shiftKey: true });
    expect(api.of('ui.showNoteMenu').at(-1)).toMatchObject({ paths: ['b.md'] });
  });
});

describe('the Table (#2960)', () => {
  it('lists each note with what it links to and what links to it, by kind; a note opens from it', async () => {
    const { api } = draw();
    await fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const rows = screen.getAllByRole('row').slice(1);
    const cells = (r: HTMLElement) => [...r.querySelectorAll('th, td')].map((c) => c.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows.map(cells)).toEqual([
      ['Alpha · Task', 'Blocks: Bravo Parent: The epic (not in this view)', '—'],
      ['Bravo · Task', 'Blocks: Charlie', 'Blocks: Alpha'],
      ['Charlie', '—', 'Blocks: Bravo'],
    ]);
    await fireEvent.click(within(rows[1]!).getByRole('button', { name: 'Bravo' }));
    await fireEvent.click(within(rows[0]!).getByRole('button', { name: 'The epic' }));
    expect(api.of('view.click')).toEqual([{ path: 'b.md' }]);
    expect(api.of('ui.openNote')).toEqual([{ path: 'epic.md' }]);
  });
});

describe('the export (#2960, until #2961 draws the graph)', () => {
  it('hands back the notes and their links as a table, styled inline, nothing to press', async () => {
    const api = fakeMinerva();
    render(App, { minerva: api.minerva });
    api.emit('view', viewState({ exportMode: true, readOnly: true, selectable: false }));
    await tick();
    api.emit('export', { requestId: 'r1' });
    await waitFor(() => expect(api.of('view.provideExport')).toHaveLength(1));
    const { requestId, html } = api.of('view.provideExport')[0] as { requestId: string; html: string };
    expect(requestId).toBe('r1');
    expect(html).toMatch(/^<table[^>]*style="border-collapse: collapse/);
    expect(html).toContain('Blocks:');
    expect(html).not.toContain('<button');
  });
});
