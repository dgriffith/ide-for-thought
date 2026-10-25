# Hostile plugins

Plugins that try to do what plugin code must not (#2832): each folder is one,
and the spec that drives it says what it attempts and what refuses it.

- `frame/` — a plugin view (#2824). Loaded at `minerva-plugin://hostile/` by
  `tests/e2e/plugin-frame.spec.ts`: it tries the network, inline script,
  navigating itself and the top page, popups, permissions and IPC. Through
  the plugin API package it imports (`/@minerva/plugin-api.js`, #2826),
  `tests/e2e/plugin-session.spec.ts` drives it past its scope and its
  capabilities (#2825).
- `worker/` — a plugin's logic (#2830), run in its worker host by
  `tests/e2e/plugin-worker-host.spec.ts`: Node globals and `node:fs`, the
  network and a socket, a handler that throws, one registered late, and a
  loop that never returns.

- `overreach/` — a plugin whose command writes a note and reaches the
  clipboard with only `notes:read` declared (#2833):
  `tests/e2e/cli-plugin-check-code.spec.ts` shows `minerva plugin check`
  failing it, naming each refused call.

The frame's `window.attempts` and the worker's `probe` are the code corpus
(#2832): `PLUGIN_CODE_CORPUS` in `tests/helpers/hostile-plugins.ts` lists
every attempt with the spec that shows it's contained, and
`tests/security/plugin-corpus-coverage.test.ts` fails on an attempt the
table doesn't list or a case whose fixture or spec no longer names it.

