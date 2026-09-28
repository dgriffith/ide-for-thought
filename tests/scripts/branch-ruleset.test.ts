/**
 * The committed-vs-live ruleset comparison behind `pnpm check:ruleset` (#2353).
 *
 * `.github/rulesets/main.json` is the source of truth for what protects main;
 * the live ruleset is a settings page anyone with admin can edit. The check
 * has to report a real loosening (a dropped required check, strict turned off,
 * a bypass widened to `always`) and stay quiet on everything the API adds or
 * reorders on its own — a drift check that cries wolf on every read gets
 * ignored, which is the same as not having one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareRulesets, normalizeRuleset } from '../../scripts/lib/branch-ruleset.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const committed = JSON.parse(
  readFileSync(path.join(ROOT, '.github', 'rulesets', 'main.json'), 'utf-8'),
) as Record<string, unknown>;

/** What `GET /rulesets/{id}` really returns for it: same policy plus bookkeeping. */
function liveFrom(body: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 24089817,
    node_id: 'RRS_x',
    source_type: 'Repository',
    source: 'dgriffith/ide-for-thought',
    created_at: '2026-09-27T18:52:36.924-06:00',
    updated_at: '2026-09-27T18:52:37.017-06:00',
    current_user_can_bypass: 'pull_requests_only',
    _links: { self: { href: 'https://api.github.com/…' } },
    ...structuredClone(body),
  };
}

type Rule = { type: string; parameters?: Record<string, unknown> };
const rulesOf = (r: Record<string, unknown>) => r.rules as Rule[];
const statusRule = (r: Record<string, unknown>) =>
  rulesOf(r).find((x) => x.type === 'required_status_checks')!;

describe('compareRulesets — in step', () => {
  it('passes the committed file against itself', () => {
    expect(compareRulesets(committed, committed)).toEqual({ ok: true });
  });

  it('ignores the bookkeeping fields the API adds', () => {
    expect(compareRulesets(committed, liveFrom(committed))).toEqual({ ok: true });
  });

  it('ignores ordering of rules, checks, bypass actors and object keys', () => {
    const live = liveFrom(committed);
    rulesOf(live).reverse();
    (statusRule(live).parameters!.required_status_checks as unknown[]).reverse();
    // The API emits object keys alphabetically; the committed file doesn't.
    const reorderedKeys = Object.fromEntries(Object.entries(live).reverse());
    reorderedKeys.bypass_actors = (live.bypass_actors as Array<Record<string, unknown>>).map((a) =>
      Object.fromEntries(Object.entries(a).reverse()),
    );
    expect(compareRulesets(committed, reorderedKeys)).toEqual({ ok: true });
  });
});

describe('compareRulesets — drift', () => {
  it('reports a required check removed in the UI', () => {
    const live = liveFrom(committed);
    const params = statusRule(live).parameters!;
    params.required_status_checks = (params.required_status_checks as Array<{ context: string }>)
      .filter((c) => c.context !== 'e2e');
    const result = compareRulesets(committed, live);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('required_status_checks');
      expect(result.message).toContain('e2e');
    }
  });

  it('reports "require up to date" turned off', () => {
    const live = liveFrom(committed);
    statusRule(live).parameters!.strict_required_status_checks_policy = false;
    const result = compareRulesets(committed, live);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.differences).toHaveLength(1);
      expect(result.differences[0].path).toMatch(/strict_required_status_checks_policy$/);
      expect(result.differences[0]).toMatchObject({ expected: true, actual: false });
    }
  });

  it('reports the admin bypass widened to "always"', () => {
    const live = liveFrom(committed);
    (live.bypass_actors as Array<Record<string, unknown>>)[0].bypass_mode = 'always';
    const result = compareRulesets(committed, live);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('"always"');
  });

  it('reports enforcement dropped to evaluate', () => {
    const result = compareRulesets(committed, { ...liveFrom(committed), enforcement: 'evaluate' });
    expect(result.ok).toBe(false);
  });

  it('reports a rule deleted outright, as missing rather than silently shorter', () => {
    const live = liveFrom(committed);
    live.rules = rulesOf(live).filter((r) => r.type !== 'non_fast_forward');
    const result = compareRulesets(committed, live);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('(missing)');
  });

  it('points at how to re-apply the file', () => {
    const result = compareRulesets(committed, { ...committed, enforcement: 'disabled' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('--input .github/rulesets/main.json');
  });
});

describe('normalizeRuleset', () => {
  it('keeps only the policy fields', () => {
    expect(Object.keys(normalizeRuleset(liveFrom(committed))).sort()).toEqual(
      ['bypass_actors', 'conditions', 'enforcement', 'name', 'rules', 'target'],
    );
  });
});
