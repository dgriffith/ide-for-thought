/**
 * Skill-eval harness — the deterministic guard (#1522, PR 1).
 *
 * The harness packages a skill's LLM request exactly the way Minerva does at
 * runtime (context assembly → prompt packaging). That packaged request
 * (`output/request.json`) is *deterministic*: same skill + same context + same
 * params ⇒ identical bytes. So the committed `request.json` doubles as a golden
 * snapshot — this test re-packages every case and asserts byte-equality, with NO
 * LLM call and NO API key. It extends `tests/main/skills-analysis.test.ts`'s
 * "the prompt renders" guarantee to the whole context→packaging path, catching a
 * prompt, context-pipeline, or model-resolution regression across the catalog.
 *
 * To intentionally change a case (edit a skill, a fixture note, or the harness),
 * regenerate with `pnpm cli eval --all` and commit the resulting diff.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runEval } from '../../src/cli/eval';
import { jsonStringify } from '../../src/cli/json';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CASES_DIR = path.join(REPO_ROOT, 'tests', 'skills-eval');

/** Committed case dirs (each with an `input/case.json`), as repo-relative paths
 *  the CLI would accept. */
function committedCases(): string[] {
  return fs
    .readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(CASES_DIR, e.name, 'input', 'case.json')))
    .map((e) => path.join('tests', 'skills-eval', e.name))
    .sort();
}

describe('skill-eval harness — deterministic request.json (#1522)', () => {
  const cases = committedCases();

  it('ships at least one case spanning one-shot + conversation skills', () => {
    expect(cases.length).toBeGreaterThanOrEqual(2);
  });

  it.each(cases)('%s re-packages byte-identically to its committed request.json', async (rel) => {
    // write:false — package in memory, never mutating the committed golden.
    const [result] = await runEval([rel], { cwd: REPO_ROOT, write: false });
    expect(result).toBeDefined();

    const produced = `${jsonStringify(result!.request, true)}\n`;
    const golden = fs.readFileSync(path.join(REPO_ROOT, rel, 'output', 'request.json'), 'utf-8');

    // The packaged prompt is what Minerva would send — assert it exactly. A diff
    // here means a skill/context/model change; regenerate with `pnpm cli eval --all`.
    expect(produced).toBe(golden);

    // Sanity: the packaged request actually carries a user message.
    expect(result!.request.messages[0]?.content.length ?? 0).toBeGreaterThan(0);
  });
});
