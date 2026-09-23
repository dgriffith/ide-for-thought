/**
 * First-paint guard for `createWindow` (#2223).
 *
 * The window used to map the instant it was constructed and then sit in
 * Electron's stock white for the whole renderer fetch + parse + mount. It is
 * built with `show: false` now and shown on the first paint signal.
 *
 * `show: false` is the half that's easy to get right and the half that, alone,
 * is dangerous: a window that never appears is a far worse bug than a blank
 * one. So the cases below lean on **it always appears** — on `ready-to-show`,
 * on `did-finish-load`, on `did-fail-load`, and failing all three on a timer —
 * and on the two places showing would be wrong (already destroyed, already
 * visible).
 *
 * Same fake-Electron shape as `window-security-flags.test.ts`: the BrowserWindow
 * stand-in records its construction options and lets a test fire the lifecycle
 * events by hand. The real `installNavigationGuards` runs against the fake
 * webContents — it only wires handlers, so it's harmless.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Listener = (...args: unknown[]) => void;

/** The fake BrowserWindow's surface, as these tests poke at it. */
interface FakeWindow {
  options: Record<string, unknown>;
  visible: boolean;
  destroyed: boolean;
  showCalls: number;
  emit(event: string): void;
  webContents: { emit(event: string): void };
}

const h = vi.hoisted(() => ({
  /** Every window the fake constructor has produced, newest last. */
  windows: [] as unknown[],
  dark: true,
}));

vi.mock('electron', () => {
  function emitter() {
    const handlers = new Map<string, Listener[]>();
    return {
      add(event: string, fn: Listener) {
        handlers.set(event, [...(handlers.get(event) ?? []), fn]);
      },
      emit(event: string) {
        const list = handlers.get(event) ?? [];
        // Every listener the code under test registers is a `once`, so drop
        // them after firing rather than modelling on/once separately.
        handlers.set(event, []);
        for (const fn of list) fn();
      },
    };
  }

  class FakeWebContents {
    #events = emitter();
    on(event: string, fn: Listener) { this.#events.add(event, fn); }
    once(event: string, fn: Listener) { this.#events.add(event, fn); }
    emit(event: string) { this.#events.emit(event); }
    send() { /* project-opened announce — never fired */ }
    setWindowOpenHandler() { /* nav guard wiring */ }
  }

  let idSeq = 1;
  class BrowserWindow {
    id = idSeq++;
    webContents = new FakeWebContents();
    options: Record<string, unknown>;
    visible: boolean;
    destroyed = false;
    showCalls = 0;
    #events = emitter();
    constructor(options: Record<string, unknown>) {
      this.options = options;
      // Electron's own default is `show: true`; mirror it, so a regression
      // that drops the flag produces an already-visible window here too.
      this.visible = options.show !== false;
      h.windows.push(this);
    }
    on(event: string, fn: Listener) { this.#events.add(event, fn); return this; }
    once(event: string, fn: Listener) { this.#events.add(event, fn); return this; }
    emit(event: string) { this.#events.emit(event); }
    show() {
      this.showCalls++;
      this.visible = true;
    }
    isVisible() { return this.visible; }
    isDestroyed() { return this.destroyed; }
    loadURL() { return Promise.resolve(); }
    loadFile() { return Promise.resolve(); }
    static getAllWindows() { return []; }
  }

  return {
    BrowserWindow,
    nativeTheme: { get shouldUseDarkColors() { return h.dark; } },
    // Present so security.ts / transitive modules' `import { … } from 'electron'`
    // bindings resolve; the members are only touched by paths this test never runs.
    session: { defaultSession: { webRequest: { onHeadersReceived() {} } } },
    shell: { openExternal() {} },
    app: { getPath: () => '/tmp/minerva-test', getAppPath: () => '/tmp/minerva-app' },
  };
});

vi.mock('../../src/main/app-icon', () => ({ appIconPath: () => '/tmp/icon.png' }));

// Closing a window schedules a debounced session write. These tests run on fake
// timers and advance past that debounce, so without this the "closed" case
// writes session.json into the fake userData path and throws ENOENT.
vi.mock('../../src/main/session', () => ({ saveSession: () => {}, loadSession: () => [] }));

// Vite `define` globals injected at build time — truthy so createWindow takes
// the loadURL branch, which the fake stubs.
(globalThis as unknown as { MAIN_WINDOW_VITE_DEV_SERVER_URL: string }).MAIN_WINDOW_VITE_DEV_SERVER_URL =
  'http://localhost:5173';
(globalThis as unknown as { MAIN_WINDOW_VITE_NAME: string }).MAIN_WINDOW_VITE_NAME = 'main_window';

import { createWindow } from '../../src/main/window-manager';

/** `createWindow`'s return value, seen as the fake it actually is. */
function make(): FakeWindow {
  return createWindow() as unknown as FakeWindow;
}
const built = (): FakeWindow[] => h.windows as FakeWindow[];

beforeEach(() => {
  h.windows = [];
  h.dark = true;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createWindow first paint (#2223)', () => {
  it('constructs the window hidden, with a themed fill behind the renderer', () => {
    const win = make();
    expect(win.options.show).toBe(false);
    expect(win.options.backgroundColor).toBe('#1b1611');
    expect(win.visible).toBe(false);
  });

  it('takes the light fill when the OS is in light mode', () => {
    h.dark = false;
    expect(make().options.backgroundColor).toBe('#f7f3eb');
  });

  it('shows on ready-to-show, and not before', () => {
    const win = make();
    expect(win.visible).toBe(false);
    win.emit('ready-to-show');
    expect(win.visible).toBe(true);
    expect(win.showCalls).toBe(1);
  });

  it('shows on did-finish-load when ready-to-show never fires', () => {
    const win = make();
    win.webContents.emit('did-finish-load');
    expect(win.visible).toBe(true);
  });

  it('shows on did-fail-load — a window that cannot paint still has to appear', () => {
    const win = make();
    win.webContents.emit('did-fail-load');
    expect(win.visible).toBe(true);
  });

  it('shows on the fallback timer when no paint signal ever arrives', () => {
    const win = make();
    expect(win.visible).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(win.visible).toBe(true);
    expect(win.showCalls).toBe(1);
  });

  it('shows once, and a later signal never yanks back a window the user put away', () => {
    const win = make();
    win.emit('ready-to-show');
    expect(win.showCalls).toBe(1);
    // The triggers sit on two different emitters, so firing one doesn't
    // unregister the others — `did-finish-load` still lands, seconds later.
    // By then the user may have minimised or hidden the window, and on the
    // platforms where that reads as not-visible a second `show()` would haul
    // it back to the front. Showing is a once-per-window decision, not a
    // reaction to whatever the page last did.
    win.visible = false;
    win.webContents.emit('did-finish-load');
    win.webContents.emit('did-fail-load');
    vi.advanceTimersByTime(5000);
    expect(win.showCalls).toBe(1);
    expect(win.visible).toBe(false);
  });

  it('never shows a window that was closed mid-load', () => {
    const win = make();
    win.destroyed = true;
    win.emit('closed');
    vi.advanceTimersByTime(5000);
    win.emit('ready-to-show');
    expect(win.showCalls).toBe(0);
  });

  it('gives every window its own show path — createWindow runs per window', () => {
    make();
    make();
    const [first, second] = built();
    expect(first!.visible).toBe(false);
    expect(second!.visible).toBe(false);
    second!.emit('ready-to-show');
    expect(second!.visible).toBe(true);
    // The second window's paint signal must not stand in for the first's.
    expect(first!.visible).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(first!.visible).toBe(true);
  });
});
