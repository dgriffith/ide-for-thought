/**
 * @vitest-environment happy-dom
 *
 * Editor formatting commands (`src/renderer/lib/editor/formatting.ts`).
 *
 * These are full CodeMirror `Command`s, so — like insert-commands.test.ts —
 * we stand up a detached headless EditorView and assert the resulting doc +
 * selection after running the command. This file covers the exports NOT already
 * exercised by insert-commands.test.ts (fences/vega/callouts) or
 * highlight-toggle.test.ts (`computeToggleHighlight`): the inline toggles, the
 * line-prefix toggles, the `toggleHighlight` command wrapper, and the remaining
 * insert commands (table / rule / footnote / link / image / wiki / typed links).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  toggleBold,
  toggleItalic,
  toggleCode,
  toggleStrikethrough,
  toggleHighlight,
  toggleH1,
  toggleH2,
  toggleH3,
  toggleQuote,
  toggleBulletList,
  toggleNumberedList,
  toggleTaskList,
  insertTable,
  insertHorizontalRule,
  insertFootnote,
  insertLink,
  insertImage,
  insertWikiLink,
  insertTypedLinks,
  insertYouTubeEmbed,
} from '../../../src/renderer/lib/editor/formatting';

let view: EditorView;
afterEach(() => view?.destroy());

/** Stand up a detached view with an optional selection range. */
function mk(doc: string, anchor = doc.length, head = anchor): EditorView {
  view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor, head } }),
  });
  return view;
}

/** Text currently selected by the main selection range. */
function selText(v: EditorView): string {
  const s = v.state.selection.main;
  return v.state.sliceDoc(s.from, s.to);
}

// ── Inline toggles (makeInlineToggle) ────────────────────────────────────────

