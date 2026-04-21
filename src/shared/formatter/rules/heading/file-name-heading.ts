import { registerRule } from '../../registry';

type Mode = 'off' | 'insert-if-missing' | 'replace-h1';

interface Config {
  mode: Mode;
  /**
   * Injected by the orchestrator per call — the file's basename without the
   * `.md` extension. Pure buffer-format calls without a known file leave
   * this undefined, in which case the rule is a no-op.
   */
  filename?: string;
}

const ATX_H1 = /^#[ \t]+.+?(?:[ \t]*#*)?[ \t]*$/;

registerRule<Config>({
  id: 'file-name-heading',
  category: 'heading',
  title: 'File-name heading',
  description:
    'Keep the note\'s first H1 in sync with its filename. `insert-if-missing` prepends `# <filename>` when no H1 is present; `replace-h1` overwrites the first H1\'s text. Needs a file on disk — the palette\'s "Format current note" works on unsaved tabs and injects the filename automatically; unsaved new notes are skipped.',
  defaultConfig: { mode: 'off' },
  apply(content, config) {
    const mode: Mode = config.mode ?? 'off';
    const filename = config.filename;
    if (mode === 'off' || !filename) return content;

    const firstH1 = findFirstH1(content);
    if (firstH1 === null) {
      if (mode !== 'insert-if-missing') return content;
      const fmEnd = findFrontmatterEnd(content);
      const head = content.slice(0, fmEnd);
      const body = content.slice(fmEnd).replace(/^\n+/, '');
      const heading = `# ${filename}`;
      if (head.length === 0) {
        return body.length > 0 ? `${heading}\n\n${body}` : `${heading}\n`;
      }
      return body.length > 0 ? `${head}\n${heading}\n\n${body}` : `${head}\n${heading}\n`;
    }

    if (mode !== 'replace-h1') return content;
    // Replace the text between the `# ` and the optional trailing `#` run.
    const { lineStart, lineEnd } = firstH1;
    return (
      content.slice(0, lineStart) +
      `# ${filename}` +
      content.slice(lineEnd)
    );
  },
});

function findFirstH1(content: string): { lineStart: number; lineEnd: number } | null {
  let inFence = false;
  let lineStart = 0;
  while (lineStart <= content.length) {
    const newlineIdx = content.indexOf('\n', lineStart);
    const lineEnd = newlineIdx === -1 ? content.length : newlineIdx;
    const line = content.slice(lineStart, lineEnd);
    if (/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
    } else if (!inFence && /^#[ \t]/.test(line) && ATX_H1.test(line)) {
      return { lineStart, lineEnd };
    }
    if (newlineIdx === -1) break;
    lineStart = newlineIdx + 1;
  }
  return null;
}

function findFrontmatterEnd(content: string): number {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/);
  return match ? match[0].length : 0;
}
