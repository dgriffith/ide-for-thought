import { api } from '../ipc/client';

let activeFilePath = $state<string | null>(null);
let activeFileName = $state<string>('');
let content = $state('');
let savedContent = $state('');

export function getEditorStore() {
  async function openFile(relativePath: string) {
    const text = await api.notebase.readFile(relativePath);
    activeFilePath = relativePath;
    activeFileName = relativePath.split('/').pop() ?? '';
    content = text;
    savedContent = text;
  }

  async function save() {
    if (!activeFilePath) return;
    await api.notebase.writeFile(activeFilePath, content);
    savedContent = content;
  }

  function setContent(text: string) {
    content = text;
  }

  function clear() {
    activeFilePath = null;
    activeFileName = '';
    content = '';
    savedContent = '';
  }

  return {
    get activeFilePath() { return activeFilePath; },
    get activeFileName() { return activeFileName; },
    get content() { return content; },
    get isDirty() { return content !== savedContent; },
    openFile,
    save,
    setContent,
    clear,
  };
}
