/**
 * @vitest-environment node
 *
 * Main-process coverage for `register-links.ts` (#1840).
 *
 * Every handler here is `withRootPathOr`, so the whole file is a test of #1631
 * rule 2: each project-less fallback has to be an answer a panel can render
 * ("nothing related", "no backlinks"), never an error in disguise. Those are
 * pinned first.
 *
 * The rest is the ranking contract the Related / Unlinked-mentions / semantic
 * query surfaces depend on and that no other test covers end-to-end: the
 * limit is clamped and the chunk fetch over-fetches ×5 so best-per-ref de-dup
 * still yields a full page; titles are resolved per hit KIND (a source's title,
 * a literal "Excerpt", a note's title); already-linked is computed from links
 * in BOTH directions; and the optional `kinds` / `excludePath` are omitted
 * rather than passed as `undefined`.
 *
 * The pure ranking module (`embeddings/related`) is used for real — mocking it
 * would leave the de-dup and ordering untested at this boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ROOT = '/vault';
/** What `rootPathFromEvent` reports; null models "no project open". */
let openProject: string | null = ROOT;

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  // vector store
  isEnabled: vi.fn(),
  relatedToNote: vi.fn(),
  searchRelated: vi.fn(),
  // graph
  noteTitle: vi.fn(),
  sourceTitle: vi.fn(),
  aliasesForNote: vi.fn(),
  outgoingLinks: vi.fn(),
  backlinks: vi.fn(),
  citationsForNote: vi.fn(),
  findExternalInboundLinks: vi.fn(),
  neighborhood: vi.fn(),
  expandNode: vi.fn(),
  // notebase fs
  readFile: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { h.handlers.set(channel, fn); } },
}));

