import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../../../src/renderer/lib/refactor/tokens';

const fixedNow = new Date('2026-04-19T12:34:56');

describe('renderTemplate', () => {
  it('renders {{date}} as YYYY-MM-DD by default', () => {
    expect(renderTemplate('{{date}}', { now: fixedNow })).toBe('2026-04-19');
  });

  it('renders {{date:FORMAT}} using format tokens', () => {
    expect(renderTemplate('{{date:YYYY}}', { now: fixedNow })).toBe('2026');
    expect(renderTemplate('{{date:YYYY-MM}}', { now: fixedNow })).toBe('2026-04');
    expect(renderTemplate('{{date:YYYYMMDDHHmmss}}', { now: fixedNow })).toBe('20260419123456');
  });

  it('renders context tokens', () => {
    const out = renderTemplate(
      '{{title}}/{{new_note_title}}/{{source}}',
      { title: 'Parent', new_note_title: 'Child', source: 'notes/parent.md', now: fixedNow },
    );
    expect(out).toBe('Parent/Child/notes/parent.md');
  });

  it('renders unknown tokens as empty strings (no brace leaks)', () => {
    expect(renderTemplate('x-{{mystery}}-y', { now: fixedNow })).toBe('x--y');
  });

  it('leaves a template without tokens unchanged', () => {
    expect(renderTemplate('notes/refactor', {})).toBe('notes/refactor');
  });

  it('handles multiple tokens in a compound template', () => {
    const out = renderTemplate('notes/{{date:YYYY}}/{{date:MM}}/{{title}}', {
      title: 'meetings',
      now: fixedNow,
    });
    expect(out).toBe('notes/2026/04/meetings');
  });
});
