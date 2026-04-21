import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

type Style = 'title-case' | 'sentence-case' | 'lowercase' | 'off';

interface Config {
  style: Style;
  /**
   * Words that should be preserved in their canonical case regardless of the
   * style (e.g. `['JavaScript', 'Minerva']`). Case-insensitive match on the
   * token; the supplied casing is written back verbatim.
   */
  properNouns: string[];
}

const TITLE_SHORT_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'of', 'in', 'on', 'at',
  'to', 'for', 'by', 'with', 'as', 'from', 'up', 'so', 'yet', 'if', 'vs',
]);

registerRule<Config>({
  id: 'capitalize-headings',
  category: 'heading',
  title: 'Capitalize headings',
  description:
    'Normalise heading case. `title-case` capitalises each major word (short words stay lowercase unless first or last); `sentence-case` only capitalises the first word; `lowercase` lowercases everything. User-supplied `properNouns` preserve their canonical casing.',
  defaultConfig: { style: 'off', properNouns: [] },
  apply(content, config, cache) {
    if (config.style === 'off') return content;
    const nounMap = buildNounMap(config.properNouns ?? []);
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(
        /^(#{1,6}[ \t]+)(.+?)([ \t]*#*[ \t]*)$/gm,
        (_m, prefix: string, text: string, suffix: string) =>
          `${prefix}${recase(text, config.style, nounMap)}${suffix}`,
      ),
    );
  },
});

function recase(text: string, style: Style, nounMap: Map<string, string>): string {
  if (style === 'lowercase') {
    return rewriteWords(text, (w) => nounMap.get(w.toLowerCase()) ?? w.toLowerCase());
  }
  if (style === 'sentence-case') {
    return rewriteWords(text, (w, i) => {
      const override = nounMap.get(w.toLowerCase());
      if (override) return override;
      return i === 0 ? capitalizeFirst(w) : w.toLowerCase();
    });
  }
  if (style === 'title-case') {
    return rewriteWords(text, (w, i, n) => {
      const override = nounMap.get(w.toLowerCase());
      if (override) return override;
      const isBoundary = i === 0 || i === n - 1;
      if (isBoundary) return capitalizeFirst(w);
      if (TITLE_SHORT_WORDS.has(w.toLowerCase())) return w.toLowerCase();
      return capitalizeFirst(w);
    });
  }
  return text;
}

function rewriteWords(
  text: string,
  rewriter: (word: string, index: number, total: number) => string,
): string {
  const tokens = text.split(/(\s+)/);
  const wordPositions: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!/^\s*$/.test(tokens[i]) && tokens[i].length > 0) wordPositions.push(i);
  }
  const total = wordPositions.length;
  wordPositions.forEach((pos, idx) => {
    tokens[pos] = rewriter(tokens[pos], idx, total);
  });
  return tokens.join('');
}

function capitalizeFirst(word: string): string {
  if (word.length === 0) return word;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

function buildNounMap(nouns: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const noun of nouns) {
    if (noun.length > 0) map.set(noun.toLowerCase(), noun);
  }
  return map;
}