vi.mock('../../../src/main/ipc/helpers', () => ({
  withRootPathOr:
    <A extends unknown[], R>(fallback: R, fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => (openProject ? fn(openProject, ...args) : fallback),
}));

vi.mock('../../../src/main/embeddings/vector-store', () => ({
  isEnabled: h.isEnabled,
  relatedToNote: h.relatedToNote,
  searchRelated: h.searchRelated,
}));
vi.mock('../../../src/main/graph/index', () => ({
  noteTitle: h.noteTitle,
  sourceTitle: h.sourceTitle,
  aliasesForNote: h.aliasesForNote,
  outgoingLinks: h.outgoingLinks,
  backlinks: h.backlinks,
  citationsForNote: h.citationsForNote,
  findExternalInboundLinks: h.findExternalInboundLinks,
  neighborhood: h.neighborhood,
  expandNode: h.expandNode,
}));
vi.mock('../../../src/main/notebase/fs', () => ({ readFile: h.readFile }));

import { registerLinks } from '../../../src/main/ipc/register-links';
import { Channels } from '../../../src/shared/channels';

registerLinks();

const call = (channel: string, ...args: unknown[]): unknown => h.handlers.get(channel)!({}, ...args);
/** Await a handler's answer whether it replied synchronously or with a promise
 *  (the `withRootPathOr` fallbacks are returned synchronously). */
const callAsync = async (channel: string, ...args: unknown[]): Promise<unknown> => call(channel, ...args);
/** The ProjectContext the registrar builds from the root path. */
const CTX = { rootPath: ROOT, _brand: 'ProjectContext' };

/** A chunk hit as the vector store returns them. */
const hit = (over: Partial<{ kind: string; ref: string; sectionHeading: string; chunkText: string; score: number }> = {}) => ({
  kind: 'note', ref: 'a.md', sectionHeading: 'Intro', chunkText: 'text', score: 0.5, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  openProject = ROOT;
  h.isEnabled.mockReturnValue(true);
  h.relatedToNote.mockResolvedValue([]);
  h.searchRelated.mockResolvedValue([]);
  h.outgoingLinks.mockReturnValue([]);
  h.backlinks.mockReturnValue([]);
  h.aliasesForNote.mockReturnValue([]);
  h.noteTitle.mockImplementation((_c: unknown, ref: string) => `Title of ${ref}`);
  h.sourceTitle.mockImplementation((_c: unknown, ref: string) => `Source ${ref}`);
});

describe('register-links — the #1631 project guard', () => {
  // Every handler in this registrar is `withRootPathOr`. Each fallback below is
  // a value a panel renders as "nothing here" — the same thing it shows for a
  // note that genuinely has no links — so none of them is an error in disguise.
  const fallbacks: [string, unknown[], unknown][] = [
    [Channels.EMBEDDINGS_RELATED, ['a.md'], { enabled: false, notes: [] }],
    [Channels.EMBEDDINGS_UNLINKED_MENTIONS, ['a.md'], { enabled: false, notes: [] }],
    [Channels.EMBEDDINGS_SEARCH_TEXT, ['query'], { enabled: false, notes: [] }],
    [Channels.LINKS_OUTGOING, ['a.md'], []],
    [Channels.LINKS_BACKLINKS, ['a.md'], []],
    [Channels.LINKS_BUNDLE, ['a.md'], { outgoing: [], backlinks: [] }],
    [Channels.LINKS_CITATIONS_FOR_NOTE, ['a.md'], []],
    [Channels.LINKS_EXTERNAL_INBOUND, [['a.md']], []],
    [Channels.LINKS_NEIGHBORHOOD, ['a.md'], { nodes: [], edges: [], truncated: false }],
    [Channels.LINKS_EXPAND_NODE, ['a.md'], { nodes: [], edges: [], expandTo: [] }],
  ];

  it.each(fallbacks)('%s answers with its empty value and no project', async (channel, args, expected) => {
    openProject = null;
    await expect(callAsync(channel, ...args)).resolves.toEqual(expected);
  });

  it('no graph or vector lookup is attempted with no project', async () => {
    openProject = null;
    for (const [channel, args] of fallbacks) await callAsync(channel, ...args);
    expect(h.relatedToNote).not.toHaveBeenCalled();
    expect(h.searchRelated).not.toHaveBeenCalled();
    expect(h.outgoingLinks).not.toHaveBeenCalled();
    expect(h.readFile).not.toHaveBeenCalled();
  });
});

describe('register-links — EMBEDDINGS_RELATED (#838/#839/#840)', () => {
  it('reports the feature off — not an empty list — when embeddings are disabled', async () => {
    // `enabled: false` is what makes the panel say "turn on semantic search"
    // rather than "this note has no related notes".
    h.isEnabled.mockReturnValue(false);
    await expect(callAsync(Channels.EMBEDDINGS_RELATED, 'a.md')).resolves.toEqual({ enabled: false, notes: [] });
    expect(h.relatedToNote).not.toHaveBeenCalled();
  });

  it('over-fetches five chunks per wanted result so best-per-ref de-dup still fills the page', async () => {
    await call(Channels.EMBEDDINGS_RELATED, 'a.md');
    expect(h.relatedToNote).toHaveBeenCalledWith(CTX, 'a.md', { limit: 40 }); // default 8 × 5
  });

  it.each([
    [undefined, 40],  // default 8
    [3, 15],
    [0, 5],           // floored up to 1
    [-7, 5],          // negative can't mean "none"
    [100, 125],       // capped at 25
    [3.9, 15],        // fractional limits are floored
  ])('clamps a requested limit of %s to an over-fetch of %i', async (limit, expected) => {
    await call(Channels.EMBEDDINGS_RELATED, 'a.md', limit);
    expect(h.relatedToNote).toHaveBeenCalledWith(CTX, 'a.md', { limit: expected });
  });

  it('keeps only each note\'s best-scoring section', async () => {
    h.relatedToNote.mockResolvedValue([
      hit({ ref: 'b.md', sectionHeading: 'Weak', score: 0.3 }),
      hit({ ref: 'b.md', sectionHeading: 'Strong', score: 0.9 }),
    ]);
    const result = await call(Channels.EMBEDDINGS_RELATED, 'a.md') as { notes: { sectionHeading: string }[] };
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]!.sectionHeading).toBe('Strong');
  });

  it('titles each hit by its kind — sources, excerpts and notes read differently', async () => {
    h.relatedToNote.mockResolvedValue([
      hit({ kind: 'note', ref: 'b.md', score: 0.9 }),
      hit({ kind: 'source', ref: 'src1', score: 0.8 }),
      hit({ kind: 'excerpt', ref: 'ex1', score: 0.7 }),
    ]);
    const result = await call(Channels.EMBEDDINGS_RELATED, 'a.md') as { notes: { title: string }[] };
    expect(result.notes.map((n) => n.title)).toEqual(['Title of b.md', 'Source src1', 'Excerpt']);
  });

  it('flags a note as already linked from either direction', async () => {
    // Only unlinked-but-related notes should be offered a "suggest link", and a
    // link pointing the other way still counts as linked (#840).
    h.relatedToNote.mockResolvedValue([
      hit({ ref: 'out.md', score: 0.9 }),
      hit({ ref: 'in.md', score: 0.8 }),
      hit({ ref: 'free.md', score: 0.7 }),
    ]);
    h.outgoingLinks.mockReturnValue([{ target: 'out.md' }]);
    h.backlinks.mockReturnValue([{ source: 'in.md' }]);

    const result = await call(Channels.EMBEDDINGS_RELATED, 'a.md') as {
      enabled: boolean; notes: { ref: string; alreadyLinked?: boolean }[];
    };

    expect(result.enabled).toBe(true);
    expect(result.notes.map((n) => [n.ref, n.alreadyLinked])).toEqual([
      ['out.md', true], ['in.md', true], ['free.md', false],
    ]);
  });
});

