// Note Stats' logic, in its worker host: the command's handler. It is handed
// the selected text and returns what to say; it changes nothing.
import { connect } from '/@minerva/plugin-api.js';
import { countWords } from './words.js';

const minerva = await connect();

minerva.handle('countWords', ({ selection }) => {
  const n = countWords(selection ?? '');
  return { announce: `${n} ${n === 1 ? 'word' : 'words'} selected.` };
});
