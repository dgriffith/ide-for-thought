/**
 * What the Proposals panel shows for a plugin an agent wrote (#2890): the
 * manifest, its capabilities in words, its servers and every file; for an
 * edit, what it gains (a hostile draft asking for more says so first) and a
 * line diff of each changed file.
 */
import { describe, it, expect } from 'vitest';
import { pluginPayloadReview, pluginPayloadSummary } from '../../../src/renderer/lib/proposals/plugin-review';
import { buildEscalatingDraftUpdate } from '../../helpers/hostile-plugins';

const manifest = (extra: Record<string, unknown> = {}) => JSON.stringify({ id: 'lab', name: 'Lab', version: '0.1.0', description: 'A lab.', ...extra });
const install = (files: { path: string; content: string }[]) => ({ kind: 'plugin-install' as const, id: 'lab', name: 'Lab', files });

describe('a plugin install, reviewed (#2890)', () => {
  it('shows what it can do in words, its servers, and every file', () => {
    const p = install([
      { path: 'plugin.json', content: manifest({ code: { capabilities: ['notes:read', 'llm:propose'] }, mcpServers: { words: { command: 'node', args: ['server/index.js'] } } }) },
      { path: 'logic.js', content: 'export const CANARY = 1;\n' },
    ]);
    expect(pluginPayloadSummary(p)).toBe('install Lab (lab), 2 files');
    const review = pluginPayloadReview(p);
    expect(review.split('\n').slice(0, 4)).toEqual([
      'Lab 0.1.0: A lab.',
      'It can read the notes Minerva hands its views and commands; and ask the assistant for changes, which you review as proposals.',
      'Approving it, Minerva then asks you to allow its code.',
      'MCP server words: node server/index.js (off until you switch it on)',
    ]);
    expect(review).toContain('── plugin.json ──');
    expect(review).toContain('── logic.js ──\nexport const CANARY = 1;');
  });

  it('a plugin with no code says it runs none', () => {
    expect(pluginPayloadReview(install([{ path: 'plugin.json', content: manifest() }]))).toMatch(/^Lab 0\.1\.0: A lab\.\nIt runs no code\./);
  });
});

describe('a plugin edit, reviewed (#2890)', () => {
  it('the escalating update from the corpus says what it gains before any file', () => {
    const { before, files } = buildEscalatingDraftUpdate();
    const review = pluginPayloadReview({ kind: 'plugin-update', id: 'lab', name: 'Lab', files, before });
    expect(review.split('\n').slice(0, 5)).toEqual([
      'Lab 0.1.1: A lab. Fixes a typo.',
      expect.stringMatching(/^It can read the notes/),
      'Approving it, Minerva then asks you to allow its code.',
      'Version 0.1.0 → 0.1.1.',
      'Now it can also: create notes, and change the notes it was given; ask the assistant for changes, which you review as proposals.',
    ]);
  });

  it('a hostile edit asking for more leads with what it gains, then diffs each file', () => {
    const before = [{ path: 'plugin.json', content: manifest() }, { path: 'skills/w.md', content: 'one\ntwo\n' }, { path: 'old.md', content: 'x' }];
    const files = [
      { path: 'plugin.json', content: manifest({ version: '0.2.0', code: { capabilities: ['notes:write'] } }) },
      { path: 'skills/w.md', content: 'one\nTWO\n' },
      { path: 'logic.js', content: 'export {};' },
    ];
    const p = { kind: 'plugin-update' as const, id: 'lab', name: 'Lab', files, before };
    expect(pluginPayloadSummary(p)).toBe('change Lab (lab): 2 changed, 1 added, 1 removed');
    const review = pluginPayloadReview(p);
    expect(review).toContain('Version 0.1.0 → 0.2.0.');
    expect(review).toContain('Now it can also: create notes, and change the notes it was given.');
    expect(review).toContain("It didn't run code before; now it does.");
    expect(review).toContain('── skills/w.md (changed) ──\n  one\n- two\n+ TWO');
    expect(review).toContain('── logic.js (new) ──\n+ export {};');
    expect(review).toContain('── old.md (removed) ──\n- x');
    expect(review.indexOf('Now it can also')).toBeLessThan(review.indexOf('──'));
  });
});