describe('register-links — EMBEDDINGS_UNLINKED_MENTIONS (#1074)', () => {
  it('searches on the object\'s title AND aliases, not its body', async () => {
    // Unlike EMBEDDINGS_RELATED this embeds the object's NAMES at query time,
    // so a note that merely mentions it by any alias surfaces.
    h.noteTitle.mockReturnValue('Bayes Theorem');
    h.aliasesForNote.mockReturnValue(['Bayes rule', 'Bayes law']);

    await call(Channels.EMBEDDINGS_UNLINKED_MENTIONS, 'objects/bayes.md', 4);

    expect(h.searchRelated).toHaveBeenCalledWith(CTX, 'Bayes Theorem\nBayes rule\nBayes law', {
      limit: 20,
      kinds: ['note'],
      exclude: { kind: 'note', ref: 'objects/bayes.md' }, // never mention itself
    });
  });

  it('drops blank aliases from the query text', async () => {
    h.noteTitle.mockReturnValue('Bayes');
    h.aliasesForNote.mockReturnValue(['', '   ', 'Bayes rule']);
    await call(Channels.EMBEDDINGS_UNLINKED_MENTIONS, 'a.md');
    expect(h.searchRelated.mock.calls[0]![1]).toBe('Bayes\nBayes rule');
  });

  it('reports "enabled, nothing to match on" for an untitled, alias-less note', async () => {
    // Searching on an empty string would rank the whole corpus at random.
    h.noteTitle.mockReturnValue('');
    h.aliasesForNote.mockReturnValue([]);
    await expect(callAsync(Channels.EMBEDDINGS_UNLINKED_MENTIONS, 'a.md'))
      .resolves.toEqual({ enabled: true, notes: [] });
    expect(h.searchRelated).not.toHaveBeenCalled();
  });

  it('reports the feature off when embeddings are disabled', async () => {
    h.isEnabled.mockReturnValue(false);
    await expect(callAsync(Channels.EMBEDDINGS_UNLINKED_MENTIONS, 'a.md'))
      .resolves.toEqual({ enabled: false, notes: [] });
  });

  it('flags the already-linked mentions so only the genuinely unlinked are offered', async () => {
    h.noteTitle.mockImplementation((_c: unknown, ref: string) => (ref === 'a.md' ? 'Bayes' : `Title of ${ref}`));
    h.searchRelated.mockResolvedValue([hit({ ref: 'linked.md', score: 0.9 }), hit({ ref: 'free.md', score: 0.8 })]);
    h.backlinks.mockReturnValue([{ source: 'linked.md' }]);

    const result = await call(Channels.EMBEDDINGS_UNLINKED_MENTIONS, 'a.md') as {
      notes: { ref: string; alreadyLinked?: boolean }[];
    };
    expect(result.notes.map((n) => [n.ref, n.alreadyLinked])).toEqual([['linked.md', true], ['free.md', false]]);
  });
});

