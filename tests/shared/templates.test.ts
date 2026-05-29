import { describe, it, expect } from 'vitest';
import { substituteTemplate, formatDateTime } from '../../src/shared/templates';

describe('substituteTemplate (#475)', () => {
  const FIXED = new Date(2026, 4, 28, 14, 7, 5); // 2026-05-28 14:07:05

  it('substitutes {{title}}', async () => {
    const r = await substituteTemplate('# {{title}}\n', { title: 'Hello' });
    expect(r.content).toBe('# Hello\n');
    expect(r.cursorOffset).toBeNull();
    expect(r.cancelled).toBe(false);
  });

  it('substitutes default {{date}} as YYYY-MM-DD', async () => {
    const r = await substituteTemplate('{{date}}', { title: '', now: FIXED });
    expect(r.content).toBe('2026-05-28');
  });

  it('substitutes default {{time}} as HH:mm', async () => {
    const r = await substituteTemplate('{{time}}', { title: '', now: FIXED });
    expect(r.content).toBe('14:07');
  });

  it('honours date format tokens', async () => {
    const r = await substituteTemplate('{{date:MMM DD, YYYY}}', { title: '', now: FIXED });
    expect(r.content).toBe('May 28, 2026');
  });

  it('honours time format tokens with seconds', async () => {
    const r = await substituteTemplate('{{time:HH:mm:ss}}', { title: '', now: FIXED });
    expect(r.content).toBe('14:07:05');
  });

  it('preserves literal characters inside a format spec', async () => {
    const r = await substituteTemplate('{{date:[Y]YYYY}}', { title: '', now: FIXED });
    expect(r.content).toBe('[Y]2026');
  });

  it('captures {{cursor}} offset and removes the marker', async () => {
    const r = await substituteTemplate('# {{title}}\n\n{{cursor}}\n\nNotes', {
      title: 'Hi',
      now: FIXED,
    });
    expect(r.content).toBe('# Hi\n\n\n\nNotes');
    // After "# Hi\n\n" — six characters
    expect(r.cursorOffset).toBe(6);
  });

  it('captures only the first {{cursor}} marker when multiple appear', async () => {
    const r = await substituteTemplate('A{{cursor}}B{{cursor}}C', { title: '', now: FIXED });
    expect(r.content).toBe('ABC');
    expect(r.cursorOffset).toBe(1);
  });

  it('substitutes {{prompt:Label}} via the resolver', async () => {
    const r = await substituteTemplate('Hello, {{prompt:Who}}!', {
      title: '',
      now: FIXED,
      prompt: async (label) => {
        expect(label).toBe('Who');
        return 'World';
      },
    });
    expect(r.content).toBe('Hello, World!');
    expect(r.cancelled).toBe(false);
  });

  it('reports cancelled when the prompt resolver returns null', async () => {
    const r = await substituteTemplate('A {{prompt:X}} B', {
      title: '',
      now: FIXED,
      prompt: async () => null,
    });
    expect(r.cancelled).toBe(true);
    // Content emits everything up to the cancelled prompt and then
    // the remaining literal so debugging the partial result is at
    // least possible.
    expect(r.content).toBe('A  B');
  });

  it('falls back to a labelled placeholder when no prompt resolver is supplied', async () => {
    const r = await substituteTemplate('{{prompt:Topic}}', { title: '', now: FIXED });
    expect(r.content).toBe('{{Topic}}');
    expect(r.cancelled).toBe(false);
  });

  it('preserves unknown placeholders verbatim', async () => {
    const r = await substituteTemplate('{{nope}}', { title: '', now: FIXED });
    expect(r.content).toBe('{{nope}}');
  });

  it('treats \\{{ as a literal {{', async () => {
    const r = await substituteTemplate('Use \\{{date}} for the date', {
      title: '',
      now: FIXED,
    });
    expect(r.content).toBe('Use {{date}} for the date');
  });

  it('handles a template with no placeholders', async () => {
    const r = await substituteTemplate('Plain text.\nNo vars here.', {
      title: '',
      now: FIXED,
    });
    expect(r.content).toBe('Plain text.\nNo vars here.');
    expect(r.cursorOffset).toBeNull();
  });

  it('tolerates an unterminated `{{` by emitting the rest verbatim', async () => {
    const r = await substituteTemplate('Before {{title}} and {{never closing', {
      title: 'X',
      now: FIXED,
    });
    expect(r.content).toBe('Before X and {{never closing');
  });

  it('trims whitespace inside placeholders', async () => {
    const r = await substituteTemplate('{{ title }} / {{  date  }}', {
      title: 'A',
      now: FIXED,
    });
    expect(r.content).toBe('A / 2026-05-28');
  });
});

describe('formatDateTime', () => {
  const D = new Date(2026, 0, 5, 9, 3, 0); // 2026-01-05 09:03:00

  it('pads single-digit components', () => {
    expect(formatDateTime('YYYY-MM-DD HH:mm:ss', D)).toBe('2026-01-05 09:03:00');
  });

  it('supports short month names', () => {
    expect(formatDateTime('MMM YYYY', D)).toBe('Jan 2026');
  });

  it('preserves untokenised characters', () => {
    expect(formatDateTime('Today is YYYY/MM/DD.', D)).toBe('Today is 2026/01/05.');
  });
});
