import { describe, it, expect } from 'vitest';
import { parseYouTubeUrl, thumbnailUrl } from '../../../src/shared/youtube/youtube';

describe('parseYouTubeUrl', () => {
  const ID = 'dQw4w9WgXcQ';

  it('parses the canonical watch URL', () => {
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}`)).toEqual({
      id: ID,
      url: `https://www.youtube.com/watch?v=${ID}`,
    });
  });

  it('parses the short youtu.be form', () => {
    expect(parseYouTubeUrl(`https://youtu.be/${ID}`)?.id).toBe(ID);
  });

  it('parses /embed/, /shorts/, /live/, /v/ paths', () => {
    for (const path of ['embed', 'shorts', 'live', 'v']) {
      expect(parseYouTubeUrl(`https://www.youtube.com/${path}/${ID}`)?.id).toBe(ID);
    }
  });

  it('accepts youtube-nocookie and m. / bare hosts', () => {
    expect(parseYouTubeUrl(`https://www.youtube-nocookie.com/embed/${ID}`)?.id).toBe(ID);
    expect(parseYouTubeUrl(`https://m.youtube.com/watch?v=${ID}`)?.id).toBe(ID);
    expect(parseYouTubeUrl(`https://youtube.com/watch?v=${ID}`)?.id).toBe(ID);
  });

  it('tolerates extra query params and normalizes away tracking junk', () => {
    const ref = parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}&list=PLxyz&feature=share`);
    // Only the canonical watch URL survives — list / feature are dropped.
    expect(ref?.url).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });

  it('preserves a timestamp from t= (seconds, 90s, and 1m30s forms)', () => {
    expect(parseYouTubeUrl(`https://youtu.be/${ID}?t=90`)).toMatchObject({ start: 90, url: `https://www.youtube.com/watch?v=${ID}&t=90s` });
    expect(parseYouTubeUrl(`https://youtu.be/${ID}?t=90s`)?.start).toBe(90);
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)?.start).toBe(90);
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`)?.start).toBe(3723);
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}&start=45`)?.start).toBe(45);
  });

  it('accepts a bare 11-char video id', () => {
    expect(parseYouTubeUrl(ID)).toEqual({ id: ID, url: `https://www.youtube.com/watch?v=${ID}` });
    expect(parseYouTubeUrl(`  ${ID}  `)?.id).toBe(ID); // trimmed
  });

  it('accepts schemeless YouTube URLs (address-bar paste without https://)', () => {
    expect(parseYouTubeUrl(`youtube.com/watch?v=${ID}`)?.id).toBe(ID);
    expect(parseYouTubeUrl(`www.youtube.com/watch?v=${ID}`)?.id).toBe(ID);
    expect(parseYouTubeUrl(`youtu.be/${ID}`)?.id).toBe(ID);
    expect(parseYouTubeUrl(`m.youtube.com/watch?v=${ID}`)?.id).toBe(ID);
  });

  it('does not let the schemeless shortcut smuggle another scheme past the protocol check', () => {
    // Not anchored to a YouTube host → left as-is → rejected by the protocol guard.
    expect(parseYouTubeUrl(`javascript:alert(1)//youtube.com/watch?v=${ID}`)).toBeNull();
    expect(parseYouTubeUrl(`data:text/html,youtube.com/watch?v=${ID}`)).toBeNull();
  });

  it('rejects non-YouTube and malformed URLs', () => {
    expect(parseYouTubeUrl('https://vimeo.com/12345')).toBeNull();
    expect(parseYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeUrl('not a url')).toBeNull();
    expect(parseYouTubeUrl('')).toBeNull();
    expect(parseYouTubeUrl('   ')).toBeNull();
  });

  it('rejects non-http(s) schemes (no javascript:/file: smuggling)', () => {
    expect(parseYouTubeUrl(`javascript:alert(1)//youtube.com/watch?v=${ID}`)).toBeNull();
    expect(parseYouTubeUrl(`file:///watch?v=${ID}`)).toBeNull();
  });

  it('rejects a watch URL with a wrong-length / missing id', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseYouTubeUrl('https://www.youtube.com/watch')).toBeNull();
    expect(parseYouTubeUrl('https://youtu.be/')).toBeNull();
  });
});

describe('thumbnailUrl', () => {
  it('builds the https hqdefault thumbnail URL', () => {
    expect(thumbnailUrl('dQw4w9WgXcQ')).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });
});
