/**
 * Unreferenced-image inspection (#1799). `findOrphanedInlineAssets`
 * (asset-references.test.ts) owns the detection logic; this covers the
 * `Inspection` shape this check produces — message, severity, quick-fix —
 * and that it's wired into `runAllChecks`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { runAllChecks } from '../../../src/main/graph/health-checks';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const ASSET_DIR = '.minerva/assets/inline';

describe('checkUnreferencedImages (#1799)', () => {
  const project = useGraphProject('minerva-unref-image-');
  let root: string;
  let ctx: ProjectContext;

  beforeEach(() => {
    root = project.root;
    ctx = project.ctx;
  });

  async function writeFile(relativePath: string, content: string): Promise<void> {
    const abs = path.join(root, relativePath);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf-8');
  }

  it('flags an orphaned asset with a sized message and a delete-asset fix', async () => {
    const relativePath = `${ASSET_DIR}/abc123-dead.png`;
    await writeFile(relativePath, 'x'.repeat(2048));

    const inspections = await runAllChecks(ctx);
    const found = inspections.filter((i) => i.type === 'unreferenced_image');

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      type: 'unreferenced_image',
      severity: 'info',
      nodeLabel: 'abc123-dead.png',
      fix: { kind: 'delete-asset', label: 'Delete image', assetPath: relativePath },
    });
    expect(found[0]!.message).toContain('abc123-dead.png');
    expect(found[0]!.message).toContain('2 KB');
  });

  it('does not flag a referenced asset', async () => {
    const relativePath = `${ASSET_DIR}/abc123-live.png`;
    await writeFile(relativePath, 'bytes');
    await writeFile('notes/a.md', `![](${relativePath})`);

    const inspections = await runAllChecks(ctx);
    expect(inspections.filter((i) => i.type === 'unreferenced_image')).toEqual([]);
  });

  it('is skipped when the check is disabled', async () => {
    await writeFile(`${ASSET_DIR}/abc123-dead.png`, 'x');

    const inspections = await runAllChecks(ctx, {
      disabled: ['unreferenced_image'],
      staleDays: 30,
      stubDays: 30,
    });
    expect(inspections.filter((i) => i.type === 'unreferenced_image')).toEqual([]);
  });
});
