/**
 * The book zipped (#2648), as an EPUB's container needs it: `mimetype` first
 * and stored, not deflated — how a reader knows the file is an EPUB — and
 * everything else deflated.
 */
import JSZip from 'jszip';
import { bookFilename, buildEpub } from './epub';
import type { PluginExportPlan, PluginExportResult } from '../../../src/shared/plugins/format';

export async function packEpub(plan: PluginExportPlan, now = new Date()): Promise<PluginExportResult> {
  const zip = new JSZip();
  for (const f of buildEpub(plan, now)) zip.file(f.path, f.text, f.path === 'mimetype' ? { compression: 'STORE' } : {});
  const base64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
  const chapters = plan.notes.length === 1 ? 'one chapter' : `${plan.notes.length} chapters`;
  return { files: [{ path: bookFilename(plan.title), base64 }], summary: `Exported "${plan.title}" as EPUB, ${chapters}.` };
}
