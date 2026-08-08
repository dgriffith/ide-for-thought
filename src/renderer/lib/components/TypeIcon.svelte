<script lang="ts">
  /**
   * A typed note's type icon, sized to drop into the same slot as an `<Icon>`
   * in a list row (sidebar tree, tabs, quick-open, backlinks).
   *
   * A type's `icon` is a raw emoji/glyph string, not an SVG from the app's icon
   * registry — so this is a text span boxed to `size` rather than an `<svg>`.
   * `◆` is the shared fallback for an icon-less type, matching the Objects
   * panel and the type pickers.
   */
  import type { TypeInfo } from '../../../shared/objects/type-def';

  interface Props {
    type: TypeInfo;
    size?: number;
    /** Tooltip/label. Defaults to the type's label ("Book"). */
    title?: string | undefined;
  }

  let { type, size = 13, title }: Props = $props();
</script>

<span
  class="type-icon"
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{Math.round(size * 0.92)}px"
  style:color={type.color ?? undefined}
  role="img"
  aria-label={title ?? type.label}
  title={title ?? type.label}
>{type.icon ?? '◆'}</span>

<style>
  /* Box to the same footprint as the <Icon> svg it replaces, so a typed and an
     untyped row keep an aligned label column. Emoji overflow their em box at
     small sizes; `overflow: visible` lets them render at full size without
     widening the gutter. */
  .type-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    line-height: 1;
    overflow: visible;
  }
</style>
