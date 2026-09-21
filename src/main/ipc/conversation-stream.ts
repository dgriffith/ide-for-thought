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


/** Build the per-send streaming callbacks: chunk + every draft kind forwarded to
 *  the window's renderer, plus the `ask_user` round-trip (tracked in
 *  `pendingAskUser` so aborting the send can reject a pending question). */
export function buildStreamCallbacks(
  win: BrowserWindow,
  convId: string,
  signal: AbortSignal,
  pendingAskUser: PendingAskUser,
): StreamCallbacks {
  // All draft channels carry ConversationDraftBase; the channel is typed against
  // EventMap but the send stays raw — TS can't verify a single-arg spread against
  // a generic `Parameters<EventMap[K]>` tuple, and every subscriber is typed via
  // `subscribe`, so the payload is checked on the receiving side (#1633).
  const draftEmit =
    (channel: keyof EventMap) =>
    (draft: ConversationDraftBase) => {
      if (!win.isDestroyed()) win.webContents.send(channel, draft);
    };
  return {
    onChunk: (chunk: string) => {
      if (!win.isDestroyed()) broadcast(win, Channels.CONVERSATION_STREAM, chunk);
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
}
