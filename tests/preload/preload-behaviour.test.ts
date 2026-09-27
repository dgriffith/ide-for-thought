/**
 * Behavioural test for the preload contextBridge (#2367).
 *
 * `preload-bridge.test.ts` pins the NAMES on `window.api`; nothing ran the
 * method bodies. So two same-signature methods with swapped channels
 * (`approve` ↔ `reject`, `deleteFile` ↔ `deleteFolder`), or a dropped or
 * reordered argument, passed every check we had. This one calls every leaf.
 *
 * For each leaf on the exposed `api` object it asserts:
 *
 *   1. Exactly ONE of `ipcRenderer.invoke` / `send` / `on` happened (or the
 *      leaf is a documented non-IPC helper in `NON_IPC_LEAVES`).
 *   2. The channel is real: an invoke channel is a `Channels` value AND a
 *      `ChannelMap` key; a send/subscribe channel is a `Channels` value AND an
 *      `EventMap` key.
 *   3. Arguments are forwarded unchanged and in order: the leaf is called with
 *      distinct string sentinels and the invoke/send args must be a prefix of
 *      them, at least as long as the leaf's declared arity. Leaves that
 *      deliberately reshape (positional args → one payload object) are listed
 *      in `RESHAPED_ARGS` with the payload they must produce.
 *   4. A subscription registers on its channel, hands the listener the payload
 *      WITHOUT the `IpcRendererEvent` (which must never reach the renderer),
 *      and its returned unsubscribe removes exactly that handler.
 *   5. Swap detectors: no two leaves share a channel, and a leaf whose channel's
 *      verb names a DIFFERENT sibling method (`proposals.approve` invoking
 *      `proposal:reject`) fails — that catches a swap between any pair of
 *      name-matched methods without a hand-written entry.
 *   6. `HIGH_RISK` — a hand-written method → exact channel map for the
 *      mutations where a swap costs data (write/rename/delete, approve/reject,
 *      source mutations, settings writes, git publish, compute run).
 *
 * And the reverse direction: every `ChannelMap` key is invoked by some leaf,
 * and every `EventMap` key is subscribed or sent by some leaf, unless it is on
 * a documented allowlist below.
 *
 * A channel added the standard way (CLAUDE.md "IPC Pattern") — a
 * `Channels` constant, a `ChannelMap` entry, and an `invoke(Channels.X, ...args)`
 * passthrough — passes all of this with no edit here.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { Channels } from '../../src/shared/channels';
import { MENU_COMMANDS } from '../../src/shared/ipc-contract';

const h = vi.hoisted(() => ({ exposed: {} }));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => { h.exposed[key] = api; },
  },
  ipcRenderer: {
    // Never settles: the typed invoke() validates the resolved payload, and
    // this test is about what goes OUT, not what comes back.
    invoke: vi.fn(() => new Promise(() => {})),
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
  },
  webUtils: { getPathForFile: vi.fn(() => '/abs/dropped.pdf') },
  webFrame: { getZoomFactor: vi.fn(() => 1.25), setZoomFactor: vi.fn() },
}));

import { ipcRenderer, webUtils, webFrame } from 'electron';
import '../../src/preload/preload';

type Fn = (...args: unknown[]) => unknown;
const invokeMock = vi.mocked(ipcRenderer.invoke);
const sendMock = vi.mocked(ipcRenderer.send);
const onMock = vi.mocked(ipcRenderer.on);
const offMock = vi.mocked(ipcRenderer.off);

// ── Contract, read from source so nothing here can go stale ──────────────────

/** Keys of `export interface <name> {` in ipc-contract.ts (quoted keys only). */
function interfaceKeys(name: string): Set<string> {
  const src = readFileSync('src/shared/ipc-contract.ts', 'utf8');
  const start = src.indexOf(`export interface ${name} `);
  if (start < 0) throw new Error(`interface ${name} not found in ipc-contract.ts`);
  const body = src.slice(start, src.indexOf('\n}\n', start));
  return new Set([...body.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]!));
}

const CHANNEL_VALUES = new Set<string>(Object.values(Channels));
const CHANNEL_MAP_KEYS = interfaceKeys('ChannelMap');
const EVENT_MAP_KEYS = new Set<string>([
  ...interfaceKeys('EventMap'),
  ...MENU_COMMANDS.map((c) => `menu:${c}`),
]);

// ── Documented exceptions ────────────────────────────────────────────────────

