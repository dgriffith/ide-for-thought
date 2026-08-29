/**
 * `loadSiteConfig` (#252, migrated to the shared config loader in #1913).
 *
 * Pins the loader-migration behavior directly (the exporter's own tests cover
 * the merged config indirectly, not corruption handling): a missing config
 * reads as safe defaults with the project-folder title, a corrupt one is
 * reported (`reportConfigError`) instead of silently defaulting with no
 * signal, and per-field fallback still applies to a partial config.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadSiteConfig } from '../../../src/main/publish/exporters/static-site/site-config';
import { useTempDir } from '../../helpers/temp-project';

const project = useTempDir('minerva-site-config-test-');

const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
afterEach(() => consoleErrorSpy.mockClear());

function writeConfig(root: string, data: unknown): void {
  const dir = path.join(root, '.minerva');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'site-config.json'), JSON.stringify(data), 'utf-8');
}

describe('loadSiteConfig (#1913)', () => {
  it('falls back to the project folder name with no config present', async () => {
    const cfg = await loadSiteConfig(project.root);
    expect(cfg.title).toBe(path.basename(project.root));
    expect(cfg.baseUrl).toBe('');
    expect(cfg.excludeTags).toEqual(['draft']);
    expect(cfg.showBacklinks).toBe(true);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('reports and falls back to defaults for a corrupt config, instead of silently defaulting', async () => {
    fs.mkdirSync(path.join(project.root, '.minerva'), { recursive: true });
    fs.writeFileSync(path.join(project.root, '.minerva', 'site-config.json'), '{ not valid json', 'utf-8');
    const cfg = await loadSiteConfig(project.root);
    expect(cfg.title).toBe(path.basename(project.root));
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('[config] failed to');
  });

  it('merges a partial config with defaults field-by-field', async () => {
    writeConfig(project.root, { title: 'My Site', excludeFolders: ['drafts/'] });
    const cfg = await loadSiteConfig(project.root);
    expect(cfg.title).toBe('My Site');
    expect(cfg.excludeFolders).toEqual(['drafts/']);
    expect(cfg.excludeTags).toEqual(['draft']);
    expect(cfg.showBacklinks).toBe(true);
  });

  it('an empty title in the config falls back to the folder name, not a blank title', async () => {
    writeConfig(project.root, { title: '' });
    const cfg = await loadSiteConfig(project.root);
    expect(cfg.title).toBe(path.basename(project.root));
  });
});
