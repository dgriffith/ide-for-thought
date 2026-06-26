import { describe, it, expect } from 'vitest';
import { renderYouTubeBlocks, hasYouTubeBlocks } from '../../../src/main/publish/youtube-render';

const ID = 'dQw4w9WgXcQ';

describe('renderYouTubeBlocks (export degrade)', () => {
  it('replaces a youtube fence with a linked-thumbnail markdown image', () => {
    const md = '# Note\n\n```youtube\nhttps://youtu.be/' + ID + '\n```\n\nAfter.';
    const out = renderYouTubeBlocks(md);
    expect(out).toContain(
      `[![Watch on YouTube](https://img.youtube.com/vi/${ID}/hqdefault.jpg)](https://www.youtube.com/watch?v=${ID})`,
    );
    // Surrounding prose is preserved; the fence is gone.
    expect(out).toContain('# Note');
    expect(out).toContain('After.');
    expect(out).not.toContain('```youtube');
  });

  it('uses the fence caption as the image alt text', () => {
    const md = '```youtube\nhttps://www.youtube.com/watch?v=' + ID + '\nMy Talk\n```';
    expect(renderYouTubeBlocks(md)).toContain(`[![My Talk](https://img.youtube.com/vi/${ID}/hqdefault.jpg)]`);
  });

  it('degrades a bad URL to an italic note rather than a broken image', () => {
    const md = '```youtube\nhttps://vimeo.com/12345\n```';
    const out = renderYouTubeBlocks(md);
    expect(out).toContain('Video could not be embedded');
    expect(out).not.toContain('img.youtube.com');
  });

  it('leaves markdown without youtube fences untouched', () => {
    const md = '# Just text\n\n```python\nprint(1)\n```\n';
    expect(renderYouTubeBlocks(md)).toBe(md);
    expect(hasYouTubeBlocks(md)).toBe(false);
  });

  it('handles multiple fences in one document', () => {
    const md = '```youtube\nhttps://youtu.be/' + ID + '\n```\n\n```youtube\nhttps://youtu.be/' + ID + '\n```';
    const matches = renderYouTubeBlocks(md).match(/img\.youtube\.com/g);
    expect(matches).toHaveLength(2);
  });
});
