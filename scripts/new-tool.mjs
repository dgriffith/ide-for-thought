#!/usr/bin/env node
/**
 * Scaffold a new ThinkingTool definition (#511).
 *
 *   pnpm new-tool <category> <id> [--with-params]
 *
 * Generates:
 *   - src/shared/tools/definitions/<category>/<id>.ts        (registerTool stub)
 *   - src/shared/tools/definitions/<category>/<id>.prompt.md (placeholder body)
 *
 * And appends the side-effect import to
 *   src/shared/tools/definitions/index.ts
 *
 * The script is intentionally dumb: it generates a minimal stub matching the
 * conventions in the existing tools (no parameters by default; `--with-params`
 * adds a single example parameter you can edit). Edit the resulting files
 * to flesh out the prompt and any per-tool logic.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const definitionsRoot = resolve(projectRoot, 'src/shared/tools/definitions');
const indexFile = resolve(definitionsRoot, 'index.ts');

const VALID_CATEGORIES = new Set(['learning', 'research', 'analysis']);
const KEBAB_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;

function fail(msg) {
  console.error(`new-tool: ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const [category, id] = positional;

if (!category || !id) {
  fail('usage: pnpm new-tool <category> <id> [--with-params]');
}
if (!VALID_CATEGORIES.has(category)) {
  fail(`unknown category "${category}". Valid: ${[...VALID_CATEGORIES].join(', ')}.`);
}
if (!KEBAB_RE.test(id)) {
  fail(`id "${id}" must be kebab-case (lowercase letters, digits, hyphens; not leading/trailing hyphen).`);
}

const tsPath = resolve(definitionsRoot, category, `${id}.ts`);
const promptPath = resolve(definitionsRoot, category, `${id}.prompt.md`);

if (existsSync(tsPath)) fail(`already exists: ${relative(projectRoot, tsPath)}`);
if (existsSync(promptPath)) fail(`already exists: ${relative(projectRoot, promptPath)}`);

const withParams = flags.has('--with-params');

// Title-case the id for the human-readable name. "find-prerequisites" → "Find Prerequisites".
const humanName = id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const fullId = `${category}.${id}`;

const tsBody = `import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './${id}.prompt.md?raw';

registerTool({
  id: '${fullId}',
  name: '${humanName}',
  category: '${category}',
  description: 'TODO short user-facing description (~80 chars).',
  longDescription:
    'TODO 1-3 sentence longer description shown in the ToolPanel. Explain ' +
    'what the tool produces and when to reach for it.',
  context: ['fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },${withParams ? `
  parameters: [
    {
      id: 'example',
      label: 'Example parameter',
      type: 'select',
      options: [
        { label: 'Option A', value: 'a' },
        { label: 'Option B', value: 'b' },
      ],
      defaultValue: 'a',
      required: true,
    },
  ],` : ''}
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const noteBlock = ctx.fullNoteContent
      ? \`\\n\\n## Note\${ctx.fullNoteTitle ? \` — \${ctx.fullNoteTitle}\` : ''}\\n\\n\${ctx.fullNoteContent}\`
      : '';${withParams ? `
    const example = ctx.parameterValues?.example ?? 'a';
    return \`\${SYSTEM_PROMPT}\\n\\nMode: \${example}.\${noteBlock}\`;` : `
    return SYSTEM_PROMPT + noteBlock;`}
  },
  buildFirstMessage: () => 'TODO first user-turn text (or empty string for no auto-send).',
});
`;

const promptBody = `You are TODO — describe the role and the one-paragraph framing of what this tool does.

Open the response with the most useful payload first; iterate from there if the user redirects.

Use web search when an external fact would meaningfully ground the result. Don't pad. Don't invent results when the source genuinely yields nothing — say so.
`;

mkdirSync(dirname(tsPath), { recursive: true });
writeFileSync(tsPath, tsBody, 'utf-8');
writeFileSync(promptPath, promptBody, 'utf-8');

// Append the side-effect import to the index aggregator. We try to land it
// in the right category section by matching the existing comment headers.
const indexSrc = readFileSync(indexFile, 'utf-8');
const importLine = `import './${category}/${id}';`;
if (indexSrc.includes(importLine)) {
  // shouldn't happen — file existence check would have caught it — but
  // guard anyway so re-running is idempotent.
  console.log(`[new-tool] index.ts already imports ${importLine}; skipping`);
} else {
  const sectionRe = new RegExp(`(// ${category[0].toUpperCase()}${category.slice(1)} tools[\\s\\S]*?)((?:\\n\\n|\\n$|$))`, 'i');
  const m = indexSrc.match(sectionRe);
  let nextSrc;
  if (m) {
    nextSrc = indexSrc.replace(sectionRe, `$1\n${importLine}$2`);
  } else {
    // No section header — append at the end with a header.
    nextSrc = indexSrc.trimEnd()
      + `\n\n// ${category[0].toUpperCase()}${category.slice(1)} tools\n${importLine}\n`;
  }
  writeFileSync(indexFile, nextSrc, 'utf-8');
}

console.log('new-tool: scaffolded');
console.log(`  ${relative(projectRoot, tsPath)}`);
console.log(`  ${relative(projectRoot, promptPath)}`);
console.log(`  index.ts: import './${category}/${id}'`);
console.log('\nEdit the prompt body, fill in the TODO description fields, then run `pnpm lint` to verify.');
