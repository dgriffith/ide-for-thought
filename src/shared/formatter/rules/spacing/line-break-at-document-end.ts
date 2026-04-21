import { registerRule } from '../../registry';

registerRule({
  id: 'line-break-at-document-end',
  category: 'spacing',
  title: 'Single newline at end of file',
  description: 'Ensure the file ends with exactly one trailing newline.',
  defaultConfig: {},
  apply(content) {
    if (content.length === 0) return content;
    let end = content.length;
    while (end > 0) {
      const c = content.charCodeAt(end - 1);
      if (c === 0x0a || c === 0x0d) end--;
      else break;
    }
    return content.slice(0, end) + '\n';
  },
});
