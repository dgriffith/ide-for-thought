/**
 * Property tests for editing a note through its outline (#2963):
 * `src/shared/outline/outline.ts` and `outline-edits.ts`.
 *
 * Notes are generated from headings at every level (skipped levels too),
 * tight and loose nested lists with task items, continuation lines and fences
 * inside items, paragraphs, top-level fences holding `#` and `-` lines, and
 * directives. Every heading and item text is unique, so a node can be found
 * again after an edit.
 *
 *   1. The outline tiles the note: children's subtrees are in order, don't
 *      overlap and sit inside their parent's; each node's text is where it says.
 *      Renaming a node to its own text, or moving it to where it already is,
 *      changes nothing (parse ∘ render is the identity on untouched text).
 *   2. Every edit keeps everything outside what it touches byte-identical:
 *      after a rename, a delete or an add, every other node is still there,
 *      in order, with its text, and the bytes before and after the change are
 *      the original's.
 *   3. A move, then a move back to where it was, is the original text —
 *      byte for byte whenever the move kept what the tree can say. Two
 *      things an index can't: a heading the destination forced to another
 *      level (an H3 placed after a top-level H1 must become an H1), and a list
 *      item alone among its parent's text (its place among the paragraphs
 *      isn't a position in the tree), and an item in a loose list (a blank
 *      line between items belongs to the item before it, and which item that
 *      is changes as items move), and the last item of a list followed by
 *      another list of the same parent (the index after it is also the index
 *      before the next list). Then the round trip gives the same tree.
 *
 * Counterexample convention: see `untrusted-content.property.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseOutline, isWithin, type Outline, type OutlineNode } from '../../src/shared/outline/outline';
import {
  addChild, addSibling, applyChanges, deleteNode, moveNode, renameNode, type OutlineEdit,
} from '../../src/shared/outline/outline-edits';

type Block =
  | { k: 'h'; level: number }
  | { k: 'list'; items: { depth: number; task: boolean; cont: boolean; fence: boolean; looseAfter: boolean }[] }
  | { k: 'p' }
  | { k: 'fence' }
  | { k: 'dir' };

const block: fc.Arbitrary<Block> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 1, max: 6 }).map((level): Block => ({ k: 'h', level })) },
  {
    weight: 3,
    arbitrary: fc.array(fc.record({ step: fc.integer({ min: -2, max: 1 }), task: fc.boolean(), cont: fc.boolean(), fence: fc.boolean(), looseAfter: fc.boolean() }), { minLength: 1, maxLength: 6 })
      .map((raw): Block => {
        let depth = 0;
        return { k: 'list', items: raw.map((r, i) => { depth = i === 0 ? 0 : Math.max(0, Math.min(depth + 1, depth + r.step)); return { depth, task: r.task, cont: r.cont, fence: r.fence && r.cont, looseAfter: r.looseAfter }; }) };
      }),
  },
  { weight: 2, arbitrary: fc.constant<Block>({ k: 'p' }) },
  { weight: 1, arbitrary: fc.constant<Block>({ k: 'fence' }) },
  { weight: 1, arbitrary: fc.constant<Block>({ k: 'dir' }) },
);

/** A note from blocks: every heading and item text unique (`t0`, `t1`, …). */
const note = fc.tuple(fc.array(block, { minLength: 1, maxLength: 10 }), fc.boolean()).map(([blocks, frontmatter]) => {
  let n = 0;
  const out: string[] = frontmatter ? ['---', 'title: x', '---'] : [];
  for (const b of blocks) {
    if (b.k === 'h') out.push(`${'#'.repeat(b.level)} t${n++}`, '');
    else if (b.k === 'p') out.push('Some words, a paragraph.', '');
    else if (b.k === 'fence') out.push('```', '# not a heading', '- not an item', '```', '');
    else if (b.k === 'dir') out.push(':::note', '# not a heading', ':::', '');
    else {
      for (const it of b.items) {
        const pad = '  '.repeat(it.depth);
        out.push(`${pad}- ${it.task ? '[ ] ' : ''}t${n++}`);
        if (it.cont) out.push(`${pad}  more of it`);
        if (it.fence) out.push(`${pad}  \`\`\``, `${pad}  # inside`, `${pad}  \`\`\``);
        if (it.looseAfter) out.push('');
      }
      out.push('');
    }
  }
  return `${out.join('\n')}\n`;
});

const texts = (o: Outline) => o.nodes.map((n) => n.text);
/** The tree's shape: each node's text and kind, and its children's. */
const tree = (n: OutlineNode): unknown => ({ t: n.text, k: n.kind, c: n.children.map(tree) });
const ok = (e: OutlineEdit) => ('changes' in e ? e.changes : null);
const byText = (o: Outline, t: string) => o.nodes.find((n) => n.text === t)!;

