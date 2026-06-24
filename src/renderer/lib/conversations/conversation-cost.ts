/**
 * Conversation cost/token aggregation + formatting (#821).
 *
 * Per-turn usage and a derived `costUSD` are persisted on each assistant
 * message (#820/#821). These pure helpers roll those per-turn records up into a
 * conversation running total and format it for the quiet badge near the
 * composer. Kept out of the component so the summation + formatting are
 * testable without a DOM.
 */

import type { ConversationMessage } from '../../../shared/types';
import { costForUsage } from '../../../shared/tools/models';

export interface ConversationCost {
  /** Summed input + output tokens across every turn that reported usage. */
  totalTokens: number;
  /** Summed USD cost across priced turns, or null if no turn was priced. */
  totalUSD: number | null;
  /** True if at least one turn reported usage from an unpriced model — the
   *  dollar figure then covers only the priced turns and shouldn't read as the
   *  whole story. */
  hasUnpriced: boolean;
}

/**
 * Roll up per-turn usage into a conversation total. `costUSD` is read from the
 * persisted record when present; for a message that has `usage` but no stored
 * cost (e.g. a turn persisted before cost derivation, or recomputed live) we
 * fall back to the pricing table so the total still reflects it.
 */
export function conversationCost(messages: ConversationMessage[]): ConversationCost {
  let totalTokens = 0;
  let totalUSD = 0;
  let anyPriced = false;
  let hasUnpriced = false;
  for (const m of messages) {
    if (!m.usage) continue;
    totalTokens += m.usage.inputTokens + m.usage.outputTokens;
    const cost = m.costUSD ?? (m.usageModel ? costForUsage(m.usage, m.usageModel) : null);
    if (cost !== null && cost !== undefined) {
      totalUSD += cost;
      anyPriced = true;
    } else {
      hasUnpriced = true;
    }
  }
  return { totalTokens, totalUSD: anyPriced ? totalUSD : null, hasUnpriced };
}

/** Compact token count: `812` / `12.3k` / `1.4M`. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Dollar figure for the badge. Small costs get four decimals ($0.0142) so a
 * cheap turn isn't rounded down to near-nothing; at a dime or more, two
 * decimals read fine.
 */
export function formatUSD(usd: number): string {
  if (usd > 0 && usd < 0.1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** One-line badge text, e.g. `$0.0142 · 12.3k tok`, or just tokens when no turn
 *  was priced. Returns null when there's nothing to show yet (no usage). */
export function formatCostBadge(cost: ConversationCost): string | null {
  if (cost.totalTokens === 0 && cost.totalUSD === null) return null;
  const tokens = `${formatTokens(cost.totalTokens)} tok`;
  if (cost.totalUSD === null) return tokens;
  return `${formatUSD(cost.totalUSD)} · ${tokens}`;
}

/**
 * Badge text + hover title for a conversation, or null when there's nothing to
 * show. The title carries the precise token breakdown and an unpriced-turn
 * caveat so the badge itself can stay terse.
 */
export function costBadgeFor(
  messages: ConversationMessage[],
): { text: string; title: string } | null {
  const cost = conversationCost(messages);
  const text = formatCostBadge(cost);
  if (!text) return null;
  const parts = [`${cost.totalTokens.toLocaleString()} tokens this conversation`];
  if (cost.totalUSD !== null) parts.push(`≈ ${formatUSD(cost.totalUSD)}`);
  if (cost.hasUnpriced) parts.push('(excludes turns from unpriced models)');
  return { text, title: parts.join(' · ') };
}

/** Per-turn cost label for the hover/expand detail on an assistant message. */
export function formatTurnCost(m: ConversationMessage): string | null {
  if (!m.usage) return null;
  const tokens = `${formatTokens(m.usage.inputTokens + m.usage.outputTokens)} tok`;
  const cost = m.costUSD ?? (m.usageModel ? costForUsage(m.usage, m.usageModel) : null);
  if (cost === null || cost === undefined) return tokens;
  return `${formatUSD(cost)} · ${tokens}`;
}
