import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatContent,
  formatContentToFixedPoint,
  isRuleEnabled,
  resolveEnabled,
  DEFAULT_FORMAT_SETTINGS,
} from '../../../src/shared/formatter/engine';
import {
  registerRule,
  __resetRuleRegistryForTests,
} from '../../../src/shared/formatter/registry';
import { HOUSE_STYLE_RULE_IDS } from '../../../src/shared/formatter/house-style';
import type { FormatterRule } from '../../../src/shared/formatter/types';

function rule(partial: Partial<FormatterRule<unknown>> & {
  id: string;
  apply: FormatterRule<unknown>['apply'];
}): FormatterRule<unknown> {
  return {
    category: 'content',
    title: partial.id,
    description: '',
    defaultConfig: {},
    ...partial,
  };
}

describe('formatter engine (issue #153)', () => {
  beforeEach(() => {
    __resetRuleRegistryForTests();
  });

  it('no-ops when no rules are enabled', () => {
    registerRule(rule({ id: 'to-upper', apply: (c) => c.toUpperCase() }));
    const out = formatContent('hello\nworld', DEFAULT_FORMAT_SETTINGS);
    expect(out).toBe('hello\nworld');
  });

  it('applies an enabled rule', () => {
    registerRule(rule({ id: 'trim-trailing', apply: (c) => c.replace(/ +$/gm, '') }));
    const out = formatContent('hello   \nworld  ', {
      enabled: { 'trim-trailing': true },
      configs: {},
    });
    expect(out).toBe('hello\nworld');
  });

  it('applies rules in category order then registration order', () => {
    registerRule(rule({ id: 'content-a', category: 'content', apply: (c) => c + '[A]' }));
    registerRule(rule({ id: 'yaml-first', category: 'yaml', apply: (c) => c + '[Y]' }));
    registerRule(rule({ id: 'content-b', category: 'content', apply: (c) => c + '[B]' }));
    const out = formatContent('start', {
      enabled: { 'content-a': true, 'yaml-first': true, 'content-b': true },
      configs: {},
    });
    // yaml runs before content (CATEGORY_ORDER), content-a before content-b (registration).
    expect(out).toBe('start[Y][A][B]');
  });

  it('respects per-rule config overrides', () => {
    registerRule(rule({
      id: 'append',
      apply: (c, cfg: { suffix: string }) => c + cfg.suffix,
      defaultConfig: { suffix: '!' },
    }));
    const outDefault = formatContent('x', {
      enabled: { append: true },
      configs: {},
    });
    expect(outDefault).toBe('x!');
    const outOverride = formatContent('x', {
      enabled: { append: true },
      configs: { append: { suffix: '?' } },
    });
    expect(outOverride).toBe('x?');
  });

  it('resolveEnabled returns only enabled rules in run order', () => {
    registerRule(rule({ id: 'r1', apply: (c) => c }));
    registerRule(rule({ id: 'r2', apply: (c) => c }));
    registerRule(rule({ id: 'r3', apply: (c) => c }));
    const enabled = resolveEnabled({
      enabled: { r1: true, r3: true },
      configs: {},
    });
    expect(enabled.map((e) => e.rule.id)).toEqual(['r1', 'r3']);
  });

  it('passes a ParseCache to each rule so they can skip code fences', () => {
    registerRule(rule({
      id: 'h2-to-h3',
      apply: (content, _cfg, cache) => {
        // Rewrite `## ` to `### ` except inside protected regions.
        let out = '';
        for (let i = 0; i < content.length; i++) {
          if (!cache.isProtected(i) && content.slice(i, i + 3) === '## ') {
            out += '### ';
            i += 2;
          } else {
            out += content[i];
          }
        }
        return out;
      },
    }));
    const input = '## outside\n\n```\n## inside\n```\n';
    const out = formatContent(input, { enabled: { 'h2-to-h3': true }, configs: {} });
    expect(out).toContain('### outside');
    expect(out).toContain('## inside');
  });

  it('formatContentToFixedPoint settles when rules converge', () => {
    registerRule(rule({
      id: 'max-blank-lines',
      apply: (c) => c.replace(/\n{3,}/g, '\n\n'),
    }));
    const input = 'a\n\n\n\n\nb';
    const out = formatContentToFixedPoint(input, {
      enabled: { 'max-blank-lines': true },
      configs: {},
    });
    expect(out).toBe('a\n\nb');
  });
});

describe('house style defaults', () => {
  const houseId = [...HOUSE_STYLE_RULE_IDS][0];
  const nonHouseId = 'definitely-not-a-house-style-rule';

  beforeEach(() => {
    __resetRuleRegistryForTests();
  });

  it('a house-style rule defaults on when the user has no entry for it', () => {
    expect(isRuleEnabled({ enabled: {}, configs: {} }, houseId)).toBe(true);
  });

  it('a non-house rule defaults off', () => {
    expect(isRuleEnabled({ enabled: {}, configs: {} }, nonHouseId)).toBe(false);
  });

  it('an explicit false overrides the house-style default', () => {
    expect(isRuleEnabled({ enabled: { [houseId]: false }, configs: {} }, houseId)).toBe(false);
  });

  it('an explicit true enables a non-house rule', () => {
    expect(isRuleEnabled({ enabled: { [nonHouseId]: true }, configs: {} }, nonHouseId)).toBe(true);
  });

  it('resolveEnabled runs registered house-style rules under default settings', () => {
    registerRule(rule({ id: houseId, apply: (c) => c }));
    registerRule(rule({ id: nonHouseId, apply: (c) => c }));
    const enabled = resolveEnabled(DEFAULT_FORMAT_SETTINGS);
    expect(enabled.map((e) => e.rule.id)).toEqual([houseId]);
  });
});
