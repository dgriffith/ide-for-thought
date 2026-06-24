/**
 * Cost calculation + aggregation/formatting (#821).
 *
 * Covers the pricing math (cache multipliers, unpriced → null) in
 * `shared/tools/models.ts` and the conversation roll-up/formatting in
 * `conversation-cost.ts`.
 */

import { describe, it, expect } from 'vitest';
import { costForUsage } from '../../src/shared/tools/models';
import {
  conversationCost,
  costBadgeFor,
  formatTokens,
  formatUSD,
  formatCostBadge,
  formatTurnCost,
} from '../../src/renderer/lib/conversations/conversation-cost';
import type { ConversationMessage, TurnUsage } from '../../src/shared/types';

const usage = (u: Partial<TurnUsage>): TurnUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  ...u,
});

function asstMsg(u: Partial<TurnUsage>, model: string | undefined): ConversationMessage {
  const m: ConversationMessage = { role: 'assistant', content: 'x', timestamp: '2026-01-01T00:00:00Z', usage: usage(u) };
  if (model) {
    m.usageModel = model;
    const c = costForUsage(usage(u), model);
    if (c !== null) m.costUSD = c;
  }
  return m;
}

describe('costForUsage (#821)', () => {
  it('prices plain input + output at the model rate', () => {
    // 1M input @ $3, 1M output @ $15 → $18 for Sonnet.
    const c = costForUsage(usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), 'claude-sonnet-4-6');
    expect(c).toBeCloseTo(18, 6);
  });

  it('prices cache reads at 0.1x and cache writes at 1.25x input', () => {
    // Opus input $5. 1M cache read → $0.5; 1M cache write → $6.25.
    const c = costForUsage(
      usage({ cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000 }),
      'claude-opus-4-8',
    );
    expect(c).toBeCloseTo(0.5 + 6.25, 6);
  });

  it('returns null for an unpriced model (no guessing)', () => {
    expect(costForUsage(usage({ inputTokens: 1000 }), 'some-future-model')).toBeNull();
  });
});

describe('conversationCost roll-up', () => {
  it('sums tokens and dollars across priced turns', () => {
    const msgs: ConversationMessage[] = [
      { role: 'user', content: 'hi', timestamp: 't' },
      asstMsg({ inputTokens: 1_000_000, outputTokens: 0 }, 'claude-sonnet-4-6'), // $3
      asstMsg({ inputTokens: 0, outputTokens: 1_000_000 }, 'claude-sonnet-4-6'), // $15
    ];
    const c = conversationCost(msgs);
    expect(c.totalTokens).toBe(2_000_000);
    expect(c.totalUSD).toBeCloseTo(18, 6);
    expect(c.hasUnpriced).toBe(false);
  });

  it('flags unpriced turns and still counts their tokens', () => {
    const msgs: ConversationMessage[] = [
      asstMsg({ inputTokens: 1000, outputTokens: 500 }, 'claude-sonnet-4-6'),
      asstMsg({ inputTokens: 200, outputTokens: 100 }, 'mystery-model'),
    ];
    const c = conversationCost(msgs);
    expect(c.totalTokens).toBe(1800);
    expect(c.totalUSD).not.toBeNull();
    expect(c.hasUnpriced).toBe(true);
  });

  it('returns a null total when no turn is priced', () => {
    const c = conversationCost([asstMsg({ inputTokens: 100 }, 'mystery-model')]);
    expect(c.totalUSD).toBeNull();
    expect(c.hasUnpriced).toBe(true);
  });

  it('falls back to live pricing when costUSD is absent but usage+model present', () => {
    const msg: ConversationMessage = {
      role: 'assistant', content: 'x', timestamp: 't',
      usage: usage({ inputTokens: 1_000_000 }), usageModel: 'claude-sonnet-4-6',
      // no costUSD persisted
    };
    expect(conversationCost([msg]).totalUSD).toBeCloseTo(3, 6);
  });
});

describe('formatting', () => {
  it('formats token counts compactly', () => {
    expect(formatTokens(812)).toBe('812');
    expect(formatTokens(12_300)).toBe('12.3k');
    expect(formatTokens(1_400_000)).toBe('1.40M');
  });

  it('uses 4 decimals for sub-cent, 2 otherwise', () => {
    expect(formatUSD(0.0142)).toBe('$0.0142');
    expect(formatUSD(1.5)).toBe('$1.50');
  });

  it('badge shows dollars + tokens, or tokens only when unpriced', () => {
    expect(formatCostBadge({ totalTokens: 12_300, totalUSD: 0.0142, hasUnpriced: false }))
      .toBe('$0.0142 · 12.3k tok');
    expect(formatCostBadge({ totalTokens: 500, totalUSD: null, hasUnpriced: true }))
      .toBe('500 tok');
    expect(formatCostBadge({ totalTokens: 0, totalUSD: null, hasUnpriced: false })).toBeNull();
  });

  it('costBadgeFor returns null when no usage recorded', () => {
    expect(costBadgeFor([{ role: 'user', content: 'hi', timestamp: 't' }])).toBeNull();
  });

  it('formatTurnCost returns null without usage', () => {
    expect(formatTurnCost({ role: 'assistant', content: 'x', timestamp: 't' })).toBeNull();
  });
});
