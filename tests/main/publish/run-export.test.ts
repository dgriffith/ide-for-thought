import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { registerExporter, _clearRegistry } from '../../../src/main/publish/registry';
import { markdownExporter } from '../../../src/main/publish/exporters/markdown';
import { runExport } from '../../../src/main/publish/run-export';

function mkTemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('runExport (#282)', () => {
  let root: string;
  let outputDir: string;

  beforeEach(async () => {
    _clearRegistry();
    registerExporter(markdownExporter);
    root = mkTemp('minerva-run-export-src-');
    outputDir = mkTemp('minerva-run-export-dst-');
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(outputDir, { recursive: true, force: true });
    _clearRegistry();
  });

  it('writes every included note to disk under outputDir and returns a summary', async () => {
    await fsp.mkdir(path.join(root, 'private'), { recursive: true });
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, 'private/secret.md'), '# Secret\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'notes/public.md'), '# Public\n', 'utf-8');

    const result = await runExport(root, {
      exporterId: 'markdown',
      input: { kind: 'project' },
      outputDir,
    });

    expect(result.filesWritten).toBe(1);
    expect(result.summary).toBe('1 note exported (1 excluded).');
    expect(result.outputDir).toBe(path.resolve(outputDir));

    // End-to-end acceptance from #246: the private file really doesn't exist
    // in the exported tree.
    expect(fs.existsSync(path.join(outputDir, 'notes/public.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'private/secret.md'))).toBe(false);
  });

  it('rejects the export when an exporter tries to write outside outputDir', async () => {
    const attackerExporter = {
      id: 'attacker',
      label: 'Bad',
      accepts: () => true,
      async run() {
        return {
          files: [{ path: '../escape.md', contents: 'oops' }],
          summary: 'done',
        };
      },
    };
    registerExporter(attackerExporter);
    await fsp.writeFile(path.join(root, 'note.md'), '# x\n', 'utf-8');

    await expect(
      runExport(root, {
        exporterId: 'attacker',
        input: { kind: 'project' },
        outputDir,
      }),
    ).rejects.toThrow(/outside the output directory/i);
    // And no files should have landed.
    expect(fs.readdirSync(outputDir)).toEqual([]);
  });

  it('throws a clear error for an unregistered exporter id', async () => {
    await expect(
      runExport(root, { exporterId: 'nope', input: { kind: 'project' }, outputDir }),
    ).rejects.toThrow(/No exporter registered/);
  });

  it('creates nested output directories as needed', async () => {
    await fsp.mkdir(path.join(root, 'deep/sub/dir'), { recursive: true });
    await fsp.writeFile(path.join(root, 'deep/sub/dir/note.md'), '# Deep\n', 'utf-8');
    await runExport(root, { exporterId: 'markdown', input: { kind: 'project' }, outputDir });
    expect(fs.existsSync(path.join(outputDir, 'deep/sub/dir/note.md'))).toBe(true);
  });
});
