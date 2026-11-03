import { describe, it, expect } from 'vitest';
import { descriptionSummary } from '../../../src/shared/plugins/description';

describe('descriptionSummary', () => {
  it('is the first paragraph, as plain text', () => {
    expect(descriptionSummary('Show a **board**, with `cards` and [links](https://x.example).\n\n## Security\n\nIt writes one property.'))
      .toBe('Show a board, with cards and links.');
  });

  it('joins a paragraph wrapped over lines, and stops at a heading with no blank line before it', () => {
    expect(descriptionSummary('One line\nand the next.\n## Security\nMore.')).toBe('One line and the next.');
  });

  it('skips a heading that comes first', () => {
    expect(descriptionSummary('## About\n\nA theme.')).toBe('A theme.');
  });

  it('removes emphasis but leaves underscores inside words alone', () => {
    expect(descriptionSummary('An *easy* and _quick_ snake_case thing.')).toBe('An easy and quick snake_case thing.');
  });

  it('leaves a one-sentence description as it is', () => {
    expect(descriptionSummary('Sort the list in your selection.')).toBe('Sort the list in your selection.');
  });
});
