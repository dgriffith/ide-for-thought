# Minerva — Design Review Implementation Spec

> A handoff doc for Claude Code. Pairs with `Minerva Design Review.html` —
> open that file alongside this spec to see the proposed surfaces.

## 0. Read order

1. `Minerva Design Review.html` — visual reference (current → proposed pairs).
2. This spec — concrete code changes, ordered low-risk → high-risk.
3. `CLAUDE.md` — design philosophy the spec must respect.

## 1. Non-negotiables (from `CLAUDE.md`)

- **No danger styling.** Delete and other destructive verbs use the accent
  color, never red. The proposed Confirm dialog explicitly keeps Delete on
  the accent.
- **"Don't ask again" stays.** Every Confirm dialog must keep the checkbox
  unless `hideDontAskAgain` is set. The redesign keeps the checkbox in the
  same place; only the visual style changes.
- **Stay out of the way.** Don't add new modals, toasts, or interstitials.
  Every proposed surface replaces an existing one 1:1 — no net new flow.
- **Hidden files / `IGNORED_DIRS` filtering** is unchanged. Sidebar redesign
  is purely visual.

## 2. Order of operations

Land in this order so each PR is small and ships value:

1. **Tokens + fonts** (Section 3) — biggest visual lift, zero behavior change.
2. **Custom SVG icon set** (Section 4) — drop-in for every Unicode glyph.
3. **Left sidebar polish** (Section 5).
4. **Right sidebar regroup** (Section 6).
5. **Chrome — title / tab / status bar** (Section 7).
6. **Editor surface** (Section 8) — type, callouts, code, math.
7. **Conversations dock** (Section 9).
8. **Dialogs sweep** (Section 10) — common, palette, settings, misc.
9. **Onboarding** (Section 11).

Each step is shippable on its own and can be hidden behind a feature flag if
needed. Steps 1-2 are the only true dependencies — everything after assumes
both have landed.

---

## 3. Tokens + fonts

### 3.1 Replace `:root` palette in `src/renderer/styles/global.css`

Current Catppuccin Mocha → warm paper-on-ink. Drop these vars in (keep the
existing ones around, mapped to the new vars, so component CSS that hasn't
been updated yet still resolves).

```css
:root {
  /* ── Honey · default warm palette ────────────────────────────────── */
  --bg:           oklch(0.205 0.012 70);
  --bg-elev:      oklch(0.245 0.012 70);
  --bg-elev-2:    oklch(0.285 0.014 70);
  --bg-inset:     oklch(0.175 0.010 70);
  --text:         oklch(0.925 0.018 85);
  --text-muted:   oklch(0.680 0.018 80);
  --text-faint:   oklch(0.520 0.015 75);
  --border:       oklch(0.330 0.012 70);
  --border-strong: oklch(0.420 0.014 70);
  --accent:       oklch(0.790 0.115 78);
  --accent-dim:   oklch(0.660 0.085 78);
  --accent-ink:   oklch(0.220 0.020 70);
  --sage:         oklch(0.700 0.058 148);
  --rust:         oklch(0.665 0.105 38);
  --iris:         oklch(0.700 0.080 280);

  /* Backwards-compat aliases — keep until every component migrates */
  --bg-titlebar:  var(--bg-elev);
  --bg-sidebar:   var(--bg-elev);
  --bg-button:    var(--bg-elev-2);
  --bg-button-hover: var(--border-strong);
  --bg-tabbar:    var(--bg-elev);
  --bg-toolbar:   var(--bg-elev);
}

[data-theme="light"] {
  --bg:           oklch(0.965 0.012 85);
  --bg-elev:      oklch(0.935 0.014 85);
  --bg-elev-2:    oklch(0.900 0.018 85);
  --bg-inset:     oklch(0.985 0.008 85);
  --text:         oklch(0.235 0.018 70);
  --text-muted:   oklch(0.460 0.018 75);
  --text-faint:   oklch(0.620 0.015 75);
  --border:       oklch(0.870 0.018 80);
  --border-strong: oklch(0.780 0.020 80);
  --accent:       oklch(0.560 0.115 65);
  --accent-dim:   oklch(0.700 0.075 70);
  --accent-ink:   oklch(0.980 0.010 85);
  --sage:         oklch(0.460 0.060 148);
  --rust:         oklch(0.520 0.115 38);
  --iris:         oklch(0.500 0.090 280);
}

/* High contrast — keep working; just tighten the new vars */
[data-theme="contrast"] {
  --bg: #ffffff;
  --bg-elev: #f5f5f7;
  --bg-elev-2: #ebebef;
  --bg-inset: #ffffff;
  --text: #0a0a14;
  --text-muted: #404050;
  --text-faint: #6a6a7a;
  --border: #c0c0cc;
  --border-strong: #9090a0;
  --accent: oklch(0.500 0.150 65);
  --accent-ink: #ffffff;
}
```

