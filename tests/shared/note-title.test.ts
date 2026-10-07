/**
 * The one note-title helper (#2683). Frontmatter `title:` wins; otherwise the
 * first ATX H1 in the BODY — never a YAML comment inside the frontmatter, and
 * never a `# ` line inside fenced code.
 */
import { describe, it, expect } from 'vitest';
import { noteTitle, firstBodyHeading } from '../../src/shared/note-title';

describe('noteTitle (#2683)', () => {
  it('ignores a YAML comment in the frontmatter and takes the body H1', () => {
    const md = '---\ntype: project\n# keep this comment\nstatus: active\n---\n# Garden Shed\n';
    expect(noteTitle(md)).toBe('Garden Shed');
  });

  it('returns null for a frontmatter comment with no body H1', () => {
    expect(noteTitle('---\n# a comment\n---\njust text\n')).toBeNull();
  });

  it('prefers frontmatter title: over the body H1', () => {
    expect(noteTitle('---\ntitle: From YAML\n---\n# From Heading\n')).toBe('From YAML');
  });

  it('reads title: through YAML (quotes and trailing comments are not part of it)', () => {
    expect(noteTitle('---\ntitle: "Quoted"\n---\n')).toBe('Quoted');
    expect(noteTitle('---\ntitle: Field Notes  # working title\n---\n')).toBe('Field Notes');
  });

  it('falls through a blank or non-string title: to the body H1', () => {
    expect(noteTitle('---\ntitle: "   "\n---\n# Body\n')).toBe('Body');
    expect(noteTitle('---\ntitle: 42\n---\n# Body\n')).toBe('Body');
    expect(noteTitle('---\ntitle:\n---\n# Body\n')).toBe('Body');
  });

  it('uses an already-parsed frontmatter record when handed one, not the text', () => {
    expect(noteTitle('---\ntitle: In Text\n---\n# H\n', { title: 'Handed In' })).toBe('Handed In');
    expect(noteTitle('---\ntitle: In Text\n---\n# H\n', {})).toBe('H');
  });

  it('does not read an inherited title off a plain object', () => {
    const proto = { title: 'Inherited' };
    expect(noteTitle('# Own\n', Object.create(proto) as Record<string, unknown>)).toBe('Own');
  });

  it('skips a # line inside a fenced code block', () => {
    expect(noteTitle('```bash\n# install deps\nnpm i\n```\n\n# Real Title\n')).toBe('Real Title');
    expect(noteTitle('~~~\n# tilde fence\n~~~\n# After Tilde\n')).toBe('After Tilde');
  });

  it('needs a matching closing fence: a shorter or different fence does not close it', () => {
    expect(noteTitle('````\n```\n# still code\n````\n# Out\n')).toBe('Out');
    expect(noteTitle('```\n~~~\n# still code\n```\n# Out\n')).toBe('Out');
  });

  it('treats everything after an unclosed fence as code', () => {
    expect(noteTitle('```\n# in code\n')).toBeNull();
  });

  it('returns null when there is no H1 anywhere', () => {
    expect(noteTitle('just some text\n\n## Only an H2\n')).toBeNull();
    expect(noteTitle('')).toBeNull();
  });

  it('handles CRLF line endings in both the frontmatter and the body', () => {
    const md = '---\r\ntype: project\r\n# keep this comment\r\n---\r\n# Crlf Shed\r\n\r\nbody\r\n';
    expect(noteTitle(md)).toBe('Crlf Shed');
  });

  it('treats a frontmatter block with no closing --- as body (as the preview does)', () => {
    // Not frontmatter, so the `# ` line is a real heading in the rendered note.
    expect(noteTitle('---\ntype: project\n# Unclosed Heading\nmore\n')).toBe('Unclosed Heading');
  });

  it('returns null for frontmatter with an empty body', () => {
    expect(noteTitle('---\ntype: project\n---\n')).toBeNull();
    expect(noteTitle('---\ntype: project\n---')).toBeNull();
  });

  it('does not take a #tag line (no space) as a heading', () => {
    expect(noteTitle('#ml #ai\n\n# Tagged Note\n')).toBe('Tagged Note');
  });

  it('does not recognise a Setext heading (it never did)', () => {
    expect(noteTitle('Setext Title\n===\n')).toBeNull();
  });

  it('accepts up to three spaces of indent; four is an indented code block', () => {
    expect(noteTitle('   # Indented\n')).toBe('Indented');
    expect(noteTitle('    # Code\n')).toBeNull();
  });

  it('strips a closing # run but keeps a hash that is part of a word', () => {
    expect(noteTitle('# Closed ##\n')).toBe('Closed');
    expect(noteTitle('# Learning C#\n')).toBe('Learning C#');
    expect(noteTitle('#\tTabbed\n')).toBe('Tabbed');
  });

  it('skips an empty H1 rather than taking a blank title or the next line', () => {
    expect(noteTitle('#\nnot a title\n# Real\n')).toBe('Real');
    expect(noteTitle('# ##\n# Real\n')).toBe('Real');
  });

  it('does not treat an H2 as the title', () => {
    expect(noteTitle('## Section\n# Title Later\n')).toBe('Title Later');
  });

  it('ignores a backtick line with a backtick in its info string (not a fence)', () => {
    expect(noteTitle('``` not `a fence`\n# Heading\n')).toBe('Heading');
  });
});

describe('firstBodyHeading', () => {
  it('ignores frontmatter title: — that is noteTitle’s job', () => {
    expect(firstBodyHeading('---\ntitle: Ignored\n---\n# Body H1\n')).toBe('Body H1');
  });
});
