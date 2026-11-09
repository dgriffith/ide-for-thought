/**
 * A note's outline as a tree (#2963): headings by level, list items by
 * indentation under their heading, task boxes, and the opaque parts —
 * frontmatter, fences (inside a list too) and directives — that never become
 * nodes. Subtree ranges tile the note.
 */
import { describe, it, expect } from 'vitest';
import { parseOutline, nodeAt, type OutlineNode } from '../../../src/shared/outline/outline';

/** The tree as `kind:text` lines, indented by depth. */
function shape(n: OutlineNode, depth = 0): string[] {
  const own = n.kind === 'root' ? [] : [`${'  '.repeat(depth - 1)}${n.kind === 'heading' ? `h${n.level}` : n.task ? (n.task.checked ? '[x]' : '[ ]') : '-'} ${n.text}`];
  return [...own, ...n.children.flatMap((c) => shape(c, depth + 1))];
}

const NOTE = [
  '---',
  'title: Trip',
  '# not a heading: frontmatter',
  '---',
  'Intro text.',
  '- loose item before any heading',
  '',
  '# Trip',
  '',
  'Some words.',
  '',
  '- Pack',
  '  - [ ] passport',
  '  - [x] tickets',
  '    continuation of tickets',
  '- Book',
  '  ```',
  '  # not a heading: in a fence in an item',
  '  - not an item',
  '  ```',
  '',
  '### Skipped to three',
  '',
  ':::note',
  '# not a heading: in a directive',
  ':::',
  '',
  '## Two',
  '1. first',
  '2. second',
  '',
  'After the list.',
  '',
  '# Second top',
  '',
].join('\n');

describe('parseOutline (#2963)', () => {
  it('nests headings by level and items by indentation under their heading; tasks keep their box', () => {
    expect(shape(parseOutline(NOTE).root)).toEqual([
      '- loose item before any heading',
      'h1 Trip',
      '  - Pack',
      '    [ ] passport',
      '    [x] tickets',
      '  - Book',
      '  h3 Skipped to three',
      '  h2 Two',
      '    - first',
      '    - second',
      'h1 Second top',
    ]);
  });

  it('never makes a node of frontmatter, a fence (inside an item too) or a directive', () => {
    const o = parseOutline(NOTE);
    expect(o.nodes.map((n) => n.text).join('|')).not.toMatch(/not a heading|not an item/);
    expect(o.frontmatter).toEqual({ start: 0, end: NOTE.indexOf('Intro') });
  });

  it('subtrees nest and tile: a heading runs to the next heading at its level or above; an item to its last line', () => {
    const o = parseOutline(NOTE);
    const trip = o.nodes.find((n) => n.text === 'Trip')!;
    expect(NOTE.slice(trip.subtree.start, trip.subtree.end)).toBe(NOTE.slice(NOTE.indexOf('# Trip'), NOTE.indexOf('# Second top')));
    const tickets = o.nodes.find((n) => n.text === 'tickets')!;
    expect(NOTE.slice(tickets.subtree.start, tickets.subtree.end)).toBe('  - [x] tickets\n    continuation of tickets\n');
    const book = o.nodes.find((n) => n.text === 'Book')!;
    expect(NOTE.slice(book.subtree.start, book.subtree.end)).toBe('- Book\n  ```\n  # not a heading: in a fence in an item\n  - not an item\n  ```\n');
    // A paragraph after a blank line at the margin ends the list: it's the heading's.
    const second = o.nodes.find((n) => n.text === 'second')!;
    expect(NOTE.slice(second.subtree.start, second.subtree.end)).toBe('2. second\n');
    for (const n of o.nodes) for (const c of n.children) {
      expect(c.subtree.start).toBeGreaterThanOrEqual(n.subtree.start);
      expect(c.subtree.end).toBeLessThanOrEqual(n.subtree.end);
    }
  });

  it('knows where each node\'s text is, for a rename', () => {
    const o = parseOutline(NOTE);
    for (const n of o.nodes) expect(NOTE.slice(n.textRange.start, n.textRange.end)).toBe(n.text);
  });

  it('nodeAt finds the innermost node at an offset', () => {
    const o = parseOutline(NOTE);
    expect(nodeAt(o, NOTE.indexOf('passport'))?.text).toBe('passport');
    expect(nodeAt(o, NOTE.indexOf('Some words'))?.text).toBe('Trip');
    expect(nodeAt(o, NOTE.indexOf('After the list'))?.text).toBe('Two');
    expect(nodeAt(o, NOTE.indexOf('Intro'))).toBeNull();
  });

  it('a heading with closing #s, an empty heading, and tabs for indentation', () => {
    const o = parseOutline('## Closed ##\n#\n- a\n\t- b\n');
    expect(shape(o.root)).toEqual(['h2 Closed', 'h1 ', '  - a', '    - b']);
  });
});