### 3.2 Add the three Plex weights

In `index.html`, replace the system font stack import with:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:ital,wght@0,400;0,500;1,400;1,500&family=IBM+Plex+Sans:wght@400;450;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
```

> Consider bundling locally instead of CDN for offline reliability — Plex
> is OFL-licensed; ~140KB total subset.

In `global.css`:

```css
:root {
  --font-display: 'IBM Plex Serif', Georgia, serif;
  --font-sans:    'IBM Plex Sans', -apple-system, system-ui, sans-serif;
  --font-mono:    'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace;
}

body {
  font-family: var(--font-sans);
  font-weight: 450;          /* Plex's "regular" is heavy — 450 reads as 400 */
}

.cm-content {
  font-family: var(--font-mono) !important;
}
```

Keep `getFontFamily()` / `FONT_FAMILY_PRESETS` (in `appearance/settings.ts`)
working — the user-facing presets just need new entries: "Minerva default
(Plex)", "JetBrains Mono", "Berkeley Mono", "System mono".

### 3.3 Density

Settings exposes density: `compact / cozy / comfy`. Default to `cozy` (the
current density is closer to `compact`).

Add CSS vars per body class:

```css
body[data-density="compact"] { --row: 22px; --pad: 6px;  --font-ui: 12px; }
body[data-density="cozy"]    { --row: 26px; --pad: 8px;  --font-ui: 13px; }
body[data-density="comfy"]   { --row: 30px; --pad: 10px; --font-ui: 13px; }
```

Components that hardcode 12/13px paddings should switch to these vars.
Drive the body attribute from a new `getDensity()` in `appearance/settings.ts`,
following the same store pattern as `getThemeMode()`.

---

## 4. Icons

### 4.1 Build an `Icon.svelte` component

```svelte
<!-- src/renderer/lib/components/Icon.svelte -->
<script lang="ts">
  import type { IconName } from './icons/registry';
  import { ICONS } from './icons/registry';
  interface Props {
    name: IconName;
    size?: number;
    color?: string;
    title?: string;
  }
  let { name, size = 16, color, title }: Props = $props();
  const path = ICONS[name];
</script>

<svg
  width={size} height={size} viewBox="0 0 16 16"
  fill="none"
  stroke={color ?? 'currentColor'}
  stroke-width="1.4"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={title ? 'img' : undefined}
  aria-label={title}
  style="display:block;flex-shrink:0"
>
  {@html path}
</svg>
```

### 4.2 Port the 30+ icons from the design canvas

Source of truth: `components/icons.jsx` in the design-review project. Each
entry is the inner SVG markup. Names already match canonical UI verbs.
Copy them verbatim into `src/renderer/lib/components/icons/registry.ts`:

```ts
export const ICONS = {
  back:        '<path d="M10 3 4.5 8 10 13"/><path d="M4.5 8H13"/>',
  forward:     '<path d="M6 3 11.5 8 6 13"/><path d="M11.5 8H3"/>',
  notes:       '<path d="M3.5 2.5h6L12.5 5.5v8H3.5z"/>…',
  // ...etc — see components/icons.jsx
} as const;
export type IconName = keyof typeof ICONS;
```

### 4.3 Replace the Unicode glyphs everywhere

Codemod-friendly. Concrete mapping (incomplete — the spec list is exhaustive
in the design file):

| File | Old glyph | New `Icon name` |
|---|---|---|
| `Sidebar.svelte` panel-tabs | `▤` | `notes` |
| ″ | `❡` | `sites` |
| ″ | `#` | `tags` |
| ″ | `⊞` | `tables` |
| ″ notes-toolbar | `⬌`/`⬍`/`⦿` | `expandAll`/`collapseAll`/`reveal` |
| `RightSidebar.svelte` panel-tabs | `☰`/`⁂`/`≡`/`→`/`←`/`#`/`⊞`/`❝`/`☆`/`⚠`/`✓` | `outline`/`footnotes`/`properties`/`outgoing`/`backlinks`/`tags`/`tables`/`citations`/`bookmark`/`inspections`/`proposals` |
| `TabBar.svelte` tab-icon | `▷` query, `📖` source | `query` / `source` |
| `StatusBar.svelte` | `←` / `⚠` | `backlinks` / `warn` |
| `TitleBar.svelte` nav arrows | `←`/`→` | `back` / `forward` |

