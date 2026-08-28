/**
 * @vitest-environment node
 *
 * Coverage for the `waitFor(...)` must-be-awaited lint rule (#1947).
 *
 * `@testing-library/svelte`'s `waitFor` polls its callback on an interval; if
 * the call itself isn't awaited (or explicitly `void`ed), a test can return —
 * and be marked passed — before the assertion inside ever gets a chance to
 * run. `expect.assertions(n)` was tried and rejected as the defense here (see
 * the CLAUDE.md note by the same issue number): `waitFor` invokes its
 * callback once per retry tick, so an exact assertion count is flaky by
 * construction, and `expect.hasAssertions()` doesn't catch the bug either
 * (the first, synchronous check ticks the counter even when the call is
 * never awaited). The actual fix is the `no-restricted-syntax` rule in
 * `eslint.config.mjs`, scoped to `tests/**\/*.ts` — this test extracts that
 * REAL rule config (not a hand-copied selector that could drift from it) and
 * runs it against fixture snippets, so a future edit that weakens the
 * selector fails here instead of silently reopening the hole.
 */
import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
// @ts-expect-error -- plain JS flat config, no .d.ts
import eslintConfig from '../../eslint.config.mjs';

function testFileRule(): unknown[] {
  const block = (eslintConfig as Array<{ files?: string[]; rules?: Record<string, unknown> }>).find(
    (c) => Array.isArray(c.files) && c.files.includes('tests/**/*.ts'),
  );
  const rule = block?.rules?.['no-restricted-syntax'];
  if (!rule) throw new Error('no-restricted-syntax rule not found on the tests/**/*.ts block — did eslint.config.mjs change shape?');
  return rule as unknown[];
}

function lint(code: string): number {
  const linter = new Linter();
  const messages = linter.verify(code, {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: { 'no-restricted-syntax': testFileRule() as never },
  });
  return messages.filter((m) => m.ruleId === 'no-restricted-syntax').length;
}

describe('waitFor(...) must be awaited (tests/**/*.ts eslint rule)', () => {
  it('flags a bare, unawaited waitFor(...) call', () => {
    expect(lint(`waitFor(() => { expect(1).toBe(1); });`)).toBe(1);
  });

  it('allows an awaited waitFor(...) call', () => {
    expect(lint(`await waitFor(() => { expect(1).toBe(1); });`)).toBe(0);
  });

  it('allows an explicitly void-ed waitFor(...) call (deliberate fire-and-forget)', () => {
    expect(lint(`void waitFor(() => { expect(1).toBe(1); });`)).toBe(0);
  });

  it('allows an assigned or returned waitFor(...) call', () => {
    expect(lint(`const p = waitFor(() => {});`)).toBe(0);
    expect(lint(`function f() { return waitFor(() => {}); }`)).toBe(0);
  });

  it('does not flag an unrelated function that happens to also be unawaited', () => {
    expect(lint(`somethingElse(() => { expect(1).toBe(1); });`)).toBe(0);
  });
});
