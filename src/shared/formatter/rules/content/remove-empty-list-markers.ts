import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

registerRule({
  id: 'remove-empty-list-markers',
  category: 'content',
  title: 'Remove empty list markers',
  description:
    'Blank out lines that contain only a list marker (`-`, `*`, `+`, `1.`, `1)`) with no content. The line is kept but emptied, leaving `consecutive-blank-lines` to handle further tidy-up.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) =>
      seg
        .replace(/^[ \t]*[-*+][ \t]*$/gm, '')
        .replace(/^[ \t]*\d+[.)][ \t]*$/gm, ''),
    );
  },
});
