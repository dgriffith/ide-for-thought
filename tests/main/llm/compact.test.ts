/**
 * Client-side compaction decision/assembly (#824).
 */
import { describe, it, expect } from 'vitest';
import {
  planCompaction,
  buildSummaryMessage,
  buildSummaryPrompt,
  COMPACT_KEEP_RECENT,
  COMPACT_MIN_MESSAGES,
} from '../../../src/main/llm/compact';
import type { ConversationMessage, TurnUsage } from '../../../src/shared/types';

function convo(n: number): ConversationMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `m${i}`,
    timestamp: 't',
  }));
}

describe('planCompaction (#824)', () => {
  it('leaves a short conversation alone', () => {
    const plan = planCompaction(convo(COMPACT_MIN_MESSAGES - 1));
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/too short/i);
  });

  it('summarizes the prefix and keeps the last KEEP_RECENT verbatim', () => {
    const msgs = convo(10);
    const plan = planCompaction(msgs);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.recent).toHaveLength(COMPACT_KEEP_RECENT);
    expect(plan.recent).toEqual(msgs.slice(-COMPACT_KEEP_RECENT));
    expect(plan.prefix).toHaveLength(10 - COMPACT_KEEP_RECENT);
    // Transcript is role-labeled and covers exactly the prefix.
    expect(plan.transcript).toContain('[user] m0');
    expect(plan.transcript).toContain(`[assistant] m${10 - COMPACT_KEEP_RECENT - 1}`);
    expect(plan.transcript).not.toContain(`m${10 - COMPACT_KEEP_RECENT}`); // first recent
  });

  it('excludes internal system messages from the transcript', () => {
    const msgs = convo(10);
    msgs[0] = { role: 'system', content: 'internal', timestamp: 't' };
    const plan = planCompaction(msgs);
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.transcript).not.toContain('internal');
  });
});

describe('buildSummaryMessage', () => {
  const usage: TurnUsage = { inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0 };

  it('produces a user-role summary carrying the summarization usage', () => {
    const m = buildSummaryMessage(6, '  the summary  ', usage, 'claude-sonnet-4-6', 'ts');
    // user role keeps the API first-message-is-user invariant + survives the
    // system-message filter on the send path.
    expect(m.role).toBe('user');
    expect(m.content).toContain('6 messages compacted');
    expect(m.content).toContain('the summary');
    expect(m.content).not.toMatch(/ {2}the summary {2}/); // trimmed
    expect(m.usage).toEqual(usage);
    expect(m.usageModel).toBe('claude-sonnet-4-6');
  });

  it('omits usage fields when the call reported none', () => {
    const m = buildSummaryMessage(6, 's', undefined, undefined, 'ts');
    expect(m.usage).toBeUndefined();
    expect(m.usageModel).toBeUndefined();
  });
});

describe('buildSummaryPrompt', () => {
  it('embeds the transcript', () => {
    expect(buildSummaryPrompt('[user] hi')).toContain('[user] hi');
  });
});
