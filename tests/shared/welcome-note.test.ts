import { describe, it, expect } from 'vitest';
import { parse as parseYAML } from 'yaml';
import { WELCOME_NOTE_PATH, welcomeNoteContent } from '../../src/shared/welcome-note';

describe('welcomeNoteContent', () => {
  it('lands at Welcome.md', () => {
    expect(WELCOME_NOTE_PATH).toBe('Welcome.md');
  });

  it('carries a parseable entrypoint tag so the note auto-opens', () => {
    const body = welcomeNoteContent(true);
    const fm = body.match(/^---\n([\s\S]*?)\n---/);
    expect(fm).not.toBeNull();
    const parsed = parseYAML(fm![1]!) as { tags?: string[] };
    expect(parsed.tags).toEqual(['entrypoint']);
  });

  it('uses the mac glyph on darwin and Ctrl elsewhere', () => {
    expect(welcomeNoteContent(true)).toContain('⌘N');
    expect(welcomeNoteContent(true)).not.toContain('Ctrl+N');
    expect(welcomeNoteContent(false)).toContain('Ctrl+N');
    expect(welcomeNoteContent(false)).not.toContain('⌘N');
  });

  it('names conversation affordances that actually exist (#1569)', () => {
    const body = welcomeNoteContent(true);
    // It used to say "Open a conversation", which matches no button, menu item,
    // or shortcut — a reader went looking for it and filed a bug. Both labels
    // below are real: the button above the editor (App.svelte) and the
    // tab / editor / preview context-menu item.
    expect(body).toContain('New Conversation');
    expect(body).toContain('Ask About This');
    expect(body).not.toMatch(/open a conversation/i);
  });

  it('says "properties", never "frontmatter" (#welcome-copy)', () => {
    const body = welcomeNoteContent(true);
    expect(body).toContain('properties');
    expect(body.toLowerCase()).not.toContain('frontmatter');
  });

  it('never points at the properties block "above"', () => {
    // The editor collapses it by default, so on most screens there is nothing
    // there to look at — the old copy sent readers to a blank line.
    const body = welcomeNoteContent(true);
    expect(body).not.toMatch(/tag above|block above|above marks/i);
  });

  it('leads with why a thoughtbase, not with the machinery', () => {
    const body = welcomeNoteContent(true);
    const intro = body.slice(0, body.indexOf('## '));
    // The pitch, in the website's framing.
    expect(intro).toMatch(/thoughtbase/i);
    expect(intro).toMatch(/chat history|conversation started from nothing|compounds/i);
    // Not the internals. "Knowledge graph" is a thing you come to want, not a
    // reason to start.
    expect(body).not.toMatch(/knowledge graph|wiki-link|indexed|SPARQL/i);
  });

  it('greets the reader', () => {
    expect(welcomeNoteContent(true)).toContain('Welcome to your thoughtbase');
  });
});
