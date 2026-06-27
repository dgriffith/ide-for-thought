/**
 * A pure-JS BERT WordPiece tokenizer (#834).
 *
 * all-MiniLM-L6-v2 uses the standard bert-base-uncased tokenizer. We implement
 * it from the model's own `tokenizer.json` vocab rather than depend on
 * transformers.js — whose Node build eagerly requires the ~100 MB native
 * `onnxruntime-node`, defeating the lean-WASM build. This file + `wasm-embedder`
 * + `onnxruntime-web` are the whole embedding runtime: no native binaries.
 *
 * Faithfulness matters — a tokenization that drifts from the reference yields
 * subtly wrong vectors — so `wordpiece.test.ts` asserts byte-for-byte equality
 * with transformers.js output across a punctuation / casing / accent / CJK /
 * subword battery captured from the reference.
 *
 * Pipeline mirrors HF's `BertNormalizer` → `BertPreTokenizer` → `WordPiece`:
 *   1. clean text (drop control chars, collapse whitespace to spaces)
 *   2. pad CJK ideographs with spaces (each becomes its own token)
 *   3. strip accents (NFD, drop combining marks) then lowercase
 *   4. split on whitespace, then split punctuation into single-char tokens
 *   5. greedy longest-match WordPiece, `##` continuation, whole word → [UNK]
 */

const MAX_CHARS_PER_WORD = 100;

export interface WordPieceTokenizer {
  /** Encode one string to token ids, including the leading [CLS] and trailing
   *  [SEP]. No truncation — the embedder caps length when it batches. */
  encode(text: string): number[];
  readonly clsId: number;
  readonly sepId: number;
  readonly padId: number;
}

export interface TokenizerJson {
  model: { vocab: Record<string, number>; unk_token?: string };
}

/** Build a tokenizer from a parsed `tokenizer.json`. */
export function createWordPieceTokenizer(json: TokenizerJson): WordPieceTokenizer {
  const vocab = new Map<string, number>(Object.entries(json.model.vocab));
  const id = (tok: string): number => {
    const v = vocab.get(tok);
    if (v === undefined) throw new Error(`tokenizer vocab missing required token: ${tok}`);
    return v;
  };
  const unkId = id(json.model.unk_token ?? '[UNK]');
  const clsId = id('[CLS]');
  const sepId = id('[SEP]');
  const padId = id('[PAD]');

  function wordToIds(word: string): number[] {
    if (word.length > MAX_CHARS_PER_WORD) return [unkId];
    const out: number[] = [];
    let start = 0;
    while (start < word.length) {
      let end = word.length;
      let curId: number | undefined;
      while (start < end) {
        const piece = (start > 0 ? '##' : '') + word.slice(start, end);
        const hit = vocab.get(piece);
        if (hit !== undefined) { curId = hit; break; }
        end--;
      }
      if (curId === undefined) return [unkId]; // whole word is unknown
      out.push(curId);
      start = end;
    }
    return out;
  }

  return {
    clsId, sepId, padId,
    encode(text: string): number[] {
      const ids: number[] = [clsId];
      for (const word of basicTokenize(text)) {
        for (const tokId of wordToIds(word)) ids.push(tokId);
      }
      ids.push(sepId);
      return ids;
    },
  };
}

/** Normalize + pre-tokenize into the "words" WordPiece runs over. */
function basicTokenize(text: string): string[] {
  const normalized = stripAccents(padChineseChars(cleanText(text)).toLowerCase());
  const words: string[] = [];
  for (const chunk of normalized.split(/\s+/)) {
    if (chunk.length === 0) continue;
    // Split punctuation into its own single-char tokens (BertPreTokenizer).
    let buf = '';
    for (const ch of chunk) {
      if (isPunctuation(ch)) {
        if (buf) { words.push(buf); buf = ''; }
        words.push(ch);
      } else {
        buf += ch;
      }
    }
    if (buf) words.push(buf);
  }
  return words;
}

/** Drop NUL / replacement / control chars; turn any whitespace into a space. */
function cleanText(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0 || cp === 0xfffd || isControl(ch)) continue;
    out += isWhitespace(ch) ? ' ' : ch;
  }
  return out;
}

/** Surround CJK ideographs with spaces so each becomes its own token. */
function padChineseChars(text: string): string {
  let out = '';
  for (const ch of text) {
    out += isChineseChar(ch.codePointAt(0)!) ? ` ${ch} ` : ch;
  }
  return out;
}

/** NFD-decompose and drop combining marks (Mn) — strip_accents follows
 *  do_lower_case (true) for this tokenizer. */
function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{Mn}/gu, '');
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || /\p{Zs}/u.test(ch);
}

function isControl(ch: string): boolean {
  if (ch === '\t' || ch === '\n' || ch === '\r') return false; // treated as whitespace
  return /\p{Cc}|\p{Cf}/u.test(ch);
}

function isPunctuation(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  // BERT treats all non-alnum ASCII as punctuation, plus any Unicode P* category.
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) {
    return true;
  }
  return /\p{P}/u.test(ch);
}

function isChineseChar(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) ||
    (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}