Every other Unicode glyph in the UI (and there are more — search the
codebase for `&#x` and `&#x2`/`&#x1` ranges) should be swapped.

---

## 5. Left sidebar

### 5.1 Hybrid icon-rail (active panel shows label, others icon-only)

In `Sidebar.svelte`, the `.panel-tabs` row currently shows four single-glyph
buttons. Replace with:

```svelte
<div class="panel-tabs">
  {#each TABS as t}
    <button
      class="panel-tab"
      class:active={activePanel === t.id}
      onclick={() => activePanel = t.id}
      title={t.label}
    >
      <Icon name={t.icon} size={14} />
      {#if activePanel === t.id}<span>{t.label}</span>{/if}
    </button>
  {/each}
</div>
```

Active tab uses `var(--bg)` + 1px inset ring of `var(--border)`. Inactive
is transparent.

### 5.2 Per-panel header

Add a panel header below the rail with the display-serif title + count +
action buttons:

```svelte
<div class="panel-header">
  <h2 class="panel-title">{ACTIVE_LABEL}</h2>
  <div class="panel-actions">
    <span class="panel-count">{count}</span>
    <button class="tiny-btn"><Icon name="plus" size={12} /></button>
    <button class="tiny-btn"><Icon name="search" size={12} /></button>
  </div>
</div>
```

```css
.panel-title {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 500;
  letter-spacing: -0.01em;
  margin: 0;
}
.panel-count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
```

### 5.3 File rows

In `FileTree.svelte`:

- Add a `<Icon name="notes" />` for files (replacing the visual placeholder
  the disclosure triangle currently fills).
- Active file row: `border-left: 2px solid var(--accent)` +
  `background: color-mix(in oklch, var(--accent) 14%, transparent)`.
- Add a right-aligned modified-stamp slot (e.g. `2h`, `5d`, `1mo`) using
  `font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint);`.
  Compute via existing file watcher or a small `formatRelativeTime` util.
- Folder icon: `<Icon name="folder" />` instead of indent-only.

### 5.4 Tags panel

`TagPanel.svelte`: render tags as a flex-wrap of chips, sized proportionally
to usage. See "constellation of weighted chips" in the design canvas.

```css
.tag-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 8px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 11.5px;
}
.tag-chip[data-big] { padding: 4px 10px; font-size: 12.5px; }
.tag-chip[data-accent] {
  background: color-mix(in oklch, var(--accent) 14%, transparent);
  color: var(--accent);
  border-color: color-mix(in oklch, var(--accent) 30%, transparent);
}
.tag-chip .count {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
```

"big" = top quartile by frequency; "accent" = `#entrypoint` or
`#open-question` (configurable list, defaulting to those two).

### 5.5 Sources panel

`SourcesPanel.svelte`: each source becomes an editorial entry:

```
{italic title in font-display}
{Author · year in font-sans + font-mono mix}        {citations icon} N
```

See `ProposedSitesPanel` in `components/left-sidebar.jsx`.

---

## 6. Right sidebar — group the 11 tabs

This is the most behaviorally-heavy change. Current model: 11 mutually-
exclusive tabs. Proposed model: same 11 panels, but exposed via a
two-row tab strip.

### 6.1 Define groups in `RightSidebar.svelte`

```ts
type PanelGroup = 'note' | 'links' | 'activity';
const GROUPS: Record<PanelGroup, { label: string; items: PanelType[] }> = {
  note:     { label: 'Note',     items: ['outline', 'properties', 'footnotes'] },
  links:    { label: 'Links',    items: ['outgoing', 'backlinks', 'tags', 'citations', 'tables'] },
  activity: { label: 'Activity', items: ['inspections', 'proposals', 'bookmarks'] },
};

let activeGroup = $state<PanelGroup>('note');
// activePanel is unchanged; switching group sets it to the group's first item.
```

### 6.2 Render two rows

Top row: three group buttons with rollup badges. Sub row: text-labeled
pills for the active group's panels.

