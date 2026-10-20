import { describe, it, expect } from 'vitest';
import { isPluginFrameUrl, PLUGIN_FRAME_SANDBOX, pluginFrameOrigin, pluginIdOfUrl } from '../../../src/shared/plugins/frame';

describe('plugin frame origins (#2824)', () => {
  it('gives each plugin its own origin, and reads the id back from a URL or an origin', () => {
    expect(pluginFrameOrigin('kanban')).toBe('minerva-plugin://kanban');
    expect(pluginIdOfUrl('minerva-plugin://kanban/index.html?x#y')).toBe('kanban');
    expect(pluginIdOfUrl(pluginFrameOrigin('kanban'))).toBe('kanban');
    // Two plugins never share one. (Node's URL reports `'null'` for a scheme it
    // doesn't know; Chromium registers it standard — the e2e reads the real one.)
    expect(pluginFrameOrigin('kanban')).not.toBe(pluginFrameOrigin('timeline'));
  });

  it('names nothing on any other scheme', () => {
    for (const url of ['app://minerva/index.html', 'https://kanban/', 'file:///x', 'null', '', 'minerva-plugin:']) {
      expect(pluginIdOfUrl(url), url).toBeNull();
      expect(isPluginFrameUrl(url), url).toBe(false);
    }
  });

  it('sandboxes with scripts and its own origin only: no popups, top navigation, forms or modals', () => {
    expect(PLUGIN_FRAME_SANDBOX.split(' ').sort()).toEqual(['allow-same-origin', 'allow-scripts']);
  });
});
