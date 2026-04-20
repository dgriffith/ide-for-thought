/**
 * Rule registry (#153). Category tickets (#155\u2013#161) register their rules
 * at import time; the engine consults the registry to find + sort rules
 * for an invocation.
 *
 * Registration order within a category is the apply order \u2014 a rule that
 * depends on another running first just registers later in its module.
 * Categories themselves apply in a fixed order (see CATEGORY_ORDER)
 * chosen so structural passes run before cosmetic ones.
 */

import type { FormatterCategory, FormatterRule } from './types';

const rules = new Map<string, FormatterRule<any>>();
const order: string[] = [];

export function registerRule<Config>(rule: FormatterRule<Config>): void {
  if (rules.has(rule.id)) {
    throw new Error(`Formatter rule "${rule.id}" is already registered.`);
  }
  rules.set(rule.id, rule as FormatterRule<any>);
  order.push(rule.id);
}

export function getRule(id: string): FormatterRule<any> | undefined {
  return rules.get(id);
}

export function listAllRules(): FormatterRule<any>[] {
  return order.map((id) => rules.get(id)!).filter(Boolean);
}

export function listRulesByCategory(category: FormatterCategory): FormatterRule<any>[] {
  return listAllRules().filter((r) => r.category === category);
}

/** Test-only: drop every registration. */
export function __resetRuleRegistryForTests(): void {
  rules.clear();
  order.length = 0;
}

export const CATEGORY_ORDER: FormatterCategory[] = [
  // Structural passes first so later rules see a normalised document shape.
  'yaml',
  'heading',
  'content',
  'footnote',
  'spacing',
  // Minerva-specific rules last \u2014 they need to inspect link shapes that
  // earlier passes may have normalised.
  'minerva',
];
