# Steel (sample theme)

A built-in sample plugin (`src/main/plugins/core.ts`) that contributes one
colour theme: white surfaces, light grey chrome, steel-blue accents.

`themes/steel.json` is exactly the file an installed plugin ships in its own
`themes/` folder (format: `src/main/plugins/themes.ts`, tokens:
`src/shared/theme-tokens.ts`), so it can be copied as the starting point for
a theme of your own. A built-in plugin's theme is bundled into the app rather
than read from disk, and is offered while the plugin is on.
