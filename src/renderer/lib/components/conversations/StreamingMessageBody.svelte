<script lang="ts">
  /**
   * The in-flight assistant reply's body (#2219).
   *
   * Exists because `{@html md.render(text)}` cannot express "update this" — an
   * only-child `{@html}` compiles to `innerHTML = value`, so every delta
   * destroys and rebuilds the whole subtree. That is the dominant renderer cost
   * during streaming and the reason text cannot be selected out of a reply
   * while it is arriving.
   *
   * The markdown semantics are unchanged: the FULL accumulated text is rendered
   * on every update, exactly as before, so the HTML is always byte-identical to
   * what a single render of that text produces. Only the DOM write is
   * incremental. See `conversations/streaming-markdown.ts` for why the split is
   * made on the rendered output and never on the markdown source.
   */
  import { renderMarkdown } from '../../conversations/markdown-render';
  import { patchRenderedMarkdown } from '../../conversations/streaming-markdown';

  interface Props {
    /** The accumulated markdown so far. */
    text: string;
    /** Class for the host element, so the caller keeps its own styling hook. */
    class?: string;
  }

  let { text, class: className = '' }: Props = $props();

  let host = $state<HTMLDivElement>();

  // Detached parse target, created once and reused. Detached is load-bearing:
  // parsing HTML into a node that is not in the document costs no style recalc,
  // layout or paint, which is what makes this cheaper than writing the same
  // HTML straight onto the live element.
  const scratch = document.createElement('div');

  $effect(() => {
    // Read `text` unconditionally so the effect tracks it even when `host` is
    // not bound yet on the very first run.
    const src = text;
    if (!host) return;
    patchRenderedMarkdown(host, scratch, renderMarkdown(src));
  });
</script>

<div class={className} bind:this={host}></div>
