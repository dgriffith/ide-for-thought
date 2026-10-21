# Built-in plugin views

The source of the views Minerva's built-in plugins draw in a plugin frame
(#2828, design `docs/plugin-code.md`). Each folder is one plugin's view:
`index.html` and its source, built by `pnpm core-plugins:build`
(`vite.core-plugins.config.mts`) into `.vite/core-plugins/<id>/`, packaged
into `app.asar`, and served at `minerva-plugin://<id>/`.

**A built-in plugin reaches only what an installed one could.** Code here may
import its own folder, the plugin API (`/@minerva/plugin-api.js`, served by
Minerva — never bundled), and pure modules from `src/shared/` (bundled in).
Never `src/renderer/` or `src/main/`.
`tests/architecture/plugin-source-boundary.test.ts` holds it.
