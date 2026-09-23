/**
 * @vitest-environment jsdom
 *
 * The transcript markdown memo (#2219).
 *
 * The gate is count-based: rendering the same transcript again must not re-run
 * markdown-it. That is the property a completed send exercises — the store
 * replaces `tab.conversation` wholesale, so every message's expression
 * re-evaluates even though the text is unchanged.
 *
 * Counting is done by spying on the markdown-it prototype, so the assertion is
 * "the parser ran N times", not "it took N milliseconds".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import MarkdownIt from 'markdown-it';
import {
  renderMarkdown,
  renderMarkdownCached,
  _clearMarkdownMemoForTests,
} from '../../src/renderer/lib/conversations/markdown-render';

let renderSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  _clearMarkdownMemoForTests();
  renderSpy = vi.spyOn(MarkdownIt.prototype, 'render');
});

afterEach(() => {
  renderSpy.mockRestore();
  _clearMarkdownMemoForTests();
});

describe('renderMarkdownCached', () => {
  it('parses once for repeated renders of the same transcript', () => {
    const transcript = [
      '# First reply\n\nSome prose.',
      'A second reply with a [link](https://example.com).',
      '- a\n- b\n- c',
    ];

    // Turn 1 lands: every message rendered for the first time.
    for (const m of transcript) renderMarkdownCached(m);
    expect(renderSpy).toHaveBeenCalledTimes(3);

    // Turn 2, 3, 4 land — the store hands back fresh objects with identical
    // text each time. Without the memo this is 3 more parses per turn.
    for (let turn = 0; turn < 3; turn++) {
      for (const m of transcript) renderMarkdownCached(m);
    }
    expect(renderSpy).toHaveBeenCalledTimes(3);
  });

  it('returns output identical to an uncached render', () => {
    const src = '## Heading\n\nText with **bold**, `code`, and a list:\n\n- one\n- two\n';
    expect(renderMarkdownCached(src)).toBe(renderMarkdown(src));
  });

  it('still parses text it has not seen', () => {
    renderMarkdownCached('alpha');
    renderMarkdownCached('beta');
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });

  it('renderMarkdown does not consult or populate the memo', () => {
    // The streaming path must stay uncached: its text differs on every flush,
    // so caching it would evict the transcript one growing prefix at a time.
    renderMarkdown('streaming prefix');
    renderMarkdown('streaming prefix');
    expect(renderSpy).toHaveBeenCalledTimes(2);

    renderMarkdownCached('streaming prefix');
    expect(renderSpy).toHaveBeenCalledTimes(3);
  });

  it('stays bounded, evicting oldest-first', () => {
    // 250 distinct messages against a 200-entry limit.
    for (let i = 0; i < 250; i++) renderMarkdownCached(`message ${i}`);
    expect(renderSpy).toHaveBeenCalledTimes(250);

    // The most recent are still hits…
    renderMarkdownCached('message 249');
    expect(renderSpy).toHaveBeenCalledTimes(250);

    // …and the oldest were evicted rather than growing without limit.
    renderMarkdownCached('message 0');
    expect(renderSpy).toHaveBeenCalledTimes(251);
  });
});