See `ProposedRightSidebar` in `components/right-sidebar.jsx` for the
exact markup pattern.

### 6.3 Per-panel headers

Just like the left sidebar — display-serif H1 + count + actions, then the
panel body. Each existing panel component
(`OutlinePanel.svelte`, `BacklinksPanel.svelte`, etc.) takes a header slot,
or the parent provides one based on a `title` prop.

The status-bar backlink-count `onShowBacklinks` still works — it now sets
`activeGroup = 'links'; activePanel = 'backlinks'`.

---

## 7. Window chrome

### 7.1 Title bar (`TitleBar.svelte`)

- Height 38 → 42.
- Replace centered breadcrumb text with a left-aligned chain:
  `mark glyph · folder · folder · italic note title · dirty-dot`
- Add a right-aligned **search affordance** that opens `cmd-K` (Goto Note).
- Add a settings cog at the far right (icon button).
- Use real SVG arrows for back/forward.

### 7.2 Tab bar (`TabBar.svelte`)

- Height 24 → 36.
- Per-tab: leading icon (`notes`/`query`/`source`) replacing Unicode glyph.
- Active tab: 2px accent underline at the bottom (instead of bg-swap only).
- Dirty pip leads the name (currently trails).
- Close `×` becomes `<Icon name="close" size={11}>`.
- Add a trailing `+ new tab` icon button (already exists in some flows; surface it).

### 7.3 Status bar (`StatusBar.svelte`)

- Height 22 → 28.
- Use mono for L/C: `L47 · C23`. `font-variant-numeric: tabular-nums`.
- Replace the bare gaps between items with 1px hairline rules
  (`background: var(--border); width: 1px; height: 11px`).
- Add a saved-state cue (left side): `<Icon name="check" /> saved · 12s ago`.
- Inspections badge: keep color but pin to `var(--rust)`, not the
  hardcoded `#f9e2af` peach.

---

## 8. Editor surface

These changes are in the `Preview.svelte` rendering layer + the CodeMirror
extensions / themes — they only affect the rendered look, not parsing.

### 8.1 Heading scale (Preview + cm theme)

```css
.cm-content .ͼ-h1, .preview h1 {
  font-family: var(--font-display);
  font-size: 30px; line-height: 1.15;
  font-weight: 500; letter-spacing: -0.01em;
  margin: 8px 0 4px;
}
.preview h2 {
  font-family: var(--font-display);
  font-size: 22px; line-height: 1.2;
  font-weight: 500; letter-spacing: -0.01em;
}
.preview h3 { font-family: var(--font-display); font-size: 18px; }
/* H2 anchor — section numerals (optional eyebrow on display) */
.preview h2::before {
  content: '§ ' counter(h2, decimal-leading-zero);
  font-family: var(--font-mono); font-size: 11px;
  color: var(--accent); margin-right: 10px;
}
```

### 8.2 Gutter

Quieter — 56px wide, 10px right-padding, `font-family: var(--font-mono)`,
`color: var(--text-faint)`. Current line: 2px accent rule.

### 8.3 Callouts (`global.css` `.callout`)

Already exists; tune to match the design canvas — 3px left accent rule,
8% accent tint, 28% accent border. The icon inside the title bar should
use the real SVG icon set (currently Unicode glyphs in the `::before`).
See `components/editor.jsx` `Callout` component.

### 8.4 Wiki-link chips (link-decorations.ts)

Render `[[target]]` as a chip with a leading link icon (use a CodeMirror
widget): tint `color-mix(accent 12%, transparent)`, color `var(--accent)`,
4px radius, 1px 8px padding. The visual is in the design canvas.

### 8.5 Code blocks

- Background: `var(--bg-inset)`.
- 1px border `var(--border)`.
- Language label in top-right corner (`font-mono`, 10px,
  uppercase, `letter-spacing: .08em`, `color: var(--text-faint)`).

### 8.6 Math + mermaid

Wrap math in `var(--bg-inset)` chips; wrap mermaid in
`var(--bg-inset)` cards. Same border + radius as code blocks.

---

## 9. Conversations dock

`ConversationsPanel.svelte` currently puts conversations as horizontal tabs
across the top of the dock. Proposed model:

### 9.1 Two-pane layout

```
┌───────────────┬──────────────────────────┐
│ Conversation  │ Active conversation pane │
│ list          │ - header                 │
│ (mail-style)  │ - messages               │
│               │ - proposal card          │
│               │ - composer               │
└───────────────┴──────────────────────────┘
```

