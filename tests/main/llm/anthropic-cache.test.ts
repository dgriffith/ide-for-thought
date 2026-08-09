/**
 * Prompt-cache breakpoint placement (#1773).
 *
 * The failure mode this guards against is silent: a misplaced or missing
 * `cache_control` marker produces no error, just a permanent 0% cache-read rate
 * and a bill nobody notices. So the rules are pinned here rather than left to a
 * live API call to reveal — the API's constraints (four markers per request,
 * only certain block types, an untouched prefix) are all things a unit test can
 * check and a running app cannot.
 */
import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  withHistoryCacheBreakpoints,
  HISTORY_BREAKPOINTS,
} from '../../../src/main/llm/provider/anthropic-cache';

type Msg = Anthropic.MessageParam;

/** Every `cache_control` in a message list, as `messageIndex:blockIndex`. */
function markers(messages: readonly Msg[]): string[] {
  const out: string[] = [];
  messages.forEach((m, mi) => {
    if (typeof m.content === 'string') return;
    m.content.forEach((b, bi) => {
      if ((b as { cache_control?: unknown }).cache_control) out.push(`${mi}:${bi}`);
    });
  });
  return out;
}

const user = (text: string): Msg => ({ role: 'user', content: text });
const assistantText = (text: string): Msg => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
});
const toolResults = (n: number): Msg => ({
  role: 'user',
  content: Array.from({ length: n }, (_, i) => ({
    type: 'tool_result' as const,
    tool_use_id: `toolu_${i}`,
    content: 'ok',
  })),
});

describe('withHistoryCacheBreakpoints', () => {
  it('marks the last two messages, on their final block', () => {
    const history = [user('one'), assistantText('two'), toolResults(3)];
    const out = withHistoryCacheBreakpoints(history);
    // Message 2's third tool_result and message 1's only text block.
    expect(markers(out)).toEqual(['1:0', '2:2']);
  });

  it('leaves the input untouched — the loop appends to the same array', () => {
    // Stamping in place would accumulate stale markers across iterations and
    // blow the four-per-request budget by the third turn.
    const history = [user('one'), assistantText('two')];
    const before = JSON.stringify(history);
    withHistoryCacheBreakpoints(history);
    expect(JSON.stringify(history)).toBe(before);
  });

  it('stays within the API budget once the system marker is counted', () => {
    const history = Array.from({ length: 30 }, (_, i) => assistantText(`m${i}`));
    const out = withHistoryCacheBreakpoints(history);
    // 4 allowed per request; the provider spends one on the system block.
    expect(markers(out).length).toBe(HISTORY_BREAKPOINTS);
    expect(markers(out).length).toBeLessThanOrEqual(3);
  });

  it('promotes string content to a text block so it can carry the marker', () => {
    const out = withHistoryCacheBreakpoints([user('plain string')]);
    expect(out[0]!.content).toEqual([
      { type: 'text', text: 'plain string', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('never marks a thinking block — the API rejects it', () => {
    // Adaptive thinking is on by default for Claude Opus 5, so an assistant
    // message can legitimately end with a block that cannot carry the marker.
    const history: Msg[] = [
      user('q'),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'answer' },
          { type: 'thinking', thinking: 'reasoning', signature: 'sig' },
        ] as unknown as Anthropic.ContentBlockParam[],
      },
    ];
    const out = withHistoryCacheBreakpoints(history);
    const blocks = out[1]!.content as Anthropic.ContentBlockParam[];
    expect((blocks[1] as { cache_control?: unknown }).cache_control).toBeUndefined();
    expect((blocks[0] as { cache_control?: unknown }).cache_control).toBeDefined();
  });

  it('falls through to an earlier message when one has nothing markable', () => {
    const unmarkable: Msg = { role: 'assistant', content: [] };
    const out = withHistoryCacheBreakpoints([user('a'), assistantText('b'), unmarkable]);
    // The empty message is skipped; both markers land on real content.
    expect(markers(out)).toEqual(['0:0', '1:0']);
  });

  it('handles a history shorter than the breakpoint count', () => {
    expect(markers(withHistoryCacheBreakpoints([user('only')]))).toEqual(['0:0']);
    expect(withHistoryCacheBreakpoints([])).toEqual([]);
  });

  it('re-marks the new tail as the loop grows, so each turn reads the last write', () => {
    // The mechanic the whole feature rests on: iteration N's markers move to
    // the messages iteration N+1 appended, leaving N's prefix byte-identical
    // and therefore readable.
    const turn1 = [user('q'), assistantText('a1')];
    const marked1 = withHistoryCacheBreakpoints(turn1);
    expect(markers(marked1)).toEqual(['0:0', '1:0']);

    const turn2 = [...turn1, toolResults(1), assistantText('a2')];
    const marked2 = withHistoryCacheBreakpoints(turn2);
    expect(markers(marked2)).toEqual(['2:0', '3:0']);

    // The prefix iteration 1 cached is unchanged in iteration 2's request —
    // this is what makes it a cache read rather than a fresh write.
    expect(JSON.stringify(marked2.slice(0, 2))).toBe(JSON.stringify(turn1));
  });
});
