/** The List Tools plugin's sort (#2643): what "Sort List in Selection" does to the selected text. */
import { describe, it, expect } from 'vitest';
import { sortList } from '../../../plugins/list-tools/src/sort-list';

describe('sortList (#2643)', () => {
  it('sorts the items, ignoring case, numbers in numeric order', () => {
    expect(sortList('- pear\n- Apple\n- item 10\n- item 2\n')).toBe('- Apple\n- item 2\n- item 10\n- pear\n');
  });

  it('moves nested items and continuation lines with their parent', () => {
    expect(sortList('- b\n  - b1\n  - b2\n- a\n  more about a\n')).toBe('- a\n  more about a\n- b\n  - b1\n  - b2\n');
  });

  it('keeps text before the list first and blank lines after it last', () => {
    expect(sortList('Groceries:\n- milk\n- eggs\n\n')).toBe('Groceries:\n- eggs\n- milk\n\n');
  });

  it('keeps a blank line between items when the list had one', () => {
    expect(sortList('- b\n\n- a\n')).toBe('- a\n\n- b\n');
  });

  it('ignores a checkbox, and keeps it on its item', () => {
    expect(sortList('- [x] b\n- [ ] a\n')).toBe('- [ ] a\n- [x] b\n');
  });

  it('renumbers an ordered list from its first number, keeping the delimiter', () => {
    expect(sortList('3) c\n4) a\n5) b')).toBe('3) a\n4) b\n5) c');
  });

  it('sorts the outermost items of a selection that starts inside the list', () => {
    expect(sortList('    - z\n    - y\n')).toBe('    - y\n    - z\n');
  });

  it('is stable for equal keys, and null with fewer than two items', () => {
    expect(sortList('- A\n- a\n')).toBe('- A\n- a\n');
    expect(sortList('- only\n')).toBeNull();
    expect(sortList('just a paragraph')).toBeNull();
  });
});
