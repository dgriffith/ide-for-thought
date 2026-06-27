import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createWordPieceTokenizer } from '../../../src/main/embeddings/wordpiece';
import { modelDir } from '../../../src/main/embeddings/embedder';

// Ground truth captured from @huggingface/transformers' AutoTokenizer for
// all-MiniLM-L6-v2. Our pure-JS tokenizer must reproduce these exactly — a drift
// here means subtly wrong embeddings. (Battery covers casing, accents, ASCII +
// unicode punctuation, numbers, CamelCase, CJK, and long-word subwording.)
const REFERENCE: Record<string, number[]> = {
  'hello world': [101, 7592, 2088, 102],
  'The Quick Brown Fox.': [101, 1996, 4248, 2829, 4419, 1012, 102],
  "Don't tokenize façades naïvely — café costs $5.":
    [101, 2123, 1005, 1056, 19204, 4697, 28708, 15743, 2135, 1517, 7668, 5366, 1002, 1019, 1012, 102],
  'unbelievable preprocessing tokenization':
    [101, 23653, 17463, 3217, 9623, 7741, 19204, 3989, 102],
  'COVID-19 vaccines (mRNA) work!':
    [101, 2522, 17258, 1011, 2539, 28896, 1006, 28848, 1007, 2147, 999, 102],
  'a    b\tc\nd': [101, 1037, 1038, 1039, 1040, 102],
  'CamelCaseWord ALLCAPS': [101, 19130, 18382, 18351, 2035, 17695, 2015, 102],
  '深度学习 embeddings': [101, 100, 100, 1817, 100, 7861, 8270, 4667, 2015, 102],
  'supercalifragilisticexpialidocious':
    [101, 3565, 9289, 10128, 29181, 24411, 4588, 10288, 19312, 21273, 10085, 6313, 102],
  '   leading and trailing   ': [101, 2877, 1998, 12542, 102],
};

const tokenizerPath = path.join(modelDir(), 'tokenizer.json');
const haveModel = fs.existsSync(tokenizerPath);
const d = haveModel ? describe : describe.skip;

d('WordPiece tokenizer — exact match with the reference', () => {
  const json = haveModel ? JSON.parse(fs.readFileSync(tokenizerPath, 'utf-8')) : { model: { vocab: {} } };
  const tok = createWordPieceTokenizer(json);

  for (const [text, expected] of Object.entries(REFERENCE)) {
    it(`encodes ${JSON.stringify(text)} identically`, () => {
      expect(tok.encode(text)).toEqual(expected);
    });
  }

  it('exposes the BERT special-token ids', () => {
    expect([tok.clsId, tok.sepId, tok.padId]).toEqual([101, 102, 0]);
  });

  it('wraps every encoding in [CLS] … [SEP]', () => {
    const ids = tok.encode('test');
    expect(ids[0]).toBe(101);
    expect(ids[ids.length - 1]).toBe(102);
  });
});