describe('the outline (#2963)', () => {
  it('tiles the note, knows where each text is, and changes nothing on a no-op edit', () => {
    fc.assert(fc.property(note, (text) => {
      const o = parseOutline(text);
      const check = (n: OutlineNode) => {
        let at = n.kind === 'root' ? n.subtree.start : n.head.end;
        for (const c of n.children) {
          expect(c.subtree.start).toBeGreaterThanOrEqual(at);
          expect(c.subtree.end).toBeLessThanOrEqual(n.subtree.end);
          at = c.subtree.end;
          check(c);
        }
      };
      check(o.root);
      for (const n of o.nodes) {
        expect(text.slice(n.textRange.start, n.textRange.end)).toBe(n.text);
        expect(applyChanges(text, ok(renameNode(o, n, n.text))!)).toBe(text);
        const sibs = n.parent!.children.filter((c) => c.kind === n.kind);
        const stay = ok(moveNode(o, n, n.parent!, sibs.indexOf(n)));
        if (stay) expect(applyChanges(text, stay)).toBe(text);
      }
      // Nothing inside a fence or directive is a node.
      expect(texts(o).every((t) => /^t\d+$/.test(t))).toBe(true);
    }), { numRuns: 300 });
  });

  it('a rename, a delete or an add leaves every other node, and every byte outside the change, as it was', () => {
    fc.assert(fc.property(note, fc.nat(), fc.constantFrom('rename', 'delete', 'child', 'sibling'), (text, pick, op) => {
      const o = parseOutline(text);
      fc.pre(o.nodes.length > 0);
      const n = o.nodes[pick % o.nodes.length]!;
      const edit = op === 'rename' ? renameNode(o, n, 'NEW') : op === 'delete' ? deleteNode(o, n) : op === 'child' ? addChild(o, n, 'NEW') : addSibling(o, n, 'NEW');
      const changes = ok(edit)!;
      const after = applyChanges(text, changes);
      const from = Math.min(...changes.map((c) => c.from));
      const to = Math.max(...changes.map((c) => c.to));
      expect(after.slice(0, from)).toBe(text.slice(0, from));
      expect(after.slice(after.length - (text.length - to))).toBe(text.slice(to));
      const r = parseOutline(after);
      const kept = o.nodes.filter((m) => (op === 'delete' ? !isWithin(m, n) : op === 'rename' ? m !== n : true)).map((m) => m.text);
      const now = texts(r).filter((t) => t !== 'NEW');
      expect(now).toEqual(kept);
      if (op !== 'delete') expect(texts(r)).toContain('NEW');
    }), { numRuns: 400 });
  });

  it('a move, then a move back, is the original text', () => {
    fc.assert(fc.property(note, fc.nat(), fc.nat(), fc.nat(), (text, pickNode, pickParent, pickIndex) => {
      const o = parseOutline(text);
      fc.pre(o.nodes.length > 0);
      const n = o.nodes[pickNode % o.nodes.length]!;
      const parents = [o.root, ...o.nodes];
      const target = parents[pickParent % parents.length]!;
      const index = pickIndex % (target.children.length + 1);
      const there = ok(moveNode(o, n, target, index));
      fc.pre(there !== null); // refused (into itself, a heading into a list, past level 6)
      const moved = applyChanges(text, there);
      const o2 = parseOutline(moved);
      const back = byText(o2, n.text);
      const home = n.parent!.kind === 'root' ? o2.root : byText(o2, n.parent!.text);
      const homeIndex = n.parent!.children.filter((c) => c.kind === n.kind).indexOf(n);
      const undo = ok(moveNode(o2, back, home, homeIndex));
      expect(undo).not.toBeNull();
      const restored = applyChanges(moved, undo!);
      const leveled = n.kind === 'heading' && back.level !== n.level;
      const items = n.parent!.children.filter((c) => c.kind === 'item');
      const lone = n.kind === 'item' && items.length === 1;
      // Loose: a blank line inside the item's own text, or just before or after it.
      const loose = n.kind === 'item' && (/\n\n/.test(text.slice(n.subtree.start, n.subtree.end + 1)) || text.slice(Math.max(0, n.subtree.start - 2), n.subtree.start) === '\n\n');
      const next = items[items.indexOf(n) + 1];
      const listEnd = n.kind === 'item' && !!next && next.subtree.start !== n.subtree.end;
      if (!leveled && !lone && !loose && !listEnd) expect(restored).toBe(text);
      else expect(tree(parseOutline(restored).root)).toEqual(tree(o.root));
    }), { numRuns: 500 });
  });
});
