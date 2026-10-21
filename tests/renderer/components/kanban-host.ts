/**
 * Driving a type view's Kanban layout from the host's side (#2828): since the
 * board is drawn by the Kanban plugin in a plugin frame, a TypeView test
 * reads the `view` state TypeView sends the plugin, and acts as the plugin by
 * calling the host callbacks the frame registered. The board itself is
 * tested in tests/plugins/kanban/.
 *
 * Each test file mocks the session store with `connectPluginFrame: h.connect`
 * and the built-in plugins store (Kanban on); this is the rest.
 */
import { vi, expect } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/svelte';
import type { PluginViewState } from '../../../src/shared/plugins/api';
import type { PluginFrameHost } from '../../../src/renderer/lib/stores/plugin-sessions.svelte';

/** What a test's `vi.hoisted` holds for the plugin session. */
export interface KanbanHostState {
  connect: ReturnType<typeof vi.fn>;
  sendView: ReturnType<typeof vi.fn>;
  host: PluginFrameHost | null;
}

/** Fill (or refill, per test) `into` with a fresh fake session. */
export function kanbanHostState(into: Partial<KanbanHostState> = {}): KanbanHostState {
  const state = Object.assign(into, { connect: vi.fn(), sendView: vi.fn(async () => {}), host: null }) as KanbanHostState;
  state.connect.mockImplementation(async (_frame: unknown, _id: string, _scope: string[], host: PluginFrameHost) => {
    state.host = host;
    return {
      sessionId: 's', setScope: vi.fn(async () => {}), sendTheme: vi.fn(async () => {}), drop: vi.fn(async () => {}),
      sendView: state.sendView, requestExport: vi.fn(async () => {}), sendPreview: vi.fn(async () => {}), close: vi.fn(async () => {}),
    };
  });
  return state;
}

/** Load the board's frame and wait for its first view; then read and drive it. */
export async function openBoard(container: HTMLElement, s: KanbanHostState) {
  const frame = await waitFor(() => {
    const f = container.querySelector<HTMLIFrameElement>('[data-plugin-layout="kanban"] iframe');
    expect(f).not.toBeNull();
    return f!;
  });
  await fireEvent.load(frame);
  await waitFor(() => expect(s.sendView).toHaveBeenCalled());
  const state = (): PluginViewState => s.sendView.mock.calls.at(-1)![0] as PluginViewState;
  return {
    state,
    host: () => s.host!,
    /** Each column's label and count, in order — as the board draws them. */
    columns: () => state().groups.map((g) => [g.label, String(g.paths.length)]),
    /** A column's card titles, in order. */
    titles: (label: string) => {
      const g = state().groups.find((x) => x.label === label)!;
      return g.paths.map((p) => state().instances.find((i) => i.path === p)!.title);
    },
    /** A card's fields as it shows them: "Label text". */
    fields: (path: string) => state().instances.find((i) => i.path === path)!.fields.map((f) => `${f.label} ${f.text}`),
  };
}

export { autoLoadPluginFrames } from './plugin-loopback';

/**
 * The Kanban plugin, in loopback: a fake session whose export request is
 * answered by the plugin's REAL board — mounted in export mode with the view
 * the host sent, its styles inlined by the plugin's real inliner — through the
 * host's real export path. Everything but the frame boundary.
 */
export function kanbanLoopback(into: Partial<KanbanHostState> = {}): KanbanHostState {
  const state = kanbanHostState(into);
  state.connect.mockImplementation(async (_frame: unknown, _id: string, _scope: string[], host: PluginFrameHost) => {
    state.host = host;
    let last: PluginViewState | null = null;
    const sendView = vi.fn(async (v: PluginViewState) => { last = v; });
    state.sendView = sendView;
    return {
      sessionId: 'loopback', setScope: vi.fn(async () => {}), sendTheme: vi.fn(async () => {}), drop: vi.fn(async () => {}),
      sendView, sendPreview: vi.fn(async () => {}), close: vi.fn(async () => {}),
      requestExport: vi.fn(async (requestId: string) => {
        const { mount, unmount, tick } = await import('svelte');
        const { default: Board } = await import('../../../plugins/kanban/src/Board.svelte');
        const { inlineStyles } = await import('../../../plugins/kanban/src/inline-styles');
        const target = document.createElement('div');
        document.body.append(target);
        const quiet = { on: () => () => {}, view: {}, ui: {} };
        const board = mount(Board, { target, props: { minerva: quiet as never, view: last! } });
        await tick();
        const el = target.querySelector<HTMLElement>('.kb-board');
        const html = el ? inlineStyles(el) : '';
        void unmount(board);
        target.remove();
        host.exportHtml?.(requestId, html);
      }),
    };
  });
  return state;
}
