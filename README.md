# Minerva

An IDE for AI-assisted human thought.

Minerva is a desktop application for managing markdown-based knowledge bases. It combines a markdown editor with semantic graph indexing, git integration, and tag-based navigation — designed to be a professional tool that stays out of your way.

## Features

- **Markdown editor** — CodeMirror 6 with syntax highlighting, tag autocomplete, and live preview (source, split, or preview modes)
- **Knowledge graph** — RDF-based semantic graph that indexes notes, tags, wiki-links, and frontmatter metadata. Queryable via SPARQL, exportable as Turtle
- **Wiki-links** — `[[note]]` and `[[note|display text]]` syntax for linking between notes
- **Tags** — `#tag` syntax with a tag panel for browsing notes by tag
- **Git integration** — Built-in version control via isomorphic-git (no system git required)
- **Multi-window** — Each project opens in its own independent window
- **File watching** — Automatic sync when files change on disk

## Tech Stack

- **Electron** — Desktop runtime
- **Svelte 5** — UI framework (using runes)
- **TypeScript** — Strict mode throughout
- **CodeMirror 6** — Editor
- **markdown-it** — Rendering
- **rdflib** — Knowledge graph
- **isomorphic-git** — Version control
- **Vite + electron-forge** — Build tooling

## Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Type check
pnpm lint

# Run tests
pnpm test

# Package the appOn
pnpm package

# Build distributable
pnpm build
```

## Project Structure

```
src/
├── main/           # Electron main process
│   ├── notebase/   # File system operations
│   ├── graph/      # RDF knowledge graph
│   └── git/        # Git operations
├── preload/        # Context-isolated IPC bridge
├── renderer/       # Svelte UI
│   └── lib/
│       ├── components/
│       ├── stores/
│       └── ipc/
└── shared/         # Types and IPC channel constants
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+N | New Note |
| Cmd+S | Save |
| Cmd+O | Open Project |
| Cmd+B | Toggle Sidebar |
| Cmd+Shift+P | Cycle View Mode |
| Cmd+Shift+N | New Window |
| Cmd+Shift+W | Close Project |
| Cmd+Shift+C | Commit All |
| Cmd+Shift+R | Reveal in Finder |
| Cmd+F | Find |
| Cmd+H | Find & Replace |

## License

Private — not yet licensed for distribution.
