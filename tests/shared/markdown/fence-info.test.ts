import { describe, it, expect } from 'vitest';
import { parseFenceInfo } from '../../../src/shared/markdown/fence-info';

describe('parseFenceInfo (#2039)', () => {
  it('parses a plain language with no hidden marker', () => {
    expect(parseFenceInfo('turtle')).toEqual({ lang: 'turtle', hidden: false });
    expect(parseFenceInfo('python')).toEqual({ lang: 'python', hidden: false });
  });

  it('strips a -hidden suffix and reports hidden: true', () => {
    expect(parseFenceInfo('turtle-hidden')).toEqual({ lang: 'turtle', hidden: true });
    expect(parseFenceInfo('python-hidden')).toEqual({ lang: 'python', hidden: true });
  });

  it('trims and lowercases like every other fence consumer', () => {
    expect(parseFenceInfo('  Turtle-Hidden  ')).toEqual({ lang: 'turtle', hidden: true });
    expect(parseFenceInfo('  TURTLE  ')).toEqual({ lang: 'turtle', hidden: false });
  });

  it('treats a bare "-hidden" (no language) as not hidden — nothing to strip a suffix from', () => {
    expect(parseFenceInfo('-hidden')).toEqual({ lang: '-hidden', hidden: false });
  });

  it('handles an empty info string', () => {
    expect(parseFenceInfo('')).toEqual({ lang: '', hidden: false });
  });

  it('does not confuse a language that merely contains "hidden" mid-word', () => {
    expect(parseFenceInfo('hiddenlang')).toEqual({ lang: 'hiddenlang', hidden: false });
  });
});