220px left list, the rest is the active conversation.

Left list: one item per conversation showing title, target note path,
timestamp, and a small "N proposal" pill if there are pending drafts.

### 9.2 Proposal card

The single most important micro-component to nail. See `ProposalCard` in
`components/conversations.jsx`. Per-file row with `+N / −M` diff stats,
explicit kbd hints at the bottom (`⏎ approve · ⌫ discard`), and an
**Edit first** option between Approve and Discard that takes the user
to a diff view of the proposed changes.

### 9.3 Composer

Multi-line textarea + a context-chip row showing which note the
conversation is anchored to. Send button is `<Icon name="send" />` +
"Send" + accent bg.

---

## 10. Dialogs

All dialogs share the same shell — see `DialogCard` in
`components/dialogs-common.jsx`:

- `border: 1px solid var(--border-strong)`
- `border-radius: 12px`
- `box-shadow: 0 16px 48px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.04) inset`
- Header section: mono-uppercase eyebrow + serif H1.
- Body section.
- Footer section: kbd hints on the left, buttons on the right, separated
  by a `border-top: 1px solid var(--border)` with a slightly darker bg.

Standard slots for each dialog:

| Slot | Purpose | Sample |
|---|---|---|
| eyebrow | What kind of action this is | "Confirm action" |
| title | What's about to happen | "Delete note?" |
| body | The actual form / list | (varies) |
| kbd hint | Footer left text | "esc · cancel · ↵ create" |
| primary | Footer right CTA | "Delete" |
| secondary | Footer right | "Cancel" |

Build a `<Dialog>` component that takes these as named slots; every
existing dialog refactors to use it.

### 10.1 Confirm + Prompt

Smallest dialogs. The proposed shells already match the canonical layout.
Keep `showConfirm(message, key, label, opts)` and `showPrompt(message, opts)`
signatures unchanged — only the rendering changes.

### 10.2 GotoNote — command palette

`GotoNoteDialog.svelte` becomes a wider (640px) palette:

- Top: input + ⌘P keyboard hint badge.
- Below input: scope filter chips (`All / Notes / Sources / Queries`) with
  counts. The scope plumbs into the search to filter the result list.
- Each result row: kind icon + name (with match highlighted) + path
  breadcrumb + modified stamp + preview line.
- Footer kbd hints: `↑↓ navigate · ↵ open · ⌥ ↵ open in split · esc close`.

The fuzzy-match logic already in `GotoNoteDialog.svelte` stays.

### 10.3 Find / Find & Replace

- Mode segmented toggle at top (replaces the current text tabs).
- Inline flag buttons inside the input (`Aa`, `.*`, `W`) instead of
  separate checkboxes.
- Result tree: per-file row with check-all tri-state checkbox, expandable
  match list with line numbers + before/match/after spans.
- Footer: `↑↓ next · ↵ open · ⌥ ↵ split · esc close`.

### 10.4 Settings

Restructure tabs into 4 groups:

1. **Workspace** — Editor, Appearance, Behaviors
2. **Authoring** — Refactoring, Formatter, Bibliography
3. **Ingest & compute** — Web, Sites, Compute
4. **AI** — AI (LLM settings)

Sidebar with mono-uppercase group labels + tab rows showing a sub-line.
Body: top-section eyebrow + display H1, content sections each grouped
into an inset card with one setting per row (label + sub-line on left,
control on right).

Build reusable primitives:
- `<Toggle>` — accent-color pill switch.
- `<Stepper>` — minus/value/plus tabular-nums.
- `<SettingRow>` — flexbox row with label/sub + control slot.

`Reset section to defaults` button in the footer scoped to the active
section, not the whole settings.

### 10.5 Save Query / Auto-link / Export / Open target

- **Save Query**: scope picker becomes two side-by-side cards explaining
  "In this thoughtbase" vs "Globally", with sub-copy. Less radio-button-y.
- **Auto-link**: confidence bar component, context excerpt for each
  suggestion, "Select high-confidence (≥ 0.8)" bulk button alongside the
  existing all/none.
- **Export**: three-column audit (Including / Excluded / Citations) with
  missing-source count as a `--rust` badge. Scope picker becomes a
  segmented control with inline counts.
- **Open Target**: three buttons → two choice cards with kbd hints
  (`↵` for the primary, `⌘ ↵` for new window).

