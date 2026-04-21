import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

interface Config {
  style: 'straight' | 'curly';
}

const L_DOUBLE = '“';
const R_DOUBLE = '”';
const L_SINGLE = '‘';
const R_SINGLE = '’';

registerRule<Config>({
  id: 'quote-style',
  category: 'content',
  title: 'Quote style',
  description:
    'Normalise quotation marks to either straight (`"` `\'`) or curly (`“” ‘’`). Apostrophes that aren’t clearly paired (e.g. `don’t`) are only flipped in `straight` mode.',
  defaultConfig: { style: 'straight' },
  apply(content, config, cache) {
    return transformUnprotected(content, cache, (seg) => {
      if (config.style === 'straight') {
        return seg
          .replace(new RegExp(`[${L_DOUBLE}${R_DOUBLE}]`, 'g'), '"')
          .replace(new RegExp(`[${L_SINGLE}${R_SINGLE}]`, 'g'), "'");
      }
      // Curly: pair-match straight quotes, word-boundary-guarded so in-word
      // apostrophes (don't, it's) aren't mis-split.
      let out = seg.replace(/"([^"\n]*)"/g, `${L_DOUBLE}$1${R_DOUBLE}`);
      out = out.replace(
        /(^|[\s(\[{])'([^'\n]+?)'(?=[\s.,!?;:)\]}]|$)/gm,
        `$1${L_SINGLE}$2${R_SINGLE}`,
      );
      return out;
    });
  },
});
