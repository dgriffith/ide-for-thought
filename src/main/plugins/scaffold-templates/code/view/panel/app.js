// The panel: Minerva runs notes.rq and sends the results as a `query` event
// (again whenever the graph changes); this lists the notes they name, and a
// click opens one. It runs in a sandboxed frame on the plugin's own origin,
// and reaches Minerva only through the plugin API.
import { connect } from '/@minerva/plugin-api.js';

const minerva = await connect();
const list = document.getElementById('notes');

minerva.on('query', ({ notes, error }) => {
  const paths = [...new Set(Object.values(notes))].sort();
  if (error || paths.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = error ?? 'No notes tagged #todo.';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(...paths.map((path) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.textContent = path.replace(/^.*\//, '').replace(/\.md$/, '');
    button.addEventListener('click', () => { void minerva.ui.openNote({ path }).catch(() => undefined); });
    li.append(button);
    return li;
  }));
});
