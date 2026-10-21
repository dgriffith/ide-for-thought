/**
 * A built-in plugin's view, in loopback (#2829): a fake session whose plugin
 * is the plugin's REAL `App.svelte`, mounted beside the frame it would draw
 * in. Every view, preview and export request the host sends is emitted to it
 * as the frame's runtime would; every call it makes reaches the host callbacks
 * the broker's intents would. Everything but the frame boundary (and the
 * broker's checks — `broker.test.ts` has those), so a type view test can
 * assert on the drawing the user would see.
 *
 * Each test file mocks the session store with `connectPluginFrame:
 * (...a) => h.loop.connect(...a)` and the built-in plugins store (on); a
 * DOM test can't load a frame, so `autoLoadPluginFrames` fires its `load`.
 */
import { vi } from 'vitest';
import { mount, unmount, type Component } from 'svelte';
import type { PluginViewState } from '../../../src/shared/plugins/api';
import type { PluginFrameHost } from '../../../src/renderer/lib/stores/plugin-sessions.svelte';

type AppComponent = Component<{ minerva: never }>;

/** What a test's `vi.hoisted` holds for the loopback. */
export interface LoopbackState {
  connect: ReturnType<typeof vi.fn>;
  /** The host callbacks the last frame registered. */
  host: PluginFrameHost | null;
  /** Every view the host sent, oldest first. */
  views: PluginViewState[];
}

/** Fill (or refill, per test) `into` with a loopback for the plugin `load` imports. */
export function pluginLoopback(into: Partial<LoopbackState>, load: () => Promise<{ default: unknown }>): LoopbackState {
  const state = Object.assign(into, { connect: vi.fn(), host: null, views: [] }) as LoopbackState;
  state.connect.mockImplementation(async (frame: HTMLIFrameElement, _id: string, _scope: string[], host: PluginFrameHost) => {
    state.host = host;
    const listeners = new Map<string, Set<(d: unknown) => void>>();
    const emit = (event: string, data: unknown) => { for (const fn of listeners.get(event) ?? []) fn(data); };
    const call = async (f: () => void) => { f(); return {}; };
    const minerva = {
      on(event: string, fn: (d: unknown) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
        return () => { listeners.get(event)?.delete(fn); };
      },
      view: {
        click: (p: { path: string; meta?: boolean; ctrl?: boolean; shift?: boolean }) => call(() => host.viewClick?.(p.path, { meta: !!p.meta, ctrl: !!p.ctrl, shift: !!p.shift })),
        setState: (p: { patch: Record<string, unknown> }) => call(() => host.setViewState?.(p.patch)),
        provideExport: (p: { requestId: string; html: string }) => call(() => host.exportHtml?.(p.requestId, p.html)),
        selectAll: () => call(() => host.selectAll?.()),
        clearSelection: () => call(() => host.clearSelection?.()),
        moveCard: (p: { path: string; target: never }) => call(() => host.moveCard?.(p.path, p.target)),
        undoMove: () => call(() => host.undoMove?.()),
        moveColumn: (p: { key: string; target: string; side: 'before' | 'after' }) => call(() => host.moveColumn?.(p.key, p.target, p.side)),
      },
      ui: {
        previewNote: (p: { path: string; x: number; y: number; width: number; height: number; via?: 'pointer' | 'focus'; extra?: string[]; omit?: string[] }) =>
          call(() => host.previewNote?.(p.path, { x: p.x, y: p.y, width: p.width, height: p.height }, p.via ?? 'pointer', { extra: p.extra ?? [], omit: p.omit ?? [] })),
        hidePreview: (p: { path: string; via?: 'pointer' | 'focus' }) => call(() => host.hidePreview?.(p.path, p.via ?? 'pointer')),
        showNoteMenu: (p: { paths: string[]; x: number; y: number; target?: boolean; label?: string }) =>
          call(() => host.showNoteMenu?.(p.paths, p.x, p.y, { target: !!p.target, label: p.label ?? null })),
      },
    };
    const target = document.createElement('div');
    target.dataset['pluginLoopback'] = '';
    frame.after(target);
    const { default: App } = await load();
    const app = mount(App as AppComponent, { target, props: { minerva: minerva as never } });
    return {
      sessionId: 'loopback', setScope: vi.fn(async () => {}), sendTheme: vi.fn(async () => {}), drop: vi.fn(async () => {}),
      sendView: vi.fn(async (v: PluginViewState) => { state.views.push(v); emit('view', v); }),
      requestExport: vi.fn(async (requestId: string) => { emit('export', { requestId }); }),
      sendPreview: vi.fn(async (path: string, description: string | null) => { emit('preview', { path, description }); }),
      close: vi.fn(async () => { void unmount(app); target.remove(); }),
    };
  });
  return state;
}

/**
 * A plugin frame never loads in a DOM test (no page loading), so `load` is
 * fired as each one is added — for flows that mount a board themselves (an
 * export, an embed). Returns the stop.
 */
export function autoLoadPluginFrames(): () => void {
  const fire = (root: ParentNode) => {
    for (const f of root.querySelectorAll<HTMLIFrameElement>('[data-plugin-layout] iframe:not([data-loaded])')) {
      f.dataset['loaded'] = '1';
      queueMicrotask(() => f.dispatchEvent(new Event('load')));
    }
  };
  const watch = new MutationObserver(() => fire(document));
  watch.observe(document.body, { childList: true, subtree: true });
  fire(document);
  return () => watch.disconnect();
}
