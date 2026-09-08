/**
 * Plain deep clone for the IPC boundary. Every payload sent renderer→main must
 * be detached from Svelte's reactive `$state` proxies first — Electron's
 * structured clone rejects them. A JSON round-trip is the one safe snapshot for
 * all of them: unlike `$state.snapshot`, it strips any lingering Proxy wrapping
 * unconditionally and survives dynamic-key payloads (the `PropertyUpdate` inner
 * `Record<string, unknown>` once arrived empty on the main side after
 * `$state.snapshot` → structured-clone — the "set_properties approved but no
 * frontmatter landed" bug). Persisted config/drafts are disk-stored as JSON, so
 * the round-trip is lossless. (#1629)
 */
export function plainSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
