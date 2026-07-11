/**
 * The provider seam invariant (#1148, epic #1145 — Substrate).
 *
 * The whole point of the seam is that the conversation layer — the agentic loop,
 * tool dispatch, the approval gate, the skills — talks to the `LLMProvider`
 * interface, never to Claude directly. That property is only true if exactly one
 * file imports `@anthropic-ai/sdk`. If a future change reaches for the SDK from
 * the loop or a tool again (the easy, tempting shortcut), this test fails so the
 * regression is caught at CI rather than discovered when a second provider is
 * attempted and the "clean seam" turns out to have quietly rotted.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const srcRoot = path.join(repoRoot, 'src');

/** Recursively collect every .ts file under a directory. */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// Match a real import/require of the SDK, not a passing mention in a comment
// (types.ts, for instance, names it in prose while importing nothing from it).
const SDK_IMPORT = /(?:from|require\()\s*['"]@anthropic-ai\/sdk['"]/;
// The single sanctioned home of the SDK. Everything Claude-specific lives here.
const SANCTIONED = path.join('src', 'main', 'llm', 'provider', 'anthropic.ts');

describe('provider seam (#1148)', () => {
  const importers = collectTsFiles(srcRoot)
    .filter((f) => SDK_IMPORT.test(fs.readFileSync(f, 'utf-8')))
    .map((f) => path.relative(repoRoot, f))
    .sort();

  it('confines the Anthropic SDK to the single provider implementation', () => {
    expect(importers).toEqual([SANCTIONED]);
  });

  it('does not let the SDK leak into tool definitions or the agentic loop', () => {
    // Belt-and-braces: name the two files that used to import the SDK, so a
    // reader of a failure sees *where* the seam broke, not just a count.
    expect(importers).not.toContain(path.join('src', 'main', 'llm', 'index.ts'));
    expect(importers).not.toContain(path.join('src', 'main', 'llm', 'tools', 'registry.ts'));
    expect(importers).not.toContain(path.join('src', 'main', 'llm', 'tools', 'types.ts'));
  });
});
