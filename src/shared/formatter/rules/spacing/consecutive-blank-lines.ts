import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

interface Config {
  max: number;
}

registerRule<Config>({
  id: 'consecutive-blank-lines',
  category: 'spacing',
  title: 'Collapse consecutive blank lines',
  description:
    'Cap runs of blank lines at a configurable maximum (default 1 blank line).',
  defaultConfig: { max: 1 },
  apply(content, config, cache) {
    const max = Math.max(0, Math.floor(config.max));
    const maxNewlinesInRun = max + 1;
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(/\n(?:[ \t]*\n)+/g, (match) => {
        const newlines = (match.match(/\n/g) || []).length;
        const capped = Math.min(newlines, maxNewlinesInRun);
        return '\n'.repeat(capped);
      }),
    );
  },
});
