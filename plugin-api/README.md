# Minerva plugin API

What plugin code inside Minerva imports (#2826). **Generated** — `index.js`,
`index.d.ts` and `abi.json` come from `src/shared/plugins/api.ts` by
`node scripts/build-plugin-api.mjs`. Don't edit them.

```js
import { connect } from '/@minerva/plugin-api.js';

const minerva = await connect();
const { paths } = await minerva.notes.list();
await minerva.notes.setProperties({ path: paths[0], properties: { status: 'done' } });
```

- **Served by Minerva**, at `/@minerva/plugin-api.js` on every plugin frame's
  own origin, so it always matches the Minerva running it. That path is
  reserved: a plugin's own file there is never served.
- **Each method needs one capability**, declared in `plugin.json` under
  `code.capabilities`. A call without it rejects with a `PluginApiError`
  whose `code` is `capability`; one naming a note the view wasn't given,
  `scope`. The codes are in `index.d.ts`.
- **Versioned on its own**: `PLUGIN_API_VERSION`, not the app's version.
  Declare the range you wrote for as `code.api` (`"^1.0.0"`). A breaking
  change bumps the major and keeps the old shape for one major; `abi.json` is
  the snapshot each change is checked against.
- Only plugins built into Minerva can declare code today; installed plugins
  follow with #2833. Design: `docs/plugin-code.md`.
