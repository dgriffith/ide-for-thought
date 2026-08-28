/**
 * `resolveBaseUri` / `initGraph` config handling (#1891). Regression coverage
 * for the data-loss bug: `graph/index.ts` used to overwrite the WHOLE
 * `.minerva/config.json` with just `{baseUri}` on first open, destroying
 * displayName/publishTargets/etc., and its own reader conflated a corrupt
 * file with a missing one — the exact condition that triggered the
 * destructive overwrite. Now both writers share one leaf
 * (`config/project-config-store.ts`) that merges instead of replacing, and
 * throws on a corrupt file instead of silently defaulting.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initGraph } from '../../../src/main/graph/index';
import { projectContext } from '../../../src/main/project-context-types';
import { readProjectConfig } from '../../../src/main/project-config';
import { useTempDir } from '../../helpers/temp-project';

const project = useTempDir('minerva-resolve-base-uri-test-');

function configFile(root: string): string {
  return path.join(root, '.minerva', 'config.json');
}

describe('resolveBaseUri via initGraph (#1891)', () => {
  it('preserves displayName + publishTargets when coining a baseUri', async () => {
    fs.mkdirSync(path.join(project.root, '.minerva'), { recursive: true });
    fs.writeFileSync(
      configFile(project.root),
      JSON.stringify({
        displayName: 'My Thoughtbase',
        publish: { targets: [{ id: 'gh-pages', label: 'GitHub Pages' }] },
      }, null, 2),
      'utf-8',
    );

    await initGraph(projectContext(project.root));

    const cfg = readProjectConfig(project.root);
    expect(cfg.displayName).toBe('My Thoughtbase');
    expect(cfg.publish?.targets).toHaveLength(1);
    expect(typeof cfg.baseUri).toBe('string');
    expect(cfg.baseUri).toBeTruthy();
  });

  it('a corrupt config throws instead of being silently overwritten', async () => {
    fs.mkdirSync(path.join(project.root, '.minerva'), { recursive: true });
    const corrupt = '{ "displayName": "unterminated';
    fs.writeFileSync(configFile(project.root), corrupt, 'utf-8');

    await expect(initGraph(projectContext(project.root))).rejects.toThrow();

    // No field loss: the corrupt bytes are exactly as they were, not
    // replaced by a freshly-coined `{baseUri}`.
    expect(fs.readFileSync(configFile(project.root), 'utf-8')).toBe(corrupt);
  });
});
