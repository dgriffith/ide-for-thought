/**
 * Integration coverage for the Auto-link orchestrator (#342).
 *
 * Drives the full suggest → apply pipeline for both modes:
 *  - "Link to": the active note picks up wiki-links to other notes.
 *  - "Link inbound": *other* notes pick up wiki-links pointing at the
 *    active note.
 * The LLM call is mocked; everything else (file reads, candidate listing,
 * insertion-point math, applied/skipped accounting) runs for real.
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

import {
  suggestLinksTo,
  applyAutoLinkToSuggestions,
  suggestLinksInbound,
  applyInboundSuggestions,
} from '../../../src/main/llm/auto-link';
import { initGraph, indexNote } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

describe('Auto-link integration (#342)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-autolink-int-'));
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

  describe('"Link to" mode', () => {
    it('returns suggestions whose anchor text is a verbatim substring of the active body', async () => {
      await plant('notes/active.md', '# Active\n\nThis discusses cognitive bias and decision making.\n');
      await plant('notes/cognitive-bias.md', '# Cognitive Bias\n\nWhen judgement deviates from rationality.\n');

      completeMock.mockResolvedValueOnce(JSON.stringify([
        { anchorText: 'cognitive bias', target: 'notes/cognitive-bias.md', rationale: 'matches.' },
        { anchorText: 'NOT IN BODY', target: 'notes/cognitive-bias.md', rationale: 'paraphrase.' },
      ]));

      const result = await suggestLinksTo(root, 'notes/active.md');
      expect(result.candidateCount).toBe(1);
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].anchorText).toBe('cognitive bias');
      expect(result.suggestions[0].target).toBe('notes/cognitive-bias.md');
    });

    it('drops suggestions whose target is not in the candidate set', async () => {
      await plant('notes/active.md', '# Active\n\nMentions cognitive bias.\n');
      await plant('notes/cognitive-bias.md', '# CB\nBody.\n');

      completeMock.mockResolvedValueOnce(JSON.stringify([
        { anchorText: 'cognitive bias', target: 'notes/does-not-exist.md', rationale: 'oops.' },
      ]));

      const result = await suggestLinksTo(root, 'notes/active.md');
      expect(result.suggestions).toHaveLength(0);
    });

    it('apply path rewrites file content with the wiki-link', async () => {
      const original = '# Active\n\nThis discusses cognitive bias and decision making.\n';
      await plant('notes/active.md', original);
      await plant('notes/cognitive-bias.md', '# CB\nBody.\n');

      const accepted = [
        { anchorText: 'cognitive bias', target: 'notes/cognitive-bias.md', rationale: 'r.' },
      ];
      const result = await applyAutoLinkToSuggestions(root, 'notes/active.md', accepted);

      expect(result.applied).toHaveLength(1);
      expect(result.skipped).toHaveLength(0);
      expect(result.content).toContain('[[notes/cognitive-bias|cognitive bias]]');
      // The orchestrator does NOT write — it returns the new content for
      // the caller to persist + reindex (#174). Confirm the file on disk
      // is untouched.
      const onDisk = await fsp.readFile(path.join(root, 'notes/active.md'), 'utf-8');
      expect(onDisk).toBe(original);
    });

    it('apply path skips suggestions whose anchor has drifted out of the file', async () => {
      await plant('notes/active.md', '# Active\n\nDifferent words now.\n');
      await plant('notes/cognitive-bias.md', '# CB\n');

      const accepted = [
        { anchorText: 'cognitive bias', target: 'notes/cognitive-bias.md', rationale: 'r.' },
      ];
      const result = await applyAutoLinkToSuggestions(root, 'notes/active.md', accepted);
      expect(result.applied).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.content).toBe('# Active\n\nDifferent words now.\n');
    });
  });

  describe('"Link inbound" mode', () => {
    it('suggests inbound links into other notes that mention the active concept', async () => {
      await plant('notes/active.md', '---\ntags:\n  - epistemics\n---\n# Trust Principle\nLLM proposes, human confirms.\n');
      await plant('notes/source-a.md', '---\ntags:\n  - epistemics\n---\n# A\nWe rely on the trust principle here.\n');
      await plant('notes/source-b.md', '---\ntags:\n  - epistemics\n---\n# B\nNo mention of that idea here.\n');

      completeMock.mockResolvedValueOnce(JSON.stringify([
        { source: 'notes/source-a.md', anchorText: 'trust principle', rationale: 'r.' },
        // This anchor doesn't appear in source-b — orchestrator should drop it.
        { source: 'notes/source-b.md', anchorText: 'trust principle', rationale: 'r.' },
      ]));

      const result = await suggestLinksInbound(root, 'notes/active.md');
      expect(result.candidateCount).toBeGreaterThanOrEqual(2);
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].source).toBe('notes/source-a.md');
      expect(result.suggestions[0].contextSnippet).toContain('trust principle');
    });

    it('apply path rewrites every touched source and tracks them in touchedPaths', async () => {
      const aOrig = '---\ntags:\n  - x\n---\n# A\nThe trust principle matters.\n';
      const bOrig = '---\ntags:\n  - x\n---\n# B\nAnother mention of trust principle here.\n';
      await plant('notes/active.md', '---\ntags:\n  - x\n---\n# Trust Principle\nBody.\n');
      await plant('notes/source-a.md', aOrig);
      await plant('notes/source-b.md', bOrig);

      const accepted = [
        { source: 'notes/source-a.md', anchorText: 'trust principle', rationale: 'r.', contextSnippet: '' },
        { source: 'notes/source-b.md', anchorText: 'trust principle', rationale: 'r.', contextSnippet: '' },
      ];
      const result = await applyInboundSuggestions(root, 'notes/active.md', accepted);

      expect(result.applied).toHaveLength(2);
      expect(result.skipped).toHaveLength(0);
      expect(result.touchedPaths.sort()).toEqual(['notes/source-a.md', 'notes/source-b.md']);
      const newA = result.updatedContents.get('notes/source-a.md')!;
      const newB = result.updatedContents.get('notes/source-b.md')!;
      expect(newA).toContain('[[notes/active|trust principle]]');
      expect(newB).toContain('[[notes/active|trust principle]]');

      // Disks are untouched — caller writes (#174).
      expect(await fsp.readFile(path.join(root, 'notes/source-a.md'), 'utf-8')).toBe(aOrig);
      expect(await fsp.readFile(path.join(root, 'notes/source-b.md'), 'utf-8')).toBe(bOrig);
    });

    it('apply path returns no touched paths when every accepted suggestion drifts', async () => {
      await plant('notes/active.md', '# Active\n');
      await plant('notes/source.md', '# S\nNothing relevant.\n');

      const accepted = [
        { source: 'notes/source.md', anchorText: 'missing phrase', rationale: 'r.', contextSnippet: '' },
      ];
      const result = await applyInboundSuggestions(root, 'notes/active.md', accepted);
      expect(result.applied).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.touchedPaths).toEqual([]);
      expect(result.updatedContents.size).toBe(0);
    });
  });
});
