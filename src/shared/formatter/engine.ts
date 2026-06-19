/**
 * Formatter engine (#153). Applies a set of enabled rules to note content,
 * parsing the cache once and passing it to every rule. Runs rules in a
 * deterministic order: category order first (see `CATEGORY_ORDER`), then
 * registration order within each category.
 *
 * The engine does not know about IO — callers read + write files and wire
 * palette commands on top. Pure in / pure out.
 */

import { buildParseCache } from './parse-cache';
import { HOUSE_STYLE_RULE_IDS } from './house-style';
import { CATEGORY_ORDER, getRule, listAllRules } from './registry';
import type { EnabledRule, FormatterRule } from './types';

export interface FormatSettings {
  /**
   * Per-rule enable map. A rule with no entry here falls back to the house
   * style (on for `HOUSE_STYLE_RULE_IDS`, off otherwise); an explicit
   * `true`/`false` always overrides the default. Read through
   * `isRuleEnabled`, never `enabled[id]` directly.
   */
  enabled: Record<string, boolean>;
  /** Per-rule config override. Unlisted rules use the rule’s defaultConfig. */
  configs: Record<string, unknown>;
}

/**
 * Whether a rule should run, honouring the curated house style as the
 * default for rules the user has never explicitly toggled. An explicit
 * entry in `enabled` (including `false`) always wins.
 */
export function isRuleEnabled(settings: FormatSettings, ruleId: string): boolean {
  return settings.enabled[ruleId] ?? HOUSE_STYLE_RULE_IDS.has(ruleId);
}

export const DEFAULT_FORMAT_SETTINGS: FormatSettings = {
  enabled: {},
  configs: {},
};

/**
 * Apply enabled rules to `content`. Returns the rewritten string; equal to
 * `content` when no enabled rule matched.
 */
export function formatContent(content: string, settings: FormatSettings): string {
  const enabledRules = resolveEnabled(settings);
  if (enabledRules.length === 0) return content;

  let current = content;
  for (const { rule, config } of enabledRules) {
    const cache = buildParseCache(current);
    const next = rule.apply(current, config, cache);
    if (next !== current) current = next;
  }
  return current;
}

/** Expose which rules would run, in order. Useful for the settings UI + tests. */
export function resolveEnabled(settings: FormatSettings): EnabledRule[] {
  const all = listAllRules();
  const byCategory = new Map<string, FormatterRule[]>();
  for (const r of all) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category)!.push(r);
  }

  const ordered: FormatterRule[] = [];
  for (const cat of CATEGORY_ORDER) {
    const group = byCategory.get(cat);
    if (group) ordered.push(...group);
  }

  const out: EnabledRule[] = [];
  for (const rule of ordered) {
    if (!isRuleEnabled(settings, rule.id)) continue;
    const config = rule.id in settings.configs
      ? settings.configs[rule.id]
      : rule.defaultConfig;
    out.push({ rule, config });
  }
  return out;
}

/** Re-apply formatting until output stabilises or we hit the pass cap. */
export function formatContentToFixedPoint(
  content: string,
  settings: FormatSettings,
  maxPasses = 3,
): string {
  let current = content;
  for (let i = 0; i < maxPasses; i++) {
    const next = formatContent(current, settings);
    if (next === current) return current;
    current = next;
  }
  return current;
}

/** Alias used by the orchestrator so callers don’t depend on the registry directly. */
export function ruleExists(id: string): boolean {
  return getRule(id) !== undefined;
}
