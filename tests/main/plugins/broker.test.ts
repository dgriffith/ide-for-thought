/**
 * The plugin host broker (#2825), one rule per test: the message, the
 * session, the capability, the scope, the limits, provenance — and that no
 * method reaches the approval engine.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createPluginSession, type BrokerDeps, type BrokerPort, type PluginIdentity } from '../../../src/main/plugins/broker';
import { PLUGIN_MAX_IN_FLIGHT, PLUGIN_MESSAGE_LIMIT_BYTES, PLUGIN_METHODS, PLUGIN_QUERY_ROW_LIMIT } from '../../../src/shared/plugins/api';
import type { RevisionSource } from '../../../src/shared/history';
import type { PluginCapability } from '../../../src/shared/plugins/capabilities';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('plugins');

const ROOT = '/tb';

function fakePort() {
  let onMessage: (data: unknown) => void = () => {};
  let onClose: () => void = () => {};
  const sent: unknown[] = [];
  const port: BrokerPort = {
    send: (text) => { sent.push(JSON.parse(text)); },
    onMessage: (fn) => { onMessage = fn; },
    onClose: (fn) => { onClose = fn; },
    close: vi.fn(),
  };
  return { port, sent, deliver: (data: unknown) => onMessage(data), hangUp: () => onClose() };
}

function fakeDeps(notes: Record<string, string> = {}) {
  const writes: Array<{ rel: string; content: string; source: RevisionSource }> = [];
  const intents: unknown[] = [];
  const copied: string[] = [];
  const menus: unknown[] = [];
  const deps: BrokerDeps = {
    readNote: async (_root, rel) => {
      if (!(rel in notes)) throw new Error(`ENOENT: no such file, open '/Users/someone/tb/${rel}'`);
      return notes[rel]!;
    },
    noteExists: async (_root, rel) => rel in notes,
    writeNote: async (_root, rel, content, source) => { notes[rel] = content; writes.push({ rel, content, source }); },
    queryGraph: async () => ({ ok: true, columns: ['s'], results: [{ s: 'x' }] }),
    querySql: async () => ({ ok: true, columns: ['n'], rows: [{ n: 1n }, { n: 2n ** 60n }] }),
    pathRefusal: (_root, rel) => (rel.startsWith('.') || rel.includes('/.') || rel.startsWith('linked/') ? 'it is in a hidden folder' : null),
    scopeRefusal: (rel) => (rel.startsWith('.') || rel.includes('/.') ? 'it is in a hidden folder' : null),
    intent: (i) => { intents.push(i); },
    copyText: (t) => { copied.push(t); },
    showMenu: async (items) => { menus.push(items); return 'second'; },
  };
  return { deps, notes, writes, intents, copied, menus };
}

/** A reply's result, loosely: each test reads the fields its method answers with. */
type Result = Record<string, unknown> & { rows: unknown[]; truncated: boolean; content: string; path: string; properties: unknown };

const ALL: PluginCapability[] = ['notes:read', 'graph:query', 'ui', 'notes:write-properties', 'notes:write', 'llm:propose'];

function open(opts: {
  capabilities?: PluginCapability[];
  scope?: string[];
  notes?: Record<string, string>;
  stillValid?: () => string | null;
  deps?: Partial<BrokerDeps>;
} = {}) {
  const p = fakePort();
  const d = fakeDeps(opts.notes ?? { 'a.md': '---\nstatus: todo\n---\n# A\n', 'b.md': '# B\n' });
  const identity: PluginIdentity = { id: 'board', name: 'Board', version: '1.2.0', capabilities: opts.capabilities ?? ALL };
  const session = createPluginSession({
    identity,
    rootPath: ROOT,
    scope: opts.scope ?? ['a.md'],
    port: p.port,
    deps: { ...d.deps, ...opts.deps },
    stillValid: opts.stillValid ?? (() => null),
  });
  let next = 1;
  const call = async (method: string, params?: unknown) => {
    const id = next++;
    p.deliver(JSON.stringify({ id, method, params }));
    await vi.waitFor(() => { if (!p.sent.some((m) => (m as { id: unknown }).id === id)) throw new Error('no reply'); });
    return p.sent.find((m) => (m as { id: unknown }).id === id) as { id: number; result?: Result; error?: { code: string; message: string } };
  };
  return { ...p, ...d, session, call };
}

