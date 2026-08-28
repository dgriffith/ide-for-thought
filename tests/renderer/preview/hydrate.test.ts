/**
 * @vitest-environment happy-dom
 *
 * DOM-hydration coverage for the note-preview post-render passes
 * (src/renderer/lib/preview/hydrate.ts, #1087). Each pass takes a rendered
 * markdown subtree (built here with `innerHTML`) plus a `HydrateContext` and
 * mutates the DOM in place: deferred hljs highlighting, local/remote/YouTube
 * image caching, local media players, and `![[embed]]` transclusion.
 *
 * The `api` IPC client and the heavy sub-hydrators (mermaid/vega/card-callout/
 * cite) are mocked — mermaid + vega lazy-import multi-MB libs we don't want in
 * a unit test, and mocking cite/card lets us assert the transclusion "injected"
 * battery fires. The pure shared helpers (transclusion slice, wiki-link
 * resolve, mediaMime) run for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Hoisted mocks -------------------------------------------------------
const h = vi.hoisted(() => ({
  api: {
    notebase: {
      readBinary: vi.fn(),
      readFile: vi.fn(),
      listFiles: vi.fn(),
    },
    images: { cacheExternal: vi.fn() },
    youtube: { thumbnail: vi.fn() },
    graph: { aliasMap: vi.fn() },
  },
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

// Stub the heavy / side-effecting sub-hydrators the transclusion pass fans out
// to, so we can (a) avoid loading mermaid/vega and (b) assert they were called.
const mermaidMock = vi.fn();
const vegaMock = vi.fn();
const cardMock = vi.fn();
const citeMock = vi.fn();
vi.mock('../../../src/renderer/lib/markdown/mermaid-renderer', () => ({
  hydrateMermaidBlocks: (...a: unknown[]) => mermaidMock(...a),
}));
vi.mock('../../../src/renderer/lib/markdown/vega-renderer', () => ({
  hydrateVegaBlocks: (...a: unknown[]) => vegaMock(...a),
}));
vi.mock('../../../src/renderer/lib/markdown/card-callout', () => ({
  hydrateCardCallouts: (...a: unknown[]) => cardMock(...a),
}));
vi.mock('../../../src/renderer/lib/preview/citation-render', () => ({
  resolveCiteQuoteLabels: (...a: unknown[]) => citeMock(...a),
}));

import {
  highlightCodeBlocks,
  hydrateLocalImages,
  hydrateRemoteImages,
  hydrateYouTubeThumbnails,
  hydrateLocalMedia,
  hydrateTransclusions,
  type HydrateContext,
} from '../../../src/renderer/lib/preview/hydrate';

// --- Helpers -------------------------------------------------------------

/** Build a HydrateContext over a detached root element, with fresh caches. */
function makeCtx(root: HTMLElement | undefined, overrides: Partial<HydrateContext> = {}): HydrateContext {
  return {
    getPreviewEl: () => root,
    getNotePath: () => null,
    getContent: () => '',
    md: { render: (t: string) => `<p>${t}</p>` } as unknown as HydrateContext['md'],
    setRenderPathOverride: vi.fn(),
    imageDataUrlCache: new Map(),
    remoteImageCache: new Map(),
    youtubeThumbCache: new Map(),
    mediaBlobCache: new Map(),
    transclusionRenderCache: new Map(),
    citeDeps: () => ({}) as never,
    ...overrides,
  };
}

