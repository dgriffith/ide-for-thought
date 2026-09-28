/**
 * One definition of "the live ruleset on main matches the committed one" (#2353).
 *
 * `.github/rulesets/main.json` is the source of truth for main's protection:
 * the required checks (`lint-and-test`, `audit`, `e2e`), "require branches to
 * be up to date", no deletion, no force-push, and an admin bypass that exists
 * only as a deliberate override on a PR merge. The file is the exact body of
 * `POST /repos/{owner}/{repo}/rulesets`, so re-applying it is one `gh api` call.
 *
 * A settings page is not somewhere an invariant can live (#2251): anyone with
 * admin can loosen the ruleset in the UI and nothing in the repo would show it.
 * `scripts/check-branch-ruleset.mjs` fetches the live ruleset and runs it
 * through `compareRulesets` against the file.
 *
 * Kept pure (no `gh`, no fs) so the comparison is unit-tested in
 * `tests/scripts/branch-ruleset.test.ts` without network access.
 */

/**
 * The fields that make up the policy. Everything else the API returns (`id`,
 * `node_id`, `created_at`, `_links`, `source`, `current_user_can_bypass`, …) is
 * bookkeeping, and comparing it would report drift on every read.
 */
export const COMPARED_FIELDS = ['name', 'target', 'enforcement', 'conditions', 'rules', 'bypass_actors'];

/** Deterministic key order, so two equal objects serialize identically. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])]),
    );
  }
  return value;
}

const byJson = (a, b) => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Reduce a ruleset (committed file or API response) to its policy, in a
 * canonical order. Order carries no meaning in any of these arrays — the API
 * is free to return rules, checks, bypass actors or ref patterns in whatever
 * order it stores them, and a reordering is not drift.
 */
export function normalizeRuleset(ruleset) {
  const out = {};
  for (const field of COMPARED_FIELDS) {
    if (ruleset?.[field] !== undefined) out[field] = ruleset[field];
  }

  if (out.conditions?.ref_name) {
    const { include = [], exclude = [] } = out.conditions.ref_name;
    out.conditions = {
      ...out.conditions,
      ref_name: { include: [...include].sort(), exclude: [...exclude].sort() },
    };
  }

  if (Array.isArray(out.rules)) {
    out.rules = out.rules
      .map((rule) => {
        const checks = rule?.parameters?.required_status_checks;
        if (!Array.isArray(checks)) return rule;
        return {
          ...rule,
          parameters: { ...rule.parameters, required_status_checks: [...checks].sort(byJson) },
        };
      })
      .map(sortKeys)
      .sort(byJson);
  }

  if (Array.isArray(out.bypass_actors)) {
    out.bypass_actors = out.bypass_actors.map(sortKeys).sort(byJson);
  }

  return sortKeys(out);
}

/** Leaf-level differences between two normalized values, as `path: a → b`. */
function diff(expected, actual, at, out) {
  const bothObjects =
    expected && actual && typeof expected === 'object' && typeof actual === 'object' &&
    Array.isArray(expected) === Array.isArray(actual);

  if (!bothObjects) {
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      out.push({ path: at || '(root)', expected, actual });
    }
    return out;
  }

  const keys = Array.isArray(expected)
    ? [...Array(Math.max(expected.length, actual.length)).keys()]
    : [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const k of keys) {
    diff(expected[k], actual[k], Array.isArray(expected) ? `${at}[${k}]` : at ? `${at}.${k}` : k, out);
  }
  return out;
}

/**
 * Compare the committed ruleset against the live one.
 *
 * Returns `{ ok: true }` or `{ ok: false, differences, message }` rather than
 * throwing, same shape as `release-version.mjs`'s `checkReleaseTag`, so the
 * caller decides how to frame the failure.
 */
export function compareRulesets(expected, actual) {
  const differences = diff(normalizeRuleset(expected), normalizeRuleset(actual), '', []);
  if (differences.length === 0) return { ok: true };

  const show = (v) => (v === undefined ? '(missing)' : JSON.stringify(v));
  const message =
    `The live ruleset on main has drifted from .github/rulesets/main.json:\n\n` +
    differences.map((d) => `  ${d.path}\n    committed: ${show(d.expected)}\n    live:      ${show(d.actual)}`).join('\n') +
    `\n\nThe committed file is the source of truth. If the live change was deliberate, ` +
    `copy it into main.json in a PR; otherwise re-apply the file:\n\n` +
    `  gh api --method PUT repos/<owner>/<repo>/rulesets/<id> --input .github/rulesets/main.json`;
  return { ok: false, differences, message };
}