describe('the message (#2825)', () => {
  it('answers JSON text with the same id', async () => {
    const s = open();
    expect(await s.call('notes.list')).toEqual({ id: 1, result: { paths: ['a.md'] } });
  });

  it('refuses a non-text message, non-JSON, a missing id, and an unknown method', async () => {
    const s = open();
    s.deliver({ id: 1, method: 'notes.list' });
    s.deliver('{nope');
    s.deliver(JSON.stringify({ method: 'notes.list' }));
    await vi.waitFor(() => expect(s.sent).toHaveLength(3));
    expect(s.sent.map((m) => (m as { error: { code: string } }).error.code)).toEqual(['bad-request', 'bad-request', 'bad-request']);
    expect((await s.call('fs.readFile', { path: '/etc/passwd' })).error?.code).toBe('unknown-method');
    expect((await s.call('__proto__')).error?.code).toBe('unknown-method');
    expect((await s.call('notes.read', 'a.md')).error?.code).toBe('bad-request'); // params not an object
    expect((await s.call('notes.read', { path: 7 })).error?.code).toBe('bad-request');
  });

  it('refuses a message over the size limit, and replaces an answer over it with an error', async () => {
    const s = open({ notes: { 'a.md': 'x'.repeat(PLUGIN_MESSAGE_LIMIT_BYTES + 10) } });
    s.deliver(JSON.stringify({ id: 1, method: 'ui.copyText', params: { text: 'y'.repeat(PLUGIN_MESSAGE_LIMIT_BYTES) } }));
    await vi.waitFor(() => expect(s.sent).toHaveLength(1));
    expect((s.sent[0] as { error: { code: string } }).error.code).toBe('too-large');
    expect(s.copied).toEqual([]);
    const big = await s.call('notes.read', { path: 'a.md' });
    expect(big.error?.code).toBe('too-large');
  });
});

describe('the capability (#2825)', () => {
  it('refuses every method whose capability is not declared, naming it, and runs nothing', async () => {
    const s = open({ capabilities: [] });
    for (const [method, { capability }] of Object.entries(PLUGIN_METHODS)) {
      const r = await s.call(method, { path: 'a.md', sparql: 'SELECT * {}', sql: 'SELECT 1', text: 't', content: 'c', properties: { x: 1 } });
      expect(r.error?.code, method).toBe('capability');
      expect(r.error?.message, method).toContain(`"${capability}"`);
    }
    expect(s.writes).toEqual([]);
    expect(s.intents).toEqual([]);
    expect(s.copied).toEqual([]);
  });

  it('read-only grants do not write: notes:read alone cannot set properties or write', async () => {
    const s = open({ capabilities: ['notes:read'] });
    expect((await s.call('notes.read', { path: 'a.md' })).result?.properties).toEqual({ status: 'todo' });
    expect((await s.call('notes.setProperties', { path: 'a.md', properties: { status: 'done' } })).error?.code).toBe('capability');
    expect((await s.call('notes.write', { path: 'a.md', content: 'pwned' })).error?.code).toBe('capability');
    expect(s.writes).toEqual([]);
  });

  it('notes:write-properties does not grant writing the body', async () => {
    const s = open({ capabilities: ['notes:write-properties'] });
    expect((await s.call('notes.write', { path: 'a.md', content: 'pwned' })).error?.code).toBe('capability');
    expect((await s.call('notes.create', { path: 'n.md', content: '' })).error?.code).toBe('capability');
  });

  it('llm.propose is declared but not available yet (#2858)', async () => {
    const s = open();
    const r = await s.call('llm.propose', {});
    expect(r.error).toEqual({ code: 'unavailable', message: expect.stringContaining('#2858') });
  });
});

