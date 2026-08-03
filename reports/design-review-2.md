# Minerva — Design Review, Round 2 (Consistency & Drift)

> Companion to `Minerva Design Review 2.html`. Round 1 (`IMPLEMENTATION.md`)
> is largely shipped — this round is about **drift**: newer and deeper
> surfaces built to older or foreign specs. Ordered by impact.

## What landed (round 1)

Confirmed integrated, no action needed: the token palette (Honey paper-on-ink
+ AA-tuned faint tier), the full IBM Plex family, the custom icon registry,
  the 42px serif-breadcrumb title bar, the status bar (saved cue + tabular
  nums + hairline rules), all seven UI primitives, the two-pane Conversations
  dock, serif note headings (§8.1), callouts + highlights with no danger red,
  the grouped right-sidebar ribbon, the About dialog, and the density system.

The six items below are what's left.

---

## 1. Code-surface theming — replace oneDark  *(high)*

**The single highest-impact fix.** The note editor's syntax palette is
`oneDark`, an off-the-shelf cold-blue theme that ignores every design token.

### Where it leaks

- `src/renderer/lib/editor/editor-theme.ts:16` — `cmTheme()` returns
  `oneDark` in dark mode.
- `src/renderer/lib/components/QueryPanel.svelte:16,168` — imports and
  applies `oneDark` for the SPARQL/SQL editor.

The result: `#282c34` slabs and `#c678dd`/`#61afef`/`#98c379` syntax colors
sit inside the warm paper chrome. In **light/contrast** mode the dark oneDark
box is still applied in QueryPanel's `isDark()` branch only — verify the
light path doesn't fall back to an unstyled CodeMirror default either.

### The fix

Build **one** `HighlightStyle` from the tokens and share it across the editor,
the query panel, and rendered code fences (`Preview.svelte`):

```ts
// src/renderer/lib/editor/minerva-highlight.ts
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Reads the CSS custom properties so it re-skins on theme swap. Because
// CodeMirror wants concrete colors, resolve them from a probe element at
// build time (getComputedStyle on document.documentElement) and rebuild
// on the same theme-change hook GraphCanvas.updateTheme() already uses.
export function minervaHighlightStyle(resolve: (v: string) => string) {
  const c = (v: string) => resolve(v);
  return HighlightStyle.define([
    { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: c('--iris') },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: c('--accent') },
    { tag: [t.string, t.special(t.string)], color: c('--sage') },
    { tag: [t.number, t.bool, t.null], color: c('--rust') },
    { tag: [t.comment, t.lineComment, t.blockComment], color: c('--text-faint'), fontStyle: 'italic' },
    { tag: [t.operator, t.punctuation, t.separator], color: c('--text-muted') },
    { tag: [t.variableName, t.propertyName], color: c('--text') },
    { tag: [t.heading], color: c('--accent'), fontWeight: '600' },
    { tag: [t.link, t.url], color: c('--accent') },
    { tag: [t.emphasis], fontStyle: 'italic' },
    { tag: [t.strong], fontWeight: '600' },
  ]);
}
```

- `cmTheme()` drops the `oneDark` branch entirely and returns just the
  token-driven `EditorView.theme` for the surface chrome
  (background `var(--bg)`, selection, cursor). `minervaEditorTheme()` stays.
- QueryPanel imports the same `minervaHighlightStyle` + `syntaxHighlighting`
  instead of `oneDark`. Delete the `@codemirror/theme-one-dark` dependency
  once both callers are migrated.
- Re-skin on theme change through the existing hook (the one
  `GraphCanvas.updateTheme()` uses) so palette swaps stay live.

The design canvas ("1 · Code-surface theming") shows the target palette:
iris keywords, honey functions, sage strings, rust numbers, faint-italic
comments. Verify AA contrast on `--bg-inset` for each in all three themes.

---

## 2. Plex Mono never reached the code surfaces  *(high)*

Body + chrome moved to Plex, but seven surfaces still hardcode a mono stack
that resolves to **SF Mono / Menlo** — so the most code-like parts of the app
are the ones *not* in the brand mono.

### The offenders (swap each to `var(--font-mono)`)

