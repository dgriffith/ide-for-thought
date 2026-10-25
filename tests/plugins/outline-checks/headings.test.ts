/** The Outline Checks plugin's parser (#2831): where a note's headings skip a level. */
import { describe, it, expect } from 'vitest';
import { headingSkips } from '../../../plugins/outline-checks/src/headings';

describe('headingSkips (#2831)', () => {
  it('finds a heading more than one level below the one before it', () => {
    expect(headingSkips('# Title\n\n### Too deep\n\n## Fine\n\n#### Again ##\n')).toEqual([
      { text: 'Too deep', from: 1, to: 3, line: 3 },
      { text: 'Again', from: 2, to: 4, line: 7 },
    ]);
  });

  it('lets a note start at any level, and step back up any number', () => {
    expect(headingSkips('### Start low\n#### Down one\n# Back to the top\n## Down one')).toEqual([]);
  });

  it('ignores fenced code, frontmatter and a # that is not a heading', () => {
    const md = ['---', 'title: x', '# not a heading', '---', '# One', '```md', '### in code', '```', '~~~', '#### also code', '~~~', '#hashtag', '    ### indented code', '## Two'].join('\n');
    expect(headingSkips(md)).toEqual([]);
  });
});
