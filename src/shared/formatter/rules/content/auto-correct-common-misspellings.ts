import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

interface Config {
  /**
   * Extra entries merged on top of the default starter dictionary.
   * Keys are the lowercase misspelling; values are the correct form.
   * User entries override defaults with the same key.
   */
  extraCorrections: Record<string, string>;
}

/**
 * A small starter dictionary of very common English misspellings. Intentionally
 * conservative — this rule defaults to off and the expectation is that users
 * extend it via `extraCorrections` rather than hope the formatter catches
 * everything. Expanding this list to match platers/obsidian-linter's full
 * corpus is follow-up work.
 */
const DEFAULT_CORRECTIONS: Record<string, string> = {
  teh: 'the',
  adn: 'and',
  alot: 'a lot',
  alright: 'all right',
  beleive: 'believe',
  calender: 'calendar',
  cemetary: 'cemetery',
  concious: 'conscious',
  definately: 'definitely',
  dissapear: 'disappear',
  embarass: 'embarrass',
  existance: 'existence',
  experiance: 'experience',
  goverment: 'government',
  happend: 'happened',
  harrass: 'harass',
  independant: 'independent',
  mispell: 'misspell',
  neccessary: 'necessary',
  noticable: 'noticeable',
  occured: 'occurred',
  occurence: 'occurrence',
  occuring: 'occurring',
  preceeding: 'preceding',
  priviledge: 'privilege',
  publically: 'publicly',
  recieve: 'receive',
  recieved: 'received',
  refered: 'referred',
  refering: 'referring',
  resistence: 'resistance',
  seperate: 'separate',
  seperated: 'separated',
  succesful: 'successful',
  succesfully: 'successfully',
  tommorrow: 'tomorrow',
  truely: 'truly',
  untill: 'until',
  wierd: 'weird',
  writen: 'written',
};

registerRule<Config>({
  id: 'auto-correct-common-misspellings',
  category: 'content',
  title: 'Auto-correct common misspellings',
  description:
    'Replace common English misspellings with their correct forms. Case of the first letter is preserved (e.g. `Teh` → `The`). Off by default; extend via `extraCorrections` in the rule config.',
  defaultConfig: { extraCorrections: {} },
  apply(content, config, cache) {
    const merged: Record<string, string> = {
      ...DEFAULT_CORRECTIONS,
      ...(config.extraCorrections ?? {}),
    };
    const keys = Object.keys(merged);
    if (keys.length === 0) return content;

    // Escape regex metachars just in case a user adds something exotic.
    const pattern = new RegExp(
      `\\b(${keys.map(escapeRegex).join('|')})\\b`,
      'gi',
    );
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(pattern, (match) => {
        const lower = match.toLowerCase();
        const replacement = merged[lower];
        if (!replacement) return match;
        return match[0] === match[0].toUpperCase()
          ? replacement[0].toUpperCase() + replacement.slice(1)
          : replacement;
      }),
    );
  },
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
