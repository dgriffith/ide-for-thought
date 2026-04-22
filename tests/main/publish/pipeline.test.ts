import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';
import { markdownExporter } from '../../../src/main/publish/exporters/markdown';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-publish-test-'));
}

describe('resolvePlan (#246)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('walks the project and loads every non-private .md into the plan', async () => {
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, 'notes/foo.md'), '---\ntitle: Foo\n---\n\n# Foo\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'notes/bar.md'), '# Bar\n\nbody.\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'project' });
    expect(plan.inputs.map((f) => f.relativePath).sort()).toEqual(['notes/bar.md', 'notes/foo.md']);
    expect(plan.excluded).toEqual([]);
  });

  it('excludes private/secret.md but keeps notes/public.md', async () => {
    await fsp.mkdir(path.join(root, 'private'), { recursive: true });
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, 'private/secret.md'), '# Secret\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'notes/public.md'), '# Public\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'project' });
    expect(plan.inputs.map((f) => f.relativePath)).toEqual(['notes/public.md']);
    expect(plan.excluded).toEqual([
      { relativePath: 'private/secret.md', reason: 'under private/' },
    ]);
  });

  it('picks up frontmatter-title, H1, or filename stem as the title (in that order)', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '---\ntitle: "A from FM"\n---\n\n# Different H1\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'b.md'), '# H1 for B\n\nbody\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'c-from-stem.md'), 'No header at all.\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'project' });
    const titleByPath = new Map(plan.inputs.map((f) => [f.relativePath, f.title]));
    expect(titleByPath.get('a.md')).toBe('A from FM');
    expect(titleByPath.get('b.md')).toBe('H1 for B');
    expect(titleByPath.get('c-from-stem.md')).toBe('c-from-stem');
  });

  it('ignores hidden and node_modules directories', async () => {
    await fsp.mkdir(path.join(root, '.obsidian'), { recursive: true });
    await fsp.mkdir(path.join(root, 'node_modules/sub'), { recursive: true });
    await fsp.writeFile(path.join(root, '.obsidian/x.md'), '# x\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'node_modules/sub/y.md'), '# y\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'visible.md'), '# v\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'project' });
    expect(plan.inputs.map((f) => f.relativePath)).toEqual(['visible.md']);
  });

  it('single-note input loads exactly that file', async () => {
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, 'notes/one.md'), '# One\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'notes/two.md'), '# Two\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'notes/one.md' });
    expect(plan.inputs.map((f) => f.relativePath)).toEqual(['notes/one.md']);
  });

  it('default link + asset policies are inline-title + keep-relative', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '# A\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'project' });
    expect(plan.linkPolicy).toBe('inline-title');
    expect(plan.assetPolicy).toBe('keep-relative');
  });
});

describe('markdownExporter end-to-end (#246)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('writes one file per included note, excluding private/*.md, with links rewritten', async () => {
    await fsp.mkdir(path.join(root, 'private'), { recursive: true });
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(
      path.join(root, 'private/secret.md'),
      '---\ntitle: Top secret\n---\n\nDo not publish.\n',
      'utf-8',
    );
    await fsp.writeFile(
      path.join(root, 'notes/public.md'),
      '---\ntitle: Public\n---\n\n# Public\n\nSee [[notes/other]] for details.\n',
      'utf-8',
    );
    await fsp.writeFile(
      path.join(root, 'notes/other.md'),
      '---\ntitle: Other\n---\n\n# Other\n\nbody\n',
      'utf-8',
    );

    const plan = await resolvePlan(root, { kind: 'project' }, { linkPolicy: 'follow-to-file' });
    const output = await runExporter(markdownExporter, plan);

    // Integration acceptance: private/secret.md is NOT in the output,
    // but IS recorded in the plan's excluded list.
    expect(output.files.map((f) => f.path).sort()).toEqual(['notes/other.md', 'notes/public.md']);
    expect(plan.excluded.map((e) => e.relativePath)).toEqual(['private/secret.md']);

    const publicOut = output.files.find((f) => f.path === 'notes/public.md')!;
    expect(publicOut.contents).toContain('See [Other](notes/other.md) for details.');
    expect(publicOut.contents).toContain('---');
    expect(publicOut.contents).toContain('title: Public');
  });

  it('summary string reflects included + excluded counts', async () => {
    await fsp.mkdir(path.join(root, 'private'), { recursive: true });
    await fsp.writeFile(path.join(root, 'a.md'), '# A\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'private/b.md'), '# B\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(markdownExporter, plan);
    expect(output.summary).toBe('1 note exported (1 excluded).');
  });
});
