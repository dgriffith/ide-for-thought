/**
 * @vitest-environment jsdom
 *
 * The plugin view host (#2827): frames the plugin sandboxed on its own
 * origin, connects it, keeps its theme in step, takes focus back on Escape,
 * passes on drops in the frame's coordinates, and closes the session.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';

const h = vi.hoisted(() => ({
  connection: null as null | {
    sessionId: string;
    setScope: ReturnType<typeof vi.fn>;
    sendTheme: ReturnType<typeof vi.fn>;
    drop: ReturnType<typeof vi.fn>;
    sendPreview: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  },
  host: null as null | {
    releaseFocus(): void;
    showNoteMenu?(paths: string[], x: number, y: number, opts: { target: boolean; label: string | null }): void;
    previewNote?(path: string, rect: { x: number; y: number; width: number; height: number }, via: 'pointer' | 'focus'): void;
    hidePreview?(path: string, via: 'pointer' | 'focus'): void;
  },
  connect: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/stores/plugin-sessions.svelte', () => ({ connectPluginFrame: h.connect }));
// The hover preview reads the note through the app's fetcher: a fixed one here.
vi.mock('../../../src/renderer/lib/components/note-hover/app-fetcher', () => ({
  appNotePreviewFetcher: () => async (target: string) => ({ path: target, title: `Title of ${target}`, snippet: 'Some text.' }),
}));

import PluginFrame from '../../../src/renderer/lib/components/plugins/PluginFrame.svelte';
import { NOTE_DROP_EVENT } from '../../../src/renderer/lib/stores/link-drag.svelte';
import { DRAG_MIME_NOTE } from '../../../src/renderer/lib/editor/drag-link';

beforeEach(() => {
  h.connection = { sessionId: 's1', setScope: vi.fn(async () => {}), sendTheme: vi.fn(async () => {}), drop: vi.fn(async () => {}), sendPreview: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  h.connect.mockReset();
  h.connect.mockImplementation(async (_frame: unknown, _id: string, _scope: string[], host: { releaseFocus(): void }) => {
    h.host = host;
    return h.connection;
  });
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.setProperty('--bg', '#101010');
});

afterEach(() => cleanup());

async function mounted(scope = ['a.md']) {
  const r = render(PluginFrame, { pluginId: 'kanban', scope, title: 'Kanban board' });
  const frame = r.container.querySelector('iframe')!;
  await fireEvent.load(frame);
  await waitFor(() => expect(h.connect).toHaveBeenCalled());
  return { ...r, frame, host: r.container.querySelector<HTMLElement>('.plugin-frame')! };
}

describe('PluginFrame (#2827)', () => {
  it("frames the plugin's page, sandboxed, on its own origin, with a name", async () => {
    const { frame } = await mounted();
    expect(frame.getAttribute('src')).toBe('minerva-plugin://kanban/index.html');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame.getAttribute('title')).toBe('Kanban board');
    expect(h.connect).toHaveBeenCalledWith(frame, 'kanban', ['a.md'], expect.objectContaining({ releaseFocus: expect.any(Function) }), undefined);
  });

  it('sends the theme on connect, and again when it changes', async () => {
    await mounted();
    await waitFor(() => expect(h.connection!.sendTheme).toHaveBeenCalledTimes(1));
    expect(h.connection!.sendTheme.mock.calls[0]![0]).toBe('dark');
    expect(h.connection!.sendTheme.mock.calls[0]![1]).toMatchObject({ '--bg': '#101010' });
    document.documentElement.setAttribute('data-theme', 'light');
    await waitFor(() => expect(h.connection!.sendTheme).toHaveBeenCalledTimes(2));
    expect(h.connection!.sendTheme.mock.calls[1]![0]).toBe('light');
  });

  it('takes focus back when the plugin gives it up', async () => {
    const { host } = await mounted();
    h.host!.releaseFocus();
    expect(document.activeElement).toBe(host);
  });

  it('follows its scope', async () => {
    const r = await mounted(['a.md']);
    await r.rerender({ pluginId: 'kanban', scope: ['a.md', 'b.md'], title: 'Kanban board' });
    await tick();
    expect(h.connection!.setScope).toHaveBeenCalledWith(['a.md', 'b.md']);
  });

  it('passes on a note dropped from a panel or the file tree, in the frame\'s coordinates', async () => {
    const { host, frame } = await mounted();
    frame.getBoundingClientRect = () => ({ left: 100, top: 50, right: 500, bottom: 450, width: 400, height: 400, x: 100, y: 50, toJSON: () => ({}) });
    host.dispatchEvent(new CustomEvent(NOTE_DROP_EVENT, { detail: { paths: ['b.md'], clientX: 130, clientY: 90 } }));
    expect(h.connection!.drop).toHaveBeenCalledWith(['b.md'], 30, 40);

    // jsdom has no DragEvent, so the file tree's drag is built by hand.
    const data = { types: [DRAG_MIME_NOTE], getData: (t: string) => (t === DRAG_MIME_NOTE ? 'c.md' : ''), dropEffect: 'none' };
    const drag = (type: string, x = 0, y = 0) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(e, { dataTransfer: data, clientX: x, clientY: y });
      host.dispatchEvent(e);
      return e;
    };
    expect(drag('dragover').defaultPrevented).toBe(true);
    expect(data.dropEffect).toBe('copy');
    drag('drop', 300, 250);
    expect(h.connection!.drop).toHaveBeenLastCalledWith(['c.md'], 200, 200);
  });

  it('lets the frame ignore the pointer while an HTML5 drag is on', async () => {
    const { host } = await mounted();
    document.dispatchEvent(new Event('dragstart'));
    await tick();
    expect(host.classList.contains('dragging')).toBe(true);
    document.dispatchEvent(new Event('dragend'));
    await tick();
    expect(host.classList.contains('dragging')).toBe(false);
  });

  it('closes the session when it goes, and says so when it could not start', async () => {
    const r = await mounted();
    r.unmount();
    expect(h.connection!.close).toHaveBeenCalled();

    h.connect.mockRejectedValueOnce(new Error('"kanban" is not an enabled plugin with code.'));
    const failed = render(PluginFrame, { pluginId: 'kanban', scope: [], title: 'Kanban board' });
    await fireEvent.load(failed.container.querySelector('iframe')!);
    await waitFor(() => expect(failed.container.textContent).toContain("This view couldn't start"));
  });
});

describe('the kit gaps, hosted (#2828, part B)', () => {
  it("draws the app's hover preview against the box the plugin names, and lets it go", async () => {
    const { container } = await mounted();
    h.host!.previewNote!('a.md', { x: 12, y: 30, width: 200, height: 40 }, 'focus');
    const anchor = container.querySelector<HTMLElement>('.plugin-hover-anchor')!;
    await waitFor(() => expect(anchor.getAttribute('aria-describedby')).toBeTruthy());
    expect([anchor.style.left, anchor.style.top, anchor.style.width, anchor.style.height]).toEqual(['12px', '30px', '200px', '40px']);
    // The preview portals into document.body, out of any clipping ancestor.
    await waitFor(() => expect(document.body.textContent).toContain('Title of a.md'));
    // Its text goes back to the plugin, to describe the card inside the frame — and is withdrawn.
    await waitFor(() => expect(h.connection!.sendPreview).toHaveBeenCalledWith('a.md', expect.stringContaining('Title of a.md')));
    h.host!.hidePreview!('a.md', 'focus');
    await waitFor(() => expect(anchor.getAttribute('aria-describedby')).toBeNull());
    await waitFor(() => expect(h.connection!.sendPreview).toHaveBeenLastCalledWith('a.md', null));
  });

  it('a pointer preview goes when the pointer leaves the frame, even if the card never heard', async () => {
    const { container } = await mounted();
    h.host!.previewNote!('a.md', { x: 12, y: 30, width: 200, height: 40 }, 'pointer');
    await waitFor(() => expect(document.body.textContent).toContain('Title of a.md'));
    await fireEvent.pointerLeave(container.querySelector('iframe')!);
    await waitFor(() => expect(document.querySelector('.note-hover-preview')).toBeNull(), { timeout: 3000 });
  });

  it("and when the window's own pointer moves off the frame — the out-of-process frame tells nobody it left", async () => {
    const { container } = await mounted();
    h.host!.previewNote!('a.md', { x: 12, y: 30, width: 200, height: 40 }, 'pointer');
    await waitFor(() => expect(document.body.textContent).toContain('Title of a.md'));
    // Over the frame itself, or the preview, it stays.
    await fireEvent.pointerMove(container.querySelector('iframe')!);
    await fireEvent.pointerMove(document.querySelector('.note-hover-preview')!);
    await new Promise((r) => setTimeout(r, 400));
    expect(document.querySelector('.note-hover-preview')).not.toBeNull();
    await fireEvent.pointerMove(document.body);
    await waitFor(() => expect(document.querySelector('.note-hover-preview')).toBeNull(), { timeout: 3000 });
  });

  it("turns the plugin's menu point into the window's for the layout host", async () => {
    const onNoteMenu = vi.fn();
    const r = render(PluginFrame, { pluginId: 'kanban', scope: [], title: 'Kanban board', onNoteMenu });
    const frame = r.container.querySelector('iframe')!;
    frame.getBoundingClientRect = () => ({ left: 100, top: 50, right: 500, bottom: 450, width: 400, height: 400, x: 100, y: 50, toJSON: () => ({}) });
    await fireEvent.load(frame);
    await waitFor(() => expect(h.connect).toHaveBeenCalled());
    h.host!.showNoteMenu!(['a.md', 'b.md'], 30, 40, { target: false, label: null });
    expect(onNoteMenu).toHaveBeenCalledWith(['a.md', 'b.md'], 130, 90, { target: false, label: null });
  });

  it('reads the theme from its own host, so an export block gets its light tokens', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const wrap = document.createElement('div');
    wrap.setAttribute('data-theme', 'light');
    wrap.style.setProperty('--bg', '#ffffff');
    document.body.append(wrap);
    const r = render(PluginFrame, { target: wrap, props: { pluginId: 'kanban', scope: [], title: 'Kanban board' } });
    await fireEvent.load(r.container.querySelector('iframe')!);
    await waitFor(() => expect(h.connection!.sendTheme).toHaveBeenCalled());
    expect(h.connection!.sendTheme.mock.calls[0]![0]).toBe('light');
    expect(h.connection!.sendTheme.mock.calls[0]![1]).toMatchObject({ '--bg': '#ffffff' });
    wrap.remove();
  });
});
