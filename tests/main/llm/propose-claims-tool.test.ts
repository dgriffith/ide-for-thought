/**
 * propose_claims tool (#104) — server-side execution contract.
 *
 * Guarantees: the tool never writes (emits a draft for review), resolves each
 * quote to an excerpt id + char offsets against the source body, validates the
 * claim shapes, and flags quotes that aren't verbatim substrings.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { executeNotebaseTool, type ToolContext } from '../../../src/main/llm/tools';
import { excerptIdFor } from '../../../src/main/sources/create-excerpt';
import type { ConversationClaimsDraft } from '../../../src/shared/conversation-claims-drafts';

let root: string;
const SOURCE_ID = 'smith-2024';
const BODY = '# Paper\n\nThe sky is blue because of Rayleigh scattering. Adoption will accelerate next year.\n';

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-claims-tool-'));
  await fsp.mkdir(path.join(root, '.minerva', 'sources', SOURCE_ID), { recursive: true });
  await fsp.writeFile(path.join(root, '.minerva', 'sources', SOURCE_ID, 'body.md'), BODY, 'utf-8');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function ctx(): ToolContext {
  return { rootPath: root, conversationId: 'conv-1' };
}

describe('propose_claims tool execution', () => {
  it('emits a draft with excerpt ids + char offsets for verbatim quotes', async () => {
    const onClaimsDraft = vi.fn();
    const quote = 'The sky is blue because of Rayleigh scattering.';
    const out = await executeNotebaseTool(
      ctx(),
      'propose_claims',
      {
        note: 'Key claims from the paper',
        sourceId: SOURCE_ID,
        claims: [{ text: 'The sky is blue due to Rayleigh scattering', kind: 'factual', quote, confidence: 0.9 }],
      },
      { onClaimsDraft },
    );
    expect(out.isError).toBe(false);
    expect(onClaimsDraft).toHaveBeenCalledTimes(1);
    const draft = onClaimsDraft.mock.calls[0][0] as ConversationClaimsDraft;
    expect(draft.draftId).toMatch(/^claimsdraft-/);
    expect(draft.sourceId).toBe(SOURCE_ID);
    const c = draft.claims[0];
    expect(c.excerptId).toBe(excerptIdFor(SOURCE_ID, quote));
    expect(c.quoteFound).toBe(true);
    expect(c.charStart).toBe(BODY.indexOf(quote));
    expect(c.charEnd).toBe(BODY.indexOf(quote) + quote.length);
  });

  it('flags a quote that is not a verbatim substring (no offsets)', async () => {
    const onClaimsDraft = vi.fn();
    await executeNotebaseTool(
      ctx(),
      'propose_claims',
      {
        note: 'n',
        sourceId: SOURCE_ID,
        claims: [{ text: 'paraphrased', kind: 'factual', quote: 'the sky is azure (paraphrase)', confidence: 0.5 }],
      },
      { onClaimsDraft },
    );
    const draft = onClaimsDraft.mock.calls[0][0] as ConversationClaimsDraft;
    expect(draft.claims[0].quoteFound).toBe(false);
    expect(draft.claims[0].charStart).toBeUndefined();
  });

  it('rejects an invalid kind', async () => {
    const onClaimsDraft = vi.fn();
    const out = await executeNotebaseTool(
      ctx(),
      'propose_claims',
      { note: 'n', sourceId: SOURCE_ID, claims: [{ text: 't', kind: 'opinion', quote: 'q', confidence: 0.5 }] },
      { onClaimsDraft },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('kind');
    expect(onClaimsDraft).not.toHaveBeenCalled();
  });

  it('rejects confidence outside [0,1] and empty claim lists', async () => {
    const bad = await executeNotebaseTool(
      ctx(), 'propose_claims',
      { note: 'n', sourceId: SOURCE_ID, claims: [{ text: 't', kind: 'factual', quote: 'q', confidence: 2 }] },
      { onClaimsDraft: vi.fn() },
    );
    expect(bad.isError).toBe(true);
    const empty = await executeNotebaseTool(
      ctx(), 'propose_claims',
      { note: 'n', sourceId: SOURCE_ID, claims: [] },
      { onClaimsDraft: vi.fn() },
    );
    expect(empty.isError).toBe(true);
  });

  it('errors with a clear message when no UI surface is wired', async () => {
    const out = await executeNotebaseTool(
      ctx(), 'propose_claims',
      { note: 'n', sourceId: SOURCE_ID, claims: [{ text: 't', kind: 'factual', quote: 'q', confidence: 0.5 }] },
      {},
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('only available in conversation contexts');
  });
});
