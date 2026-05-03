import { describe, it, expect } from 'vitest';
import { scanFootnotes } from '../../src/renderer/lib/footnotes';

describe('scanFootnotes: definitions', () => {
  it('finds a single-line definition', () => {
    const r = scanFootnotes('Body. [^foo]\n\n[^foo]: definition body.\n');
    expect(r.definitions).toHaveLength(1);
    expect(r.definitions[0]).toMatchObject({
      label: 'foo',
      body: 'definition body.',
      defLine: 3,
    });
  });

  it('joins continuation lines with single spaces', () => {
    const src = '[^x]\n\n[^x]: line one\n    line two\n    line three\n';
    const r = scanFootnotes(src);
    expect(r.definitions[0].body).toBe('line one line two line three');
  });

  it('stops at a non-indented line that is not blank', () => {
    const src = '[^x]\n\n[^x]: only this line\nNot continuation.\n';
    const r = scanFootnotes(src);
    expect(r.definitions[0].body).toBe('only this line');
    expect(r.references.map((ref) => ref.label)).toContain('x');
  });
});

describe('scanFootnotes: references', () => {
  it('finds inline [^name] references', () => {
    const r = scanFootnotes('See note[^a] and[^b].\n[^a]: A.\n[^b]: B.\n');
    expect(r.references.map((ref) => ref.label)).toEqual(['a', 'b']);
  });

  it('does not treat the definition opener as a reference', () => {
    const r = scanFootnotes('[^foo]: just a def.\n');
    expect(r.references).toHaveLength(0);
    expect(r.definitions).toHaveLength(1);
  });

  it('skips refs inside backtick inline code', () => {
    const r = scanFootnotes('Code: `[^nope]` real[^yes].\n[^yes]: y.\n');
    expect(r.references.map((ref) => ref.label)).toEqual(['yes']);
  });

  it('skips refs inside fenced code blocks', () => {
    const src = '```\n[^nope]\n```\nReal[^yes].\n[^yes]: y.\n';
    const r = scanFootnotes(src);
    expect(r.references.map((ref) => ref.label)).toEqual(['yes']);
  });

  it('ignores backslash-escaped references', () => {
    const r = scanFootnotes('Literal \\[^nope] stays prose. Real[^yes].\n[^yes]: y.\n');
    expect(r.references.map((ref) => ref.label)).toEqual(['yes']);
  });
});

describe('scanFootnotes: mismatch diagnostics', () => {
  it('flags definitions with no in-text reference as orphans', () => {
    const r = scanFootnotes('Body.\n[^unused]: I am alone.\n');
    expect(r.orphanDefinitions.map((d) => d.label)).toEqual(['unused']);
  });

  it('flags references with no matching definition as missing', () => {
    const r = scanFootnotes('See[^ghost].\n');
    expect(r.missingReferences.map((ref) => ref.label)).toEqual(['ghost']);
  });

  it('a defined-and-referenced footnote is neither orphan nor missing', () => {
    const r = scanFootnotes('See[^a].\n[^a]: yes.\n');
    expect(r.orphanDefinitions).toEqual([]);
    expect(r.missingReferences).toEqual([]);
  });
});
