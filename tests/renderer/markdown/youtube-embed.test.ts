import { describe, it, expect } from 'vitest';
import { renderYouTubeFence } from '../../../src/renderer/lib/markdown/youtube-embed';

const ID = 'dQw4w9WgXcQ';

describe('renderYouTubeFence', () => {
  it('renders a poster card anchor with the canonical URL and thumbnail', () => {
    const html = renderYouTubeFence(`https://youtu.be/${ID}`);
    expect(html).toContain('class="youtube-embed"');
    expect(html).toContain(`href="https://www.youtube.com/watch?v=${ID}"`);
    expect(html).toContain(`data-youtube-url="https://www.youtube.com/watch?v=${ID}"`);
    expect(html).toContain(`src="https://img.youtube.com/vi/${ID}/hqdefault.jpg"`);
    expect(html).toContain('youtube-embed-play');
    // Opens externally, never frames in-app.
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('uses a caption from the fence body, defaulting to "Watch on YouTube"', () => {
    expect(renderYouTubeFence(`https://youtu.be/${ID}`)).toContain('>Watch on YouTube<');
    const captioned = renderYouTubeFence(`https://youtu.be/${ID}\nRick Astley — Never Gonna Give You Up`);
    expect(captioned).toContain('>Rick Astley — Never Gonna Give You Up<');
  });

  it('escapes a caption so it cannot inject markup', () => {
    const html = renderYouTubeFence(`https://youtu.be/${ID}\n<img src=x onerror=alert(1)>`);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('renders an inline error for a non-YouTube URL (escaped)', () => {
    const html = renderYouTubeFence('https://example.com/<script>');
    expect(html).toContain('youtube-embed-error');
    expect(html).toContain('Unrecognized YouTube URL');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