describe('the scope (#2825)', () => {
  it('reads and writes only the notes the session was given', async () => {
    const s = open({ scope: ['a.md'] });
    expect((await s.call('notes.read', { path: 'b.md' })).error?.code).toBe('scope');
    expect((await s.call('notes.setProperties', { path: 'b.md', properties: { x: 1 } })).error?.code).toBe('scope');
    expect((await s.call('notes.write', { path: 'b.md', content: 'x' })).error?.code).toBe('scope');
    expect((await s.call('ui.openNote', { path: 'b.md' })).error?.code).toBe('scope');
    expect(s.writes).toEqual([]);
  });

  it('matches spellings of the same path, and refuses spellings that leave it', async () => {
    const s = open({ scope: ['notes/a.md'], notes: { 'notes/a.md': '# A' } });
    expect((await s.call('notes.read', { path: './notes/a.md' })).result?.path).toBe('notes/a.md');
    expect((await s.call('notes.read', { path: 'notes\\a.md' })).result?.path).toBe('notes/a.md');
    expect((await s.call('notes.read', { path: 'notes/x/../a.md' })).result?.path).toBe('notes/a.md');
    expect((await s.call('notes.read', { path: '.minerva/secrets.json' })).error?.code).toBe('scope');
  });

  it('a path a plugin may never name stays out of the scope, even when the host gives it', async () => {
    const s = open({ scope: ['a.md', '.minerva/config.json'] });
    expect((await s.call('notes.list')).result).toEqual({ paths: ['a.md'] });
    expect((await s.call('notes.read', { path: '.minerva/config.json' })).error?.code).toBe('scope');
  });

  it('follows setScope', async () => {
    const s = open({ scope: ['a.md'] });
    s.session.setScope(['b.md']);
    expect((await s.call('notes.read', { path: 'a.md' })).error?.code).toBe('scope');
    expect((await s.call('notes.read', { path: 'b.md' })).result?.content).toBe('# B\n');
  });

  it('a note it creates joins its scope; an existing, hidden or non-note path is refused', async () => {
    const s = open({ scope: [] });
    expect((await s.call('notes.create', { path: 'a.md', content: 'x' })).error?.code).toBe('failed');
    expect((await s.call('notes.create', { path: '.minerva/x.md', content: 'x' })).error?.code).toBe('scope');
    expect((await s.call('notes.create', { path: 'evil.html', content: '<script>' })).error?.code).toBe('bad-request');
    expect((await s.call('notes.create', { path: 'new.md', content: '# New' })).result).toEqual({ path: 'new.md' });
    expect((await s.call('notes.read', { path: 'new.md' })).result?.content).toBe('# New');
  });
});

describe('writes carry provenance (#2825, #1157)', () => {
  it('records every plugin write in history as plugin:<id>@<version>', async () => {
    const s = open({ scope: ['a.md'] });
    expect((await s.call('notes.setProperties', { path: 'a.md', properties: { status: 'done' } })).result).toEqual({ changed: ['status'] });
    await s.call('notes.write', { path: 'a.md', content: '# rewritten' });
    await s.call('notes.create', { path: 'c.md', content: '# C' });
    expect(s.writes.map((w) => w.rel)).toEqual(['a.md', 'a.md', 'c.md']);
    for (const w of s.writes) expect(w.source).toEqual({ origin: 'plugin', cause: 'Board (plugin:board@1.2.0)' });
    expect(s.writes[0]!.content).toContain('status: done');
  });

  it('a property patch that changes nothing writes nothing', async () => {
    const s = open({ scope: ['a.md'] });
    expect((await s.call('notes.setProperties', { path: 'a.md', properties: { status: 'todo' } })).result).toEqual({ changed: [] });
    expect(s.writes).toEqual([]);
  });
});

