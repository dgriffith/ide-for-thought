/**
 * @vitest-environment jsdom
 *
 * Mounting plugins' live blocks in the preview (#2641): each placeholder gets
 * its plugin's frame once; a fresh placeholder for the same block (the next
 * render tick) gets the same mount back; editing the block's text is a new
 * block; and a block whose plugin is off stays text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ on: true }));
vi.mock('../../../src/renderer/lib/stores/plugin-sessions.svelte', () => ({ connectPluginFrame: vi.fn(() => new Promise(() => {})) }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: { graph: { onChanged: () => () => {} } } }));
vi.mock('../../../src/renderer/lib/stores/code-plugins.svelte', () => ({
  codePluginsStore: { block: () => (h.on ? { id: 'queue', title: 'Reading queue', fence: 'reading-queue', entry: 'index.html' } : null) },
}));

import { hydratePluginBlocks } from '../../../src/renderer/lib/markdown/plugin-block-renderer';
import { disposeCaches } from '../../../src/renderer/lib/markdown/hydrated-block-cache';
import { pluginBlockPlaceholderHtml } from '../../../src/renderer/lib/preview/plugin-blocks';

const SYNTAX = { pluginId: 'reading-queue', blockId: 'queue', title: 'Reading queue', fence: 'reading-queue' };
let root: HTMLDivElement;

beforeEach(() => {
  h.on = true;
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  disposeCaches(root);
  document.body.innerHTML = '';
});

/** A render tick: fresh placeholders for these sources, then the post-render pass. */
function tick(...sources: string[]): HTMLIFrameElement[] {
  root.innerHTML = sources.map((s) => pluginBlockPlaceholderHtml(SYNTAX, s, 'n.md')).join('');
  hydratePluginBlocks(root);
  return Array.from(root.querySelectorAll('iframe'));
}

describe('hydratePluginBlocks (#2641)', () => {
  it("mounts the plugin's frame into each block, titled, and drops the pending mark", () => {
    const [frame] = tick('limit: 2\n');
    expect(frame!.getAttribute('src')).toBe('minerva-plugin://reading-queue/index.html');
    expect(frame!.getAttribute('title')).toBe('Reading queue');
    expect(root.querySelector('[data-plugin-block-pending]')).toBeNull();
  });

  it('the next tick gets the same mount back; a block whose text changed is a new one', () => {
    const [first] = tick('limit: 2\n');
    const [again] = tick('limit: 2\n');
    expect(again).toBe(first);
    const [edited] = tick('limit: 3\n');
    expect(edited).not.toBe(first);
    expect(first!.isConnected).toBe(false);
  });

  it('two identical blocks are two mounts', () => {
    const frames = tick('same\n', 'same\n');
    expect(frames).toHaveLength(2);
    expect(frames[0]).not.toBe(frames[1]);
  });

  it("a block whose plugin is off stays its text", () => {
    h.on = false;
    expect(tick('limit: 2\n')).toEqual([]);
    expect(root.querySelector('.plugin-block')!.textContent).toBe('limit: 2\n');
  });
});
