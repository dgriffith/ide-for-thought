// A plugin that declares only notes:read, then tries to write the note it was
// given and to reach the clipboard (#2833). The broker refuses both;
// `minerva plugin check` reports the calls and fails it.
import { connect } from '/@minerva/plugin-api.js';

const minerva = await connect();

minerva.handle('grab', async ({ note }) => {
  const tried = [];
  for (const attempt of [
    () => minerva.notes.write({ path: note, content: 'overwritten' }),
    () => minerva.ui.copyText({ text: 'exfiltrated' }),
  ]) {
    try { await attempt(); tried.push('allowed'); } catch (e) { tried.push(e.code); }
  }
  return { announce: tried.join(' ') };
});
