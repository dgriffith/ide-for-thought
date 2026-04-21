import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

interface Config {
  marker: '-' | '*' | '+';
}

const HR_RE = /^([-*_])(?:[ \t]*\1){2,}$/;

registerRule<Config>({
  id: 'unordered-list-marker-style',
  category: 'content',
  title: 'Unordered list marker',
  description: 'Enforce a single style (`-`, `*`, or `+`) for unordered list markers.',
  defaultConfig: { marker: '-' },
  apply(content, config, cache) {
    const target = config.marker;
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(
        /^([ \t]*)([-*+])([ \t]+\S.*)$/gm,
        (match, indent: string, _curr, rest: string) => {
          // Skip lines that are HRs (e.g. `* * *`) both before and after rewrite.
          const orig = (indent + match.slice(indent.length)).trim();
          if (HR_RE.test(orig)) return match;
          const rewritten = `${indent}${target}${rest}`;
          if (HR_RE.test(rewritten.trim())) return match;
          return rewritten;
        },
      ),
    );
  },
});