### 10.6 Busy overlay

Becomes a card with a spinner + a verb-noun headline. Spinner is a
12px arc rotating around a static ring.

---

## 11. Onboarding

`OnboardingDialog.svelte`:

- Two columns.
- Left (280px): brand panel — the Minerva mark + wordmark + tagline + a
  Hegel epigraph in italic display-serif.
- Right (flex): mono-uppercase eyebrow ("New thoughtbase · step 1 of 1") +
  display-serif H1 ("What would you like to think about?") + 4-field form
  (Subject text input, Reader segmented, Depth segmented stack of cards
  showing the count, optional "For" textarea).
- Footer: primary action `Draft my thoughtbase` (with sparkle icon),
  secondary action `I'll start from scratch`, and a right-aligned
  "Don't ask again" checkbox.

The existing `OnboardingAnswers` shape and `buildOnboardingPrompts` logic
in `App.svelte` is unchanged.

---

## 12. Component primitives to land first

Before any dialog refactor, build these (in `src/renderer/lib/components/ui/`):

- `Dialog.svelte` — backdrop + card with eyebrow/title/body/footer slots.
- `Icon.svelte` — see §4.1.
- `Toggle.svelte` — pill toggle on accent.
- `Stepper.svelte` — minus/value/plus.
- `Kbd.svelte` — keyboard glyph badge.
- `Eyebrow.svelte` — mono-uppercase label above titles.
- `Chip.svelte` — pill (used for tag chips, status bar items, breadcrumbs).
- `SegmentedControl.svelte` — used in Find mode toggle, Export scope, Settings density, Onboarding depth.

The design canvas mocks the same primitive across surfaces — that's the
test that each primitive is right.

---

## 13. Right-sidebar panel bodies

Each panel sits under the group/sub-tab chrome built in §6. They share one
header pattern: a `font-mono` eyebrow (the sub-line), a `font-display` H1
title, and an action cluster (count + tiny icon buttons). Each panel's
body has its own row vocabulary.

### 13.1 Properties (`PropertiesPanel.svelte`)

Already the most complex panel. Tighten to:

- One row per frontmatter key. 3-col grid: `[type-icon + key]` · `value-control` · `× remove`.
- **Type icons** (12px) signal data shape: text → outline, number → tables,
  bool → check, date → bookmark, list → tags, link → link, enum →
  properties, raw → query. Canonical keys' icons use `var(--accent)`;
  custom keys' icons use `var(--text-faint)`.
- **Value controls** are type-specific:
  - text → bare input, no border until focus.
  - number → small input + tabular-nums.
  - bool → Toggle primitive (§12).
  - date → native date input, mono.
  - list → chip row with inline "+" input.
  - link → wiki-chip with leading `link` icon, accent-tinted bg.
  - raw → mono code line in `bg-inset`, click to edit-in-source.
- **Add row** at the bottom: icon + bare input + Enter to commit.
- **Canonical suggestions**: dashed pill chips below the add row for each
  canonical key the note hasn't set yet (`+ tags`, `+ summary`, etc.).
  Clicking inserts that row with its default shape.
- Wiki-chip values that don't resolve render in `var(--rust)` with a
  warn icon — surfaces broken `based-on:` links without removing them.

### 13.2 Footnotes (`FootnotesPanel.svelte`)

- One row per footnote definition. Lead with a mono badge (`[^label]`),
  body text wrapping next to it, count chip on the right.
- **Orphan** (defined, never referenced) → muted badge + mono caption
  `DEFINED · NEVER USED`.
- **Missing** (referenced, no definition) → rust badge + caption
  `REFERENCED · NOT DEFINED`.
- Click any row → scroll the editor to its target line.

### 13.3 Outgoing / Backlinks

Same pattern, two different sources. Group rows by **link type**
(`links-to`, `supports`, `refutes`, `grounds`, etc.). Each group:

- Disclosure chevron + 7×7 color square (per-type color) + type label in
  mono + per-group count on the right.
- Group color follows the typed-link palette: accent (links-to), sage
  (supports), rust (refutes), iris (grounds). Defined in `link-types.ts`.
- Each row: notes icon + target title + occurrence count `×N` when > 1.
- Broken outgoing links: rust title + warn icon. The link still renders
  (so the user can fix the target), but the visual cue is unmissable.

### 13.4 Tags (in right sidebar, per active note)

