<script lang="ts">
  interface Props {
    label: string;
  }

  let { label }: Props = $props();
</script>

<div class="overlay">
  <div class="box">
    <div class="spinner" aria-hidden="true"></div>
    <div class="label">{label}</div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 3000;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 18px 22px;
    min-width: 180px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .spinner {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    animation: spin 0.9s linear infinite;
  }

  .label {
    font-size: 12px;
    color: var(--text);
    text-align: center;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
