import { describe, it, expect } from 'vitest';
import { mediaKind, mediaMime } from '../../src/shared/media';
import { linkifyLocalMedia } from '../../src/main/publish/media-export';

describe('mediaKind', () => {
  it('classifies video extensions', () => {
    for (const f of ['clip.mp4', 'a/b/lecture.webm', 'rec.MOV', 'x.m4v', 'y.ogv']) {
      expect(mediaKind(f)).toBe('video');
    }
  });
  it('classifies audio extensions', () => {
    for (const f of ['voice.mp3', 'note.m4a', 'r.WAV', 's.flac', 't.ogg', 'u.opus']) {
      expect(mediaKind(f)).toBe('audio');
    }
  });
  it('returns null for images and other files', () => {
    for (const f of ['pic.png', 'doc.pdf', 'data.csv', 'note.md', 'noext']) {
      expect(mediaKind(f)).toBeNull();
    }
  });
});

describe('mediaMime', () => {
  it('maps known extensions', () => {
    expect(mediaMime('a.mp4')).toBe('video/mp4');
    expect(mediaMime('a.webm')).toBe('video/webm');
    expect(mediaMime('a.mp3')).toBe('audio/mpeg');
    expect(mediaMime('a.wav')).toBe('audio/wav');
  });
  it('falls back for unknown', () => {
    expect(mediaMime('a.xyz')).toBe('application/octet-stream');
  });
});

describe('linkifyLocalMedia (export degrade)', () => {
  it('rewrites a local media image-ref to a link, keeping alt as the label', () => {
    expect(linkifyLocalMedia('![My talk](media/talk.mp4)')).toBe('[My talk](media/talk.mp4)');
  });
  it('uses the filename when there is no alt', () => {
    expect(linkifyLocalMedia('![](audio/voice.mp3)')).toBe('[voice.mp3](audio/voice.mp3)');
  });
  it('leaves real images, remote URLs, and non-media refs alone', () => {
    expect(linkifyLocalMedia('![pic](photo.png)')).toBe('![pic](photo.png)');
    expect(linkifyLocalMedia('![v](https://x.com/v.mp4)')).toBe('![v](https://x.com/v.mp4)');
    expect(linkifyLocalMedia('![](doc.pdf)')).toBe('![](doc.pdf)');
  });
  it('handles multiple refs and leaves surrounding text intact', () => {
    const out = linkifyLocalMedia('See ![](a.mp4) and ![pic](b.png) and ![](c.wav).');
    expect(out).toBe('See [a.mp4](a.mp4) and ![pic](b.png) and [c.wav](c.wav).');
  });
});