describe('toggleBold', () => {
  it('wraps a selection with ** and reselects the body', () => {
    const v = mk('text', 0, 4);
    expect(toggleBold(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('**text**');
    expect(selText(v)).toBe('text'); // body between the markers stays selected
  });

  it('inserts empty markers with the cursor between them when nothing is selected', () => {
    const v = mk('', 0);
    expect(toggleBold(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('****');
    expect(v.state.selection.main.empty).toBe(true);
    expect(v.state.selection.main.head).toBe(2);
  });

  it('unwraps when the whole ** … ** span (markers included) is selected', () => {
    const v = mk('**bold**', 0, 8);
    expect(toggleBold(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('bold');
    expect(selText(v)).toBe('bold');
  });

  it('removes surrounding markers when only the inner text is selected', () => {
    const v = mk('**bold**', 2, 6); // "bold"
    expect(toggleBold(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('bold');
    expect(selText(v)).toBe('bold');
  });

  it('wraps two independent selection ranges in one dispatch', () => {
    view = new EditorView({
      state: EditorState.create({
        doc: 'foo bar',
        // Two ranges: "foo" (0..3) and "bar" (4..7). CodeMirror collapses to
        // a single range unless multiple selections are explicitly allowed.
        selection: EditorSelection.create([
          EditorSelection.range(0, 3),
          EditorSelection.range(4, 7),
        ]),
        extensions: EditorState.allowMultipleSelections.of(true),
      }),
    });
    expect(toggleBold(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('**foo** **bar**');
  });
});

describe('toggleItalic / toggleCode / toggleStrikethrough', () => {
  it('toggleItalic wraps with a single *', () => {
    const v = mk('word', 0, 4);
    expect(toggleItalic(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('*word*');
  });

  it('toggleCode wraps with a backtick', () => {
    const v = mk('code', 0, 4);
    expect(toggleCode(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('`code`');
  });

  it('toggleStrikethrough wraps with ~~', () => {
    const v = mk('gone', 0, 4);
    expect(toggleStrikethrough(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('~~gone~~');
  });

  it('toggleStrikethrough unwraps a fully-selected ~~ span', () => {
    const v = mk('~~gone~~', 0, 8);
    expect(toggleStrikethrough(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('gone');
  });
});

// ── toggleHighlight command wrapper ──────────────────────────────────────────

describe('toggleHighlight (command wrapper)', () => {
  it('wraps a single-line selection with ==yellow: … == and returns true', () => {
    const v = mk('Hello world', 6, 11); // "world"
    expect(toggleHighlight(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('Hello ==yellow:world==');
    expect(selText(v)).toBe('world'); // body reselected for cycling
  });

  it('bails (returns false, no change) on a multi-line selection', () => {
    const v = mk('a\nb', 0, 3); // spans the newline
    expect(toggleHighlight(v)).toBe(false);
    expect(v.state.doc.toString()).toBe('a\nb');
  });
});

// ── Line-prefix toggles (makeLinePrefixToggle) ───────────────────────────────

describe('heading toggles', () => {
  it('toggleH1 adds "# " to a plain line', () => {
    const v = mk('text', 0);
    expect(toggleH1(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('# text');
  });

  it('toggleH1 removes "# " when already present (toggle off)', () => {
    const v = mk('# text', 0);
    expect(toggleH1(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('text');
  });

  it('toggleH2 converts an existing H1 prefix rather than stacking', () => {
    const v = mk('# text', 0);
    expect(toggleH2(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('## text');
  });

  it('toggleH3 adds "### "', () => {
    const v = mk('text', 0);
    expect(toggleH3(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('### text');
  });
});

describe('quote / list toggles', () => {
  it('toggleQuote adds "> "', () => {
    const v = mk('quote', 0);
    expect(toggleQuote(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('> quote');
  });

  it('toggleBulletList adds "- "', () => {
    const v = mk('item', 0);
    expect(toggleBulletList(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('- item');
  });

  it('toggleBulletList replaces an existing heading prefix', () => {
    const v = mk('# heading', 0);
    expect(toggleBulletList(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('- heading');
  });

  it('toggleTaskList adds "- [ ] "', () => {
    const v = mk('task', 0);
    expect(toggleTaskList(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('- [ ] task');
  });
});

describe('toggleNumberedList', () => {
  it('numbers each selected line sequentially', () => {
    const v = mk('a\nb\nc', 0, 5); // whole doc
    expect(toggleNumberedList(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('1. a\n2. b\n3. c');
  });

  it('removes numbering when all selected lines are already numbered', () => {
    const v = mk('1. a\n2. b', 0, 9);
    expect(toggleNumberedList(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('a\nb');
  });
});

// ── Insert commands ──────────────────────────────────────────────────────────

describe('insertTable', () => {
  it('inserts a 3-column table scaffold at the start of an empty doc', () => {
    const v = mk('', 0);
    expect(insertTable(v)).toBe(true);
    expect(v.state.doc.toString()).toBe(
      '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n',
    );
    expect(v.state.selection.main.head).toBe(0); // no leading newline needed
  });

  it('prepends a newline when not at the start of a line', () => {
    const v = mk('text', 4);
    expect(insertTable(v)).toBe(true);
    expect(v.state.doc.toString().startsWith('text\n| Column 1 |')).toBe(true);
    expect(v.state.selection.main.head).toBe(5); // after the inserted '\n'
  });
});

describe('insertHorizontalRule', () => {
  it('inserts "---" at the start of an empty doc', () => {
    const v = mk('', 0);
    expect(insertHorizontalRule(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('---\n');
  });

  it('prepends a newline when mid-line', () => {
    const v = mk('text', 4);
    expect(insertHorizontalRule(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('text\n---\n');
  });
});

describe('insertFootnote', () => {
  it('inserts [^1] at the cursor and its definition at the end of the doc', () => {
    const v = mk('hello world', 5); // after "hello"
    expect(insertFootnote(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('hello[^1] world\n[^1]: ');
    // The command computes its anchor as (pre-change doc length + def length),
    // i.e. 11 + '\n[^1]: '.length — so the cursor lands at offset 18 in the
    // new doc, inside the appended definition. (Asserted as actual behavior.)
    expect(v.state.selection.main.head).toBe(18);
  });

  it('picks the next available footnote number', () => {
    const v = mk('ref [^3] here', 13); // cursor at end
    expect(insertFootnote(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('ref [^3] here[^4]\n[^4]: ');
  });
});

describe('insertLink', () => {
  it('wraps a selection as [text](url) with "url" selected', () => {
    const v = mk('text', 0, 4);
    expect(insertLink(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('[text](url)');
    expect(selText(v)).toBe('url');
  });

  it('inserts an empty [](url) with the cursor in the label when nothing is selected', () => {
    const v = mk('', 0);
    expect(insertLink(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('[](url)');
    expect(v.state.selection.main.head).toBe(1); // between the [ ]
  });
});

describe('insertImage', () => {
  it('inserts ![alt](url) with "alt" selected', () => {
    const v = mk('', 0);
    expect(insertImage(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('![alt](url)');
    expect(selText(v)).toBe('alt');
  });
});

describe('insertWikiLink', () => {
  it('wraps a selection as [[Page]]', () => {
    const v = mk('Page', 0, 4);
    expect(insertWikiLink(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('[[Page]]');
    expect(v.state.selection.main.head).toBe(8);
  });

  it('inserts empty [[]] with the cursor between the brackets', () => {
    const v = mk('', 0);
    expect(insertWikiLink(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('[[]]');
    expect(v.state.selection.main.head).toBe(2);
  });
});

describe('insertTypedLinks', () => {
  it('excludes the plain "references" link type', () => {
    expect(insertTypedLinks.some((t) => t.linkType.name === 'references')).toBe(false);
    // Every other registered type is present.
    expect(insertTypedLinks.map((t) => t.linkType.name)).toContain('supports');
  });

  it('wraps a selection as [[name::selected]]', () => {
    const supports = insertTypedLinks.find((t) => t.linkType.name === 'supports')!;
    const v = mk('claim', 0, 5);
    expect(supports.command(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('[[supports::claim]]');
    expect(v.state.selection.main.head).toBe(v.state.doc.length);
  });

  it('inserts a [[name::]] template with the cursor at the target position', () => {
    const rebuts = insertTypedLinks.find((t) => t.linkType.name === 'rebuts')!;
    const v = mk('', 0);
    expect(rebuts.command(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('[[rebuts::]]');
    expect(v.state.selection.main.head).toBe('[[rebuts::'.length); // before the closing ]]
  });
});

describe('insertYouTubeEmbed', () => {
  it('inserts a ```youtube fence with the cursor on the empty body line', () => {
    const v = mk('', 0);
    expect(insertYouTubeEmbed(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('```youtube\n\n```\n');
    expect(v.state.selection.main.head).toBe('```youtube\n'.length);
  });
});
