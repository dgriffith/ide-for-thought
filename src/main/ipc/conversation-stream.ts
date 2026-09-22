/**
 * The per-send streaming callbacks: every LLM callback mapped to the IPC
 * channel that carries it to the window's renderer (#2237, epic #2241).
 *
 * ── Why this stayed under `ipc/` ────────────────────────────────────────────
 * #2237 groups this with the prompt assembly and the container-recovery
 * strategy as "not IPC glue" and sends all three to `src/main/llm/`. The other
 * two moved; this one is glue, and moving it would have cost something real.
 * Its entire body is `win.webContents.send(channel, …)` — ten draft kinds, a
 * chunk stream, and the `ask_user` round-trip — so it needs `BrowserWindow`,
 * `Channels` and `broadcast`. `src/main/llm/` is electron-free today apart
 * from `settings.ts` reading a userData path, and putting the renderer
 * transport inside it would invert that for no gain.
 *
 * The issue's actual complaint is satisfied either way: the registrar is
 * thin delegation now, and the 54 lines that map callbacks onto channels sit
 * in a file whose name says that is what they do. `llm/index.ts` still owns
 * the callback *shape* (`StreamCallbacks`); this owns the transport.
 */
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';
import type { EventMap } from '../../shared/ipc-contract';
import type { ConversationDraftBase } from '../../shared/conversation-draft-base';
import type { StreamCallbacks } from '../llm/container-recovery';
import { broadcast } from './broadcast';

/** Pending `ask_user` prompts keyed by question id, owned by the registrar so
 *  aborting a send can reject every question that window is waiting on. */
export type PendingAskUser = Map<
  string,
  { winId: number; resolve: (answer: string) => void; reject: (err: Error) => void }
>;

/**
 * Trailing-edge window for coalescing `onChunk` into one CONVERSATION_STREAM
 * send (#2219). Chosen against a measured stream, not guessed.
 *
 * The issue assumed one IPC message per *token* and proposed a ~50ms window. A
 * real `claude-opus-5` reply (2,514 output tokens, 6,679 chars, 38.1s) emitted
 * **610** `text` delta events — 0.24 per token, because the API already batches
 * ~4 tokens into each `content_block_delta`. Their median spacing was **58.8ms**
 * (p10 43ms, p90 70ms), i.e. deltas arrive *further apart* than the proposed
 * window, so a 50ms timer coalesces almost nothing. Measured on that trace:
 *
 *     window   50ms -> 515 sends (1.2x fewer)   <- the issue's proposal
 *     window  100ms -> 287 sends (2.1x fewer)   <- chosen
 *     window  150ms -> 196 sends (3.1x fewer)
 *
 * 100ms is the knee: it halves the traffic while still repainting ~10x/second,
 * which still reads as continuous streaming. 150ms buys another 1.5x but drops
 * to ~5 repaints/second, where text visibly arrives in blocks. Going wider
 * trades a perceptual property for a diminishing one.
 *
 * This is deliberately a *trailing* timer with no leading-edge send: the first
 * chunk arms the window rather than transmitting immediately. That costs up to
 * 100ms of extra latency on the first visible text — negligible against a
 * time-to-first-token measured in seconds, and the thinking indicator is
 * already on screen — and it buys a single code path whose "nothing is dropped"
 * argument is one buffer, one timer, one reader.
 */
export const STREAM_COALESCE_MS = 100;

/**
 * The callbacks for one send, plus the handle that guarantees the tail of the
 * stream is not lost.
 *
 * `flush()` exists because coalescing introduces a failure mode the
 * send-per-chunk code could not have: text sitting in a buffer when the turn
 * ends. A truncated final chunk is a silently corrupted message — the user sees
 * a reply that stops mid-sentence with no error — so the caller MUST call
 * `flush()` when the completion settles, on the error and abort paths as well
 * as the happy one. It is idempotent and safe to call more than once.
 */
export interface StreamCallbackHandle {
  callbacks: StreamCallbacks;
  /** Send anything still buffered and disarm the pending timer. Idempotent. */
  flush: () => void;
}


/** Build the per-send streaming callbacks: chunk + every draft kind forwarded to
 *  the window's renderer, plus the `ask_user` round-trip (tracked in
 *  `pendingAskUser` so aborting the send can reject a pending question). */
