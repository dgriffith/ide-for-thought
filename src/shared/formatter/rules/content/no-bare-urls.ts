import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

registerRule({
  id: 'no-bare-urls',
  category: 'content',
  title: 'Wrap bare URLs',
  description:
    'Wrap a URL that sits alone on a line in autolink angle brackets (`<https://…>`) so every markdown parser treats it uniformly.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(
        /^([ \t]*)((?:https?|ftp):\/\/\S+?)([ \t]*)$/gm,
        (_m, indent: string, url: string, trail: string) => {
          if (url.startsWith('<') && url.endsWith('>')) return _m;
          return `${indent}<${url}>${trail}`;
        },
      ),
    );
  },
});