describe('register-links — EMBEDDINGS_SEARCH_TEXT (#1128)', () => {
  it('refuses to rank the corpus against a blank query', async () => {
    await expect(callAsync(Channels.EMBEDDINGS_SEARCH_TEXT, '   ')).resolves.toEqual({ enabled: false, notes: [] });
    expect(h.searchRelated).not.toHaveBeenCalled();
  });

  it('passes neither kinds nor exclude when the block set no options', async () => {
    // Passing `kinds: undefined` / `exclude: undefined` would look like a real
    // restriction to the store rather than "no restriction".
    await call(Channels.EMBEDDINGS_SEARCH_TEXT, 'why is the sky blue');
    expect(h.searchRelated).toHaveBeenCalledWith(CTX, 'why is the sky blue', { limit: 40 });
  });

  it('ignores an empty kinds array — restricting to nothing is not a restriction', async () => {
    await call(Channels.EMBEDDINGS_SEARCH_TEXT, 'q', { kinds: [] });
    expect(h.searchRelated).toHaveBeenCalledWith(CTX, 'q', { limit: 40 });
  });

  it('applies the block\'s kinds, limit, and host-note exclusion', async () => {
    await call(Channels.EMBEDDINGS_SEARCH_TEXT, 'q', { limit: 2, kinds: ['source'], excludePath: 'host.md' });
    expect(h.searchRelated).toHaveBeenCalledWith(CTX, 'q', {
      limit: 10,
      kinds: ['source'],
      exclude: { kind: 'note', ref: 'host.md' },
    });
  });

  it('ranks results without an already-linked flag — this is a read-only query', async () => {
    h.searchRelated.mockResolvedValue([hit({ ref: 'b.md', score: 0.9 })]);
    const result = await call(Channels.EMBEDDINGS_SEARCH_TEXT, 'q') as {
      notes: { ref: string; alreadyLinked?: boolean }[];
    };
    expect(result.notes[0]).toMatchObject({ ref: 'b.md', title: 'Title of b.md' });
    expect(result.notes[0]!.alreadyLinked).toBeUndefined();
    expect(h.outgoingLinks).not.toHaveBeenCalled();
  });
});

