/**
 * Skill-eval harness — the live half (#1522, PR 2).
 *
 * The `--live` path makes a real model call and captures the non-deterministic
 * artifacts (`response.md`, `drafts.json`) plus usage/timing in `meta.json`.
 * This test exercises that capture + serialization with an **injected fake LLM
 * seam** — no provider, no API key, no tokens — so it can run in CI while the
 * real calls stay opt-in. It asserts:
 *   - one-shot skills go through `complete` (no drafts);
 *   - conversation skills go through `completeWithTools`, and every draft the
 *     agentic loop emits is captured into `drafts.json` with its kind;
 *   - a non-live run writes neither `response.md` nor `drafts.json`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runEval, type LlmSeam } from '../../src/cli/eval';
import type { TurnUsage } from '../../src/shared/types';

const USAGE: TurnUsage = { inputTokens: 11, outputTokens: 22, cacheCreationTokens: 0, cacheReadTokens: 0 };

/** A fake seam: `complete` returns canned text (reporting usage); `completeWithTools`
 *  fires two draft callbacks (a note + a claim) before returning. */
function fakeLlm(): LlmSeam {
  return {
    async complete(_prompt, opts) {
      opts?.onUsage?.(USAGE, opts.model ?? 'fake-model');
      return 'ONE-SHOT RESPONSE TEXT';
    },
    async completeWithTools(opts) {
      opts.callbacks?.onDraft?.({ conversationId: 'x', notes: [{ relativePath: 'n.md', content: '# N' }] } as never);
      opts.callbacks?.onClaimsDraft?.({ conversationId: 'x', claims: [{ label: 'c' }] } as never);
      return {
        text: 'CONVERSATION RESPONSE TEXT',
        citations: [],
        usage: USAGE,
        usageModel: opts.model ?? 'fake-model',
      };
    },
  };
}

let cwd: string;

beforeAll(async () => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-eval-live-'));
  // A conversation-skill case (inline note + selection) and a one-shot-skill case.
  const conv = path.join(cwd, 'conv-case', 'input');
  await fsp.mkdir(conv, { recursive: true });
  await fsp.writeFile(
    path.join(conv, 'case.json'),
    JSON.stringify({ skill: 'analysis.antithesize', model: 'claude-opus-5', context: { noteTitle: 'T' } }),
    'utf-8',
  );
  await fsp.writeFile(path.join(conv, 'note.md'), '# T\n\nA claim worth opposing.\n', 'utf-8');

  const one = path.join(cwd, 'oneshot-case', 'input');
  await fsp.mkdir(one, { recursive: true });
  await fsp.writeFile(
    path.join(one, 'case.json'),
    JSON.stringify({ skill: 'planning.steelman', model: 'claude-opus-5', context: { noteTitle: 'T' } }),
    'utf-8',
  );
  await fsp.writeFile(path.join(one, 'note.md'), '# T\n\nA position to steelman.\n', 'utf-8');
});

afterAll(async () => {
  await fsp.rm(cwd, { recursive: true, force: true });
});

describe('skill-eval harness — live capture (#1522 PR 2)', () => {
  it('conversation skill: captures response + every draft, and enriches meta', async () => {
    const [res] = await runEval(['conv-case'], { cwd, live: true, llm: fakeLlm() });
    expect(res!.live).toBeDefined();
    expect(res!.live!.response).toBe('CONVERSATION RESPONSE TEXT');
    // Both draft callbacks captured, labelled by kind.
    expect(res!.live!.drafts.map((d) => d.kind)).toEqual(['notes', 'claims']);

    const out = path.join(cwd, 'conv-case', 'output');
    expect(fs.readFileSync(path.join(out, 'response.md'), 'utf-8')).toBe('CONVERSATION RESPONSE TEXT\n');
    const drafts = JSON.parse(fs.readFileSync(path.join(out, 'drafts.json'), 'utf-8'));
    expect(drafts).toHaveLength(2);
    expect(drafts[0].kind).toBe('notes');

    const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf-8'));
    expect(meta.usage).toEqual(USAGE);
    expect(meta.usageModel).toBe('claude-opus-5');
    expect(meta.draftCount).toBe(2);
    expect(typeof meta.timingMs).toBe('number');
    expect(meta.harnessVersion).toBeDefined();
  });

  it('one-shot skill: goes through complete, no drafts', async () => {
    const [res] = await runEval(['oneshot-case'], { cwd, live: true, llm: fakeLlm() });
    expect(res!.live!.response).toBe('ONE-SHOT RESPONSE TEXT');
    expect(res!.live!.drafts).toEqual([]);
    const out = path.join(cwd, 'oneshot-case', 'output');
    expect(fs.readFileSync(path.join(out, 'response.md'), 'utf-8')).toBe('ONE-SHOT RESPONSE TEXT\n');
    expect(JSON.parse(fs.readFileSync(path.join(out, 'drafts.json'), 'utf-8'))).toEqual([]);
  });

  it('captures a live error into the case instead of aborting the batch', async () => {
    // A seam whose conversation call always throws (e.g. a provider 400). The
    // run must record the error on the case and still complete.
    const throwing: LlmSeam = {
      async complete() {
        return 'x';
      },
      async completeWithTools() {
        throw new Error('400 container_id is required when there are pending tool uses');
      },
    };
    const [res] = await runEval(['conv-case'], { cwd, live: true, llm: throwing });
    expect(res!.live!.error).toContain('container_id is required');
    expect(res!.live!.response).toContain('[eval error]');
    const meta = JSON.parse(fs.readFileSync(path.join(cwd, 'conv-case', 'output', 'meta.json'), 'utf-8'));
    expect(meta.error).toContain('container_id is required');
    // The case's response.md is written with the error marker (batch didn't die).
    expect(fs.readFileSync(path.join(cwd, 'conv-case', 'output', 'response.md'), 'utf-8')).toContain('[eval error]');
  });

  it('a non-live run writes neither response.md nor drafts.json', async () => {
    // A fresh case that never saw a live run, so the live-only artifacts can
    // only be absent because non-live skips them.
    const fresh = path.join(cwd, 'fresh-case', 'input');
    await fsp.mkdir(fresh, { recursive: true });
    await fsp.writeFile(
      path.join(fresh, 'case.json'),
      JSON.stringify({ skill: 'planning.steelman', model: 'claude-opus-5', context: { noteTitle: 'T' } }),
      'utf-8',
    );
    await fsp.writeFile(path.join(fresh, 'note.md'), '# T\n\nnope\n', 'utf-8');

    const [res] = await runEval(['fresh-case'], { cwd, live: false, llm: fakeLlm() });
    expect(res!.live).toBeUndefined();
    const out = path.join(cwd, 'fresh-case', 'output');
    expect(fs.existsSync(path.join(out, 'request.json'))).toBe(true); // always written
    expect(fs.existsSync(path.join(out, 'response.md'))).toBe(false);
    expect(fs.existsSync(path.join(out, 'drafts.json'))).toBe(false);
  });
});
