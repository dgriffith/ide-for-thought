// @vitest-environment jsdom
/**
 * Renderer-side navigation guard (#2554): no link click or file drop may take
 * the window off the renderer's own index.html.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { installNavigationGuard, isAllowedLinkTarget } from '../../../src/renderer/lib/app/navigation-guard';

const DOC = 'file:///Applications/Minerva.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html';

describe('isAllowedLinkTarget (#2554)', () => {
  it('allows http(s), mailto, and fragments of this document', () => {
    expect(isAllowedLinkTarget('https://example.com/x', DOC)).toBe(true);
    expect(isAllowedLinkTarget('http://example.com/x', DOC)).toBe(true);
    expect(isAllowedLinkTarget('mailto:a@b.c', DOC)).toBe(true);
    expect(isAllowedLinkTarget('#section', DOC)).toBe(true);
    expect(isAllowedLinkTarget(`${DOC}#section`, DOC)).toBe(true);
    expect(isAllowedLinkTarget(null, DOC)).toBe(true);
  });

  it('refuses every other file:// target, absolute or relative', () => {
    expect(isAllowedLinkTarget('/Volumes/X/evil.html', DOC)).toBe(false);
    expect(isAllowedLinkTarget('file:///tmp/x.html', DOC)).toBe(false);
    expect(isAllowedLinkTarget('evil.html', DOC)).toBe(false);
    expect(isAllowedLinkTarget('../../../../../../tmp/x.html', DOC)).toBe(false);
    // This document, reloaded or with a query, is a navigation too.
    expect(isAllowedLinkTarget('', DOC)).toBe(false);
    expect(isAllowedLinkTarget('?x=1', DOC)).toBe(false);
  });

  it('under the dev server, refuses same-origin paths and relative hrefs but not other hosts', () => {
    const dev = 'http://localhost:5173/';
    expect(isAllowedLinkTarget('/Volumes/X/evil.html', dev)).toBe(false);
    expect(isAllowedLinkTarget('evil.html', dev)).toBe(false);
    expect(isAllowedLinkTarget('#x', dev)).toBe(true);
    expect(isAllowedLinkTarget('https://example.com/', dev)).toBe(true);
    expect(isAllowedLinkTarget('http://localhost:8080/', dev)).toBe(true);
  });

  it('refuses script, data, blob and custom schemes', () => {
    expect(isAllowedLinkTarget('javascript:alert(1)', DOC)).toBe(false);
    expect(isAllowedLinkTarget('data:text/html,<script>1</script>', DOC)).toBe(false);
    expect(isAllowedLinkTarget('blob:file:///abc', DOC)).toBe(false);
    expect(isAllowedLinkTarget('vscode://open', DOC)).toBe(false);
  });
});

describe('installNavigationGuard (#2554)', () => {
  let uninstall: (() => void) | null = null;
  afterEach(() => {
    uninstall?.();
    uninstall = null;
    document.body.innerHTML = '';
  });

  function click(el: Element, type: 'click' | 'auxclick' = 'click'): MouseEvent {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: type === 'auxclick' ? 1 : 0 });
    el.dispatchEvent(e);
    return e;
  }

  it('cancels a click on a link to a local file, from inside nested markup', () => {
    uninstall = installNavigationGuard();
    document.body.innerHTML = '<div class="preview"><a href="/Volumes/X/evil.html"><strong>open</strong></a></div>';
    expect(click(document.querySelector('strong')!).defaultPrevented).toBe(true);
    expect(click(document.querySelector('a')!, 'auxclick').defaultPrevented).toBe(true);
  });

  it('leaves http(s) and fragment links alone', () => {
    uninstall = installNavigationGuard();
    document.body.innerHTML = '<a id="w" href="https://example.com">w</a><a id="f" href="#top">f</a><span id="s">x</span>';
    expect(click(document.getElementById('w')!).defaultPrevented).toBe(false);
    expect(click(document.getElementById('f')!).defaultPrevented).toBe(false);
    expect(click(document.getElementById('s')!).defaultPrevented).toBe(false);
  });

  it('cancels only the default: the element\'s own click handler still runs', () => {
    uninstall = installNavigationGuard();
    document.body.innerHTML = '<a class="wiki-link" href="other-note.md">n</a>';
    let handled = false;
    document.querySelector('a')!.addEventListener('click', () => { handled = true; });
    expect(click(document.querySelector('a')!).defaultPrevented).toBe(true);
    expect(handled).toBe(true);
  });

  it('cancels an SVG link to a local file (xlink:href)', () => {
    uninstall = installNavigationGuard();
    document.body.innerHTML =
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="file:///tmp/x.html"><text>t</text></a></svg>';
    expect(click(document.querySelector('text')!).defaultPrevented).toBe(true);
  });

  function drag(el: Element, type: 'dragover' | 'drop', types: string[]): DragEvent {
    const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
    const dt = { types, dropEffect: 'copy' };
    Object.defineProperty(e, 'dataTransfer', { value: dt });
    el.dispatchEvent(e);
    return e;
  }

  it('refuses a file drag nothing accepted, with the no-drop cursor', () => {
    uninstall = installNavigationGuard();
    document.body.innerHTML = '<aside id="sidebar"></aside>';
    const over = drag(document.getElementById('sidebar')!, 'dragover', ['Files']);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer!.dropEffect).toBe('none');
    expect(drag(document.getElementById('sidebar')!, 'drop', ['Files']).defaultPrevented).toBe(true);
  });

  it('leaves a drop target that accepted the drag in charge of it', () => {
    uninstall = installNavigationGuard();
    document.body.innerHTML = '<div id="pane"></div>';
    const pane = document.getElementById('pane')!;
    pane.addEventListener('dragover', (e) => {
      e.preventDefault();
      (e).dataTransfer!.dropEffect = 'copy';
    });
    const over = drag(pane, 'dragover', ['Files']);
    expect(over.dataTransfer!.dropEffect).toBe('copy');
  });

  it('ignores in-app drags that carry no files', () => {
    uninstall = installNavigationGuard();
    document.body.innerHTML = '<div id="row"></div>';
    expect(drag(document.getElementById('row')!, 'dragover', ['text/plain']).defaultPrevented).toBe(false);
  });
});
