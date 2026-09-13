/**
 * Asset ops (#1799) — the "Delete image" quick-fix behind the "Unreferenced
 * images" inspection's `delete-asset` fix. A thin passthrough to
 * `api.notebase.deleteFile`, tested the same as `note-ops.ts`'s handlers.
 */
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({
  api: { notebase: { deleteFile: vi.fn() } },
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

import { deleteAsset } from '../../../src/renderer/lib/app/asset-ops';

describe('deleteAsset (#1799)', () => {
  it('deletes the asset file at the given path', async () => {
    await deleteAsset('.minerva/assets/inline/abc123-screenshot.png');
    expect(h.api.notebase.deleteFile).toHaveBeenCalledWith('.minerva/assets/inline/abc123-screenshot.png');
  });
});