/** Leaves that make no IPC call at all, and what they must delegate to. */
const NON_IPC_LEAVES: Record<string, (fn: Fn) => void> = {
  'files.getPathForFile': (fn) => {
    const file = { name: 'dropped.pdf' };
    expect(fn(file)).toBe('/abs/dropped.pdf');
    expect(webUtils.getPathForFile).toHaveBeenCalledExactlyOnceWith(file);
  },
  'view.getZoomFactor': (fn) => {
    expect(fn()).toBe(1.25);
    expect(webFrame.getZoomFactor).toHaveBeenCalledTimes(1);
  },
  'view.setZoomFactor': (fn) => {
    fn(1.5);
    expect(webFrame.setZoomFactor).toHaveBeenCalledExactlyOnceWith(1.5);
  },
};

/**
 * Leaves that deliberately wrap positional arguments into one payload object
 * (the handler takes a single object). `s` is the sentinel list the leaf was
 * called with; the value is the exact args expected after the channel.
 */
const RESHAPED_ARGS: Record<string, (s: string[]) => unknown[]> = {
  'sources.merge': (s) => [{ srcId: s[0], destId: s[1] }],
  'sources.setReadStatus': (s) => [{ sourceId: s[0], status: s[1] }],
  'sources.setTitle': (s) => [{ sourceId: s[0], title: s[1] }],
  'sources.setReadDueBy': (s) => [{ sourceId: s[0], dueBy: s[1] }],
  'sources.addTag': (s) => [{ sourceId: s[0], tag: s[1] }],
  'sources.removeTag': (s) => [{ sourceId: s[0], tag: s[1] }],
  'sources.createReferenceStubs': (s) => [{ sourceId: s[0], refs: s[1] }],
  'sources.applyStubResolution': (s) => [{ sourceId: s[0], doi: s[1] }],
  'collections.rename': (s) => [{ id: s[0], name: s[1] }],
  'collections.addSource': (s) => [{ collectionId: s[0], sourceId: s[1] }],
  'collections.removeSource': (s) => [{ collectionId: s[0], sourceId: s[1] }],
  'collections.renameSmart': (s) => [{ id: s[0], name: s[1] }],
  'collections.updateSmartPredicate': (s) => [{ id: s[0], predicate: s[1] }],
};

/** Subscriptions that intentionally call the listener with no arguments even
 *  though the channel may carry some. */
const DROPS_PAYLOAD = new Set(['sources.onExcerptsChanged']);

/** `ChannelMap` keys no preload leaf invokes, with why. Empty today — every
 *  invoke channel is renderer-reachable. May only shrink. */
const INTERNAL_INVOKE_CHANNELS: Record<string, string> = {};

/** `EventMap` keys no preload leaf subscribes to or sends, with why. May only
 *  shrink. */
const UNSUBSCRIBED_EVENTS: Record<string, string> = {
  // A REAL BUG, not a design choice: menu.ts's File ▸ Open In ▸ Reveal in
  // Finder sends this event and nothing listens, so the item is a no-op. The
  // same string is also an invoke channel (api.shell.revealFile), which is
  // why every name-level check saw it as used. Remove this entry with #2411.
  'shell:revealFile': 'dead menu command, #2411',
};

/**
 * The mutations where a channel swap between two same-signature methods costs
 * user data or trust. Asserted EXACTLY — string literals, not `Channels.X`, so
 * a wrong constant can't agree with itself.
 */
const HIGH_RISK: Record<string, string> = {
  'notebase.writeFile': 'notebase:writeFile',
  'notebase.writeBinary': 'notebase:writeBinary',
  'notebase.createFile': 'notebase:createFile',
  'notebase.deleteFile': 'notebase:deleteFile',
  'notebase.createFolder': 'notebase:createFolder',
  'notebase.deleteFolder': 'notebase:deleteFolder',
  'notebase.rename': 'notebase:rename',
  'notebase.copy': 'notebase:copy',
  'notebase.merge': 'notebase:merge',
  'notebase.renameSource': 'notebase:renameSource',
  'notebase.renameExcerpt': 'notebase:renameExcerpt',
  'proposals.approve': 'proposal:approve',
  'proposals.reject': 'proposal:reject',
  'proposals.expire': 'proposal:expire',
  'sources.delete': 'sources:delete',
  'sources.merge': 'sources:merge',
  'sources.setReadStatus': 'sources:setReadStatus',
  'sources.setTitle': 'sources:setTitle',
  'sources.addTag': 'sources:addTag',
  'sources.removeTag': 'sources:removeTag',
  'sources.createExcerpt': 'sources:createExcerpt',
  'sources.setIngestSettings': 'ingest:setSettings',
  'tools.setSettings': 'tool:setSettings',
  'compute.setPythonSettings': 'compute:setPythonSettings',
  'history.setSettings': 'history:setSettings',
  'formatter.saveSettings': 'formatter:saveSettings',
  'graph.setInspectionSettings': 'inspections:setSettings',
  'history.restore': 'history:restore',
  'history.batchRevert': 'history:batchRevert',
  'publish.toGit': 'publish:toGit',
  'git.commit': 'git:commit',
  'compute.runCell': 'compute:runCell',
  'compute.grantConsent': 'compute:grantConsent',
  'compute.revokeConsent': 'compute:revokeConsent',
  'conversations.runComputeDraft': 'conversation:runComputeDraft',
  'conversations.fileDeleteDraft': 'conversation:fileDeleteDraft',
  'types.delete': 'types:delete',
  'types.deleteSafely': 'types:deleteSafely',
  'collections.remove': 'collections:delete',
  'queries.delete': 'queries:delete',
  // Subscriptions whose listener drives a store refresh after a mutation.
  'proposals.onChanged': 'proposals:changed',
  'sources.onChanged': 'sources:changed',
  'notebase.onFileDeleted': 'notebase:fileDeleted',
  'notebase.onRenamed': 'notebase:renamed',
};

