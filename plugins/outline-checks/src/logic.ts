/**
 * The Outline Checks plugin's logic (#2831), run in its worker host (#2830):
 * the handler its inspection names. It is handed the notes its query found,
 * reads each, and returns findings; Minerva shows them. It writes nothing,
 * and its call couldn't if it tried: an inspection only reads.
 */
import { connect } from '/@minerva/plugin-api.js';
import { headingSkips } from './headings';
import type { PluginInspectionFinding, PluginInspectionInput } from '../../../src/shared/plugins/format';

const minerva = await connect();

/** Reads at once: the broker runs 16 calls at a time. */
const BATCH = 12;

minerva.handle('skippedHeadings', async (args) => {
  const { query } = args as PluginInspectionInput;
  const paths = [...new Set(Object.values(query?.notes ?? {}))].sort();
  const findings: PluginInspectionFinding[] = [];
  for (let i = 0; i < paths.length; i += BATCH) {
    const notes = await Promise.all(paths.slice(i, i + BATCH).map((path) => minerva.notes.read({ path })));
    for (const note of notes) {
      const skips = headingSkips(note.content);
      const first = skips[0];
      if (!first) continue;
      const more = skips.length > 1 ? ` (and ${skips.length - 1} more)` : '';
      findings.push({
        note: note.path,
        message: `"${first.text}" goes from H${first.from} to H${first.to}, skipping a level${more}.`,
        suggestedAction: `Make "${first.text}" an H${first.from + 1}, or add the heading it belongs under.`,
      });
    }
  }
  return { findings };
});
