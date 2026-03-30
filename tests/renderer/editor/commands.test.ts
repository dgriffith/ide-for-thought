import { describe, it, expect } from 'vitest';
import { Text } from '@codemirror/state';
import {
  isAllLower, isAllUpper, toTitleCase,
  findWord, findLine, findSentence, findParagraph,
  findHeadingSection, findEnclosingPair, nextExpansion,
} from '../../../src/renderer/lib/editor/commands';

function doc(lines: string[]): Text {
  return Text.of(lines);
}

// ── Case helpers ────────────────────────────────────────────────────────────

describe('isAllLower', () => {
  it('returns true for lowercase', () => expect(isAllLower('hello')).toBe(true));
  it('returns false for mixed', () => expect(isAllLower('Hello')).toBe(false));
  it('returns false for uppercase', () => expect(isAllLower('HELLO')).toBe(false));
  it('returns false for numbers only', () => expect(isAllLower('123')).toBe(false));
});

describe('isAllUpper', () => {
  it('returns true for uppercase', () => expect(isAllUpper('HELLO')).toBe(true));
  it('returns false for mixed', () => expect(isAllUpper('Hello')).toBe(false));
  it('returns false for lowercase', () => expect(isAllUpper('hello')).toBe(false));
});

describe('toTitleCase', () => {
  it('capitalizes first letter of each word', () => {
    expect(toTitleCase('hello world')).toBe('Hello World');
  });
  it('handles single word', () => {
    expect(toTitleCase('HELLO')).toBe('Hello');
  });
});

// ── Region finders ──────────────────────────────────────────────────────────

describe('findWord', () => {
  it('finds word at cursor', () => {
    const d = doc(['hello world']);
    expect(findWord(d, 2)).toEqual({ from: 0, to: 5 });
  });

  it('finds second word', () => {
    const d = doc(['hello world']);
    expect(findWord(d, 7)).toEqual({ from: 6, to: 11 });
  });

  it('returns null in whitespace between words', () => {
    const d = doc(['hello  world']);
    // Position 5 is the first space; position 6 is second space
    expect(findWord(d, 6)).toBeNull();
  });
});

describe('findLine', () => {
  it('returns the full line for a position', () => {
    const d = doc(['first', 'second', 'third']);
    const result = findLine(d, 6, 6); // in 'second'
    expect(d.sliceString(result.from, result.to)).toBe('second');
  });

  it('spans multiple lines for a range', () => {
    const d = doc(['first', 'second', 'third']);
    const result = findLine(d, 0, 10); // first into second
    expect(result.from).toBe(0);
    expect(d.sliceString(result.from, result.to)).toContain('second');
  });
});

describe('findSentence', () => {
  it('finds a sentence ending with period', () => {
    const d = doc(['Hello world. Goodbye world.']);
    const result = findSentence(d, 2, 2);
    expect(result).not.toBeNull();
    const text = d.sliceString(result!.from, result!.to);
    expect(text).toContain('Hello world.');
  });

  it('finds second sentence', () => {
    const d = doc(['First sentence. Second sentence.']);
    // Position in "Second"
    const result = findSentence(d, 18, 18);
    expect(result).not.toBeNull();
    const text = d.sliceString(result!.from, result!.to);
    expect(text).toContain('Second');
  });
});

describe('findParagraph', () => {
  it('finds a paragraph bounded by blank lines', () => {
    const d = doc(['First para.', '', 'Second para.', 'Still second.', '', 'Third.']);
    // Position in 'Second para.'
    const secondStart = d.line(3).from;
    const result = findParagraph(d, secondStart, secondStart);
    const text = d.sliceString(result.from, result.to);
    expect(text).toContain('Second para.');
    expect(text).toContain('Still second.');
    expect(text).not.toContain('First');
  });
});

describe('findHeadingSection', () => {
  it('finds section from heading to next same-level heading', () => {
    const d = doc(['# H1', 'Content', '## H2', 'Sub content', '# Next H1']);
    // Position in 'Content'
    const result = findHeadingSection(d, 5, 5);
    expect(result).not.toBeNull();
    const text = d.sliceString(result!.from, result!.to);
    expect(text).toContain('# H1');
    expect(text).toContain('Sub content');
    expect(text).not.toContain('Next H1');
  });

  it('finds H2 section within H1', () => {
    const d = doc(['# H1', '## H2a', 'Content A', '## H2b', 'Content B']);
    // Position in 'Content A'
    const pos = d.line(3).from;
    const result = findHeadingSection(d, pos, pos);
    expect(result).not.toBeNull();
    const text = d.sliceString(result!.from, result!.to);
    expect(text).toContain('## H2a');
    expect(text).toContain('Content A');
    expect(text).not.toContain('H2b');
  });

  it('returns null when no heading above', () => {
    const d = doc(['No headings here', 'Just content']);
    expect(findHeadingSection(d, 0, 0)).toBeNull();
  });
});

describe('findEnclosingPair', () => {
  it('finds parentheses', () => {
    const d = doc(['foo (bar baz) end']);
    const result = findEnclosingPair(d, 5, 12); // inside parens
    expect(result).not.toBeNull();
    expect(d.sliceString(result!.from, result!.to)).toBe('(bar baz)');
  });

  it('finds brackets', () => {
    const d = doc(['[hello world]']);
    const result = findEnclosingPair(d, 2, 2);
    expect(result).not.toBeNull();
    expect(d.sliceString(result!.from, result!.to)).toBe('[hello world]');
  });

  it('returns null when no enclosing pair', () => {
    const d = doc(['no pairs here']);
    expect(findEnclosingPair(d, 3, 3)).toBeNull();
  });
});

describe('nextExpansion', () => {
  it('expands cursor to word', () => {
    const d = doc(['hello world']);
    const result = nextExpansion(d, 2, 2);
    expect(result).toEqual({ from: 0, to: 5 });
  });

  it('expands word to line', () => {
    const d = doc(['hello world']);
    const result = nextExpansion(d, 0, 5);
    expect(result).not.toBeNull();
    expect(result!.to).toBe(11); // full line
  });

  it('returns null when already selecting the whole document', () => {
    const d = doc(['hello']);
    const result = nextExpansion(d, 0, 5);
    expect(result).toBeNull();
  });
});
