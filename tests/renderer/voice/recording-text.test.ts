import { describe, it, expect } from 'vitest';
import {
  recordingExtension,
  recordingPath,
  recordingNoteTitle,
  embedInsertion,
  audioEmbedsIn,
  audioEmbedOnLine,
  findAudioEmbed,
  transcriptInsertion,
  transcriptCallout,
  transcriptAfter,
  joinSegments,
  formatElapsed,
} from '../../../src/renderer/lib/voice/recording-text';

function apply(doc: string, change: { at: number; insert: string }): string {
  return doc.slice(0, change.at) + change.insert + doc.slice(change.at);
}

describe('recording paths', () => {
  const at = new Date(2026, 9, 8, 14, 32, 59);

  it('names a recording by local date and minute, as audio-classified WebM', () => {
    expect(recordingPath(at, recordingExtension('audio/webm;codecs=opus')))
      .toBe('assets/recordings/2026-10-08-1432.weba');
  });

  it('suffixes a second recording in the same minute', () => {
    expect(recordingPath(at, 'weba', 2)).toBe('assets/recordings/2026-10-08-1432-2.weba');
  });

  it('keeps ogg and mp4 recordings in their own containers', () => {
    expect(recordingExtension('audio/ogg;codecs=opus')).toBe('ogg');
    expect(recordingExtension('audio/mp4')).toBe('m4a');
    expect(recordingExtension('')).toBe('weba');
  });

  it('titles a holder note without characters that are awkward in filenames', () => {
    expect(recordingNoteTitle(at)).toBe('Recording 2026-10-08 14.32');
  });
});

describe('embedInsertion', () => {
  const embed = '![](rec.weba)';

  it('inserts on an empty line as-is', () => {
    expect(apply('a\n\nb', embedInsertion('a\n\nb', 2, embed))).toBe('a\n![](rec.weba)\nb');
  });

  it('breaks out of the middle of a line', () => {
    expect(apply('hello world', embedInsertion('hello world', 5, embed)))
      .toBe('hello\n![](rec.weba)\n world');
  });

  it('handles the start and end of the document', () => {
    expect(apply('', embedInsertion('', 0, embed))).toBe('![](rec.weba)');
    expect(apply('text', embedInsertion('text', 4, embed))).toBe('text\n![](rec.weba)');
  });
});

describe('finding audio embeds', () => {
  const doc = [
    '# Meeting',
    '![](pic.png) and ![](../assets/recordings/a.weba "standup")',
    '![clip](video.webm)',
    '![](assets/recordings/my%20talk.mp3)',
  ].join('\n');

  it('finds audio embeds only, with their note-relative targets', () => {
    expect(audioEmbedsIn(doc).map((e) => e.target)).toEqual([
      '../assets/recordings/a.weba',
      'assets/recordings/my%20talk.mp3',
    ]);
  });

  it('finds the embed on the cursor line, wherever the cursor is on it', () => {
    const line2 = doc.indexOf('![](pic');
    for (const pos of [line2, line2 + 3, doc.indexOf('\n![clip')]) {
      expect(audioEmbedOnLine(doc, pos)?.target).toBe('../assets/recordings/a.weba');
    }
    expect(audioEmbedOnLine(doc, 2)).toBeNull(); // the heading line
    expect(audioEmbedOnLine(doc, doc.indexOf('![clip'))).toBeNull(); // video
  });

  it('reports where the embed ends, for placing the transcript', () => {
    const e = findAudioEmbed(doc, '../assets/recordings/a.weba')!;
    expect(doc.slice(0, e.end).endsWith('"standup")')).toBe(true);
    expect(findAudioEmbed(doc, 'missing.weba')).toBeNull();
  });
});

describe('transcriptCallout', () => {
  it('wraps paragraphs in a default-collapsed transcript callout', () => {
    expect(transcriptCallout('First part.\n\nSecond part.')).toBe(
      '> [!transcript]- Transcript\n> First part.\n>\n> Second part.',
    );
  });
});

describe('transcriptInsertion', () => {
  const T = '> [!transcript]- Transcript\n> Hi.';

  it('adds the transcript callout below the embed, before the next block', () => {
    const doc = 'intro\n![](a.weba)\nnext line';
    const e = findAudioEmbed(doc, 'a.weba')!;
    expect(apply(doc, transcriptInsertion(doc, e.end, 'Hi.')))
      .toBe(`intro\n![](a.weba)\n\n${T}\n\nnext line`);
  });

  it('keeps an existing blank line rather than doubling it', () => {
    const doc = '![](a.weba)\n\nnext';
    expect(apply(doc, transcriptInsertion(doc, 11, 'Hi.'))).toBe(`![](a.weba)\n\n${T}\n\nnext`);
  });

  it('ends the document with one newline', () => {
    expect(apply('![](a.weba)', transcriptInsertion('![](a.weba)', 11, 'Hi.'))).toBe(`![](a.weba)\n\n${T}\n`);
    expect(apply('![](a.weba)\n', transcriptInsertion('![](a.weba)\n', 11, 'Hi.'))).toBe(`![](a.weba)\n\n${T}\n`);
  });

  it('goes after any text that shares the embed line', () => {
    const doc = '![](a.weba) — standup';
    expect(apply(doc, transcriptInsertion(doc, 11, 'Hi.'))).toBe(`![](a.weba) — standup\n\n${T}\n`);
  });
});

describe('transcriptAfter', () => {
  it('finds the transcript callout written for an embed, and its whole span', () => {
    const doc = '![](a.weba)';
    const withT = apply(doc, transcriptInsertion(doc, 11, 'One.\n\nTwo.')) + '\nAfter';
    const span = transcriptAfter(withT, 11)!;
    expect(withT.slice(span.start, span.end)).toBe('> [!transcript]- Transcript\n> One.\n>\n> Two.');
  });

  it('ends the span where the `>` lines stop', () => {
    const doc = '![](a.weba)\n\n> [!transcript]- Transcript\n> Hi.\n\n> unrelated quote';
    const span = transcriptAfter(doc, 11)!;
    expect(doc.slice(span.start, span.end)).toBe('> [!transcript]- Transcript\n> Hi.');
  });

  it('is null when the next block is not a transcript', () => {
    expect(transcriptAfter('![](a.weba)\n\nJust text', 11)).toBeNull();
    expect(transcriptAfter('![](a.weba)\n\n> [!summary] Summary\n> S', 11)).toBeNull();
    expect(transcriptAfter('![](a.weba)', 11)).toBeNull();
  });
});

describe('joinSegments', () => {
  it('makes one paragraph per segment and drops empty ones', () => {
    expect(joinSegments([' one. ', '', 'two.'])).toBe('one.\n\ntwo.');
    expect(joinSegments([])).toBe('');
  });
});

describe('formatElapsed', () => {
  it('shows m:ss under an hour and h:mm:ss from an hour', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(134)).toBe('2:14');
    expect(formatElapsed(3599)).toBe('59:59');
    expect(formatElapsed(3600 + 65)).toBe('1:01:05');
  });
});