export function buildStreamCallbacks(
  win: BrowserWindow,
  convId: string,
  signal: AbortSignal,
  pendingAskUser: PendingAskUser,
): StreamCallbackHandle {
  // ── Chunk coalescing (#2219) ───────────────────────────────────────────────
  // ONE buffer, ONE timer, ONE reader (`flush`). That shape is the whole
  // correctness argument, so it is worth stating what it buys:
  //
  //  - **Nothing is dropped.** Every non-empty chunk is appended to `buffer`.
  //    The only code that empties `buffer` is `flush`, which transmits exactly
  //    what it took. There is no path that clears without sending.
  //  - **Nothing is reordered.** The buffer is a string built by `+=` in
  //    arrival order, and the main process is single-threaded, so no chunk can
  //    interleave with a flush in progress.
  //  - **The tail always lands.** The registrar calls `flush()` in a `finally`
  //    around the completion, so a turn that ends — normally, by throwing, or
  //    by the user pressing Stop — still ships whatever was buffered. Without
  //    that the last ≤100ms of a reply would silently vanish, and on the abort
  //    path so would the partial text the failure card is supposed to show.
  //
  // `buffer` is captured and cleared *before* the send: if `webContents.send`
  // throws, the window is gone and the text has nowhere to go anyway — holding
  // it would only leak it into a later turn.
  let buffer = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (buffer === '') return;
    const payload = buffer;
    buffer = '';
    if (!win.isDestroyed()) broadcast(win, Channels.CONVERSATION_STREAM, payload);
  };


  // All draft channels carry ConversationDraftBase; the channel is typed against
  // EventMap but the send stays raw — TS can't verify a single-arg spread against
  // a generic `Parameters<EventMap[K]>` tuple, and every subscriber is typed via
  // `subscribe`, so the payload is checked on the receiving side (#1633).
  //
  // Every non-chunk event flushes first (#2219). Coalescing delays only
  // CONVERSATION_STREAM; the draft and ask_user channels still send
  // immediately, so without this a card emitted at T would reach the renderer
  // *ahead of* the prose the model wrote before it — the draft would visibly
  // anchor above its own lead-in, and an ask_user question would appear over
  // text that introduces it. Flushing restores the property the
  // send-per-chunk code got for free: everything the model produced earlier
  // is on screen before anything it produced later.
  const draftEmit =
    (channel: keyof EventMap) =>
    (draft: ConversationDraftBase) => {
      flush();
      if (!win.isDestroyed()) win.webContents.send(channel, draft);
    };
  const callbacks: StreamCallbacks = {
    onChunk: (chunk: string) => {
      // An empty delta carries no text; buffering it would arm a timer for a
      // flush with nothing in it.
      if (chunk === '') return;
      buffer += chunk;
      // Trailing edge: the first chunk after a flush arms the window; every
      // chunk inside it just accumulates. Re-arming per chunk would be a
      // debounce, which on a continuous stream never fires at all.
      if (timer === null) timer = setTimeout(flush, STREAM_COALESCE_MS);
    },
    onDraft: draftEmit(Channels.CONVERSATION_DRAFT),
    onSourceDraft: draftEmit(Channels.CONVERSATION_SOURCE_DRAFT),
    onPropertyDraft: draftEmit(Channels.CONVERSATION_PROPERTY_DRAFT),
    onSourcePropertyDraft: draftEmit(Channels.CONVERSATION_SOURCE_PROPERTY_DRAFT),
    onClaimsDraft: draftEmit(Channels.CONVERSATION_CLAIMS_DRAFT),
    onComputeDraft: draftEmit(Channels.CONVERSATION_COMPUTE_DRAFT),
    onRefactorDraft: draftEmit(Channels.CONVERSATION_REFACTOR_DRAFT),
    onReorgDraft: draftEmit(Channels.CONVERSATION_REORG_DRAFT),
    onDeleteDraft: draftEmit(Channels.CONVERSATION_DELETE_DRAFT),
    onNoteBodyDraft: draftEmit(Channels.CONVERSATION_NOTE_BODY_DRAFT),
    askUser: ({ question, choices }: { question: string; choices?: string[] }) => {
      // Same ordering rule as the drafts above: the question card must not
      // overtake the text the model wrote to introduce it.
      flush();
      const questionId = randomUUID();
      return new Promise<string>((resolve, reject) => {
        pendingAskUser.set(questionId, { winId: win.id, resolve, reject });
        if (!win.isDestroyed()) {
          broadcast(win, Channels.CONVERSATION_ASK_USER, {
            questionId,
            conversationId: convId,
            question,
            // `choices` is optional (exactOptionalPropertyTypes) — omit when absent.
            ...(choices ? { choices } : {}),
          });
        } else {
          pendingAskUser.delete(questionId);
          reject(new Error('window destroyed'));
        }
      });
    },
    signal,
  };

  return { callbacks, flush };
}
