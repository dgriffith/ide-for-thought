import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

registerRule({
  id: 'remove-hyphenated-line-breaks',
  category: 'content',
  title: 'Remove PDF-style hyphenated line breaks',
  description:
    'Rejoin words that were broken across a line with a trailing `-` (typical of text copied out of a PDF). Only fires when a letter precedes the hyphen and a lowercase letter follows on the next line.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(/([A-Za-z])-\r?\n([a-z])/g, '$1$2'),
    );
  },
});
