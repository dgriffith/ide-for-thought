/**
 * @vitest-environment node
 *
 * A drafted skill or plugin is checked before the user sees it (#2652), with
 * the same parser and manifest checker Settings uses, and with paths that can
 * only name files inside the draft. A draft that fails comes back to the
 * model with every problem; nothing reaches a card.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { checkExtensionDraft } from '../../../src/main/extensions/draft-check';
import { draftPathProblem, EXTENSION_DRAFT_LIMITS } from '../../../src/shared/extensions/drafts';

const CTX = { appVersion: '4.0.0', takenSkillIds: new Set(['analysis.steelman']) };
const SKILL = '---\nid: my.weekly\nname: Weekly Review\ndescription: Review the week\nmenu: Analysis\noutputMode: openConversation\n---\nHelp me review my week.\n';
const WORD_TOOLS = path.resolve(__dirname, '../../fixtures/plugins/word-tools');
const fixtureFiles = (dir: string, rel = ''): { path: string; content: string }[] =>
  fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((d) => {
    const p = rel ? `${rel}/${d.name}` : d.name;
    return d.isDirectory() ? fixtureFiles(dir, p) : [{ path: p, content: fs.readFileSync(path.join(dir, p), 'utf-8') }];
  });
const check = (input: object) => checkExtensionDraft({ summary: 'Adds a thing.', ...input }, CTX);
const problems = (input: object) => {
  const r = check(input);
  return r.ok ? [] : r.problems;
};

describe('draftPathProblem (#2652)', () => {
  it.each(['plugin.json', 'skills/x.md', 'server/index.js', 'tests/__init__.py', 'a/b/c.txt'])('accepts %s', (p) => {
    expect(draftPathProblem(p)).toBeNull();
  });
  it.each(['', '../x', 'a/../b', '/etc/passwd', '.minerva/x', 'a/.git/config', 'a\\b', 'C:x', '-rf', 'a//b', 'a/', `${'a/'.repeat(6)}x`, 'x'.repeat(201)])('refuses %j', (p) => {
    expect(draftPathProblem(p)).not.toBeNull();
  });
});

describe('a skill draft (#2652)', () => {
  it.each(['weekly.md', 'weekly/SKILL.md'])('is one file (%s) that parses', (p) => {
    expect(check({ kind: 'skill', files: [{ path: p, content: SKILL }] })).toEqual({
      ok: true,
      draft: { kind: 'skill', id: 'my.weekly', name: 'Weekly Review', summary: 'Adds a thing.', files: [{ path: p, content: SKILL }] },
    });
  });

  it.each([
    ['two files', [{ path: 'a.md', content: SKILL }, { path: 'b.md', content: SKILL }], /A skill is one file/],
    ['not markdown', [{ path: 'a.txt', content: SKILL }], /A skill is one file/],
    ['nested too deep', [{ path: 'a/b/SKILL.md', content: SKILL }], /A skill is one file/],
    ['a body-less skill', [{ path: 'a.md', content: '---\nname: X\n---\n' }], /a\.md: /],
    ['a taken id', [{ path: 'a.md', content: SKILL.replace('my.weekly', 'analysis.steelman') }], /"analysis\.steelman" already exists/],
    ['an MCP tool from a skill that isn\'t a plugin\'s', [{ path: 'a.md', content: SKILL.replace('---\nHelp', 'tools: [mcp:words]\n---\nHelp') }], /only a plugin's skills can name MCP tools/],
  ])('refuses %s', (_what, files, msg) => {
    expect(problems({ kind: 'skill', files }).join('\n')).toMatch(msg);
  });
});

describe('a plugin draft (#2652)', () => {
  const files = fixtureFiles(WORD_TOOLS);

  it('accepts the Word Tools example, naming its servers', () => {
    const r = check({ kind: 'plugin', files });
    expect(r.ok && { id: r.draft.id, name: r.draft.name, mcpServers: r.draft.mcpServers }).toEqual({ id: 'word-tools', name: 'Word Tools', mcpServers: ['words'] });
  });

  const without = (p: string) => files.filter((f) => f.path !== p);
  const editManifest = (fn: (m: Record<string, unknown>) => void) => files.map((f) => {
    if (f.path !== 'plugin.json') return f;
    const m = JSON.parse(f.content) as Record<string, unknown>;
    fn(m);
    return { path: f.path, content: JSON.stringify(m) };
  });

  it.each([
    ['no plugin.json', () => without('plugin.json'), /needs a plugin\.json/],
    ['a plugin.json that isn\'t JSON', () => files.map((f) => (f.path === 'plugin.json' ? { ...f, content: '{' } : f)), /isn't valid JSON/],
    ['a manifest the checker refuses', () => editManifest((m) => { m.id = 'Bad_Id'; }), /plugin\.json: "id" must be lowercase/],
    ['an unknown manifest field', () => editManifest((m) => { m.extra = 1; }), /plugin\.json: .*extra/],
    ['a contribution that isn\'t in the draft', () => without('skills/word-count.md'), /contributes "skills\/word-count\.md" \(skills\), but there's no such file/],
    ['a server whose script isn\'t in the draft', () => without('server/index.js'), /runs "server\/index\.js", which isn't in the draft/],
    ['a skill naming a server the plugin doesn\'t ship', () => files.map((f) => (f.path === 'skills/word-count.md' ? { ...f, content: f.content.replace('mcp:words/count_words', 'mcp:other') } : f)), /ships no MCP server "other"/],
    ['a skill whose id is taken', () => files.map((f) => (f.path === 'skills/word-count.md' ? { ...f, content: f.content.replace('word-tools.word-count', 'analysis.steelman') } : f)), /"analysis\.steelman" already exists/],
  ])('refuses %s', (_what, make, msg) => {
    expect(problems({ kind: 'plugin', files: make() }).join('\n')).toMatch(msg);
  });
});

describe('every draft (#2652)', () => {
  const one = [{ path: 'a.md', content: SKILL }];
  it.each([
    ['an unknown kind', { kind: 'script', files: one }, /"kind" must be skill or plugin/],
    ['no summary', { kind: 'skill', files: one, summary: '  ' }, /"summary" must say/],
    ['a long summary', { kind: 'skill', files: one, summary: 'x'.repeat(EXTENSION_DRAFT_LIMITS.summary + 1) }, /"summary" is at most/],
    ['no files', { kind: 'skill', files: [] }, /at least one file/],
    ['a file that isn\'t { path, content }', { kind: 'skill', files: [{ path: 'a.md' }] }, /Each file must be/],
    ['a path out of the draft', { kind: 'plugin', files: [{ path: '../plugin.json', content: '{}' }] }, /must be a relative path of plain names/],
    ['one file twice, in two cases', { kind: 'plugin', files: [{ path: 'A.md', content: '' }, { path: 'a.md', content: '' }] }, /"a\.md" is listed twice/],
    ['a big file', { kind: 'skill', files: [{ path: 'a.md', content: 'x'.repeat(EXTENSION_DRAFT_LIMITS.fileBytes + 1) }] }, /at most 64 KB a file/],
    ['too many files', { kind: 'plugin', files: Array.from({ length: EXTENSION_DRAFT_LIMITS.files + 1 }, (_, i) => ({ path: `f${i}.txt`, content: '' })) }, /At most 40 files/],
    ['too much in all', { kind: 'plugin', files: Array.from({ length: 9 }, (_, i) => ({ path: `f${i}.txt`, content: 'x'.repeat(60 * 1024) })) }, /at most 512 KB in all/],
  ])('refuses %s', (_what, input, msg) => {
    expect(problems(input).join('\n')).toMatch(msg);
  });

  it('refuses input that isn\'t an object', () => {
    expect(checkExtensionDraft(null, CTX)).toEqual({ ok: false, problems: ['"kind" must be skill or plugin.'] });
  });
});
