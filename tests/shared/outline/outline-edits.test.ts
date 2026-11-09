/**
 * Editing a note through its outline (#2963): each operation as the exact
 * text it leaves — rename, add a child / a sibling, delete, move (re-leveling
 * headings, re-indenting items), up / down, promote and demote as tree moves —
 * and what each refuses: a list item becoming a heading, a heading into a
 * list, past level 6, a node into itself.
 */
import { describe, it, expect } from 'vitest';
import { parseOutline, type Outline } from '../../../src/shared/outline/outline';
import {
  addChild, addSibling, applyChanges, deleteNode, demote, moveBy, moveNode, promote, renameNode, type OutlineEdit,
} from '../../../src/shared/outline/outline-edits';

const NOTE = [
  '# Trip',
  '',
  '## Pack',
  '',
  '- clothes',
  '  - socks',
  '- papers',
  '',
  '## Book',
  '',
  'Trains first.',
  '',
  '### Hotel',
  '',
  '## Go',
  '',
].join('\n');

const o = () => parseOutline(NOTE);
const find = (out: Outline, text: string) => out.nodes.find((n) => n.text === text)!;
const run = (edit: OutlineEdit) => {
  if ('refused' in edit) throw new Error(`refused: ${edit.refused}`);
  return applyChanges(NOTE, edit.changes);
};

describe('the outline edits (#2963)', () => {
  it('renames in place, keeping the #s, marker and box', () => {
    const out = o();
    expect(run(renameNode(out, find(out, 'Pack'), 'Packing'))).toBe(NOTE.replace('## Pack\n', '## Packing\n'));
    expect(run(renameNode(out, find(out, 'socks'), 'warm\nsocks'))).toBe(NOTE.replace('  - socks', '  - warm socks'));
  });

  it('adds a child of the kind already there, at the end; a sub-heading under a heading with none', () => {
    const out = o();
    expect(run(addChild(out, find(out, 'clothes'), 'hat'))).toBe(NOTE.replace('  - socks\n', '  - socks\n  - hat\n'));
    expect(run(addChild(out, find(out, 'Pack'), 'tickets'))).toBe(NOTE.replace('- papers\n', '- papers\n- tickets\n'));
    expect(run(addChild(out, find(out, 'Go'), 'Station'))).toBe(`${NOTE}### Station\n`);
  });

  it('adds a sibling straight after everything beneath the node', () => {
    const out = o();
    expect(run(addSibling(out, find(out, 'Book'), 'Budget'))).toBe(NOTE.replace('## Go', '## Budget\n## Go'));
    expect(run(addSibling(out, find(out, 'clothes'), 'shoes'))).toBe(NOTE.replace('- papers', '- shoes\n- papers'));
  });

  it('deletes a node with its subtree', () => {
    const out = o();
    expect(run(deleteNode(out, find(out, 'Book')))).toBe(NOTE.replace('## Book\n\nTrains first.\n\n### Hotel\n\n', ''));
    expect(run(deleteNode(out, find(out, 'clothes')))).toBe(NOTE.replace('- clothes\n  - socks\n', ''));
  });

  it('moves a section up or down among its siblings, with its own blank lines', () => {
    const out = o();
    // Go is the last section and has no blank line of its own: none is added.
    expect(run(moveBy(out, find(out, 'Go'), -1))).toBe('# Trip\n\n## Pack\n\n- clothes\n  - socks\n- papers\n\n## Go\n## Book\n\nTrains first.\n\n### Hotel\n\n');
    expect(run(moveBy(out, find(out, 'papers'), -1))).toBe(NOTE.replace('- clothes\n  - socks\n- papers\n', '- papers\n- clothes\n  - socks\n'));
    expect(moveBy(out, find(out, 'Pack'), -1)).toEqual({ refused: 'It\'s already first.' });
  });

  it('moves to another parent: a heading takes its new level, its own sub-headings with it; an item its new indent', () => {
    const out = o();
    // Book (h2, with Hotel h3) under Go: h3, Hotel h4.
    expect(run(moveNode(out, find(out, 'Book'), find(out, 'Go'), 0))).toBe('# Trip\n\n## Pack\n\n- clothes\n  - socks\n- papers\n\n## Go\n### Book\n\nTrains first.\n\n#### Hotel\n\n');
    // papers under clothes: indented to its content.
    expect(run(moveNode(out, find(out, 'papers'), find(out, 'clothes'), 1))).toBe(NOTE.replace('  - socks\n- papers\n', '  - socks\n  - papers\n'));
  });

  it('promotes to the parent\'s next sibling and demotes under the sibling before — tree moves, not just levels', () => {
    const out = o();
    // Hotel (h3 under Book) promoted: an h2 after Book, before Go.
    expect(run(promote(out, find(out, 'Hotel')))).toBe(NOTE.replace('### Hotel', '## Hotel'));
    // socks promoted out of clothes: a sibling after clothes, before papers.
    expect(run(promote(out, find(out, 'socks')))).toBe(NOTE.replace('  - socks\n', '- socks\n'));
    // Book demoted under Pack: an h3 at Pack's end, after Pack's list.
    expect(run(demote(out, find(out, 'Book')))).toBe('# Trip\n\n## Pack\n\n- clothes\n  - socks\n- papers\n\n### Book\n\nTrains first.\n\n#### Hotel\n\n## Go\n');
  });

  it('refuses what would cross between headings and lists, go past level 6, or go inside itself', () => {
    const out = o();
    expect(promote(out, find(out, 'clothes'))).toEqual({ refused: 'A list item can\'t become a heading.' });
    expect(moveNode(out, find(out, 'Book'), find(out, 'clothes'), 0)).toEqual({ refused: 'A heading can\'t go inside a list item.' });
    expect(moveNode(out, find(out, 'Book'), find(out, 'Hotel'), 0)).toEqual({ refused: 'A node can\'t go inside itself.' });
    expect(promote(out, find(out, 'Trip'))).toEqual({ refused: 'It\'s already at the top.' });
    expect(demote(out, find(out, 'Pack'))).toEqual({ refused: 'There\'s nothing before it to go under.' });
    const deep = parseOutline('# a\n## b\n### c\n#### d\n##### e\n###### f\n# g\n');
    expect(moveNode(deep, deep.nodes.find((n) => n.text === 'a')!, deep.nodes.find((n) => n.text === 'g')!, 0)).toEqual({ refused: 'That would put a heading past level 6.' });
  });

  it('numbers a new ordered item on from the one before', () => {
    const out = parseOutline('1. one\n2. two\n');
    expect(applyChanges(out.text, (addSibling(out, out.nodes[1]!, 'three') as { changes: [] }).changes)).toBe('1. one\n2. two\n3. three\n');
  });

  it('adds a newline first at the very end of a note without one', () => {
    const out = parseOutline('# A');
    expect(applyChanges(out.text, (addSibling(out, out.nodes[0]!, 'B') as { changes: [] }).changes)).toBe('# A\n# B\n');
  });
});
