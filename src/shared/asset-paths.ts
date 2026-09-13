/**
 * Project-relative locations for editor-attached binary assets (#1799).
 *
 * Kept in `shared/` because both the renderer (which writes here on
 * paste/drop, `editor/image-upload.ts`) and main (which scans here for
 * orphans, `notebase/asset-references.ts`) need the same path — a drifted
 * copy in either would make the other miss files.
 */

/** Where drag-and-drop / pasted images land (`editor/image-upload.ts`'s
 *  `uploadImage`), content-addressed as `<sha-prefix>-<safe-stem>.<ext>`.
 *  Separate from `.minerva/assets/derived/` (compute output). */
export const INLINE_ASSET_DIR = '.minerva/assets/inline';
