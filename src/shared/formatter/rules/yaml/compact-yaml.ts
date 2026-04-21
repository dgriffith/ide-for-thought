import { registerRule } from '../../registry';

registerRule({
  id: 'compact-yaml',
  category: 'yaml',
  title: 'Compact frontmatter',
  description:
    'Strip leading and trailing blank lines inside the YAML frontmatter block.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    const fm = cache.frontmatterRange;
    if (!fm) return content;
    const block = content.slice(fm.start, fm.end);
    const m = block.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/);
    if (!m) return content;
    const [, open, body, close] = m;
    const compacted = body.replace(/^(?:\s*\n)+/, '').replace(/\n\s*$/, '');
    if (compacted === body) return content;
    return content.slice(0, fm.start) + open + compacted + close + content.slice(fm.end);
  },
});
