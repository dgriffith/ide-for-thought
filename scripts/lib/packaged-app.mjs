/**
 * Where forge puts the packaged app on each platform (#2981, #2179) — the one
 * statement of it, read by `scripts/check-electron-fuses.mjs` and by the e2e
 * specs that boot or run the packaged binary (`tests/e2e/helpers/launch.ts`).
 *
 *  - macOS: `Minerva.app`, binary in `Contents/MacOS/`, resources in
 *    `Contents/Resources/`.
 *  - Windows: `Minerva.exe` beside a `resources/` folder.
 *  - Linux: `minerva` beside a `resources/` folder. Lower-case because
 *    forge.config.ts sets `executableName` there: the deb and rpm makers look
 *    for package.json's `name`, and a Linux command is lower-case anyway.
 *
 * Plain `.mjs` (typed by the sibling `.d.mts`), like `electron-fuses.mjs`.
 */
import path from 'node:path';

/** The binary's name on Linux, which forge.config.ts sets as `executableName`. */
export const LINUX_EXECUTABLE_NAME = 'minerva';

/**
 * @param {string} root the repository root
 * @param {string} [platform]
 * @param {string} [arch]
 * @returns {{ dir: string; app: string; binary: string; resources: string }}
 *   `dir` is forge's output folder; `app` what to hand a tool that takes "the
 *   app" (the `.app` bundle on macOS, the binary elsewhere).
 */
export function packagedAppPaths(root, platform = process.platform, arch = process.arch) {
  const dir = path.join(root, 'out', `Minerva-${platform}-${arch}`);
  if (platform === 'darwin') {
    const app = path.join(dir, 'Minerva.app');
    return { dir, app, binary: path.join(app, 'Contents', 'MacOS', 'Minerva'), resources: path.join(app, 'Contents', 'Resources') };
  }
  const binary = path.join(dir, platform === 'win32' ? 'Minerva.exe' : LINUX_EXECUTABLE_NAME);
  return { dir, app: binary, binary, resources: path.join(dir, 'resources') };
}

