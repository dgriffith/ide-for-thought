import { describe, it, expect } from 'vitest';
import { escapeTurtleLiteral } from '../../../src/main/llm/turtle';

// Unified turtle string-literal escaper (#676) — was three drifted copies.

describe('escapeTurtleLiteral', () => {
  it('passes plain text through unchanged', () => {
    expect(escapeTurtleLiteral('hello world')).toBe('hello world');
  });

  it('escapes backslash, double-quote, CR, LF, and tab', () => {
    expect(escapeTurtleLiteral('a\\b')).toBe('a\\\\b');
    expect(escapeTurtleLiteral('say "hi"')).toBe('say \\"hi\\"');
    expect(escapeTurtleLiteral('a\rb')).toBe('a\\rb');
    expect(escapeTurtleLiteral('a\nb')).toBe('a\\nb');
    expect(escapeTurtleLiteral('a\tb')).toBe('a\\tb');
  });

  it('escapes the backslash first so our own inserts are not double-escaped', () => {
    // A literal `\n` (backslash + n) must become `\\n` (escaped backslash) + n,
    // not `\` + escaped-newline.
    expect(escapeTurtleLiteral('a\\nb')).toBe('a\\\\nb');
  });

  it('handles a realistic multi-line, quoted, tabbed payload', () => {
    const input = 'def f():\n\treturn "x"\r\n';
    expect(escapeTurtleLiteral(input)).toBe('def f():\\n\\treturn \\"x\\"\\r\\n');
  });

  it('produces output that, re-read, contains no raw control chars', () => {
    const escaped = escapeTurtleLiteral('line1\nline2\twith "quotes"\rand \\slash');
    expect(escaped).not.toMatch(/[\n\r\t]/);
    expect(escaped).not.toMatch(/(^|[^\\])"/); // every " is preceded by a backslash
  });
});
