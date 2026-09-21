/**
 * The `container_id is required` recovery (#2237, epic #2241).
 *
 * This is a retry policy, and retry policies fail in the direction nobody
 * looks: not by failing to recover, but by recovering from things they
 * shouldn't. The recovery is lossy — it deletes assistant turns from the
 * history it re-sends — so a rate-limit or auth error that accidentally
 * matched would silently mangle a conversation and report success.
 *
 * It lived in `register-conversation.ts` until #2237, where exercising it meant
 * standing up an IPC harness with a fake BrowserWindow. It takes
 * `completeWithTools` as a parameter, so all of this is now a plain function
 * call with a stub.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  stripCodeExecutionTurns,
  runCompletionWithContainerRecovery,
  type LlmMessage,
} from '../../../src/main/llm/container-recovery';

vi.mock('../../../src/main/llm/conversation', () => ({
  setContainerId: vi.fn(async () => undefined),
}));
const conversation = await import('../../../src/main/llm/conversation');

const BASE = { system: 'sys' } as never;
const OK = { text: 'done' } as never;

/** The 400 the API returns when history references a sandbox we can't re-echo. */
const containerErr = (): Error => new Error('400 bad_request: container_id is required for this request');

function complete(...outcomes: Array<'ok' | Error>): {
  fn: ReturnType<typeof vi.fn>;
  calls: () => Array<{ messages: LlmMessage[]; initialContainerId?: string }>;
} {
  let i = 0;
  const fn = vi.fn(async (params: { messages: LlmMessage[]; initialContainerId?: string }) => {
    const outcome = outcomes[i++];
    if (outcome instanceof Error) throw outcome;
    void params;
    return OK;
  });
  return { fn, calls: () => fn.mock.calls.map((c) => c[0]) };
}

const HISTORY: LlmMessage[] = [
  { role: 'user', content: 'plot this for me' },
  { role: 'assistant', content: '_⚙️ Running code_\n\nHere is the chart.' },
  { role: 'user', content: 'now summarize it' },
];

beforeEach(() => { vi.clearAllMocks(); });

describe('stripCodeExecutionTurns', () => {
  it('drops assistant turns carrying a code-execution marker', () => {
    expect(stripCodeExecutionTurns(HISTORY).map((m) => m.content)).toEqual([
      'plot this for me',
      'now summarize it',
    ]);
  });

  it('keeps a USER turn that merely quotes a marker', () => {
    // The markers are ours, written into assistant text as we stream it. A
    // user pasting one back is not a turn the API will demand a container for,
    // and dropping it would delete something the user actually said.
    const msgs: LlmMessage[] = [{ role: 'user', content: 'why does it say _⚙️ Running code_?' }];
    expect(stripCodeExecutionTurns(msgs)).toEqual(msgs);
  });

  it('recognises all three markers', () => {
    const msgs: LlmMessage[] = [
      { role: 'assistant', content: '_🔍 Searching the web_' },
      { role: 'assistant', content: '_🌐 Fetching a page_' },
      { role: 'assistant', content: '_⚙️ Running code_' },
      { role: 'assistant', content: 'an ordinary reply' },
    ];
    expect(stripCodeExecutionTurns(msgs)).toEqual([{ role: 'assistant', content: 'an ordinary reply' }]);
  });

  it('leaves history untouched when nothing matches', () => {
    const msgs: LlmMessage[] = [{ role: 'assistant', content: 'plain' }];
    expect(stripCodeExecutionTurns(msgs)).toEqual(msgs);
  });
});

describe('runCompletionWithContainerRecovery', () => {
  it('passes the cached container id through on the happy path', async () => {
    const { fn, calls } = complete('ok');
    await runCompletionWithContainerRecovery(fn as never, '/root', 'c1', BASE, HISTORY, 'cont-1', {} as never);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls()[0]?.initialContainerId).toBe('cont-1');
    expect(calls()[0]?.messages).toEqual(HISTORY);
    expect(conversation.setContainerId).not.toHaveBeenCalled();
  });

  it('omits initialContainerId entirely when there is none', async () => {
    // Not `initialContainerId: undefined` — `exactOptionalPropertyTypes` is on,
    // and the provider treats a present-but-undefined key differently.
    const { fn, calls } = complete('ok');
    await runCompletionWithContainerRecovery(fn as never, '/root', 'c1', BASE, HISTORY, undefined, {} as never);
    expect('initialContainerId' in (calls()[0] ?? {})).toBe(false);
  });

  it('on the container 400: clears the id, strips the turns, retries once', async () => {
    const { fn, calls } = complete(containerErr(), 'ok');
    const result = await runCompletionWithContainerRecovery(
      fn as never, '/root', 'c1', BASE, HISTORY, 'stale-container', {} as never,
    );

    expect(result).toBe(OK);
    expect(fn).toHaveBeenCalledTimes(2);
    // The cached id is cleared on disk, or the next turn re-sends the same
    // stale one and lands right back here.
    expect(conversation.setContainerId).toHaveBeenCalledWith('/root', 'c1', undefined, undefined);
    // The retry drops the offending turn AND stops echoing the container id.
    expect(calls()[1]?.messages).toEqual(stripCodeExecutionTurns(HISTORY));
    expect('initialContainerId' in (calls()[1] ?? {})).toBe(false);
  });

  it('does NOT retry any other error — the recovery is lossy', async () => {
    // The whole risk of this function. A 429 or a 401 that got retried would
    // delete assistant turns from a conversation for no reason at all.
    const other = new Error('429 rate_limit_error: slow down');
    const { fn } = complete(other);
    await expect(
      runCompletionWithContainerRecovery(fn as never, '/root', 'c1', BASE, HISTORY, 'cont-1', {} as never),
    ).rejects.toThrow('rate_limit_error');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(conversation.setContainerId).not.toHaveBeenCalled();
  });

  it('retries at most once — a second container 400 propagates', async () => {
    const { fn } = complete(containerErr(), containerErr());
    await expect(
      runCompletionWithContainerRecovery(fn as never, '/root', 'c1', BASE, HISTORY, 'cont-1', {} as never),
    ).rejects.toThrow('container_id is required');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('matches the marker on a non-Error rejection too', async () => {
    // Providers reject with plain objects often enough that `String(err)` is
    // the safer read; this pins that the branch doesn't depend on `instanceof`.
    const fn = vi.fn()
      .mockRejectedValueOnce('container_id is required')
      .mockResolvedValueOnce(OK);
    await runCompletionWithContainerRecovery(fn as never, '/root', 'c1', BASE, HISTORY, 'c', {} as never);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
