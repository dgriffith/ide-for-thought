/**
 * Prompt-cache breakpoint placement for the Anthropic provider (#1773).
 *
 * Caching is a PREFIX match: the cache key is the exact bytes of the rendered
 * prompt up to each `cache_control` marker, and the render order is
 * `tools` → `system` → `messages`. The provider already marks the system block,
 * which covers tools + system — but the conversation history was never marked,
 * so every iteration of the agentic loop re-sent the whole growing transcript
 * at full input price. A tool-heavy turn pays that up to `maxIterations` times.
 *
 * The fix is a rolling breakpoint on the tail of the history. Iteration N marks
 * its last messages, writing a cache entry for everything through them;
 * iteration N+1 sends that same prefix unchanged, reads it back at ~0.1× input
 * price, and writes only its own delta.
 *
 * Two constraints shape the implementation:
 *
 *  - **Four breakpoints per request, total.** The system block takes one, so
 *    the history gets at most three. We use two, leaving one spare.
 *  - **A breakpoint looks back at most 20 content blocks** for a prior entry.
 *    One iteration can add many blocks at once (an assistant message plus one
 *    `tool_result` per parallel tool call), so marking only the very last
 *    message risks the next lookback overshooting the previous entry. Marking
 *    the last two keeps a second anchor ~1 message back, well inside the window.
 *
 * A pure leaf module — no SDK client, no I/O — so the placement rules are
 * unit-testable without a live API.
 */
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Block types the API accepts `cache_control` on. Notably absent: `thinking`
 * and `redacted_thinking`, which an assistant message can end with — marking
 * one is rejected, so we walk back to the last block that can carry it.
 */
const CACHEABLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'text',
  'image',
  'tool_use',
  'tool_result',
  'document',
]);

/** History breakpoints to place. System takes a fourth; the API allows 4. */
export const HISTORY_BREAKPOINTS = 2;

const EPHEMERAL = { type: 'ephemeral' } as const;

/** Index of the last block that can carry `cache_control`, or -1 if none can. */
function lastCacheableIndex(content: readonly Anthropic.ContentBlockParam[]): number {
  for (let i = content.length - 1; i >= 0; i--) {
    const type = content[i]?.type;
    if (type && CACHEABLE_BLOCK_TYPES.has(type)) return i;
  }
  return -1;
}

/**
 * A copy of `message` with `cache_control` on its last cacheable block, or null
 * when it has none to mark (an empty message, or one that is all thinking).
 * String content is promoted to a single text block so it can carry the marker.
 */
function markMessage(message: Anthropic.MessageParam): Anthropic.MessageParam | null {
  const { content } = message;

  if (typeof content === 'string') {
    if (content === '') return null;
    return { ...message, content: [{ type: 'text', text: content, cache_control: EPHEMERAL }] };
  }

  if (content.length === 0) return null;
  const at = lastCacheableIndex(content);
  if (at === -1) return null;

  const next: Anthropic.ContentBlockParam[] = [...content];
  next[at] = { ...next[at], cache_control: EPHEMERAL } as Anthropic.ContentBlockParam;
  return { ...message, content: next };
}

/**
 * Return `history` with a rolling cache breakpoint on the last `limit`
 * markable messages.
 *
 * Never mutates the input: the agentic loop reuses and appends to the same
 * array across iterations, so stamping in place would accumulate stale
 * breakpoints and blow the four-per-request budget after two iterations.
 */
export function withHistoryCacheBreakpoints(
  history: readonly Anthropic.MessageParam[],
  limit: number = HISTORY_BREAKPOINTS,
): Anthropic.MessageParam[] {
  const out = [...history];
  let placed = 0;
  for (let i = out.length - 1; i >= 0 && placed < limit; i--) {
    const marked = markMessage(out[i]!);
    if (!marked) continue; // nothing markable here — try the message before it
    out[i] = marked;
    placed++;
  }
  return out;
}
