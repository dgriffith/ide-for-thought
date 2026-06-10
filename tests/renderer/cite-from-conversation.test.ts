import { describe, it, expect } from 'vitest';
import {
  citationMarker,
  insertCitationMarker,
  noteBasename,
} from '../../src/renderer/lib/conversations/cite-from-conversation';

describe('citationMarker', () => {
  it('matches the editor [[cite::id]] syntax', () => {
    expect(citationMarker('s-abc')).toBe('[[cite::s-abc]]');
  });
});

describe('insertCitationMarker', () => {
  it('appends the marker at end of document', () => {
    expect(insertCitationMarker('# Note\n\nsome prose', 's1'))
      .toBe('# Note\n\nsome prose\n\n[[cite::s1]]\n');
  });

  it('is idempotent — a source already cited is left untouched', () => {
    const content = '# Note\n\nbody [[cite::s1]] more';
    expect(insertCitationMarker(content, 's1')).toBe(content);
  });

  it('inserts before a rendered bibliography block, not after it', () => {
    const content =
      '# Note\n\nbody\n\n<!-- minerva:bibliography -->\nrefs\n<!-- /minerva:bibliography -->\n';
    const out = insertCitationMarker(content, 's2');
    expect(out).toBe(
      '# Note\n\nbody\n\n[[cite::s2]]\n\n<!-- minerva:bibliography -->\nrefs\n<!-- /minerva:bibliography -->\n',
    );
    // The new marker must sit ahead of the bibliography open tag so the next
    // render run can fold it in rather than orphan it after the close tag.
    expect(out.indexOf('[[cite::s2]]')).toBeLessThan(out.indexOf('<!-- minerva:bibliography -->'));
  });

  it('handles empty content', () => {
    expect(insertCitationMarker('', 's3')).toBe('[[cite::s3]]\n');
    expect(insertCitationMarker('   \n', 's3')).toBe('[[cite::s3]]\n');
  });
});

describe('noteBasename', () => {
  it('strips directory and the .md extension', () => {
    expect(noteBasename('ideas/sub/Foundations.md')).toBe('Foundations');
    expect(noteBasename('Top.md')).toBe('Top');
    expect(noteBasename('noext')).toBe('noext');
  });
});