- Hierarchical tree (`#claim/grounded` → child of `#claim`).
- Each row: chevron · mono tag name · tabular-nums count. Active tag
  gets the standard active-row treatment (2px accent rail + tint).
- Below the tree: a `NOTES WITH #<selected-tag>` section with a count
  and the first N notes; "…and N more" fallback at the end.

### 13.5 Tables (referenced in note)

- One row per table reference. Tables icon + table name in mono + 
  `rows × cols` stat in mono-faint.
- Right-aligned `SELECT *` accent button — replaces today's plain row
  click. Hover state shows the full row clickable as before.

### 13.6 Citations

The most editorial panel — sources cited from this note.

- Per source: source-glyph + italic display-serif title + sans byline
  (author · year) + cite-count / quote-count split on the right.
- Sources with quotes are expandable; excerpts render as block-quote
  attached chunks indented under the source, with a 2px accent rail.
- Each excerpt: italic display-serif text (truncated), mono locator
  (e.g. `p. 433a` or `ch. 3`), occurrence count `×N`.
- Missing-source rows: rust title, no quote count, byline reads
  `N references · uncited`.

### 13.7 Bookmarks

- Folder tree with `folder` icon for groups and `bookmark` icon for items.
- Each item: title + sub-line showing source path in mono-faint.
- Header actions: `+` (new bookmark) and `+ folder`.
- Folder context menu unchanged — rename / delete.

### 13.8 Proposals (the activity heart)

- **Filter chips** at the top: Pending · Approved · Rejected · All,
  each with a count.
- **Per-proposal card**:
  - Top row: status pill (`PENDING` in accent, `APPROVED` in sage,
    `REJECTED` in muted) · operation type in mono · timestamp.
  - Note path with notes icon in mono-faint.
  - Effects line in plain English ("2 notes · 1 claim") with `by
    {proposer}` in mono-faint.
  - Selected card expands to show payload list (kind · summary, each
    expandable to a mono code preview) and Approve / Reject buttons.
- **Approve**: accent CTA. **Reject**: ghost outline. Per CLAUDE.md
  "no danger styling" — reject is just a normal action.

### 13.9 What's out of scope here

- **Inspections** — the user has signaled this panel will change
  function meaningfully. Hold for separate spec.
- **Diff view** for proposal payloads — beyond a mono preview line,
  the diff between current and proposed graph state needs its own
  design pass.

---

## 14. Out of scope (this round)

- **Inspections** right-sidebar panel — different functionality coming.
- Tree DnD ghost styling.
- Settings AI tab — model picker design.
- Diff view for "Edit first" in the proposal card.
- Proposal payload diff view (current → proposed graph state).

---

## 15. Validation

- After tokens + fonts: run `pnpm lint`, `pnpm dev`, scroll through every
  surface. Nothing should be visibly broken — just warmer and serified.
- After icons: search for `&#x` in the repo and confirm no Unicode glyphs
  remain in markup.
- After dialogs: every `showConfirm` / `showPrompt` call site is exercised
  in dev; the "Don't ask again" checkbox works for all `CONFIRM_KEYS`.
- High contrast theme (`data-theme="contrast"`) still renders sensibly —
  the new tokens should fall back to defined values.

---

## 16. File map

The design-review project ships every artboard as its own JSX file —
treat them as reference, not source-of-truth:

```
components/
├── tokens.jsx            # PALETTES, TYPE_PAIRS, DENSITY, tokenVars()
├── icons.jsx             # ICONS registry — copy into src/renderer
├── bits.jsx              # Surface, ModalShell helpers
├── brand.jsx             # wordmark + palette + type + icons specimens
├── chrome.jsx            # title, tab, status bar — current + proposed
├── left-sidebar.jsx
├── right-sidebar.jsx     # group + sub-tab chrome
├── right-panels.jsx      # Properties, Outgoing, Backlinks, Tags, Tables,
│                         # Citations, Bookmarks, Proposals, Footnotes
├── editor.jsx
├── conversations.jsx
├── onboarding.jsx
├── dialogs-common.jsx    # Confirm, Prompt, Busy
├── dialogs-palette.jsx   # GotoNote, Find
├── dialogs-settings.jsx
└── dialogs-misc.jsx      # SaveQuery, AutoLink, Export, OpenTarget
```

Open `Minerva Design Review.html` to see them assembled. Tweaks panel
(bottom right) flips palettes / type / density — useful for sanity-
checking before/after a palette change.
