/**
 * The Transcripts plugin's parser (#2647): SubRip and WebVTT cues joined into
 * timestamped paragraphs, split on a speaker change or a pause, with rolling
 * captions' repeated lines dropped and markup stripped.
 */
import { describe, it, expect } from 'vitest';
import {
  formatTimestamp,
  parseCues,
  parseTimestamp,
  parseTranscript,
  titleFromFilename,
} from '../../../plugins/transcripts/src/parse-transcript';

const SRT = `\uFEFF1\r
00:00:01,000 --> 00:00:03,500\r
Welcome, everyone.\r
\r
2\r
00:00:03,600 --> 00:00:05,000\r
Thanks for <i>coming</i>.\r
\r
3\r
00:00:12,000 --> 00:00:14,000\r
After a pause &amp; a sip.\r
`;

describe('parseTranscript (#2647)', () => {
  it('reads SubRip: cues run together, a pause starts a paragraph, tags and entities go', () => {
    const t = parseTranscript(SRT);
    expect(t.format).toBe('srt');
    expect(t.cues).toHaveLength(3);
    expect(t.body).toBe('**[0:01]** Welcome, everyone. Thanks for coming.\n\n**[0:12]** After a pause & a sip.\n');
  });

  it('reads WebVTT: header, NOTE and STYLE blocks skipped, voices name the speaker once', () => {
    const vtt = [
      'WEBVTT - Panel', '', 'NOTE recorded live', '', 'STYLE', '::cue { color: red }', '',
      'intro', '00:00.000 --> 00:02.000 align:start', '<v Ada Lovelace>Engines can compose.', '',
      '00:02.100 --> 00:04.000', '<v Ada Lovelace>Music, even.', '',
      '00:04.100 --> 00:06.000', '<v.loud Charles>Only <00:05.000><c>numbers</c>.', '',
      '01:00:00.000 --> 01:00:01.000', '<v Charles>Hours later.',
    ].join('\n');
    const t = parseTranscript(vtt);
    expect(t.format).toBe('vtt');
    expect(t.body).toBe(
      '**[0:00]** *Ada Lovelace:* Engines can compose. Music, even.\n\n'
      + '**[0:04]** *Charles:* Only numbers.\n\n'
      + '**[1:00:00]** Hours later.\n',
    );
  });

  it('takes a speaker in capitals at the start of a cue, and not an ordinary colon', () => {
    const srt = '1\n00:00:00,000 --> 00:00:01,000\n>> JANE DOE: Hello.\n\n2\n00:00:01,000 --> 00:00:02,000\nNote: this is not a name.\n';
    expect(parseTranscript(srt).body).toBe('**[0:00]** *JANE DOE:* Hello. Note: this is not a name.\n');
  });

  it('drops a line repeated from the cue before (rolling captions)', () => {
    const srt = '1\n00:00:00,000 --> 00:00:01,000\nthe quick brown\n\n2\n00:00:01,000 --> 00:00:02,000\nthe quick brown\nfox jumps\n\n3\n00:00:02,000 --> 00:00:03,000\nfox jumps\n';
    expect(parseTranscript(srt).body).toBe('**[0:00]** the quick brown fox jumps\n');
  });

  it('finds no cues in text that has none', () => {
    expect(parseCues('just some words\n\nand more').cues).toEqual([]);
    expect(parseTranscript('').body).toBe('');
  });
});

describe('timestamps and titles', () => {
  it('reads and writes times', () => {
    expect(parseTimestamp('01:02:03,456')).toBeCloseTo(3723.456);
    expect(parseTimestamp('02:03.5')).toBeCloseTo(123.5);
    expect(formatTimestamp(59.9)).toBe('0:59');
    expect(formatTimestamp(3723)).toBe('1:02:03');
  });
  it('takes a title and a language from the file name', () => {
    expect(titleFromFilename('my_big-talk.en.vtt')).toEqual({ title: 'my big talk', language: 'en' });
    expect(titleFromFilename('Interview.pt-BR.srt')).toEqual({ title: 'Interview', language: 'pt-BR' });
    expect(titleFromFilename('Episode 12.srt')).toEqual({ title: 'Episode 12' });
  });
});
