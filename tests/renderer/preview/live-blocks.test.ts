/**
 * Live query-block builders (#1137 backlinks, #1128 semantic) — selection
 * (filter/limit/threshold/kind) + read-only HTML. Pure string functions.
 */
import { describe, it, expect } from 'vitest';
import {
  selectBacklinks,
  buildBacklinksHtml,
  semanticKinds,
  selectSemanticNotes,
  buildSemanticHtml,
} from '../../../src/renderer/lib/preview/live-blocks';
import type { Backlink, RelatedNote } from '../../../src/shared/types';

const bl = (over: Partial<Backlink>): Backlink => ({
  source: 'notes/a.md', sourceTitle: 'A', linkType: 'references', linkLabel: '', linkColor: '#888', ...over,
});
const rn = (over: Partial<RelatedNote>): RelatedNote => ({
  kind: 'note', ref: 'notes/x.md', title: 'X', sectionHeading: '', snippet: '', score: 0.9, ...over,
});

describe('backlinks block (#1137)', () => {
  it('filters by linkType and honors limit', () => {
    const rows = [bl({ source: '1.md', linkType: 'cite' }), bl({ source: '2.md', linkType: 'references' }), bl({ source: '3.md', linkType: 'cite' })];
    expect(selectBacklinks(rows, { linkType: 'cite' }).map((b) => b.source)).toEqual(['1.md', '3.md']);
    expect(selectBacklinks(rows, { limit: '2' })).toHaveLength(2);
  });

  it('renders navigable rows with a typed badge, escaping content', () => {
    const html = buildBacklinksHtml([bl({ source: 'notes/b.md', sourceTitle: 'B & <C>', linkType: 'cite', linkLabel: 'cites', linkColor: '#e78284' })], {});
    expect(html).toContain('data-target="notes/b.md"');
    expect(html).toContain('B &amp; &lt;C&gt;');
    expect(html).toContain('class="query-link-badge" style="background:#e78284"');
    expect(html).toContain('>cites<');
  });

  it('quiet empty state, plus optional title', () => {
    expect(buildBacklinksHtml([], {})).toContain('No backlinks yet');
    expect(buildBacklinksHtml([], { title: 'Linked from' })).toContain('<h4 class="query-title">Linked from</h4>');
  });
});

describe('semantic block (#1128)', () => {
  it('defaults to notes; `all` spans every kind', () => {
    expect(semanticKinds({})).toEqual(['note']);
    expect(semanticKinds({ kind: 'all' })).toEqual(['note', 'source', 'excerpt']);
    expect(semanticKinds({ kind: 'source' })).toEqual(['source']);
  });

  it('applies threshold and limit', () => {
    const notes = [rn({ ref: '1.md', score: 0.9 }), rn({ ref: '2.md', score: 0.5 }), rn({ ref: '3.md', score: 0.8 })];
    expect(selectSemanticNotes(notes, { threshold: '0.75' }).map((n) => n.ref)).toEqual(['1.md', '3.md']);
    expect(selectSemanticNotes(notes, { limit: '1' })).toHaveLength(1);
  });

  it('filters by kind — default is note-only; kind:all keeps everything', () => {
    // The empty-query path reuses the all-kinds "related to this note" IPC, so
    // the kind filter runs client-side here.
    const notes = [rn({ ref: '1.md' }), rn({ kind: 'source', ref: 'src-1' })];
    expect(selectSemanticNotes(notes, {}).map((n) => n.ref)).toEqual(['1.md']);
    expect(selectSemanticNotes(notes, { kind: 'all' })).toHaveLength(2);
  });

  it('compact mode renders only the link (no section / snippet)', () => {
    const notes = [rn({ ref: 'notes/r.md', title: 'R', sectionHeading: 'Sec', snippet: 'snip' })];
    const html = buildSemanticHtml(notes, { compact: 'true' });
    expect(html).toContain('data-target="notes/r.md"');
    expect(html).not.toContain('semantic-section');
    expect(html).not.toContain('Sec');
    expect(html).not.toContain('snip');
  });

  it('renders note hits as wiki-links with section + snippet; snippet:off hides it', () => {
    const notes = [rn({ ref: 'notes/r.md', title: 'Result', sectionHeading: 'Intro', snippet: 'a snippet' })];
    const html = buildSemanticHtml(notes, {});
    expect(html).toContain('class="wiki-link" data-target="notes/r.md"');
    expect(html).toContain('Intro');
    expect(html).toContain('a snippet');
    expect(buildSemanticHtml(notes, { snippet: 'off' })).not.toContain('a snippet');
  });

  it('non-note hits are not navigable', () => {
    const html = buildSemanticHtml([rn({ kind: 'source', ref: 'src-1', title: 'A Paper' })], {});
    expect(html).toContain('semantic-nonnote');
    expect(html).not.toContain('wiki-link');
  });

  it('quiet empty state', () => {
    expect(buildSemanticHtml([], {})).toContain('No related notes');
  });
});
