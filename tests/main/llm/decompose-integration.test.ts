/**
 * Integration coverage for the Decompose orchestrator (#342).
 *
 * `suggestDecomposition()` is a thin wrapper: read the source note, build
 * a prompt, call the LLM, parse the response. The unit tests in
 * `tests/shared/refactor/decompose.test.ts` already cover the parser; the
 * gap was end-to-end wiring (file I/O + LLM call + parse) plus the LLM
 * write-guard scope. These tests close that.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const { completeMock, getSettingsMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
  getSettingsMock: vi.fn(),
}));

vi.mock('../../../src/main/llm/index', () => ({ complete: completeMock }));
vi.mock('../../../src/main/llm/settings', () => ({ getSettings: getSettingsMock }));

import { suggestDecomposition } from '../../../src/main/llm/decompose';
import {
  initGraph,
  indexNote,
  enterLLMContext,
  exitLLMContext,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

describe('suggestDecomposition() integration (#342)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-decompose-int-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    completeMock.mockReset();
    getSettingsMock.mockReset();
    getSettingsMock.mockResolvedValue({ model: 'claude-sonnet-4-6', apiKey: 'fake' });
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  async function plant(rel: string, content: string): Promise<void> {
    const full = path.join(root, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, content, 'utf-8');
    await indexNote(ctx, rel, content);
  }

  it('parses a well-formed LLM response into a proposal', async () => {
    await plant('notes/big.md',
      '# Big Note\n\n## Section A\nFirst topic.\n\n## Section B\nSecond topic.\n');
    completeMock.mockResolvedValueOnce(JSON.stringify({
      parent: { content: 'Index of two topics.' },
      children: [
        { title: 'Topic A', content: 'First topic.', rationale: 'split a.' },
        { title: 'Topic B', content: 'Second topic.', rationale: 'split b.' },
      ],
    }));

    const result = await suggestDecomposition(root, 'notes/big.md');
    expect(result.error).toBeUndefined();
    expect(result.proposal).not.toBeNull();
    expect(result.proposal!.parent.content).toBe('Index of two topics.');
    expect(result.proposal!.children).toHaveLength(2);
    expect(result.proposal!.children[0].title).toBe('Topic A');
  });

  it('feeds the source title and body into the prompt', async () => {
    await plant('notes/big.md', '# My Title\n\nUnique body marker xyz.\n');
    completeMock.mockResolvedValueOnce('{"parent":{"content":"x"},"children":[{"title":"T","content":"c","rationale":"r"}]}');

    await suggestDecomposition(root, 'notes/big.md');
    const prompt = completeMock.mock.calls[0][0] as string;
    expect(prompt).toContain('My Title');
    expect(prompt).toContain('Unique body marker xyz.');
    // The frontmatter-stripped body is what gets fed in; nothing else.
  });

  it('returns null proposal with a diagnostic when the LLM response is unparseable', async () => {
    await plant('notes/big.md', '# Big\nBody.\n');
    completeMock.mockResolvedValueOnce('not-json-at-all');

    const result = await suggestDecomposition(root, 'notes/big.md');
    expect(result.proposal).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('exits the LLM-context guard even when the LLM call throws', async () => {
    await plant('notes/big.md', '# Big\nBody.\n');
    completeMock.mockRejectedValueOnce(new Error('network down'));

    await expect(suggestDecomposition(root, 'notes/big.md'))
      .rejects.toThrow('network down');

    // If exitLLMContext didn't run, a follow-up enter→exit would unbalance
    // the depth counter. Guard the assertion by entering+exiting once and
    // confirming a subsequent indexNote (outside LLM context) doesn't warn.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    enterLLMContext();
    exitLLMContext();
    await indexNote(ctx, 'notes/quiet.md', '# Q\n');
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.some(m => m.includes('[trust-guard]'))).toBe(false);
    warnSpy.mockRestore();
  });
});
