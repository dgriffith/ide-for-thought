# Hostile plugins

Plugins that try to do what plugin code must not (#2832): each folder is one,
and the spec that drives it says what it attempts and what refuses it.

- `frame/` — a plugin view (#2824). Loaded at `minerva-plugin://hostile/` by
  `tests/e2e/plugin-frame.spec.ts`: it tries the network, inline script,
  navigating itself and the top page, popups, permissions and IPC.
