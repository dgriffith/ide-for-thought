import { registerRule } from '../../registry';

registerRule({
  id: 'add-blank-line-after-yaml',
  category: 'yaml',
  title: 'Blank line after frontmatter',
  description:
    'Ensure exactly one blank line between the closing `---` of the frontmatter block and the body.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    const fm = cache.frontmatterRange;
    if (!fm) return content;
    // The parse-cache's frontmatter range includes the terminating newline
    // after the closing `---`. Strip any additional blank lines immediately
    // after that, then re-insert exactly one.
    const head = content.slice(0, fm.end);
    const tail = content.slice(fm.end).replace(/^\n+/, '');
    if (tail.length === 0) return head;
    return `${head}\n${tail}`;
  },
});