// ── Walk the exposed surface ─────────────────────────────────────────────────

interface Leaf { path: string; ns: string; name: string; fn: Fn }

function leaves(): Leaf[] {
  const api = h.exposed.api as Record<string, Record<string, unknown>>;
  const out: Leaf[] = [];
  for (const [ns, methods] of Object.entries(api)) {
    for (const [name, fn] of Object.entries(methods)) {
      if (typeof fn === 'function') out.push({ path: `${ns}.${name}`, ns, name, fn: fn as Fn });
    }
  }
  return out;
}

const isSubscription = (name: string) => /^on[A-Z]/.test(name);
const sentinels = (path: string) => Array.from({ length: 8 }, (_, i) => `«${path}#${i}»`);

type Observed =
  | { kind: 'invoke' | 'send'; channel: string; args: unknown[]; fnLength: number }
  | { kind: 'on'; channel: string; handler: Fn; unsubscribe: unknown; cb: ReturnType<typeof vi.fn> };

/** Calls one leaf against fresh mocks and reports the single IPC call it made. */
function observe(leaf: Leaf): Observed {
  vi.clearAllMocks();
  if (isSubscription(leaf.name)) {
    const cb = vi.fn();
    const unsubscribe = leaf.fn(cb);
    expect(invokeMock, `${leaf.path} is a subscription but called ipcRenderer.invoke`).not.toHaveBeenCalled();
    expect(sendMock, `${leaf.path} is a subscription but called ipcRenderer.send`).not.toHaveBeenCalled();
    expect(onMock.mock.calls.length, `${leaf.path} must register exactly one ipcRenderer.on listener`).toBe(1);
    const [channel, handler] = onMock.mock.calls[0]!;
    return { kind: 'on', channel, handler: handler as Fn, unsubscribe, cb };
  }
  leaf.fn(...sentinels(leaf.path));
  const calls = [
    ...invokeMock.mock.calls.map((c) => ({ kind: 'invoke' as const, c })),
    ...sendMock.mock.calls.map((c) => ({ kind: 'send' as const, c })),
    ...onMock.mock.calls.map((c) => ({ kind: 'on' as const, c })),
  ];
  expect(
    calls.map((x) => `${x.kind}(${String(x.c[0])})`),
    `${leaf.path} must make exactly one ipcRenderer.invoke/send call. A leaf that legitimately makes none belongs in NON_IPC_LEAVES; a subscription must be named on<Something>.`,
  ).toHaveLength(1);
  const { kind, c } = calls[0]!;
  if (kind === 'on') throw new Error(`${leaf.path} registered a listener but is not named on<Something>`);
  const [channel, ...args] = c as [string, ...unknown[]];
  return { kind, channel, args, fnLength: leaf.fn.length };
}

const ALL = leaves();
const IPC_LEAVES = ALL.filter((l) => !(l.path in NON_IPC_LEAVES));

beforeEach(() => { vi.clearAllMocks(); });

