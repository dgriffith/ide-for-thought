// Loaded with `-r` after Playwright's Electron loader (#2595). Makes the
// runner's first `__playwright_run()` a no-op, which is what a lost
// fire-and-forget `Runtime.evaluate` looks like from inside the app: Electron
// is ready, the app never sees `ready`, and no window is ever created.
let real = globalThis.__playwright_run;
let calls = 0;
Object.defineProperty(globalThis, '__playwright_run', {
  configurable: true,
  get() {
    if (!real) return undefined;
    return async () => {
      calls++;
      if (calls === 1) return undefined;
      return real();
    };
  },
  set(fn) { real = fn; },
});
