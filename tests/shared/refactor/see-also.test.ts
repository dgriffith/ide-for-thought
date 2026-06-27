import { describe, it, expect } from 'vitest';
import { appendSeeAlsoLink, wikiLinkStem } from '../../../src/main/../shared/refactor/see-also';

describe('wikiLinkStem', () => {
  it('strips the .md extension, keeping the path', () => {
    expect(wikiLinkStem('notes/topic/raft.md')).toBe('notes/topic/raft');
    expect(wikiLinkStem('raft.md')).toBe('raft');
  });
});

describe('appendSeeAlsoLink', () => {
  it('creates a See also section when none exists', () => {
    const { content, changed } = appendSeeAlsoLink('# Note\n\nBody text.', 'notes/raft.md');
    expect(changed).toBe(true);
    expect(content).toContain('## See also');
    expect(content).toContain('- [[notes/raft]]');
    // The original body is preserved.
    expect(content).toContain('Body text.');
  });

  it('appends to an existing See also section', () => {
    const input = '# Note\n\nBody.\n\n## See also\n\n- [[existing]]\n';
    const { content, changed } = appendSeeAlsoLink(input, 'new-note.md');
    expect(changed).toBe(true);
    expect(content).toContain('- [[existing]]');
    expect(content).toContain('- [[new-note]]');
    // Only one See also heading.
    expect(content.match(/## See also/g)).toHaveLength(1);
  });

  it('inserts into a See also section that is followed by another heading', () => {
    const input = '# Note\n\n## See also\n\n- [[a]]\n\n## Notes\n\nmore text\n';
    const { content } = appendSeeAlsoLink(input, 'b.md');
    // The new bullet lands inside See also, before ## Notes.
    expect(content.indexOf('[[b]]')).toBeGreaterThan(content.indexOf('[[a]]'));
    expect(content.indexOf('[[b]]')).toBeLessThan(content.indexOf('## Notes'));
    expect(content).toContain('more text');
  });

  it('is a no-op when the target is already linked anywhere', () => {
    const inline = '# Note\n\nSee [[notes/raft]] for details.';
    expect(appendSeeAlsoLink(inline, 'notes/raft.md').changed).toBe(false);

    const aliased = '# Note\n\nSee [[notes/raft|Raft]] for details.';
    expect(appendSeeAlsoLink(aliased, 'notes/raft.md').changed).toBe(false);
  });

  it('does not duplicate a link already in the See also section', () => {
    const input = '# Note\n\n## See also\n\n- [[raft]]\n';
    const { content, changed } = appendSeeAlsoLink(input, 'raft.md');
    expect(changed).toBe(false);
    expect(content.match(/\[\[raft\]\]/g)).toHaveLength(1);
  });
});
