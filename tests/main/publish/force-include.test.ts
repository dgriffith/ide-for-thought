/**
 * Per-export exclusion override (#283).
 *
 * The dialog lets the user click a row in the Excluded list to
 * re-include it. The pipeline honours that via `forceInclude` in
 * `ResolvePlanOptions`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolvePlan } from '../../../src/main/publish/pipeline';

function mkProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-force-include-'));
}

describe('forceInclude — per-export exclusion override (#283)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkProject();
    await fsp.writeFile(path.join(root, 'public.md'),
      '---\ntitle: Public\n---\n# Public\n', 'utf-8');
    await fsp.mkdir(path.join(root, 'private'), { recursive: true });
    await fsp.writeFile(path.join(root, 'private/secret.md'),
      '---\ntitle: Secret\n---\n# Secret\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'flag.md'),
      '---\ntitle: Flagged\nprivate: true\n---\n# Flagged\n', 'utf-8');
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('without forceInclude: private/ folder + private:true frontmatter excluded as usual', async () => {
    const plan = await resolvePlan(root, { kind: 'project' });
    const includedPaths = plan.inputs.map((f) => f.relativePath).sort();
    expect(includedPaths).toEqual(['public.md']);
    expect(plan.excluded.map((e) => e.relativePath).sort()).toEqual(['flag.md', 'private/secret.md']);
  });

  it('forceInclude moves a path from excluded into included with overridden:true', async () => {
    const plan = await resolvePlan(
      root,
      { kind: 'project' },
      { forceInclude: ['private/secret.md'] },
    );
    const paths = plan.inputs.map((f) => f.relativePath).sort();
    expect(paths).toEqual(['private/secret.md', 'public.md']);
    const overridden = plan.inputs.find((f) => f.relativePath === 'private/secret.md');
    expect(overridden?.overridden).toBe(true);
    // The other included file is *not* overridden — it was always included.
    const normal = plan.inputs.find((f) => f.relativePath === 'public.md');
    expect(normal?.overridden).toBe(false);
    // And it's no longer in the excluded list.
    expect(plan.excluded.map((e) => e.relativePath)).not.toContain('private/secret.md');
  });

  it('forceInclude can re-include multiple paths in one export', async () => {
    const plan = await resolvePlan(
      root,
      { kind: 'project' },
      { forceInclude: ['private/secret.md', 'flag.md'] },
    );
    const paths = plan.inputs.map((f) => f.relativePath).sort();
    expect(paths).toEqual(['flag.md', 'private/secret.md', 'public.md']);
    expect(plan.excluded).toEqual([]);
    expect(plan.inputs.find((f) => f.relativePath === 'flag.md')?.overridden).toBe(true);
    expect(plan.inputs.find((f) => f.relativePath === 'private/secret.md')?.overridden).toBe(true);
  });

  it('forceInclude on a path that was never excluded leaves overridden as false', async () => {
    const plan = await resolvePlan(
      root,
      { kind: 'project' },
      { forceInclude: ['public.md'] },
    );
    const pub = plan.inputs.find((f) => f.relativePath === 'public.md');
    expect(pub?.overridden).toBe(false);
  });

  // ── #293 — manual per-note deselection mirror ─────────────────────────

  it('forceExclude moves an included path into excluded with reason "manually excluded"', async () => {
    const plan = await resolvePlan(
      root,
      { kind: 'project' },
      { forceExclude: ['public.md'] },
    );
    expect(plan.inputs.map((f) => f.relativePath)).not.toContain('public.md');
    const manual = plan.excluded.find((e) => e.relativePath === 'public.md');
    expect(manual).toBeDefined();
    expect(manual!.reason).toBe('manually excluded');
  });

  it('forceExclude is independent of forceInclude — different paths each list', async () => {
    const plan = await resolvePlan(
      root,
      { kind: 'project' },
      {
        forceInclude: ['private/secret.md'], // re-include a private one
        forceExclude: ['public.md'],          // drop the only normal one
      },
    );
    const includedPaths = plan.inputs.map((f) => f.relativePath).sort();
    expect(includedPaths).toEqual(['private/secret.md']);
    const excludedPaths = plan.excluded.map((e) => e.relativePath).sort();
    expect(excludedPaths).toContain('flag.md'); // still excluded by default rules
    expect(excludedPaths).toContain('public.md'); // manually excluded
  });

  it('tree mode honours forceExclude — a reachable note can be deselected', async () => {
    await fsp.writeFile(path.join(root, 'tree-root.md'),
      '---\ntitle: Root\n---\n# Root\n\n[[public]]\n', 'utf-8');
    const plan = await resolvePlan(
      root,
      { kind: 'tree', relativePath: 'tree-root.md', maxDepth: 2 },
      { forceExclude: ['public.md'] },
    );
    expect(plan.inputs.map((f) => f.relativePath)).not.toContain('public.md');
    const manual = plan.excluded.find((e) => e.relativePath === 'public.md');
    expect(manual?.reason).toBe('manually excluded');
  });

  it('forceExclude on a non-included path is a silent no-op', async () => {
    // The default rules already exclude flag.md; force-excluding it
    // should not double-add to excluded or otherwise misbehave.
    const plan = await resolvePlan(
      root,
      { kind: 'project' },
      { forceExclude: ['flag.md', 'nonexistent.md'] },
    );
    // flag.md is in excluded once, with the original reason (private:
    // true via frontmatter), not "manually excluded".
    const flag = plan.excluded.filter((e) => e.relativePath === 'flag.md');
    expect(flag).toHaveLength(1);
    expect(flag[0].reason).not.toBe('manually excluded');
    // nonexistent.md doesn't appear at all.
    expect(plan.excluded.find((e) => e.relativePath === 'nonexistent.md')).toBeUndefined();
  });

  it('tree mode honours forceInclude for an otherwise-private linked note', async () => {
    await fsp.writeFile(path.join(root, 'root.md'),
      '---\ntitle: Root\n---\n# Root\n\n[[private/secret]]\n', 'utf-8');
    // Re-write secret to be reachable in the tree.
    const planWithoutOverride = await resolvePlan(
      root,
      { kind: 'tree', relativePath: 'root.md', maxDepth: 2 },
    );
    expect(planWithoutOverride.inputs.map((f) => f.relativePath)).not.toContain('private/secret.md');

    const planWithOverride = await resolvePlan(
      root,
      { kind: 'tree', relativePath: 'root.md', maxDepth: 2 },
      { forceInclude: ['private/secret.md'] },
    );
    const secret = planWithOverride.inputs.find((f) => f.relativePath === 'private/secret.md');
    expect(secret).toBeDefined();
    expect(secret?.overridden).toBe(true);
  });
});