| File | What | Current stack |
|---|---|---|
| `Preview.svelte:1887` | cite-tooltip meta | `'SF Mono', 'Fira Code'` |
| `SourceDetail.svelte:984,1327` | `.mono` (source id, refs) | `'SF Mono', 'Fira Code'` |
| `right-sidebar/ProposalsPanel.svelte:475,492` | op / node id | `'SF Mono', 'Fira Code'` |
| `QueryPanel.svelte:237` | results grid | `'SF Mono', 'Fira Code', 'Cascadia'` |
| `right-sidebar/PropertiesPanel.svelte:884,1004` | raw-yaml / keys | `ui-monospace, SFMono, Menlo` |
| `ComputeDraftCard.svelte:262,281,323,327` | stdout / preview | `ui-monospace, SFMono, Menlo` |
| `right-sidebar/AutocompleteDropdown.svelte:223` | completion detail | `ui-monospace, SFMono, Menlo` |

Pure find-and-replace, but do it as one pass so file paths, node ids, query
results, YAML and stdout all render in the same Plex Mono the gutter and code
fences already use.

### Required: a guard so this can't regress

Add a mono-literal check to the existing pre-push hook so a stray
`SF Mono` / `Fira Code` / `SFMono-Regular` can't slip back in. The hook
already runs `pnpm lint` (`.githooks/pre-push`) — add a step before it:

```json
// package.json → scripts
"lint:fonts": "! grep -rnE \"SF Mono|Fira Code|SFMono-Regular|'Cascadia\" src/renderer --include=*.svelte --include=*.ts",
```

```sh
# .githooks/pre-push — run before pnpm lint
pnpm lint:fonts || {
  echo 'error: hardcoded mono font literal found — use var(--font-mono). See REVIEW-2.md §2.'
  exit 1
}
```

`grep` exits 0 when it finds a match, so the leading `!` inverts it: the
script passes only when there are **no** hits. `ui-monospace, SFMono-Regular,
…` fallback stacks are intentionally caught too — migrate those to
`var(--font-mono)` as well (Plex Mono already carries its own fallback
chain in the `--font-mono` definition, so the local fallback is redundant).
Bypass for a genuine exception is the same `--no-verify` / `SKIP_HOOKS=1`
escape the hook already documents, but there should be no exceptions here.

> Prefer a stylelint rule if the project adds stylelint later
> (`declaration-property-value-disallowed-list` on `font-family`), but the
> grep guard is zero-dependency and matches the existing hook's style.

---

## 3. SourceDetail was written to the pre-review spec  *(medium)*

The note **Preview** got the §8.1 treatment; the parallel **Source reading
surface** (`SourceDetail.svelte`) didn't. It's the most-visible drifted screen.

Current (see `SourceDetail.svelte` styles):
- `h1 { font-size: 26px; font-weight: 600 }` — sans bold, not serif display.
- `h2 { font-size: 15px; font-weight: 600; text-transform: uppercase; color: var(--text-muted) }`
  — the old uppercase-label pattern, not eyebrow + serif.
- `.mono { font-family: 'SF Mono', 'Fira Code' }` (see §2).
- Tools menu uses a `▾` Unicode caret; tag chips use a `×` remove glyph and
  `border-radius: 10px`.

Bring it in line with the note surface and the round-1 Citations panel:
- **Title** → `var(--font-display)`, 30px, weight 500, `-0.01em`.
- **Byline** → italic display serif, `var(--text-muted)` (matches Citations).
- **Section headings** ("Abstract", "Excerpts (N)", "Notes", "References",
  "Referenced from") → the shared **Eyebrow** primitive (mono-uppercase) with
  the count in accent, *not* a bold uppercase sans `<h2>`.
- **Tags** → the shared **Chip** primitive: pill radius, `<Icon name="close">`
  not `×`, `+ tag` with `<Icon name="plus">`.
- **Tools caret** → `<Icon name="chevronDown" size={11}>`.
- **Abstract body** → optional italic display serif for the editorial feel
  (see canvas frame 3).

The subtype badge, metadata grid, read-status segmented control and
excerpt/backlink lists are structurally fine — this is a type + chip + icon
pass, not a re-layout.

---

## 4. The § numeral is a global default  *(medium)*

