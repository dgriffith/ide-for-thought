/**
 * Where the bundled `resources/` dir is (#2410).
 *
 * The packaged `minerva semantic` failed with
 * `ENOENT … resources/models/all-MiniLM-L6-v2/tokenizer.json` because the CLI
 * resolved `<cli.js>/../../resources` — right in a checkout, and
 * `Resources/app.asar/resources` once packaged. The in-app resolvers had the
 * opposite problem: `app?.isPackaged`, which is undefined under
 * ELECTRON_RUN_AS_NODE, so a packaged CLI reaching them took the dev branch.
 *
 * These pin every layout the resolver has to get right. The paths are the real
 * shapes, measured on an `electron-forge package` build:
 *   process.resourcesPath   …/Minerva.app/Contents/Resources   (set under RunAsNode too)
 *   cli.js / main.js dir    …/Minerva.app/Contents/Resources/app.asar/.vite/build
 *   extraResource target    …/Minerva.app/Contents/Resources/resources
 */
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { resolveResourcesRoot, bundledResourcesRoot } from '../../src/main/bundled-resources';

const REPO = path.resolve(__dirname, '..', '..');
const APP = '/Applications/Minerva.app/Contents';
const RESOURCES = `${APP}/Resources`;
const BUNDLE_DIR = `${RESOURCES}/app.asar/.vite/build`;
const DEV_ELECTRON_RESOURCES = path.join(
  REPO, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Resources',
);

describe('resolveResourcesRoot (#2410)', () => {
  it('dev, plain node (CLI from a checkout): <repo>/resources from the bundle dir', () => {
    expect(
      resolveResourcesRoot({ resourcesPath: undefined, moduleDir: path.join(REPO, '.vite', 'build') }),
    ).toBe(path.join(REPO, 'resources'));
  });

  it('dev, under Electron: the dev Electron resourcesPath is NOT mistaken for packaged', () => {
    // `electron-forge start` (and `ELECTRON_RUN_AS_NODE` with the dev binary)
    // set process.resourcesPath to Electron's own dist Resources — the bundle
    // isn't under it, so this must still resolve to the repo.
    expect(
      resolveResourcesRoot({
        resourcesPath: DEV_ELECTRON_RESOURCES,
        moduleDir: path.join(REPO, '.vite', 'build'),
      }),
    ).toBe(path.join(REPO, 'resources'));
  });

  it('dev, vitest: resolves from the source file two levels below the repo', () => {
    expect(
      resolveResourcesRoot({ resourcesPath: undefined, moduleDir: path.join(REPO, 'src', 'main') }),
    ).toBe(path.join(REPO, 'resources'));
  });

  it('packaged app (main process): <Resources>/resources, with the extraResource nesting (#808)', () => {
    const root = resolveResourcesRoot({ resourcesPath: RESOURCES, moduleDir: BUNDLE_DIR });
    expect(root).toBe(`${RESOURCES}/resources`);
    // Neither of the two historical wrong answers:
    expect(root).not.toBe(RESOURCES); // #808 — dropped the `resources/` segment
    expect(root).not.toBe(`${RESOURCES}/app.asar/resources`); // #2410 — <cli.js>/../..
  });

  it('packaged CLI under ELECTRON_RUN_AS_NODE: same answer, with no `app` in sight', () => {
    // The shim (cli-install.ts) runs `<app>/Contents/MacOS/Minerva <…>/cli.js`
    // with ELECTRON_RUN_AS_NODE=1. Electron still sets process.resourcesPath
    // (verified on the packaged binary), and nothing here consults `app`.
    expect(
      resolveResourcesRoot({ resourcesPath: RESOURCES, moduleDir: BUNDLE_DIR }),
    ).toBe(`${RESOURCES}/resources`);
  });

  it('packaged, resourcesPath absent: falls back to the dir holding app.asar', () => {
    expect(
      resolveResourcesRoot({ resourcesPath: undefined, moduleDir: BUNDLE_DIR }),
    ).toBe(`${RESOURCES}/resources`);
  });

  it('packaged, the app moved after install (resourcesPath follows the binary)', () => {
    const moved = '/Users/me/Desktop/Minerva.app/Contents/Resources';
    expect(
      resolveResourcesRoot({ resourcesPath: moved, moduleDir: `${moved}/app.asar/.vite/build` }),
    ).toBe(`${moved}/resources`);
  });

  it('a sibling dir that merely shares the Resources prefix is not "inside" it', () => {
    // `/…/Resources-old/…` must not be read as under `/…/Resources`.
    expect(
      resolveResourcesRoot({
        resourcesPath: RESOURCES,
        moduleDir: `${RESOURCES}-old/checkout/.vite/build`,
      }),
    ).toBe(`${RESOURCES}-old/checkout/resources`);
  });

  it('win32 layout: resources/ beside app.asar under <install>\\resources', () => {
    const w = path.win32;
    const res = 'C:\\Program Files\\Minerva\\resources';
    expect(
      resolveResourcesRoot({
        resourcesPath: res,
        moduleDir: `${res}\\app.asar\\.vite\\build`,
        pathImpl: w,
      }),
    ).toBe(`${res}\\resources`);
  });
});

describe('bundledResourcesRoot', () => {
  it('in this (dev/test) process resolves to the repo resources dir, independent of cwd', () => {
    // The CLI runs from any directory — the old cwd fallback was wrong there.
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/somewhere/else');
    try {
      expect(bundledResourcesRoot()).toBe(path.join(REPO, 'resources'));
    } finally {
      cwd.mockRestore();
    }
  });
});
