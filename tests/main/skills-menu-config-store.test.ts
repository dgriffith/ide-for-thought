import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadMenuConfig,
  saveMenuConfig,
  getMenuConfig,
} from '../../src/main/skills/menu-config-store';
import { emptyMenuConfig, type MenuConfig } from '../../src/shared/skills/menu-config';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-menucfg-'));
  file = path.join(dir, 'sub', 'menu-config.json');
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('loadMenuConfig', () => {
  it('returns defaults when the file is missing', async () => {
    const cfg = await loadMenuConfig(file);
    expect(cfg).toEqual(emptyMenuConfig());
    expect(getMenuConfig()).toEqual(emptyMenuConfig());
  });

  it('returns defaults on corrupt JSON rather than throwing', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ not json', 'utf-8');
    const cfg = await loadMenuConfig(file);
    expect(cfg).toEqual(emptyMenuConfig());
  });
});

describe('saveMenuConfig', () => {
  it('creates the directory, persists, normalizes, and caches', async () => {
    const cfg: MenuConfig = {
      skills: { 'learning.a': { enabled: false, menu: 'Research' } },
      order: { Learning: ['learning.b'], Research: [], Analysis: [] },
    };
    const saved = await saveMenuConfig(cfg, file);
    expect(saved.skills['learning.a']).toEqual({ enabled: false, menu: 'Research' });
    expect(getMenuConfig()).toEqual(saved);

    // Round-trips through disk.
    const reloaded = await loadMenuConfig(file);
    expect(reloaded).toEqual(saved);
  });

  it('strips junk before writing', async () => {
    await saveMenuConfig(
      { skills: { x: { enabled: true, menu: 'Bogus' as never } }, order: {} as never },
      file,
    );
    const onDisk = JSON.parse(await fs.readFile(file, 'utf-8'));
    // invalid menu → enabled-only override; missing order keys filled in
    expect(onDisk.skills.x).toEqual({ enabled: true });
    expect(onDisk.order).toEqual(emptyMenuConfig().order);
  });
});
