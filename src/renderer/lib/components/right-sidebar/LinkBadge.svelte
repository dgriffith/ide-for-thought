<script lang="ts">
  interface Props {
    label: string;
    color: string;
  }

  let { label, color }: Props = $props();
</script>

<span class="link-badge" style:background={color}>{label}</span>

<style>
  .link-badge {
    display: inline-block;
    font-size: 9px;
    font-weight: 600;
    color: var(--bg);
    padding: 1px 4px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    flex-shrink: 0;
  }
</style>