describe('queries, intents and failures (#2825)', () => {
  it('answers queries with columns, rows (BigInt-safe) and a truncated flag', async () => {
    const s = open();
    expect((await s.call('graph.query', { sparql: 'SELECT ?s {}' })).result).toEqual({ columns: ['s'], rows: [{ s: 'x' }], truncated: false });
    expect((await s.call('tables.query', { sql: 'SELECT 1' })).result).toEqual({
      columns: ['n'], rows: [{ n: 1 }, { n: (2n ** 60n).toString() }], truncated: false,
    });
  });

  it('caps rows at the query limit', async () => {
    const rows = Array.from({ length: PLUGIN_QUERY_ROW_LIMIT + 5 }, (_, i) => ({ i }));
    const s = open({ deps: { querySql: async () => ({ ok: true, columns: ['i'], rows }) } });
    const r = await s.call('tables.query', { sql: 'SELECT * FROM range(9999)' });
    expect(r.result.rows).toHaveLength(PLUGIN_QUERY_ROW_LIMIT);
    expect(r.result.truncated).toBe(true);
  });

  it('passes a refused query on as failed, with the guard\'s words', async () => {
    const s = open({ deps: { querySql: async () => ({ ok: false, error: "Refused: read_text reads a file. A plugin's tables.query can only read…" }) } });
    expect((await s.call('tables.query', { sql: "SELECT * FROM read_text('.minerva/secrets.json')" })).error).toEqual({
      code: 'failed', message: expect.stringContaining("plugin's tables.query"),
    });
  });

  it('sends ui intents to the window, scoped where they name a note', async () => {
    const s = open({ scope: ['a.md'] });
    await s.call('ui.openNote', { path: 'a.md' });
    await s.call('ui.announce', { text: 'Moved to Done' });
    await s.call('ui.copyText', { text: 'copied' });
    expect(s.intents).toEqual([{ kind: 'openNote', path: 'a.md' }, { kind: 'announce', text: 'Moved to Done' }]);
    expect(s.copied).toEqual(['copied']);
  });

  it('a missing note is failed without main\'s path; an unexpected error says only that it failed', async () => {
    const s = open({ scope: ['gone.md'] });
    const missing = await s.call('notes.read', { path: 'gone.md' });
    expect(missing.error).toEqual({ code: 'failed', message: '"gone.md" doesn\'t exist.' });
    const t = open({ scope: ['a.md'], deps: { readNote: async () => { throw new Error("EACCES: open '/Users/someone/tb/a.md'"); } } });
    const r = await t.call('notes.read', { path: 'a.md' });
    expect(r.error?.code).toBe('failed');
    expect(r.error?.message).not.toContain('/Users/');
  });
});

