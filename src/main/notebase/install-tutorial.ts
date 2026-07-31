/**
 * Install the bundled tutorial thoughtbase (#1542, part of the #1518 epic).
 *
 * The curated tutorial tree ships under `resources/tutorial-thoughtbase/` (via
 * the blanket `extraResource: ['resources']` in `forge.config.ts`). Installing
 * it is a recursive copy of that tree into a fresh directory the user picks —
 * there is no external recursive copy elsewhere in `notebase/fs.ts` (`copyItem`
 * is intra-project only), so this module owns it.
 *
 * Idempotent / re-installable: we NEVER mutate an existing directory in place —
 * a collision suffixes ` 2`, ` 3`, … so re-installing always yields a clean copy
 * (issue #1518 "installing again picks a fresh folder"). Once copied it's an
 * ordinary thoughtbase — fully editable and deletable.
 *
 * The copy core is Electron-free (takes an explicit destination) so it unit-tests
 * without a running app; the IPC handler in `ipc/register-notebase.ts` supplies
 * the picked path and opens the result.
 */
import { app } from 'electron';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Folder name the tutorial ships under inside `resources/`. */
const TUTORIAL_DIR_NAME = 'tutorial-thoughtbase';

/** Default basename for a freshly installed tutorial thoughtbase. */
export const TUTORIAL_DEFAULT_NAME = 'Minerva Tutorial';

/**
 * Absolute path to the bundled tutorial tree, resolved the same way as the
 * help-docs corpus (`help-docs/corpus-store.ts`): `process.resourcesPath` when
 * packaged, `process.cwd()` in dev. `resourcesBaseOverride` is a test seam.
 */
export function tutorialResourceDir(resourcesBaseOverride?: string): string {
  const resourcesBase =
    resourcesBaseOverride ??
    (app?.isPackaged
      ? path.join(process.resourcesPath, 'resources')
      : path.join(process.cwd(), 'resources'));
  return path.join(resourcesBase, TUTORIAL_DIR_NAME);
}

/**
 * The first non-existent directory in the sequence `dir`, `dir 2`, `dir 3`, …
 * so an install never clobbers an existing folder.
 */
export function firstAvailableDir(dir: string): string {
  if (!existsSync(dir)) return dir;
  const parent = path.dirname(dir);
  const base = path.basename(dir);
  for (let n = 2; ; n++) {
    const candidate = path.join(parent, `${base} ${n}`);
    if (!existsSync(candidate)) return candidate;
  }
}

/**
 * Copy the bundled tutorial tree into a fresh directory at (or suffixed from)
 * `destDir`, returning the final destination path. Throws if the bundled tree
 * is missing (a broken build). `sourceDir` is a test seam.
 */
export async function installTutorialThoughtbase(
  destDir: string,
  sourceDir: string = tutorialResourceDir(),
): Promise<string> {
  if (!existsSync(sourceDir)) {
    throw new Error(`[tutorial] bundled thoughtbase not found at ${sourceDir}`);
  }
  const finalDest = firstAvailableDir(destDir);
  await fs.cp(sourceDir, finalDest, { recursive: true });
  return finalDest;
}
