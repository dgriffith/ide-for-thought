/**
 * The shared inline-tag lexer (#2430). `findInlineTags` locates tags in the
 * ORIGINAL text for the merge rewrite; `extractInlineTags` is what the indexer
 * reads. They must agree, or a merge either edits text that isn't a tag or
 * leaves one behind — so the core assertion is differential.
 */
import { describe, it, expect } from 'vitest';
import { extractInlineTags, findInlineTags, isValidTagName } from '../../src/shared/inline-tags';

const CORPUS = [
  '',
  '#ml',
  'plain #a and #b/c/d, then #e.',
  '# Heading\n## Sub #tag\n',
  'code `#x` and ```\n#y\n``` and #z',
  'see `x`#after-code here',
  '#m`x`l straddles code',
  'url https://e.com/p#frag and [l](#anchor) and (#paren)',
  '#a//b #a/1b #ok/ #ok// #9no',
  '---\ntags: [x]\ndescription: about #fm-inline\n---\nbody #body',
  'unterminated ```\n#still-a-tag\n',
  '`#a` `#b` #c `#d`',
];

describe('findInlineTags', () => {
  it.each(CORPUS)('agrees with the indexer on %j', (content) => {
    const found = findInlineTags(content);
    // Every located span spells the tag it names.
    for (const occ of found) expect(content.slice(occ.start, occ.end)).toBe(occ.tag);
    // And the set of names is the indexer's, except for a hit split by code
    // (which no merge can rewrite in place).
    const names = [...new Set(found.map((o) => o.tag))].sort();
    const indexed = extractInlineTags(content).filter((t) => !(content.includes('#m`x`l') && t === 'ml')).sort();
    expect(names).toEqual(indexed);
  });

  it('reports each occurrence, with offsets into the original text', () => {
    const s = 'a `#x` #ml then #ml/nlp';
    expect(findInlineTags(s)).toEqual([
      { tag: 'ml', start: 8, end: 10 },
      { tag: 'ml/nlp', start: 17, end: 23 },
    ]);
  });

  it('drops a hit whose characters are split by a code span', () => {
    expect(findInlineTags('#m`x`l')).toEqual([]);
  });
});

describe('isValidTagName', () => {
  it('accepts names an inline #name indexes as exactly that name', () => {
    for (const n of ['ml', 'machine-learning', 'a/b_c/d-1', 'ML']) expect(isValidTagName(n)).toBe(true);
  });
  it('rejects everything else', () => {
    for (const n of ['', '1a', 'a b', 'a/', 'a//b', '#a', 'a.b']) expect(isValidTagName(n)).toBe(false);
  });
});
