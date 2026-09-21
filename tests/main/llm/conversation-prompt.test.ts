/**
 * The conversation system prompt's assembly (#2237, epic #2241).
 *
 * Not a test of the prompt's wording — that's product copy and it should be
 * free to change. What's pinned here is the *structure*, because the ordering
 * is load-bearing for two separate reasons and neither is visible from reading
 * a single `parts.push`:
 *
 *   - **Precedence.** The thoughtbase's own conventions doc sits directly after
 *     the base instructions, above the per-turn context and above the user's
 *     own system prompt. Reorder it below them and a thoughtbase's house style
 *     starts losing to "the note currently open is …".
 *   - **Cache hits.** Everything static comes first and everything per-turn
 *     after, so the cached system block survives a turn where only the open
 *     note changed. Interleave the two and every turn re-caches.
 *
 * It lived in `register-conversation.ts` until #2237, where none of this was
 * reachable without an IPC harness.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContextBundle } from '../../../src/shared/conversation';

vi.mock('../../../src/main/llm/thoughtbase-doc', () => ({
  readThoughtbaseDoc: vi.fn(async () => null),
  thoughtbaseDocPromptBlock: vi.fn((doc: string | null) => (doc ? `THOUGHTBASE DOC:\n${doc}` : null)),
}));
vi.mock('../../../src/main/llm/date-context', () => ({
  currentDateContext: vi.fn(() => 'Today is 2026-09-21.'),
}));

const { readThoughtbaseDoc } = await import('../../../src/main/llm/thoughtbase-doc');
const { buildConversationSystemPrompt, DEFAULT_CONVERSATION_SYSTEM_PROMPT } =
  await import('../../../src/main/llm/conversation-prompt');

const EMPTY: ContextBundle = {};
const bundle = (notePath: string): ContextBundle => ({ notePath });

/** Index of a fragment in the assembled prompt, or -1. */
const at = (prompt: string, fragment: string): number => prompt.indexOf(fragment);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readThoughtbaseDoc).mockResolvedValue(null);
});

describe('the base instructions always lead', () => {
  it('starts with the default prompt even with nothing else supplied', async () => {
    const prompt = await buildConversationSystemPrompt(undefined, EMPTY);
    expect(prompt.startsWith(DEFAULT_CONVERSATION_SYSTEM_PROMPT)).toBe(true);
  });

  it('appends the date context after it', async () => {
    const prompt = await buildConversationSystemPrompt(undefined, EMPTY);
    expect(at(prompt, 'Today is 2026-09-21.')).toBeGreaterThan(0);
  });

  it('does not read the thoughtbase doc when there is no project', async () => {
    await buildConversationSystemPrompt(undefined, EMPTY, undefined, null);
    expect(readThoughtbaseDoc).not.toHaveBeenCalled();
  });
});

describe('ordering — precedence and cache stability', () => {
  it('puts the thoughtbase doc above the per-turn context and the user prompt', async () => {
    vi.mocked(readThoughtbaseDoc).mockResolvedValue('Prefer British spelling.');
    const prompt = await buildConversationSystemPrompt(
      'User says: be terse.',
      bundle('notes/origin.md'),
      'notes/open.md',
      '/root',
    );

    const doc = at(prompt, 'THOUGHTBASE DOC:');
    expect(doc).toBeGreaterThan(0);
    expect(doc).toBeLessThan(at(prompt, 'Today is 2026-09-21.'));
    expect(doc).toBeLessThan(at(prompt, 'notes/origin.md'));
    expect(doc).toBeLessThan(at(prompt, 'User says: be terse.'));
  });

  it('puts the user system prompt last', async () => {
    // It's the most specific instruction in the stack, so it goes where a
    // model weights it most heavily — and it must not sit between two blocks
    // that are otherwise cacheable together.
    const prompt = await buildConversationSystemPrompt(
      'User says: be terse.',
      bundle('notes/origin.md'),
      'notes/open.md',
    );
    expect(prompt.trimEnd().endsWith('User says: be terse.')).toBe(true);
  });

  it('omits the doc block entirely when the thoughtbase has no doc', async () => {
    const prompt = await buildConversationSystemPrompt(undefined, EMPTY, undefined, '/root');
    expect(prompt).not.toContain('THOUGHTBASE DOC:');
  });
});

describe('the open-note context', () => {
  it('names the origin note the conversation started from', async () => {
    const prompt = await buildConversationSystemPrompt(undefined, bundle('notes/origin.md'));
    expect(prompt).toContain('The user started this conversation from the note: notes/origin.md');
  });

  it('names a DIFFERENT open note as live context', async () => {
    // This is what resolves "this note" in a user's prompt against what they
    // are actually looking at, which need not be where the thread began.
    const prompt = await buildConversationSystemPrompt(undefined, bundle('notes/origin.md'), 'notes/elsewhere.md');
    expect(prompt).toContain('The note currently open in the editor is: notes/elsewhere.md');
    expect(prompt).not.toContain('still viewing the origin note');
  });

  it('says so plainly when the open note IS the origin, rather than repeating the path', async () => {
    const prompt = await buildConversationSystemPrompt(undefined, bundle('notes/origin.md'), 'notes/origin.md');
    expect(prompt).toContain('The user is still viewing the origin note.');
    expect(prompt).not.toContain('The note currently open in the editor is');
  });

  it('mentions no note at all when there is neither', async () => {
    const prompt = await buildConversationSystemPrompt(undefined, EMPTY);
    expect(prompt).not.toContain('started this conversation from the note');
    expect(prompt).not.toContain('currently open in the editor');
  });
});

describe('a blank user system prompt is not a user system prompt', () => {
  it.each([undefined, '', '   ', '\n\t '])('%o adds nothing', async (userSystem) => {
    const prompt = await buildConversationSystemPrompt(userSystem, EMPTY);
    expect(prompt.trimEnd().endsWith('Today is 2026-09-21.')).toBe(true);
  });

  it('trims a real one rather than pasting its whitespace', async () => {
    const prompt = await buildConversationSystemPrompt('  be terse.  ', EMPTY);
    expect(prompt.trimEnd().endsWith('be terse.')).toBe(true);
  });
});