`Preview.svelte` `.preview { counter-reset: h2 }` + `h2::before { content: '§ '
counter(h2, decimal-leading-zero) }` fires on **every** note. Lovely on an
essay; on a journal or grocery list it prepends "§ 01" to "Groceries".

### The fix — make it opt-in

- Gate the counter on a `numbered: true` frontmatter flag (or a
  `.preview.numbered` class the renderer adds when it sees the flag), default
  **off**.
- Scope both the `counter-reset` and the `::before` under that class:
  ```css
  .preview.numbered { counter-reset: h2; }
  .preview.numbered :global(h2) { counter-increment: h2; }
  .preview.numbered :global(h2)::before { content: '§ ' counter(h2, decimal-leading-zero); /* … */ }
  ```
- Keep the serif H2 itself unconditional — only the numeral is gated.
- The same flag should drive the CodeMirror source-mode decoration if one
  exists, so source and preview agree.

Optional: expose it in the New Note dialog for the "essay" note type so
long-form notes get it automatically.

---

## 5. Two owls — keep both, make them rhyme  *(low)*

You chose to keep both scales: the night-sky owl (`assets/minerva-icon.svg`)
for the dock, the monoline `minervaMark` for 16px chrome. Correct call — but
they don't currently relate. The app icon is a full owl with a honey-brass
face and glowing eyes; the in-app mark is three flat accent rings that read
as an aperture or target, not an owl.

### The fix — the mark is a crop of the app owl's eye

Redraw `minervaMark` in `icons/registry.ts` so at 14–16px it reads as an owl's
eye looking back:

```ts
// concentric owl-eye: outer socket ring, honey iris fill, dark pupil, catchlight
minervaMark:
  '<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.4"/>' +
  '<circle cx="8" cy="8" r="4.2" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="1.2"/>' +
  '<circle cx="8" cy="8" r="1.7" fill="currentColor"/>' +
  '<circle cx="7.2" cy="7.2" r="0.6" fill="#fff" fill-opacity="0.7"/>',
```

- Iris fill + dark pupil + catchlight give it a gaze; the ring proportions
  match the app owl's socket/iris/pupil ratio.
- It still resolves to `currentColor` so it inherits the accent in the title
  bar and the muted tone wherever else it appears.
- Verify it reads at 14px in the title bar and 12px if used inline. The
  canvas ("5 · Two owls") shows a 44 → 16px ramp beside the dock icon.

No change to `minerva-icon.svg` (the dock icon is doing its job).

---

## 6. Tagline casing  *(low)*

`AboutDialog.svelte` ships `Thoughts Worth Keeping` (title case). The
onboarding brand panel already uses sentence case. Title case reads as a
product-name boast — the exact register the round-1 tagline change moved away
from.

- Standardize on **"Thoughts worth keeping."** — sentence case, italic
  display serif, trailing full stop — everywhere the tagline appears.
- `AboutDialog.svelte` `.tagline` → set the text and `font-style: italic`,
  `font-family: var(--font-display)`.
- Grep for the string to catch any other occurrences (menu About, window
  title, marketing copy in-repo).

---

## Suggested order for Claude Code

Each is independently shippable. Recommended sequence:

1. **§2 Plex Mono swap** — trivial, mechanical, immediate consistency win.
2. **§6 Tagline** — one string.
3. **§5 Mark redraw** — one icon entry.
4. **§4 § numeral opt-in** — small, contained CSS + flag.
5. **§3 SourceDetail** — a type/chip/icon pass on one file.
6. **§1 Code-surface theme** — the largest; do last, most careful, most
   valuable. Needs the theme-resolve-and-rebuild plumbing and AA checks in
   all three themes.

## Validation

- After §1: open a note and a query tab in dark, light, and contrast — syntax
  colors should be the warm palette in all three, no `#282c34` box anywhere.
- After §2: `pnpm lint:fonts` passes (no `SF Mono`/`Fira Code`/`SFMono-Regular`
  literals in `.svelte`/`.ts`), and the pre-push hook blocks any reintroduction.
- After §3: the Source screen and a note screen sit side by side with matching
  heading type, chips, and mono.
- After §4: a note with no frontmatter shows unnumbered H2s; adding
  `numbered: true` restores the § numerals.
- After §5/§6: the title-bar mark reads as an eye; About and onboarding show
  the identical sentence-case tagline.