describe('register-links — the link panels', () => {
  it('LINKS_OUTGOING and LINKS_BACKLINKS each read one direction', () => {
    h.outgoingLinks.mockReturnValue([{ target: 'b.md' }]);
    h.backlinks.mockReturnValue([{ source: 'c.md' }]);
    expect(call(Channels.LINKS_OUTGOING, 'a.md')).toEqual([{ target: 'b.md' }]);
    expect(call(Channels.LINKS_BACKLINKS, 'a.md')).toEqual([{ source: 'c.md' }]);
  });

  it('LINKS_BUNDLE returns both directions from a single round-trip (#351)', () => {
    h.outgoingLinks.mockReturnValue([{ target: 'b.md' }]);
    h.backlinks.mockReturnValue([{ source: 'c.md' }]);

    expect(call(Channels.LINKS_BUNDLE, 'a.md')).toEqual({
      outgoing: [{ target: 'b.md' }],
      backlinks: [{ source: 'c.md' }],
    });
    // One pass each — the point of the bundle is to replace two IPC calls.
    expect(h.outgoingLinks).toHaveBeenCalledTimes(1);
    expect(h.backlinks).toHaveBeenCalledTimes(1);
  });

  it('LINKS_EXTERNAL_INBOUND asks the graph about the whole path set at once', () => {
    h.findExternalInboundLinks.mockReturnValue([{ source: 'x.md', target: 'a.md' }]);
    expect(call(Channels.LINKS_EXTERNAL_INBOUND, ['a.md', 'b.md']))
      .toEqual([{ source: 'x.md', target: 'a.md' }]);
    expect(h.findExternalInboundLinks).toHaveBeenCalledWith(CTX, ['a.md', 'b.md']);
  });

  it('LINKS_NEIGHBORHOOD substitutes empty options when the view passed none', () => {
    h.neighborhood.mockReturnValue({ nodes: [], edges: [], truncated: false });
    call(Channels.LINKS_NEIGHBORHOOD, 'a.md');
    expect(h.neighborhood).toHaveBeenCalledWith(CTX, 'a.md', {});
  });

  it('LINKS_NEIGHBORHOOD forwards the depth the view asked for', () => {
    h.neighborhood.mockReturnValue({ nodes: [], edges: [], truncated: true });
    expect(call(Channels.LINKS_NEIGHBORHOOD, 'a.md', { depth: 3 }))
      .toEqual({ nodes: [], edges: [], truncated: true });
    expect(h.neighborhood).toHaveBeenCalledWith(CTX, 'a.md', { depth: 3 });
  });

  it('LINKS_EXPAND_NODE reports the single hop out of a node', () => {
    h.expandNode.mockReturnValue({ nodes: [{ id: 'b.md' }], edges: [], expandTo: ['b.md'] });
    expect(call(Channels.LINKS_EXPAND_NODE, 'a.md'))
      .toEqual({ nodes: [{ id: 'b.md' }], edges: [], expandTo: ['b.md'] });
  });
});

describe('register-links — LINKS_CITATIONS_FOR_NOTE', () => {
  it('counts against the live editor buffer when the renderer supplies one', async () => {
    // The count has to track what the user is typing right now, so a supplied
    // buffer must win over — and skip — the on-disk copy.
    h.citationsForNote.mockReturnValue([{ sourceId: 's1', count: 2 }]);

    await expect(callAsync(Channels.LINKS_CITATIONS_FOR_NOTE, 'a.md', 'live @s1 @s1 text'))
      .resolves.toEqual([{ sourceId: 's1', count: 2 }]);

    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.citationsForNote).toHaveBeenCalledWith(CTX, 'a.md', 'live @s1 @s1 text');
  });

  it('falls back to disk when refreshed from a graph event with no open buffer', async () => {
    h.readFile.mockResolvedValue('on-disk @s1');
    h.citationsForNote.mockReturnValue([]);

    await call(Channels.LINKS_CITATIONS_FOR_NOTE, 'a.md');

    expect(h.readFile).toHaveBeenCalledWith(ROOT, 'a.md');
    expect(h.citationsForNote).toHaveBeenCalledWith(CTX, 'a.md', 'on-disk @s1');
  });

  it('an empty live buffer is used as-is, not treated as "no buffer"', async () => {
    // `?? ` (not `||`) — a note the user just cleared has zero citations, and
    // must not silently fall back to the stale file on disk.
    h.citationsForNote.mockReturnValue([]);
    await call(Channels.LINKS_CITATIONS_FOR_NOTE, 'a.md', '');
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.citationsForNote).toHaveBeenCalledWith(CTX, 'a.md', '');
  });

  // NOT pinned here, deliberately: the disk fallback is `.catch(() => '')`,
  // which turns a real read failure (EACCES, a corrupt mount) into "this note
  // cites nothing". That swallow is already on CLAUDE.md's #1631 backlog;
  // asserting it would bless it.
});
