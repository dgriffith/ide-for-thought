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
