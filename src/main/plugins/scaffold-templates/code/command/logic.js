// The plugin's logic, run in its worker host: no DOM, no network, no files.
// A command's handler is handed what it runs on and returns what to do;
// Minerva does it, here replacing the text that's still selected.
import { connect } from '/@minerva/plugin-api.js';

const minerva = await connect();

minerva.handle('titleCase', ({ selection }) => {
  if (!selection) return { announce: 'Select some text first.' };
  return { replaceSelection: selection.replace(/\b(\p{L})(\p{L}*)/gu, (_m, first, rest) => first.toUpperCase() + rest.toLowerCase()) };
});