describe('preload behaviour: every leaf reaches the right channel (#2367)', () => {
  it('walks a non-trivial surface (sanity: the mock captured window.api)', () => {
    expect(ALL.length).toBeGreaterThan(300);
  });

  describe.each(IPC_LEAVES.filter((l) => !isSubscription(l.name)).map((l) => [l.path, l] as const))(
    '%s',
    (path, leaf) => {
      it('makes one invoke/send on a real channel with its args forwarded unchanged', () => {
        const o = observe(leaf);
        if (o.kind === 'on') throw new Error('unreachable');

        expect(CHANNEL_VALUES.has(o.channel), `${path} uses "${o.channel}", which is not a value in Channels (src/shared/channels.ts)`).toBe(true);
        if (o.kind === 'invoke') {
          expect(CHANNEL_MAP_KEYS.has(o.channel), `${path} invokes "${o.channel}", which has no ChannelMap entry in src/shared/ipc-contract.ts`).toBe(true);
        } else {
          expect(EVENT_MAP_KEYS.has(o.channel), `${path} sends "${o.channel}", which is not an EventMap key in src/shared/ipc-contract.ts`).toBe(true);
        }

        const s = sentinels(path);
        const reshape = RESHAPED_ARGS[path];
        if (reshape) {
          expect(o.args, `${path} must build this payload from its arguments (RESHAPED_ARGS)`).toEqual(reshape(s));
        } else {
          expect(
            o.args,
            `${path} must forward its arguments unchanged and in order. If it intentionally reshapes them, add it to RESHAPED_ARGS.`,
          ).toEqual(s.slice(0, o.args.length));
          expect(
            o.args.length,
            `${path} declares ${o.fnLength} parameter(s) but forwarded only ${o.args.length} — an argument was dropped`,
          ).toBeGreaterThanOrEqual(o.fnLength);
        }

        if (path in HIGH_RISK) {
          expect(o.channel, `${path} is high-risk and must use exactly "${HIGH_RISK[path]}"`).toBe(HIGH_RISK[path]);
        }
      });
    },
  );

  describe.each(IPC_LEAVES.filter((l) => isSubscription(l.name)).map((l) => [l.path, l] as const))(
    '%s',
    (path, leaf) => {
      it('subscribes on a real event channel, strips the event, and unsubscribes the same handler', () => {
        const o = observe(leaf);
        if (o.kind !== 'on') throw new Error('unreachable');

        expect(EVENT_MAP_KEYS.has(o.channel), `${path} subscribes to "${o.channel}", which is not an EventMap key in src/shared/ipc-contract.ts`).toBe(true);
        expect(CHANNEL_VALUES.has(o.channel), `${path} subscribes to "${o.channel}", which has no Channels constant — add one to src/shared/channels.ts and use it`).toBe(true);
        if (path in HIGH_RISK) {
          expect(o.channel, `${path} is high-risk and must use exactly "${HIGH_RISK[path]}"`).toBe(HIGH_RISK[path]);
        }

        const event = { sender: 'IpcRendererEvent' };
        o.handler(event, `«${path}:p0»`, `«${path}:p1»`);
        expect(o.cb).toHaveBeenCalledTimes(1);
        expect(o.cb.mock.calls[0], `${path} must not hand the IpcRendererEvent to the renderer`).not.toContain(event);
        const expected = DROPS_PAYLOAD.has(path) ? [] : [`«${path}:p0»`, `«${path}:p1»`];
        expect(o.cb.mock.calls[0], `${path} must forward the event payload unchanged (or be listed in DROPS_PAYLOAD)`).toEqual(expected);

        expect(typeof o.unsubscribe, `${path} must return an unsubscribe function`).toBe('function');
        expect(offMock).not.toHaveBeenCalled();
        (o.unsubscribe as () => void)();
        expect(offMock, `${path}'s unsubscribe must remove the same handler from the same channel`)
          .toHaveBeenCalledExactlyOnceWith(o.channel, o.handler);
      });
    },
  );

  describe.each(Object.keys(NON_IPC_LEAVES).map((p) => [p] as const))('%s (non-IPC)', (path) => {
    it('delegates to Electron locally and makes no IPC call', () => {
      const leaf = ALL.find((l) => l.path === path);
      expect(leaf, `NON_IPC_LEAVES names ${path}, which is not on window.api — remove the entry`).toBeDefined();
      NON_IPC_LEAVES[path]!(leaf!.fn);
      expect(invokeMock).not.toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();
      expect(onMock).not.toHaveBeenCalled();
    });
  });
});