describe('the session (#2825)', () => {
  it('refuses and closes when stillValid says it has ended', async () => {
    let ended: string | null = null;
    const s = open({ stillValid: () => ended });
    expect((await s.call('notes.list')).result).toBeDefined();
    ended = 'Board has been turned off.';
    expect((await s.call('notes.read', { path: 'a.md' })).error).toEqual({ code: 'unavailable', message: 'Board has been turned off.' });
    expect(s.session.closed).toBe(true);
    expect(s.port.close).toHaveBeenCalled();
  });

  it('closes when the port does, telling its listeners once', () => {
    const s = open();
    const onClose = vi.fn();
    s.session.onClose(onClose);
    s.hangUp();
    s.hangUp();
    expect(s.session.closed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it(`allows ${PLUGIN_MAX_IN_FLIGHT} calls at once, and refuses the next as busy`, async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const s = open({ deps: { queryGraph: async () => { await gate; return { ok: true, columns: [], results: [] }; } } });
    for (let i = 1; i <= PLUGIN_MAX_IN_FLIGHT + 1; i++) s.deliver(JSON.stringify({ id: i, method: 'graph.query', params: { sparql: 'x' } }));
    await vi.waitFor(() => expect(s.sent).toHaveLength(1));
    expect(s.sent[0]).toEqual({ id: PLUGIN_MAX_IN_FLIGHT + 1, error: { code: 'busy', message: expect.any(String) } });
    release();
    await vi.waitFor(() => expect(s.sent).toHaveLength(PLUGIN_MAX_IN_FLIGHT + 1));
  });
});

describe('nothing reaches the approval engine (#2825)', () => {
  it('the broker and its wiring import nothing from llm/ and name no proposal operation', () => {
    for (const rel of ['src/main/plugins/broker.ts', 'src/main/plugins/code-plugins.ts', 'src/main/plugin-sessions.ts']) {
      const code = fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8');
      expect(code, rel).not.toMatch(/from ['"][./]*(?:llm|\.\.\/llm)\//);
      expect(code, rel).not.toMatch(/\b(?:approveProposal|rejectProposal|expireProposals?|proposeWrite|applyBundle|withTrustedContext|enterTrustedContext)\b/);
    }
  });

  it('the API has no proposal method but the refused llm.propose', () => {
    expect(Object.keys(PLUGIN_METHODS).filter((m) => /propos|approv|reject|expire/i.test(m))).toEqual(['llm.propose']);
  });
});

describe('the ui kit (#2827)', () => {
  it('reveals only a note it was given', async () => {
    const s = open({ scope: ['a.md'] });
    await s.call('ui.revealNote', { path: 'a.md' });
    expect((await s.call('ui.revealNote', { path: 'b.md' })).error?.code).toBe('scope');
    expect(s.intents).toEqual([{ kind: 'revealNote', path: 'a.md' }]);
  });

  it('shows a menu Minerva draws, and answers the chosen id', async () => {
    const s = open();
    const r = await s.call('ui.showMenu', { items: [{ id: 'first', label: 'Move to Done' }, { separator: true }, { id: 'second', label: 'Open', enabled: false }] });
    expect(r.result).toEqual({ id: 'second' });
    expect(s.menus).toEqual([[{ id: 'first', label: 'Move to Done' }, { separator: true }, { id: 'second', label: 'Open', enabled: false }]]);
  });

  it('refuses a menu that is empty, too long, or has items without an id or label', async () => {
    const s = open();
    for (const items of [[], 'x', Array.from({ length: 51 }, (_, i) => ({ id: `${i}`, label: 'x' })),
      [{ label: 'no id' }], [{ id: 'x', label: '  ' }], [{ id: 'x', label: 'y'.repeat(121) }], [null]]) {
      expect((await s.call('ui.showMenu', { items })).error?.code, JSON.stringify(items).slice(0, 40)).toBe('bad-request');
    }
    expect(s.menus).toEqual([]);
  });

  it('passes on releaseFocus and a forwarded key as intents, for the host to decide', async () => {
    const s = open();
    await s.call('ui.releaseFocus');
    await s.call('ui.forwardKey', { key: 'k', meta: true, shift: 'yes' });
    expect(s.intents).toEqual([
      { kind: 'releaseFocus' },
      { kind: 'key', key: 'k', meta: true, ctrl: false, alt: false, shift: false },
    ]);
    expect((await s.call('ui.forwardKey', { key: '' })).error?.code).toBe('bad-request');
    expect((await s.call('ui.forwardKey', { key: 'x'.repeat(33) })).error?.code).toBe('bad-request');
  });

  it('none of them without the ui capability', async () => {
    const s = open({ capabilities: ['notes:read'] });
    for (const m of ['ui.revealNote', 'ui.showMenu', 'ui.releaseFocus', 'ui.forwardKey']) {
      expect((await s.call(m, { path: 'a.md', items: [{ id: 'a', label: 'b' }], key: 'k' })).error?.code, m).toBe('capability');
    }
    expect(s.menus).toEqual([]);
    expect(s.intents).toEqual([]);
  });
});

describe('events and drops (#2827)', () => {
  it('emits an event on the port as { event, data }', () => {
    const s = open();
    s.session.emit('theme', { mode: 'light', vars: { '--bg': '#fff' } });
    expect(s.sent).toEqual([{ event: 'theme', data: { mode: 'light', vars: { '--bg': '#fff' } } }]);
  });

  it('sends nothing once closed, or over the size limit', () => {
    const s = open();
    s.session.emit('theme', { mode: 'x', vars: { '--bg': 'y'.repeat(PLUGIN_MESSAGE_LIMIT_BYTES) } });
    s.session.close();
    s.session.emit('theme', { mode: 'x', vars: {} });
    expect(s.sent).toEqual([]);
  });

  it('a drop adds what a plugin may be given to its scope, and nothing else', async () => {
    const s = open({ scope: ['a.md'] });
    expect(s.session.addToScope(['b.md', '.minerva/secrets.json', './b.md'])).toEqual(['b.md']);
    expect((await s.call('notes.list')).result).toEqual({ paths: ['a.md', 'b.md'] });
    expect((await s.call('notes.read', { path: '.minerva/secrets.json' })).error?.code).toBe('scope');
  });
});

describe('scope admission is cheap; access is checked in full (#2827)', () => {
  it('a path that only the full check refuses (a link out) is admitted, then refused on use', async () => {
    const s = open({ scope: ['linked/escape.md'], notes: { 'linked/escape.md': 'outside!' } });
    expect((await s.call('notes.list')).result).toEqual({ paths: ['linked/escape.md'] });
    const r = await s.call('notes.read', { path: 'linked/escape.md' });
    expect(r.error?.code).toBe('scope');
    expect(JSON.stringify(r)).not.toContain('outside!');
  });
});
