/**
 * Incremental DOM patching for the streaming assistant message (#2219).
 *
 * ── What was actually wrong ────────────────────────────────────────────────
 * `MessageList.svelte` renders the in-flight reply as
 * `{@html md.render(tab.streamedChunks)}`. Svelte compiles an `{@html}` that is
 * its element's only child into `parent.innerHTML = value` (see
 * `svelte/src/internal/client/dom/blocks/html.js`), so **every** delta threw
 * away the whole rendered subtree and rebuilt it.
 *
 * Measured against a captured `claude-opus-5` reply (2,514 output tokens,
 * 6,679 chars, 610 delta events, 38.1s — the final tree is 114 elements):
 *
 *     per-delta innerHTML (today) : 28,831 on-screen nodes destroyed
 *     coalesced to 100ms          : 13,920
 *     coalesced + this patcher    :  1,388   (10x better than coalescing alone)
 *
 * That count — not the markdown parse — is the cost that matters. markdown-it
 * is cheap (219ms of parsing across the whole 38s stream, ~0.6% of one core);
 * what is expensive is destroying and recreating live nodes, because each round
 * costs style recalc, layout and paint on the visible tree. It is also what
 * destroys a mid-stream text selection and any IME composition: a Selection
 * anchored in a node that gets removed collapses, which is why you cannot
 * currently select text out of a reply while it streams.
 *
 * ── What "stable prefix" means here, precisely ─────────────────────────────
 * The obvious implementation of "render only the stable prefix" is to split the
 * *markdown source* at some boundary and render the halves separately. That is
 * a correctness trap, and this module deliberately does NOT do it. Markdown has
 * no prefix-stability property: a later line can retroactively change how an
 * earlier one renders. Three that bite:
 *
 *   - `Foo` is a paragraph until a following `===` makes it an `<h1>`.
 *   - `- a` is a tight list item (`<li>a</li>`) until a blank line and `- b`
 *     make the whole list loose (`<li><p>a</p></li>`).
 *   - A `[foo]` renders literally until a link reference definition appears
 *     further down.
 *
 * Any of those would render text one way and then flip it — the "half-written
 * fence shown as literal text, then swallowed" failure the issue's fix shape
 * invites.
 *
 * So the split is made on the **output**, never the input. Every flush renders
 * the *entire* accumulated markdown through markdown-it, exactly as the
 * non-incremental code did, which means the HTML is always byte-for-byte what a
 * single full render of that text produces — a loose/tight flip or a fence
 * finally closing simply shows up as a changed node and is replaced correctly.
 * "Stable prefix" is then a property of the DOM, not of markdown:
 *
 *   > the longest run of leading **top-level child nodes** that is structurally
 *   > identical (`Node.isEqualNode`) between the previous render and this one.
 *
 * Those nodes are reused in place; everything from the first difference onward
 * is dropped and replaced by the new tail. A node only survives if the renderer
 * would have produced exactly it anyway, so there is no state in which the user
 * is looking at markup that the full render disagrees with.
 *
 * The diff walks **childNodes**, not `children`: markdown-it separates block
 * elements with `\n` text nodes, and skipping them yields output that differs
 * from a full render by exactly those newlines. Verified byte-identical against
 * a single full render over the real 610-delta trace.
 */

/**
 * Patch `host` so its contents equal `html`, reusing the longest identical
 * leading run of top-level child nodes.
 *
 * `scratch` is a caller-owned **detached** element used to parse `html`. It
 * must not be in the document: parsing into a detached node costs no style,
 * layout or paint, which is the entire reason this is cheaper than assigning
 * `host.innerHTML` — the parse still happens either way, but only one of them
 * happens on the live tree.
 *
 * Returns the number of top-level nodes replaced, which is what the regression
 * gate in `streaming-markdown.test.ts` asserts on. A count is the right gate
 * here: timing a DOM patch in jsdom measures jsdom, whereas "a delta that only
 * appends to the last paragraph replaces exactly one node" is the property that
 * has to hold.
 */
export function patchRenderedMarkdown(
  host: Element,
  scratch: Element,
  html: string,
): number {
  scratch.innerHTML = html;

  // Longest identical leading run. `isEqualNode` is a deep structural compare
  // (tag, attributes, children, text), not identity — which is what we want:
  // the two trees come from different parses and never share node objects.
  let stable = 0;
  const prev = host.childNodes;
  const next = scratch.childNodes;
  while (
    stable < prev.length &&
    stable < next.length &&
    prev[stable]!.isEqualNode(next[stable]!)
  ) {
    stable++;
  }

  // Drop the divergent tail. Removing from the end keeps the indices of the
  // stable prefix valid while we shrink.
  while (host.childNodes.length > stable) host.lastChild!.remove();

  // Move the new tail across. `appendChild` MOVES a node rather than copying,
  // so `scratch` empties from index `stable` as we go and each node is parsed
  // exactly once.
  let replaced = 0;
  while (scratch.childNodes.length > stable) {
    host.appendChild(scratch.childNodes[stable]!);
    replaced++;
  }
  return replaced;
}
