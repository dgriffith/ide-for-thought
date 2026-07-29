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

// Each provider SDK is confined to its own implementation file. A real
// import/require (not a passing mention in a comment — types.ts names Anthropic
// in prose while importing nothing) anywhere else breaks the seam. As providers
// are added (BYOM #1492) each SDK gets a row here.
const SDKS: { name: string; importRe: RegExp; sanctioned: string }[] = [
  {
    name: '@anthropic-ai/sdk',
    importRe: /(?:from|require\()\s*['"]@anthropic-ai\/sdk['"]/,
    sanctioned: path.join('src', 'main', 'llm', 'provider', 'anthropic.ts'),
  },
  {
    name: 'openai',
    importRe: /(?:from|require\()\s*['"]openai(?:\/[^'"]*)?['"]/,
    sanctioned: path.join('src', 'main', 'llm', 'provider', 'openai.ts'),
  },
  {
    name: '@google/genai',
    importRe: /(?:from|require\()\s*['"]@google\/genai['"]/,
    sanctioned: path.join('src', 'main', 'llm', 'provider', 'google.ts'),
  },
];

const NON_PROVIDER_FILES = [
  path.join('src', 'main', 'llm', 'index.ts'),
  path.join('src', 'main', 'llm', 'tools', 'registry.ts'),
  path.join('src', 'main', 'llm', 'tools', 'types.ts'),
];

describe('provider seam (#1148, BYOM #1492)', () => {
  const files = collectTsFiles(srcRoot);
  const importersOf = (re: RegExp) =>
    files
      .filter((f) => re.test(fs.readFileSync(f, 'utf-8')))
      .map((f) => path.relative(repoRoot, f))
      .sort();

  for (const sdk of SDKS) {
    it(`confines ${sdk.name} to its single provider implementation`, () => {
      expect(importersOf(sdk.importRe)).toEqual([sdk.sanctioned]);
    });
  }

  it('does not let any provider SDK leak into tool definitions or the agentic loop', () => {
    // Belt-and-braces: name the files that must never import a provider SDK, so
    // a reader of a failure sees *where* the seam broke, not just a count.
    for (const sdk of SDKS) {
      const importers = importersOf(sdk.importRe);
      for (const f of NON_PROVIDER_FILES) expect(importers).not.toContain(f);
    }
  });
});
