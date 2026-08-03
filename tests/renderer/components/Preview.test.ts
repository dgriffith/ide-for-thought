/**
 * @vitest-environment happy-dom
 *
 * Preview render/smoke test. Preview.svelte is the note-preview pane — a large
 * markdown → HTML renderer with a click-routing table, a read-only right-click
 * menu, and a battery of post-render hydration passes. It had 0% coverage of
 * its own file. This mounts the REAL component with the REAL markdown pipeline
 * (createPreviewMarkdown + sanitizeNoteHtml, both proven under happy-dom by
 * markdown-config.test.ts) so `{@html rendered}` shows genuine output, and
 * asserts a handful of user-visible behaviors: markdown renders, wiki-link /
 * tag clicks route to the right callback, and the note context menu wires its
 * tool entries through `onToolInvoke`.
 *
 * The post-render hydration modules (mermaid / vega / card-callout / hydrate /
 * citation-render / typed-link / query-blocks) are mocked to inert no-ops so
 * the requestAnimationFrame pass is deterministic — Preview's own `$effect`
 * bodies still execute (they call the mocks), so its line coverage is unaffected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/svelte';
import type { ThinkingToolInfo } from '../../../src/shared/tools/types';

const h = vi.hoisted(() => ({
  api: {
    notebase: { readFile: vi.fn() },
    types: { noteProperties: vi.fn() },
    shell: {
      openExternal: vi.fn(),
      revealFile: vi.fn(),
      openInDefault: vi.fn(),
      openInTerminal: vi.fn(),
    },
  },
  getToolInfosByCategory: vi.fn((_category: string) => [] as ThinkingToolInfo[]),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/tools/tool-registry', () => ({
  getToolInfosByCategory: h.getToolInfosByCategory,
}));

// Inert post-render hydration passes — keep the rAF work deterministic. Preview's
// own effect bodies still run and invoke these; only the heavy DOM/library work
// is stubbed. Types are re-exported as `unknown`-shaped no-ops.
vi.mock('../../../src/renderer/lib/markdown/mermaid-renderer', () => ({
  hydrateMermaidBlocks: vi.fn(),
  invalidateMermaidTheme: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/markdown/vega-renderer', () => ({
  hydrateVegaBlocks: vi.fn(),
  invalidateVegaTheme: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/markdown/card-callout', () => ({
  hydrateCardCallouts: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/preview/hydrate', () => ({
  highlightCodeBlocks: vi.fn(),
  hydrateLocalImages: vi.fn(),
  hydrateRemoteImages: vi.fn(),
  hydrateYouTubeThumbnails: vi.fn(),
  hydrateTransclusions: vi.fn(),
  hydrateLocalMedia: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/preview/citation-render', () => ({
  applyCslMarkers: vi.fn(),
  resolveCiteQuoteLabels: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/preview/typed-link-render', () => ({
  hydrateTypedCards: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/preview/query-blocks', () => ({
  executeQueryBlock: vi.fn(),
}));

import Preview from '../../../src/renderer/lib/components/Preview.svelte';

function props(over: Record<string, unknown> = {}) {
  return {
    content: '# Hello World\n\nThis is **bold** body text.\n',
    notePath: 'notes/hello.md',
    onNavigate: vi.fn(),
    onTagSelect: vi.fn(),
    ...over,
  };
}

function tool(id: string, name: string, category: string): ThinkingToolInfo {
  return {
    id, name, category, description: '', longDescription: '',
    context: [], outputMode: 'note',
  } as unknown as ThinkingToolInfo;
}

beforeEach(() => {
  h.api.notebase.readFile.mockResolvedValue('');
  h.api.types.noteProperties.mockResolvedValue({ type: null, properties: {} });
  h.getToolInfosByCategory.mockReturnValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Preview (render/smoke)', () => {
  it('renders markdown content to HTML', () => {
    const { container } = render(Preview, props());
    const preview = container.querySelector('.preview')!;
    expect(preview.textContent).toContain('Hello World');
    // Inline emphasis survives the DOMPurify pass and reaches `{@html rendered}`.
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('p')?.textContent).toContain('bold body text');
  });

  it('routes a wiki-link click through onNavigate with the link target', async () => {
    const p = props({ content: 'See [[Some Note]] for details.\n' });
    const { container } = render(Preview, p);
    const link = container.querySelector<HTMLElement>('a.wiki-link');
    expect(link?.dataset.target).toBe('Some Note');
    await fireEvent.click(link!);
    expect(p.onNavigate).toHaveBeenCalledWith('Some Note');
  });

  it('routes a tag click through onTagSelect with the tag name', async () => {
    const p = props({ content: 'Filed under #research today.\n' });
    const { container } = render(Preview, p);
    const tagEl = container.querySelector<HTMLElement>('.note-tag');
    expect(tagEl?.dataset.tag).toBe('research');
    await fireEvent.click(tagEl!);
    expect(p.onTagSelect).toHaveBeenCalledWith('research');
  });

  it('re-renders when the content prop changes (debounced effect)', async () => {
    const { container, rerender } = render(Preview, props());
    expect(container.textContent).toContain('Hello World');
    await rerender(props({ content: '## Second Heading\n\nWholly new text.\n' }));
    // The $effect debounces the re-render (~120ms) — poll for the new body.
    await waitFor(() => expect(container.textContent).toContain('Wholly new text.'));
    expect(container.textContent).not.toContain('Hello World');
  });

  it('opens the read-only note context menu and wires tool entries through onToolInvoke', async () => {
    h.getToolInfosByCategory.mockImplementation((category: string) =>
      category === 'learning' ? [tool('learn.summarize', 'Summarize', 'learning')] : [],
    );
    const onToolInvoke = vi.fn();
    const { container } = render(Preview, props({ onToolInvoke }));

    await fireEvent.contextMenu(container.querySelector('.preview')!);
    const menu = container.querySelector('.note-context-menu');
    expect(menu).toBeTruthy();

    // The Learning submenu holds a button per learning tool.
    const toolBtn = screen.getByRole('button', { name: 'Summarize' });
    await fireEvent.click(toolBtn);
    expect(onToolInvoke).toHaveBeenCalledWith('learn.summarize');
    // Menu closes after acting.
    expect(container.querySelector('.note-context-menu')).toBeFalsy();
  });

  it('suppresses the context menu when no callbacks and no notePath are wired', async () => {
    const { container } = render(Preview, props({ notePath: null, onTagSelect: undefined }));
    await fireEvent.contextMenu(container.querySelector('.preview')!);
    expect(container.querySelector('.note-context-menu')).toBeFalsy();
  });

  it('renders a .ttl note as highlighted turtle source rather than markdown', () => {
    const { container } = render(Preview, props({
      notePath: 'graph/data.ttl',
      content: '@prefix ex: <http://example.org/> .\n# a comment\n',
    }));
    // renderTurtle emits token-classed spans instead of markdown-parsed HTML.
    expect(container.querySelector('.ttl-directive')?.textContent).toBe('@prefix');
    expect(container.querySelector('.ttl-comment')?.textContent).toContain('# a comment');
    expect(container.querySelector('.ttl-iri')?.textContent).toContain('http://example.org/');
  });
});
