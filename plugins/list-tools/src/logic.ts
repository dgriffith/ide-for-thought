/**
 * The List Tools plugin's logic (#2643), run in its worker host (#2830):
 * the handlers its commands name. Each is handed the command's context as
 * data and returns what Minerva should do — it changes nothing itself.
 */
import { connect } from '/@minerva/plugin-api.js';
import { sortList } from './sort-list';

const minerva = await connect();

minerva.handle('sortSelection', (args) => {
  const { selection } = args as { selection: string | null };
  const sorted = selection === null ? null : sortList(selection);
  if (sorted === null) return { announce: 'No list to sort in the selection.' };
  if (sorted === selection) return { announce: 'The list is already sorted.' };
  return { replaceSelection: sorted };
});
