/**
 * Shared `.minerva/config.json` read/patch leaf (#1891). The bug this closes:
 * `graph/index.ts` used to have its own reader/writer and `writeConfig`
 * replaced the WHOLE file with `{baseUri}`, destroying displayName /
 * publishTargets / etc. the moment `resolveBaseUri` ran on a project that
 * already had other config fields. Worse, its reader's `catch { return null }`
 * treated a corrupt file the same as a missing one — exactly the case that
 * triggered the destructive overwrite.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readRawProjectConfig, patchRawProjectConfig } from '../../../src/main/config/project-config-store';
import { useTempDir } from '../../helpers/temp-project';

const project = useTempDir('minerva-project-config-store-test-');

function configFile(root: string): string {
  return path.join(root, '.minerva', 'config.json');
}

describe('readRawProjectConfig (#1891)', () => {
  it('returns {} when the file is missing', () => {
    expect(readRawProjectConfig(project.root)).toEqual({});
  });

  it('throws on a corrupt file instead of returning {}', () => {
    fs.mkdirSync(path.join(project.root, '.minerva'), { recursive: true });
    fs.writeFileSync(configFile(project.root), '{ not valid json', 'utf-8');
    expect(() => readRawProjectConfig(project.root)).toThrow();
  });
});

describe('patchRawProjectConfig (#1891)', () => {
  it('a config with displayName + publishTargets survives a patch', () => {
    patchRawProjectConfig(project.root, {
      displayName: 'My Thoughtbase',
      publish: { targets: [{ id: 'gh-pages', label: 'GitHub Pages' }] },
    });
    patchRawProjectConfig(project.root, { baseUri: 'https://example.com/' });

    const cfg = readRawProjectConfig(project.root);
    expect(cfg.displayName).toBe('My Thoughtbase');
    expect(cfg.publish).toEqual({ targets: [{ id: 'gh-pages', label: 'GitHub Pages' }] });
    expect(cfg.baseUri).toBe('https://example.com/');
  });

  it('a corrupt config throws and is left on disk untouched — no field loss', () => {
    fs.mkdirSync(path.join(project.root, '.minerva'), { recursive: true });
    const corrupt = '{ displayName: "unterminated';
    fs.writeFileSync(configFile(project.root), corrupt, 'utf-8');

    expect(() => patchRawProjectConfig(project.root, { baseUri: 'https://example.com/' })).toThrow();

    // The whole point: a failed patch must not clobber the corrupt file with
    // just the patch fields (the original #1891 bug).
    expect(fs.readFileSync(configFile(project.root), 'utf-8')).toBe(corrupt);
  });
});
