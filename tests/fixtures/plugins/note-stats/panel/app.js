// Note Stats' panel: Minerva runs notes.rq and hands it the notes; it reads
// each, counts its words, and lists them longest first. A row opens its note.
import { connect } from '/@minerva/plugin-api.js';
import { countWords } from '../words.js';

const minerva = await connect();
const list = document.getElementById('lengths');

minerva.on('query', async ({ notes }) => {
  const paths = [...new Set(Object.values(notes))];
  const rows = [];
  for (const path of paths) {
    const note = await minerva.notes.read({ path });
    rows.push({ path, title: path.replace(/^.*\//, '').replace(/\.md$/, ''), words: countWords(note.content) });
  }
  rows.sort((a, b) => b.words - a.words || a.title.localeCompare(b.title));
  list.replaceChildren(...rows.map((r) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    const title = document.createElement('span');
    title.textContent = r.title;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `${r.words} ${r.words === 1 ? 'word' : 'words'}`;
    button.append(title, n);
    button.addEventListener('click', () => { void minerva.ui.openNote({ path: r.path }).catch(() => undefined); });
    li.append(button);
    return li;
  }));
});
