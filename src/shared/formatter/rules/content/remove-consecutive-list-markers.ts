import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

const HR_RE = /^([-*_])(?:[ \t]*\1){2,}$/;

registerRule({
  id: 'remove-consecutive-list-markers',
  category: 'content',
  title: 'Collapse consecutive list markers',
  description:
    'A line like `- - item` becomes `- item`. Only the first marker is kept.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(
        /^([ \t]*)([-*+])(?:[ \t]+[-*+])+[ \t]+(\S.*)$/gm,
        (match, indent: string, marker: string, rest: string) => {
          // An HR-shaped line (e.g. `* * *`, `- - -`) would match the regex
          // by backtracking on the marker-repetition count; detect and skip.
          if (HR_RE.test(match.trim())) return match;
          return `${indent}${marker} ${rest}`;
        },
      ),
    );
  },
});
