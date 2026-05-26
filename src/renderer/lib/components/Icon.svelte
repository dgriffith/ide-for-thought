<script lang="ts">
  import { ICONS, type IconName } from './icons/registry';

  interface Props {
    name: IconName;
    size?: number;
    color?: string;
    title?: string;
  }

  let { name, size = 16, color, title }: Props = $props();

  const path = $derived(ICONS[name]);
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke={color ?? 'currentColor'}
  stroke-width="1.4"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={title ? 'img' : undefined}
  aria-label={title}
  aria-hidden={title ? undefined : true}
  style="display:block;flex-shrink:0"
>
  {@html path}
</svg>
