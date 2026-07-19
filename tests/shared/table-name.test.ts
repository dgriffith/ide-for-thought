import { describe, it, expect } from 'vitest';
import { slugifyTableName } from '../../src/shared/table-name';

describe('slugifyTableName', () => {
  it('collapses separators (spaces, slashes, dots, hyphens) to single underscores', () => {
    expect(slugifyTableName('Q3 Sales')).toBe('Q3_Sales');
    expect(slugifyTableName('notes/data/experiment')).toBe('notes_data_experiment');
    expect(slugifyTableName('a - b . c')).toBe('a_b_c');
  });

  it('preserves case (matches CSV deriveTableName behavior)', () => {
    expect(slugifyTableName('MixedCase')).toBe('MixedCase');
  });

  it('drops non-identifier characters', () => {
    expect(slugifyTableName('sales$ (2024)!')).toBe('sales_2024');
  });

  it('prefixes a digit-leading name with t_', () => {
    expect(slugifyTableName('2024-experiment')).toBe('t_2024_experiment');
  });

  it('trims leading/trailing underscores and collapses runs', () => {
    expect(slugifyTableName('__a___b__')).toBe('a_b');
  });

  it('falls back to "table" when nothing usable remains', () => {
    expect(slugifyTableName('!!!')).toBe('table');
    expect(slugifyTableName('   ')).toBe('table');
  });
});
