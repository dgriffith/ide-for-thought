# __PLUGIN_NAME__

A Minerva plugin with an MCP server, made by `minerva plugin new --mcp node`.

- `plugin.json` declares the plugin, its `memoFile` setting, the `memos`
  server (`node server/index.js`) and the Memos skill.
- `server/index.js` is the server: `list_memos` (read-only, so the assistant calls
  it freely) and `add_memo` (it writes, so Minerva asks first).
- `test/server.test.js` drives the server over stdio. Run it with `npm test`.
- `skills/memos.md` is a skill that can reach this server's tools, and only
  those: `tools: [mcp:memos]`.

## Try it

1. Settings → Plugins → **Install from folder…**, and pick this folder. (Or
   link it into `~/.minerva/plugins/__PLUGIN_ID__` to work on it in place.)
2. Settings → MCP Servers: switch on **__PLUGIN_ID__.memos**. Minerva shows
   the exact command and asks before it runs anything.
3. Run **Memos** from the Analysis menu, or ask the assistant to list your memos.

## Make it yours

Replace the two tools with your own, keeping `readOnlyHint: true` only on
tools that change nothing. The server speaks the protocol with no
dependencies; move to `@modelcontextprotocol/sdk` when you need more. Bump `version` in
`plugin.json` when you change the server: Minerva then asks again before
running the new one.

See Minerva's docs/authoring-plugins.md for everything `plugin.json` can say.
