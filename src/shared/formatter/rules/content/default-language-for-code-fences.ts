import { registerRule } from '../../registry';

interface Config {
  defaultLanguage: string;
}

registerRule<Config>({
  id: 'default-language-for-code-fences',
  category: 'content',
  title: 'Default language for code fences',
  description:
    'Tag un-languaged code fences (`\\`\\`\\`` with no language) with a configurable default (default `text`).',
  defaultConfig: { defaultLanguage: 'text' },
  apply(content, config, cache) {
    const lang = String(config.defaultLanguage ?? '').trim();
    if (!lang) return content;

    const insertions: { offset: number; text: string }[] = [];
    for (const r of cache.codeFenceRanges) {
      const firstNewline = content.indexOf('\n', r.start);
      if (firstNewline === -1 || firstNewline >= r.end) continue;
      const openingLine = content.slice(r.start, firstNewline);
      // Only match bare fences — if an info string is already present, leave it.
      if (/^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*$/.test(openingLine)) {
        insertions.push({ offset: firstNewline, text: lang });
      }
    }
    if (insertions.length === 0) return content;

    insertions.sort((a, b) => b.offset - a.offset);
    let out = content;
    for (const ins of insertions) {
      out = out.slice(0, ins.offset) + ins.text + out.slice(ins.offset);
    }
    return out;
  },
});
