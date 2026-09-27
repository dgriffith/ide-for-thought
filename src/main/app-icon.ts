import path from 'node:path';
import { bundledResourcesRoot } from './bundled-resources';

/**
 * Absolute path to the runtime app icon PNG (#805).
 *
 * Used for the Linux/Windows window + taskbar icon and the macOS *dev* dock
 * icon. (Packaged macOS/Windows builds get their icon embedded by
 * electron-packager via `packagerConfig.icon`; Linux has no embedded app icon,
 * and an unpackaged `electron-forge start` shows the stock Electron icon unless
 * we set one — hence this runtime fallback.)
 *
 * Shipped under `resources/icons/` via forge's `extraResource: ['resources']`,
 * which copies the `resources/` dir verbatim into the packaged Resources dir
 * (i.e. `<Resources>/resources/icons/...`, verified against a real package); in
 * dev it's read from the repo. Resolution is `bundledResourcesRoot()`'s (#2410).
 */
export function appIconPath(): string {
  return path.join(bundledResourcesRoot(), 'icons', 'minerva.png');
}
