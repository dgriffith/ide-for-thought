/**
 * Plan "create note from conversation" (#177). Pure-function tests
 * — the host wires writeFile / openFile around the plan.
 */

import { describe, it, expect } from 'vitest';
import {
  planCreateFromConversation,
  suggestConversationNoteTitle,
  yamlScalar,
} from '../../src/renderer/lib/refactor/create-from-conversation';
import { DEFAULT_REFACTOR_SETTINGS } from '../../src/renderer/lib/refactor/settings';

const BASE = {
  title: 'My new note',
  body: 'Hello world.\nA second line.',
  conversationId: 'conv-1775415007888-pizewg',
  today: '2026-05-27',
  settings: DEFAULT_REFACTOR_SETTINGS,
};

describe('planCreateFromConversation', () => {
  it('writes frontmatter with title / created / source / conversation', () => {
    const plan = planCreateFromConversation({
      ...BASE,
      sourceRelativePath: 'notes/origin.md',
    });
    expect(plan.newNoteContent).toContain('title: My new note');
    expect(plan.newNoteContent).toContain('created: 2026-05-27');
    expect(plan.newNoteContent).toContain('source: notes/origin.md');
    expect(plan.newNoteContent).toContain('conversation: conv-1775415007888-pizewg');
    expect(plan.newNoteContent).toContain('Hello world.');
  });

  it('omits the source field for a freeform conversation', () => {
    const plan = planCreateFromConversation({
      ...BASE,
      sourceRelativePath: null,
    });
    expect(plan.newNoteContent).not.toContain('source:');
    // Other fields still present.
    expect(plan.newNoteContent).toContain('conversation:');
    expect(plan.newNoteContent).toContain('title:');
  });

  it('lands in the source note\'s folder by default', () => {
    const plan = planCreateFromConversation({
      ...BASE,
      sourceRelativePath: 'reading/papers/origin.md',
    });
    expect(plan.newNotePath).toBe('reading/papers/my-new-note.md');
  });

  it('falls back to root for freeform conversations regardless of destination setting', () => {
    const plan = planCreateFromConversation({
      ...BASE,
      sourceRelativePath: null,
      settings: { ...DEFAULT_REFACTOR_SETTINGS, destination: 'same-folder' },
    });
    expect(plan.newNotePath).toBe('my-new-note.md');
  });

  it('honours the custom destination template when the source path is present', () => {
    const plan = planCreateFromConversation({
      ...BASE,
      sourceRelativePath: 'reading/origin.md',
      settings: { ...DEFAULT_REFACTOR_SETTINGS, destination: 'custom', destinationTemplate: 'derived/{{source}}' },
    });
    expect(plan.newNotePath.startsWith('derived/reading/origin.md/')).toBe(true);
  });

  it('trims surrounding whitespace from the body', () => {
    const plan = planCreateFromConversation({
      ...BASE,
      body: '\n\n  body with leading whitespace  \n\n',
      sourceRelativePath: 'a.md',
    });
    expect(plan.newNoteContent).toMatch(/---\n\nbody with leading whitespace\n$/);
  });

  it('quotes path-shaped titles so YAML doesn\'t mis-parse them', () => {
    // Titles containing colons / brackets / lone dashes need quoting.
    const plan = planCreateFromConversation({
      ...BASE,
      title: 'Notes: 2026-05-27 thoughts',
      sourceRelativePath: null,
    });
    expect(plan.newNoteContent).toContain('title: "Notes: 2026-05-27 thoughts"');
  });

  it('falls back to a default stem when the title sanitises to empty', () => {
    const plan = planCreateFromConversation({
      ...BASE,
      title: '!!!',
      sourceRelativePath: 'a.md',
    });
    expect(plan.newNotePath).toMatch(/^note-\d+\.md$/);
  });
});

describe('suggestConversationNoteTitle', () => {
  it('uses the first markdown heading when present', () => {
    expect(suggestConversationNoteTitle('# A bold claim\n\nbody here')).toBe('A bold claim');
  });

  it('uses the first short line when no heading', () => {
    expect(suggestConversationNoteTitle('A summary in one line\n\nlonger body follows')).toBe('A summary in one line');
  });

  it('returns null when the body opens with a long paragraph', () => {
    const long = 'This is a much longer opening paragraph that would not make a sensible note title and should fall through to the host prompt.';
    expect(suggestConversationNoteTitle(long)).toBeNull();
  });
});

describe('yamlScalar', () => {
  it('passes plain words through unquoted', () => {
    expect(yamlScalar('hello-world')).toBe('hello-world');
    expect(yamlScalar('Plain Words')).toBe('Plain Words');
  });
  it('quotes values that look like dates / booleans / numbers', () => {
    expect(yamlScalar('2026-05-27')).toBe('"2026-05-27"');
    expect(yamlScalar('true')).toBe('"true"');
    expect(yamlScalar('42')).toBe('"42"');
  });
  it('quotes anything with punctuation YAML cares about', () => {
    expect(yamlScalar('Notes: hi')).toBe('"Notes: hi"');
    expect(yamlScalar('a "quote" inside')).toBe('"a \\"quote\\" inside"');
  });
});