function div(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

// =========================================================================
// highlightCodeBlocks
// =========================================================================
describe('highlightCodeBlocks', () => {
  it('returns without throwing when there is no preview element', () => {
    expect(() => highlightCodeBlocks(makeCtx(undefined))).not.toThrow();
  });

  it('returns early when there are no un-highlighted code blocks', () => {
    const root = div('<p>no code here</p>');
    const before = root.innerHTML;
    highlightCodeBlocks(makeCtx(root));
    expect(root.innerHTML).toBe(before);
  });

  it('highlights a known-language block synchronously and marks it data-hl', () => {
    const root = div('<pre><code class="language-javascript">const x = 1;</code></pre>');
    highlightCodeBlocks(makeCtx(root));
    const code = root.querySelector('code')!;
    expect(code.dataset.hl).toBe('1');
    // hljs wraps tokens in <span class="hljs-…"> elements.
    expect(code.querySelector('span.hljs-keyword')).not.toBeNull();
  });

  it('marks an unknown-language block done but leaves its text untouched', () => {
    const root = div('<pre><code class="language-nope">plain text</code></pre>');
    highlightCodeBlocks(makeCtx(root));
    const code = root.querySelector('code')!;
    expect(code.dataset.hl).toBe('1');
    expect(code.querySelector('span')).toBeNull();
    expect(code.textContent).toBe('plain text');
  });

  it('skips blocks already carrying data-hl', () => {
    const root = div('<pre><code class="language-javascript" data-hl="1">const x = 1;</code></pre>');
    highlightCodeBlocks(makeCtx(root));
    // Unchanged: still the raw text, no hljs spans injected.
    expect(root.querySelector('code')!.textContent).toBe('const x = 1;');
    expect(root.querySelector('span')).toBeNull();
  });

  it('chunks large block counts via requestIdleCallback when available', () => {
    const idle = vi.fn((cb: () => void) => { cb(); return 0; });
    (window as unknown as { requestIdleCallback: unknown }).requestIdleCallback = idle;
    try {
      const blocks = Array.from({ length: 14 }, () =>
        '<pre><code class="language-javascript">const x = 1;</code></pre>').join('');
      const root = div(blocks);
      highlightCodeBlocks(makeCtx(root));
      // 14 blocks / CHUNK(12) → one follow-up idle schedule.
      expect(idle).toHaveBeenCalledTimes(1);
      root.querySelectorAll('code').forEach((c) => expect((c).dataset.hl).toBe('1'));
    } finally {
      delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
    }
  });

  it('falls back to setTimeout chunking when requestIdleCallback is absent', () => {
    delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
    vi.useFakeTimers();
    try {
      const blocks = Array.from({ length: 13 }, () =>
        '<pre><code class="language-javascript">const x = 1;</code></pre>').join('');
      const root = div(blocks);
      highlightCodeBlocks(makeCtx(root));
      // First chunk (12) ran synchronously; the 13th is deferred to a timer.
      vi.runAllTimers();
      root.querySelectorAll('code').forEach((c) => expect((c).dataset.hl).toBe('1'));
    } finally {
      vi.useRealTimers();
    }
  });
});

// =========================================================================
// hydrateLocalImages
// =========================================================================
describe('hydrateLocalImages', () => {
  it('returns early with no preview element', async () => {
    await expect(hydrateLocalImages(makeCtx(undefined))).resolves.toBeUndefined();
  });

  it('reuses a cached data URL without touching the IPC', async () => {
    const root = div('<img class="local-image" data-rel="a/b.png">');
    const ctx = makeCtx(root);
    ctx.imageDataUrlCache.set('a/b.png', 'data:image/png;base64,CACHED');
    await hydrateLocalImages(ctx);
    expect(root.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,CACHED');
    expect(h.api.notebase.readBinary).not.toHaveBeenCalled();
  });

  it('ignores an image whose data-rel is empty', async () => {
    const root = div('<img class="local-image" data-rel="">');
    await hydrateLocalImages(makeCtx(root));
    expect(h.api.notebase.readBinary).not.toHaveBeenCalled();
  });

  it('fetches bytes and inlines a data URL (Uint8Array path), populating the cache', async () => {
    h.api.notebase.readBinary.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    const root = div('<img class="local-image" data-rel="pics/x.png">');
    const ctx = makeCtx(root);
    await hydrateLocalImages(ctx);
    const src = root.querySelector('img')!.getAttribute('src')!;
    expect(src.startsWith('data:image/png;base64,')).toBe(true);
    expect(ctx.imageDataUrlCache.get('pics/x.png')).toBe(src);
  });

  it('accepts an ArrayBuffer result (non-Uint8Array branch)', async () => {
    h.api.notebase.readBinary.mockResolvedValueOnce(new Uint8Array([9, 9]).buffer);
    const root = div('<img class="local-image" data-rel="pics/y.jpg">');
    await hydrateLocalImages(makeCtx(root));
    expect(root.querySelector('img')!.getAttribute('src')!.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('flags the placeholder broken when readBinary is not exposed', async () => {
    const orig = h.api.notebase.readBinary;
    (h.api.notebase as { readBinary?: unknown }).readBinary = undefined;
    try {
      const root = div('<img class="local-image" data-rel="pics/z.png">');
      await hydrateLocalImages(makeCtx(root));
      expect(root.querySelector('img')!.classList.contains('local-image-broken')).toBe(true);
    } finally {
      h.api.notebase.readBinary = orig;
    }
  });

  it('flags the placeholder broken when the fetch rejects', async () => {
    h.api.notebase.readBinary.mockRejectedValueOnce(new Error('gone'));
    const root = div('<img class="local-image" data-rel="pics/missing.png">');
    await hydrateLocalImages(makeCtx(root));
    expect(root.querySelector('img')!.classList.contains('local-image-broken')).toBe(true);
  });
});

// =========================================================================
// hydrateRemoteImages
// =========================================================================
describe('hydrateRemoteImages', () => {
  it('returns early with no preview element', async () => {
    await expect(hydrateRemoteImages(makeCtx(undefined))).resolves.toBeUndefined();
  });

  it('reuses a cached data URL', async () => {
    const root = div('<img class="remote-image" data-remote-src="https://x/a.png">');
    const ctx = makeCtx(root);
    ctx.remoteImageCache.set('https://x/a.png', 'data:image/png;base64,RC');
    await hydrateRemoteImages(ctx);
    expect(root.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,RC');
    expect(h.api.images.cacheExternal).not.toHaveBeenCalled();
  });

  it('ignores an image whose data-remote-src is empty', async () => {
    const root = div('<img class="remote-image" data-remote-src="">');
    await hydrateRemoteImages(makeCtx(root));
    expect(h.api.images.cacheExternal).not.toHaveBeenCalled();
  });

  it('caches a fetched asset as a data URL (with explicit mime)', async () => {
    h.api.images.cacheExternal.mockResolvedValueOnce({ bytes: new Uint8Array([1]), mime: 'image/webp' });
    const root = div('<img class="remote-image" data-remote-src="https://x/b.webp">');
    const ctx = makeCtx(root);
    await hydrateRemoteImages(ctx);
    const src = root.querySelector('img')!.getAttribute('src')!;
    expect(src.startsWith('data:image/webp;base64,')).toBe(true);
    expect(ctx.remoteImageCache.get('https://x/b.webp')).toBe(src);
  });

  it('falls back to octet-stream when the asset omits a mime, ArrayBuffer bytes', async () => {
    h.api.images.cacheExternal.mockResolvedValueOnce({ bytes: new Uint8Array([2, 2]).buffer, mime: '' });
    const root = div('<img class="remote-image" data-remote-src="https://x/c">');
    await hydrateRemoteImages(makeCtx(root));
    expect(root.querySelector('img')!.getAttribute('src')!.startsWith('data:application/octet-stream;base64,')).toBe(true);
  });

  it('keeps the remote fallback when the cache returns null', async () => {
    h.api.images.cacheExternal.mockResolvedValueOnce(null);
    const root = div('<img class="remote-image" data-remote-src="https://x/d.png" src="https://x/d.png">');
    await hydrateRemoteImages(makeCtx(root));
    expect(root.querySelector('img')!.getAttribute('src')).toBe('https://x/d.png');
  });

  it('swallows a fetch error (leaves the element untouched)', async () => {
    h.api.images.cacheExternal.mockRejectedValueOnce(new Error('net'));
    const root = div('<img class="remote-image" data-remote-src="https://x/e.png" src="https://x/e.png">');
    await expect(hydrateRemoteImages(makeCtx(root))).resolves.toBeUndefined();
    expect(root.querySelector('img')!.getAttribute('src')).toBe('https://x/e.png');
  });

  it('returns early when cacheExternal is not a function', async () => {
    const orig = h.api.images.cacheExternal;
    (h.api.images as { cacheExternal?: unknown }).cacheExternal = undefined;
    try {
      const root = div('<img class="remote-image" data-remote-src="https://x/f.png">');
      await expect(hydrateRemoteImages(makeCtx(root))).resolves.toBeUndefined();
    } finally {
      h.api.images.cacheExternal = orig;
    }
  });
});

// =========================================================================
// hydrateYouTubeThumbnails
// =========================================================================
describe('hydrateYouTubeThumbnails', () => {
  it('returns early with no preview element', async () => {
    await expect(hydrateYouTubeThumbnails(makeCtx(undefined))).resolves.toBeUndefined();
  });

  it('reuses a cached poster', async () => {
    const root = div('<img class="youtube-thumb" data-youtube-id="abc">');
    const ctx = makeCtx(root);
    ctx.youtubeThumbCache.set('abc', 'data:image/jpeg;base64,YC');
    await hydrateYouTubeThumbnails(ctx);
    expect(root.querySelector('img')!.getAttribute('src')).toBe('data:image/jpeg;base64,YC');
    expect(h.api.youtube.thumbnail).not.toHaveBeenCalled();
  });

  it('ignores a thumb with an empty id', async () => {
    const root = div('<img class="youtube-thumb" data-youtube-id="">');
    await hydrateYouTubeThumbnails(makeCtx(root));
    expect(h.api.youtube.thumbnail).not.toHaveBeenCalled();
  });

  it('caches fetched thumbnail bytes as a jpeg data URL', async () => {
    h.api.youtube.thumbnail.mockResolvedValueOnce(new Uint8Array([7, 8]));
    const root = div('<img class="youtube-thumb" data-youtube-id="vid1">');
    const ctx = makeCtx(root);
    await hydrateYouTubeThumbnails(ctx);
    const src = root.querySelector('img')!.getAttribute('src')!;
    expect(src.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(ctx.youtubeThumbCache.get('vid1')).toBe(src);
  });

  it('accepts an ArrayBuffer result', async () => {
    h.api.youtube.thumbnail.mockResolvedValueOnce(new Uint8Array([5]).buffer);
    const root = div('<img class="youtube-thumb" data-youtube-id="vid2">');
    await hydrateYouTubeThumbnails(makeCtx(root));
    expect(root.querySelector('img')!.getAttribute('src')!.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('keeps the remote fallback on a null result', async () => {
    h.api.youtube.thumbnail.mockResolvedValueOnce(null);
    const root = div('<img class="youtube-thumb" data-youtube-id="vid3" src="https://img/yt.jpg">');
    await hydrateYouTubeThumbnails(makeCtx(root));
    expect(root.querySelector('img')!.getAttribute('src')).toBe('https://img/yt.jpg');
  });

  it('swallows a fetch error', async () => {
    h.api.youtube.thumbnail.mockRejectedValueOnce(new Error('boom'));
    const root = div('<img class="youtube-thumb" data-youtube-id="vid4" src="https://img/yt.jpg">');
    await expect(hydrateYouTubeThumbnails(makeCtx(root))).resolves.toBeUndefined();
    expect(root.querySelector('img')!.getAttribute('src')).toBe('https://img/yt.jpg');
  });

  it('returns early when thumbnail is not a function', async () => {
    const orig = h.api.youtube.thumbnail;
    (h.api.youtube as { thumbnail?: unknown }).thumbnail = undefined;
    try {
      const root = div('<img class="youtube-thumb" data-youtube-id="vid5">');
      await expect(hydrateYouTubeThumbnails(makeCtx(root))).resolves.toBeUndefined();
    } finally {
      h.api.youtube.thumbnail = orig;
    }
  });
});

// =========================================================================
// hydrateLocalMedia
// =========================================================================
describe('hydrateLocalMedia', () => {
  const realCreate = URL.createObjectURL;
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:fake-url');
  });
  afterEach(() => {
    URL.createObjectURL = realCreate;
  });

  it('returns early with no preview element', async () => {
    await expect(hydrateLocalMedia(makeCtx(undefined))).resolves.toBeUndefined();
  });

  it('reuses a cached blob URL', async () => {
    const root = div('<audio class="local-media" data-rel="a.mp3"></audio>');
    const ctx = makeCtx(root);
    ctx.mediaBlobCache.set('a.mp3', 'blob:cached');
    await hydrateLocalMedia(ctx);
    expect(root.querySelector('audio')!.getAttribute('src')).toBe('blob:cached');
    expect(h.api.notebase.readBinary).not.toHaveBeenCalled();
  });

  it('ignores media with an empty data-rel', async () => {
    const root = div('<audio class="local-media" data-rel=""></audio>');
    await hydrateLocalMedia(makeCtx(root));
    expect(h.api.notebase.readBinary).not.toHaveBeenCalled();
  });

  it('fetches bytes and points the element at a fresh blob URL', async () => {
    h.api.notebase.readBinary.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    const root = div('<video class="local-media" data-rel="clips/v.mp4"></video>');
    const ctx = makeCtx(root);
    await hydrateLocalMedia(ctx);
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(root.querySelector('video')!.getAttribute('src')).toBe('blob:fake-url');
    expect(ctx.mediaBlobCache.get('clips/v.mp4')).toBe('blob:fake-url');
  });

  it('flags the element broken when the fetch rejects', async () => {
    h.api.notebase.readBinary.mockRejectedValueOnce(new Error('io'));
    const root = div('<audio class="local-media" data-rel="bad.mp3"></audio>');
    await hydrateLocalMedia(makeCtx(root));
    expect(root.querySelector('audio')!.classList.contains('local-media-broken')).toBe(true);
  });
});

// =========================================================================
// hydrateTransclusions
// =========================================================================
describe('hydrateTransclusions', () => {
  const tree = [{ relativePath: 'foo.md', isDirectory: false, name: 'foo.md' }];

  beforeEach(() => {
    h.api.notebase.listFiles.mockResolvedValue(tree);
    h.api.graph.aliasMap.mockResolvedValue({});
  });

  it('returns early with no preview element', async () => {
    await expect(hydrateTransclusions(makeCtx(undefined))).resolves.toBeUndefined();
  });

  it('returns early when there are no unresolved placeholders', async () => {
    const root = div('<div class="transclusion" data-embed="foo" data-resolved="1"></div>');
    await hydrateTransclusions(makeCtx(root));
    expect(h.api.notebase.listFiles).not.toHaveBeenCalled();
  });

  it('renders a resolvable embed and fans out the injected battery', async () => {
    h.api.notebase.readFile.mockResolvedValueOnce('# Title\n\nBody text.');
    const root = div('<div class="transclusion" data-embed="foo"></div>');
    document.body.appendChild(root);
    const ctx = makeCtx(root);
    await hydrateTransclusions(ctx);
    const ph = root.querySelector('.transclusion')!;
    expect((ph as HTMLElement).dataset.resolved).toBe('1');
    const header = ph.querySelector('a.transclusion-open')!;
    expect(header.getAttribute('data-target')).toBe('foo');
    expect(ph.querySelector('.transclusion-body')!.innerHTML).toContain('Body text.');
    // Chain seeded with the resolved rel.
    expect(JSON.parse((ph as HTMLElement).dataset.chain!)).toEqual(['foo.md']);
    // Cache populated for the reuse path.
    expect(ctx.transclusionRenderCache.get('foo.md\u0000foo')).toContain('Body text.');
    // The injected-subtree battery ran.
    expect(mermaidMock).toHaveBeenCalledWith(root);
    expect(vegaMock).toHaveBeenCalled();
    expect(cardMock).toHaveBeenCalledWith(root);
    expect(citeMock).toHaveBeenCalled();
  });

  it('reuses a cached embed body (skips readFile)', async () => {
    const root = div('<div class="transclusion" data-embed="foo"></div>');
    const ctx = makeCtx(root);
    ctx.transclusionRenderCache.set('foo.md\u0000foo', '<p>cached body</p>');
    await hydrateTransclusions(ctx);
    expect(root.querySelector('.transclusion-body')!.innerHTML).toBe('<p>cached body</p>');
    expect(h.api.notebase.readFile).not.toHaveBeenCalled();
  });

  it('shows a not-found notice for an unresolvable target', async () => {
    const root = div('<div class="transclusion" data-embed="ghost"></div>');
    await hydrateTransclusions(makeCtx(root));
    const notice = root.querySelector('.transclusion-notice')!;
    expect(notice.classList.contains('transclusion-missing')).toBe(true);
    expect(notice.textContent).toContain('not found');
  });

  it('detects a transclusion loop against the host note', async () => {
    const root = div('<div class="transclusion" data-embed="foo"></div>');
    const ctx = makeCtx(root, { getNotePath: () => 'foo.md' });
    await hydrateTransclusions(ctx);
    const notice = root.querySelector('.transclusion-notice')!;
    expect(notice.classList.contains('transclusion-loop')).toBe(true);
    expect(notice.textContent).toContain('loop');
  });

  it('shows a read-error notice when readFile rejects', async () => {
    h.api.notebase.readFile.mockRejectedValueOnce(new Error('nope'));
    const root = div('<div class="transclusion" data-embed="foo"></div>');
    await hydrateTransclusions(makeCtx(root));
    const notice = root.querySelector('.transclusion-notice')!;
    expect(notice.classList.contains('transclusion-missing')).toBe(true);
    expect(notice.textContent).toContain('Could not read');
  });

  it('shows a slice-failure notice for a missing heading', async () => {
    h.api.notebase.readFile.mockResolvedValueOnce('# Real Heading\n\nbody');
    const root = div('<div class="transclusion" data-embed="foo#Nonexistent"></div>');
    await hydrateTransclusions(makeCtx(root));
    const notice = root.querySelector('.transclusion-notice')!;
    expect(notice.classList.contains('transclusion-missing')).toBe(true);
    expect(notice.textContent).toContain('not found');
  });

  it('labels a heading embed with the › separator', async () => {
    h.api.notebase.readFile.mockResolvedValueOnce('# Intro\n\nsection body');
    const root = div('<div class="transclusion" data-embed="foo#Intro"></div>');
    await hydrateTransclusions(makeCtx(root));
    expect(root.querySelector('a.transclusion-open')!.textContent).toBe('foo › Intro');
  });

  it('labels a block embed with the ^ prefix', async () => {
    h.api.notebase.readFile.mockResolvedValueOnce('a paragraph ^blk\n');
    const root = div('<div class="transclusion" data-embed="foo^blk"></div>');
    await hydrateTransclusions(makeCtx(root));
    expect(root.querySelector('a.transclusion-open')!.textContent).toBe('foo › ^blk');
  });

  it('degrades gracefully when listFiles / aliasMap reject', async () => {
    h.api.notebase.listFiles.mockRejectedValueOnce(new Error('tree'));
    h.api.graph.aliasMap.mockRejectedValueOnce(new Error('alias'));
    const root = div('<div class="transclusion" data-embed="foo"></div>');
    await hydrateTransclusions(makeCtx(root));
    // No file tree → nothing resolves → not-found notice.
    expect(root.querySelector('.transclusion-notice')!.classList.contains('transclusion-missing')).toBe(true);
  });
});