describe('preload behaviour: surface-wide invariants (#2367)', () => {
  // Recomputed (not read from the per-leaf tests) so this block is
  // order-independent; built in beforeAll so a leaf that breaks observe()
  // fails a test with its message instead of crashing collection.
  let all = new Map<string, Observed>();
  beforeAll(() => {
    all = new Map(IPC_LEAVES.map((l) => [l.path, observe(l)]));
    vi.clearAllMocks();
  });

  it('every HIGH_RISK entry names a real leaf', () => {
    const missing = Object.keys(HIGH_RISK).filter((p) => !all.has(p));
    expect(missing, 'HIGH_RISK names leaves that no longer exist on window.api').toEqual([]);
  });

  it('every RESHAPED_ARGS / DROPS_PAYLOAD entry names a real leaf', () => {
    const missing = [...Object.keys(RESHAPED_ARGS), ...DROPS_PAYLOAD].filter((p) => !all.has(p));
    expect(missing).toEqual([]);
  });

  it('no two leaves share a channel (a copy-paste swap would duplicate one)', () => {
    const byChannel = new Map<string, string[]>();
    for (const [path, o] of all) (byChannel.get(`${o.kind}:${o.channel}`) ?? byChannel.set(`${o.kind}:${o.channel}`, []).get(`${o.kind}:${o.channel}`)!).push(path);
    const dupes = [...byChannel].filter(([, paths]) => paths.length > 1).map(([c, paths]) => `${c} ← ${paths.join(', ')}`);
    expect(dupes).toEqual([]);
  });

  it("no leaf uses a channel whose verb is a DIFFERENT sibling method's name", () => {
    const names = new Map<string, Set<string>>();
    for (const l of IPC_LEAVES) (names.get(l.ns) ?? names.set(l.ns, new Set()).get(l.ns)!).add(l.name);
    const crossed: string[] = [];
    for (const l of IPC_LEAVES) {
      const verb = all.get(l.path)!.channel.split(':').pop()!;
      if (verb !== l.name && names.get(l.ns)!.has(verb)) {
        crossed.push(`${l.path} uses "${all.get(l.path)!.channel}" — that verb is ${l.ns}.${verb}'s`);
      }
    }
    expect(crossed).toEqual([]);
  });

  it('the full method → channel map is snapshotted (catches swaps no derived check can)', () => {
    // The sibling-verb check above only catches a swap onto a channel NAMED
    // after the other method. 110 leaves have a channel verb that differs from
    // their own name (`graph.inspections` → `inspections:list`), and swapping
    // two of those (`runInspections` → `inspections:run`) passes every derived
    // check — verified. Hand-pinning all of them in HIGH_RISK would be 110
    // unreviewed copies of the current values; a snapshot is the same pin with
    // an honest diff. A swap shows up as two exchanged lines in
    // `__snapshots__/preload-behaviour.test.ts.snap` — read that diff before
    // re-blessing with `-u`; an added channel shows up as one new line.
    const map = Object.fromEntries(
      [...all].sort(([a], [b]) => a.localeCompare(b)).map(([path, o]) => [path, `${o.kind} ${o.channel}`]),
    );
    expect(map).toMatchSnapshot();
  });

  it('every ChannelMap key is invoked by some preload leaf (or is documented internal-only)', () => {
    const invoked = new Set([...all.values()].filter((o) => o.kind === 'invoke').map((o) => o.channel));
    const unreached = [...CHANNEL_MAP_KEYS].filter((k) => !invoked.has(k) && !(k in INTERNAL_INVOKE_CHANNELS));
    expect(
      unreached,
      'ChannelMap keys with no preload method: expose each via invoke() in src/preload/preload.ts, or list it in INTERNAL_INVOKE_CHANNELS with a reason',
    ).toEqual([]);
  });

  it('INTERNAL_INVOKE_CHANNELS holds only keys that are real and genuinely unreached', () => {
    const invoked = new Set([...all.values()].map((o) => o.channel));
    const stale = Object.keys(INTERNAL_INVOKE_CHANNELS).filter((k) => !CHANNEL_MAP_KEYS.has(k) || invoked.has(k));
    expect(stale, 'remove these from INTERNAL_INVOKE_CHANNELS').toEqual([]);
  });

  it('every EventMap key is subscribed or sent by some preload leaf (or is documented)', () => {
    const used = new Set([...all.values()].filter((o) => o.kind !== 'invoke').map((o) => o.channel));
    const unreached = [...EVENT_MAP_KEYS].filter((k) => !used.has(k) && !(k in UNSUBSCRIBED_EVENTS));
    expect(
      unreached,
      'EventMap keys nothing in preload listens to or sends: add a subscribe() leaf, or list it in UNSUBSCRIBED_EVENTS with a reason',
    ).toEqual([]);
  });

  it('UNSUBSCRIBED_EVENTS holds only real, genuinely unsubscribed keys', () => {
    const used = new Set([...all.values()].filter((o) => o.kind !== 'invoke').map((o) => o.channel));
    const stale = Object.keys(UNSUBSCRIBED_EVENTS).filter((k) => !EVENT_MAP_KEYS.has(k) || used.has(k));
    expect(stale, 'remove these from UNSUBSCRIBED_EVENTS').toEqual([]);
  });
});
