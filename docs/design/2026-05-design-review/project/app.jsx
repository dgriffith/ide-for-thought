// Minerva — Design Review canvas. Assembles sections of current-vs-proposed
// artboard pairs, with a Tweaks panel exposing palette / type / density.

const { DesignCanvas, DCSection, DCArtboard, DCPostIt } = window;
const { useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakRadio,
        TweakSelect, TweakToggle, TweakColor } = window;

const { tokenVars, PALETTES, TYPE_PAIRS, DENSITY } = window.MinervaTokens;
const Bits = window.MinervaBits;
const { BrandArtboard, PaletteArtboard, TypeSpecimen, IconSpecimen } = window.MinervaBrand;
const { CurrentTitleBar, CurrentTabBar, CurrentStatusBar,
        ProposedTitleBar, ProposedTabBar, ProposedStatusBar } = window.MinervaChrome;
const { CurrentLeftSidebar, ProposedLeftSidebar } = window.MinervaLeftSidebar;
const { CurrentRightSidebar, ProposedRightSidebar } = window.MinervaRightSidebar;
const { CurrentEditor, ProposedEditor } = window.MinervaEditor;
const { CurrentConversations, ProposedConversations } = window.MinervaConversations;
const { CurrentOnboarding, ProposedOnboarding } = window.MinervaOnboarding;
const { CurrentConfirm, ProposedConfirm,
        CurrentPrompt, ProposedPrompt,
        CurrentBusy, ProposedBusy } = window.MinervaDialogsCommon;
const { CurrentGotoNote, ProposedGotoNote,
        CurrentFind, ProposedFind } = window.MinervaDialogsPalette;
const { CurrentSettings, ProposedSettings } = window.MinervaDialogsSettings;
const { CurrentSaveQuery, ProposedSaveQuery,
        CurrentAutoLink, ProposedAutoLink,
        CurrentExport, ProposedExport,
        ProposedOpenTarget } = window.MinervaDialogsMisc;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": "honey",
  "typePair": "plex",
  "density": "cozy",
  "showAnnotations": true
}/*EDITMODE-END*/;

// A row of two artboards sharing the same prop-set, with optional caption tags.
const Pair = ({ id, label, w, h, vars, current, proposed, ann, mode }) => {
  return (
    <>
      <DCArtboard id={`${id}-cur-${mode}`} label={`Current · ${mode}`} width={w} height={h}>
        {current}
      </DCArtboard>
      <DCArtboard id={`${id}-prop-${mode}`} label={`Proposed · ${mode}`} width={w} height={h}>
        {proposed}
      </DCArtboard>
    </>
  );
};

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const varsDark  = tokenVars(t, "dark");
  const varsLight = tokenVars(t, "light");

  // Common dimensions
  const W = {
    chrome:   980,
    sidebar:  300,
    right:    320,
    editor:   780,
    convo:    980,
    onboard:  900,
    brand:    820,
    palette:  400,
    type:     820,
    icons:    820,
  };
  const H = {
    titlebar: 80,
    tabbar:   72,
    statusbar: 64,
    sidebar:  640,
    editor:   680,
    convo:    560,
    onboard:  620,
    brand:    500,
    palette:  400,
    type:     520,
    icons:    540,
  };

  return (
    <>
      <DesignCanvas>

        {/* ── BRAND ──────────────────────────────────────────────────── */}
        <DCSection id="brand" title="Brand"
          subtitle="A name, a mark, a voice — the personality we'll dress every surface in.">
          <DCArtboard id="brand-dark" label="Wordmark · dark" width={W.brand} height={H.brand}>
            <BrandArtboard vars={varsDark} mode="dark" />
          </DCArtboard>
          <DCArtboard id="brand-light" label="Wordmark · light" width={W.brand} height={H.brand}>
            <BrandArtboard vars={varsLight} mode="light" />
          </DCArtboard>
          <DCPostIt x={20} y={-40}>
            Paper-on-ink, IBM Plex Serif wordmark, owl-eye mark.
            “Software for superhumans” reads as a vow rather than a slogan when set
            in italic Plex Serif. The mark is a concentric eye — Minerva's owl.
          </DCPostIt>
        </DCSection>

        <DCSection id="system" title="Design system"
          subtitle="Tokens & specimens. Tweaks live in the bottom-right.">
          <DCArtboard id="palette-dark" label={`Palette · ${PALETTES[t.palette].name} dark`}
            width={W.palette} height={H.palette}>
            <PaletteArtboard vars={varsDark} mode="dark" paletteKey={t.palette} />
          </DCArtboard>
          <DCArtboard id="palette-light" label={`Palette · ${PALETTES[t.palette].name} light`}
            width={W.palette} height={H.palette}>
            <PaletteArtboard vars={varsLight} mode="light" paletteKey={t.palette} />
          </DCArtboard>
          <DCArtboard id="type" label="Type system" width={W.type} height={H.type}>
            <TypeSpecimen vars={varsDark} mode="dark" />
          </DCArtboard>
          <DCArtboard id="icons" label="Icon set · 16px" width={W.icons} height={H.icons}>
            <IconSpecimen vars={varsDark} mode="dark" />
          </DCArtboard>
          <DCPostIt x={20} y={-40}>
            The grayness disappears when chroma sits at 0.012 on a warm hue
            (~70–85°). Accent does the only meaningful color work.
            Three Plex weights, one mono. Sixteen custom icons replace every
            Unicode glyph in the app.
          </DCPostIt>
        </DCSection>

        {/* ── CHROME ─────────────────────────────────────────────────── */}
        <DCSection id="chrome" title="Window chrome"
          subtitle="Title bar · tab bar · status bar. Each row: current → proposed, dark and light.">
          <DCArtboard id="title-cur-d" label="Current title bar · dark" width={W.chrome} height={H.titlebar}>
            <CurrentTitleBar mode="dark" />
          </DCArtboard>
          <DCArtboard id="title-cur-l" label="Current · light" width={W.chrome} height={H.titlebar}>
            <CurrentTitleBar mode="light" />
          </DCArtboard>
          <DCArtboard id="title-prop-d" label="Proposed · dark" width={W.chrome} height={H.titlebar}>
            <ProposedTitleBar vars={varsDark} mode="dark" />
          </DCArtboard>
          <DCArtboard id="title-prop-l" label="Proposed · light" width={W.chrome} height={H.titlebar}>
            <ProposedTitleBar vars={varsLight} mode="light" />
          </DCArtboard>

          <DCArtboard id="tab-cur-d" label="Current tab bar · dark" width={W.chrome} height={H.tabbar}>
            <CurrentTabBar mode="dark" />
          </DCArtboard>
          <DCArtboard id="tab-cur-l" label="Current · light" width={W.chrome} height={H.tabbar}>
            <CurrentTabBar mode="light" />
          </DCArtboard>
          <DCArtboard id="tab-prop-d" label="Proposed · dark" width={W.chrome} height={H.tabbar}>
            <ProposedTabBar vars={varsDark} mode="dark" />
          </DCArtboard>
          <DCArtboard id="tab-prop-l" label="Proposed · light" width={W.chrome} height={H.tabbar}>
            <ProposedTabBar vars={varsLight} mode="light" />
          </DCArtboard>

          <DCArtboard id="status-cur-d" label="Current status bar · dark" width={W.chrome} height={H.statusbar}>
            <CurrentStatusBar mode="dark" />
          </DCArtboard>
          <DCArtboard id="status-cur-l" label="Current · light" width={W.chrome} height={H.statusbar}>
            <CurrentStatusBar mode="light" />
          </DCArtboard>
          <DCArtboard id="status-prop-d" label="Proposed · dark" width={W.chrome} height={H.statusbar}>
            <ProposedStatusBar vars={varsDark} mode="dark" />
          </DCArtboard>
          <DCArtboard id="status-prop-l" label="Proposed · light" width={W.chrome} height={H.statusbar}>
            <ProposedStatusBar vars={varsLight} mode="light" />
          </DCArtboard>

          <DCPostIt x={20} y={-40}>
            Title bar grows from 38px to 42px to seat a breadcrumb that reads
            like a sentence (italic note title). Tab bar trades the per-glyph
            Unicode for real icons, an accent underline, dirty-pip leading the
            name. Status bar gets tabular numerals, a saved-state cue, and
            actual divider rules instead of bare gaps.
          </DCPostIt>
        </DCSection>

        {/* ── SIDEBARS ───────────────────────────────────────────────── */}
        <DCSection id="left" title="Left sidebar · Notes / Sites / Tags / Tables"
          subtitle="Most-stared-at surface in the app. The hybrid icon-rail unlocks legible labels.">
          <DCArtboard id="left-cur-n-d" label="Current · Notes · dark"
            width={W.sidebar} height={H.sidebar}>
            <CurrentLeftSidebar mode="dark" panel="notes" />
          </DCArtboard>
          <DCArtboard id="left-prop-n-d" label="Proposed · Notes · dark"
            width={W.sidebar} height={H.sidebar}>
            <ProposedLeftSidebar vars={varsDark} mode="dark" panel="notes" />
          </DCArtboard>
          <DCArtboard id="left-cur-n-l" label="Current · Notes · light"
            width={W.sidebar} height={H.sidebar}>
            <CurrentLeftSidebar mode="light" panel="notes" />
          </DCArtboard>
          <DCArtboard id="left-prop-n-l" label="Proposed · Notes · light"
            width={W.sidebar} height={H.sidebar}>
            <ProposedLeftSidebar vars={varsLight} mode="light" panel="notes" />
          </DCArtboard>

          <DCArtboard id="left-cur-t-d" label="Current · Tags · dark"
            width={W.sidebar} height={H.sidebar}>
            <CurrentLeftSidebar mode="dark" panel="tags" />
          </DCArtboard>
          <DCArtboard id="left-prop-t-d" label="Proposed · Tags · dark"
            width={W.sidebar} height={H.sidebar}>
            <ProposedLeftSidebar vars={varsDark} mode="dark" panel="tags" />
          </DCArtboard>
          <DCArtboard id="left-cur-s-d" label="Current · Sites · dark"
            width={W.sidebar} height={H.sidebar}>
            <CurrentLeftSidebar mode="dark" panel="sites" />
          </DCArtboard>
          <DCArtboard id="left-prop-s-d" label="Proposed · Sites · dark"
            width={W.sidebar} height={H.sidebar}>
            <ProposedLeftSidebar vars={varsDark} mode="dark" panel="sites" />
          </DCArtboard>
          <DCArtboard id="left-cur-tb-d" label="Current · Tables · dark"
            width={W.sidebar} height={H.sidebar}>
            <CurrentLeftSidebar mode="dark" panel="tables" />
          </DCArtboard>
          <DCArtboard id="left-prop-tb-d" label="Proposed · Tables · dark"
            width={W.sidebar} height={H.sidebar}>
            <ProposedLeftSidebar vars={varsDark} mode="dark" panel="tables" />
          </DCArtboard>

          <DCPostIt x={20} y={-40}>
            Inactive panels show icon-only; active expands to icon + label
            (your hybrid pick). Every panel has a real title (display-serif
            H1), a count, and a focused action row. Notes rows now have a
            file-icon + modified-stamp; the active row gets a 2px accent rail.
            Tags become a constellation of weighted chips. Sites become
            an editorial author/title/year stack. Tables get table iconography
            and a “Query” affordance.
          </DCPostIt>
        </DCSection>

        <DCSection id="right" title="Right sidebar · grouped, not 11-deep"
          subtitle="The 11-glyph ribbon was the worst icon offender. Group into Note · Links · Activity.">
          <DCArtboard id="right-cur-d" label="Current · dark" width={W.right} height={H.sidebar}>
            <CurrentRightSidebar mode="dark" />
          </DCArtboard>
          <DCArtboard id="right-prop-d" label="Proposed · dark" width={W.right} height={H.sidebar}>
            <ProposedRightSidebar vars={varsDark} mode="dark" />
          </DCArtboard>
          <DCArtboard id="right-cur-l" label="Current · light" width={W.right} height={H.sidebar}>
            <CurrentRightSidebar mode="light" />
          </DCArtboard>
          <DCArtboard id="right-prop-l" label="Proposed · light" width={W.right} height={H.sidebar}>
            <ProposedRightSidebar vars={varsLight} mode="light" />
          </DCArtboard>
          <DCPostIt x={20} y={-40}>
            Two-row tab strip: top row picks the GROUP (Note / Links / Activity);
            sub-row picks the panel inside it. Group buttons own count badges
            so the user sees "2 inspections" without drilling. Inside the
            panel: a real title with serif display H1, structured outline
            with section numerals, current-line bookmark on the accent rail.
          </DCPostIt>
        </DCSection>

        {/* ── EDITOR ─────────────────────────────────────────────────── */}
        <DCSection id="editor" title="Editor surface"
          subtitle="Margins, gutter, callouts, code, math, mermaid. The thing you actually work in.">
          <DCArtboard id="ed-cur-d" label="Current · dark" width={W.editor} height={H.editor}>
            <CurrentEditor mode="dark" />
          </DCArtboard>
          <DCArtboard id="ed-prop-d" label="Proposed · dark" width={W.editor} height={H.editor}>
            <ProposedEditor vars={varsDark} mode="dark" />
          </DCArtboard>
          <DCArtboard id="ed-cur-l" label="Current · light" width={W.editor} height={H.editor}>
            <CurrentEditor mode="light" />
          </DCArtboard>
          <DCArtboard id="ed-prop-l" label="Proposed · light" width={W.editor} height={H.editor}>
            <ProposedEditor vars={varsLight} mode="light" />
          </DCArtboard>
          <DCPostIt x={20} y={-40}>
            Headings move to display-serif at sized scale (30 / 22 / 18px);
            body stays Plex Mono for the “editor feels like an editor” promise.
            Each H2 carries a § numeral. Callouts get a proper icon, real
            border + tint, no danger reds. Wiki-links become labeled chips
            with a link glyph; math gets its own inset; mermaid blocks live
            in a parchment-toned card.
          </DCPostIt>
        </DCSection>

        {/* ── CONVERSATIONS ──────────────────────────────────────────── */}
        <DCSection id="convo" title="Conversations dock"
          subtitle="The LLM-proposes-human-confirms surface. Read CLAUDE.md and design accordingly.">
          <DCArtboard id="convo-cur-d" label="Current · dark" width={W.convo} height={H.convo}>
            <CurrentConversations mode="dark" />
          </DCArtboard>
          <DCArtboard id="convo-prop-d" label="Proposed · dark" width={W.convo} height={H.convo}>
            <ProposedConversations vars={varsDark} mode="dark" />
          </DCArtboard>
          <DCArtboard id="convo-prop-l" label="Proposed · light" width={W.convo} height={H.convo}>
            <ProposedConversations vars={varsLight} mode="light" />
          </DCArtboard>
          <DCPostIt x={20} y={-40}>
            Horizontal-tabs → mail-app vertical sidebar. The proposal card
            is the centerpiece: per-file diff stats, kbd hints (⏎ approve · ⌫
            discard), an Edit-first button to make “the human confirms”
            concrete. Composer grows into a real card with a context chip and
            send button rather than a one-line textarea.
          </DCPostIt>
        </DCSection>

        {/* ── ONBOARDING ─────────────────────────────────────────────── */}
        <DCSection id="onboard" title="Onboarding · the personality moment"
          subtitle="First-run is the only moment you can spend on character. Spend it well.">
          <DCArtboard id="ob-cur" label="Current" width={W.onboard} height={H.onboard}>
            <CurrentOnboarding />
          </DCArtboard>
          <DCArtboard id="ob-prop-d" label="Proposed · dark" width={W.onboard} height={H.onboard}>
            <ProposedOnboarding vars={varsDark} mode="dark" />
          </DCArtboard>
          <DCArtboard id="ob-prop-l" label="Proposed · light" width={W.onboard} height={H.onboard}>
            <ProposedOnboarding vars={varsLight} mode="light" />
          </DCArtboard>
          <DCPostIt x={20} y={-40}>
            Two-column with brand panel + form. Hegel epigraph because the owl
            of Minerva is the source. Reader + depth become segmented
            choices instead of select-dropdowns. The CTA reads “Draft my
            thoughtbase” with a sparkle, and an honest “I'll start from
            scratch” escape hatch sits beside it.
          </DCPostIt>
        </DCSection>

        {/* ── DIALOGS ────────────────────────────────────────────────── */}
        <DCSection id="dlg-small" title="Dialogs · Confirm · Prompt · Busy"
          subtitle="The 10x dialogs. Compact, kbd-driven, no danger styling.">
          <DCArtboard id="dlg-cf-cur" label="Confirm · current" width={580} height={360}>
            <CurrentConfirm mode="dark" />
          </DCArtboard>
          <DCArtboard id="dlg-cf-prop" label="Confirm · proposed" width={580} height={360}>
            <ProposedConfirm vars={varsDark} mode="dark" />
          </DCArtboard>
          <DCArtboard id="dlg-cf-prop-l" label="Confirm · proposed · light" width={580} height={360}>
            <ProposedConfirm vars={varsLight} mode="light" />
          </DCArtboard>

          <DCArtboard id="dlg-pr-cur" label="Prompt · current" width={580} height={360}>
            <CurrentPrompt mode="dark" />
          </DCArtboard>
          <DCArtboard id="dlg-pr-prop" label="Prompt · proposed" width={580} height={360}>
            <ProposedPrompt vars={varsDark} mode="dark" />
          </DCArtboard>
          <DCArtboard id="dlg-pr-prop-l" label="Prompt · proposed · light" width={580} height={360}>
            <ProposedPrompt vars={varsLight} mode="light" />
          </DCArtboard>

          <DCArtboard id="dlg-busy-cur" label="Busy · current" width={580} height={360}>
            <CurrentBusy mode="dark" />
          </DCArtboard>
          <DCArtboard id="dlg-busy-prop" label="Busy · proposed" width={580} height={360}>
            <ProposedBusy vars={varsDark} mode="dark" />
          </DCArtboard>

          <DCPostIt x={20} y={-40}>
            Every small dialog: serif title, mono kbd-hint footer, primary CTA
            with the ↵ glyph baked in. Confirm-with-target shows the file path
            so the user reads the noun before the verb. Even "delete" stays
            in the accent — the CLAUDE.md "no danger styling" promise is
            non-negotiable.
          </DCPostIt>
        </DCSection>

        <DCSection id="dlg-palette" title="Command palette · Find &amp; Replace"
          subtitle="Goto Note becomes a proper command palette. Find/Replace gets a tree, checkboxes, kbd flow.">
          <DCArtboard id="dlg-goto-cur" label="Goto Note · current" width={780} height={420}>
            <CurrentGotoNote mode="dark" />
          </DCArtboard>
          <DCArtboard id="dlg-goto-prop" label="Goto Note · proposed" width={780} height={420}>
            <ProposedGotoNote vars={varsDark} mode="dark" />
          </DCArtboard>

          <DCArtboard id="dlg-find-cur" label="Find · current" width={780} height={560}>
            <CurrentFind mode="dark" />
          </DCArtboard>
          <DCArtboard id="dlg-find-prop" label="Find · proposed" width={780} height={560}>
            <ProposedFind vars={varsDark} mode="dark" />
          </DCArtboard>
          <DCArtboard id="dlg-find-prop-l" label="Find · light" width={780} height={560}>
            <ProposedFind vars={varsLight} mode="light" />
          </DCArtboard>

          <DCPostIt x={20} y={-40}>
            Goto Note grows scope filter chips (All / Notes / Sources /
            Queries) with counts, a preview line per result, and explicit
            kbd hints in the footer. Find adds a segmented mode toggle,
            inline regex/case/word flags, per-file accordion with check-all
            tri-state, and inline match highlighting.
          </DCPostIt>
        </DCSection>

        <DCSection id="dlg-settings" title="Settings · ten tabs become four groups"
          subtitle="The biggest dialog. Restructured by job-to-be-done; immediate-save (no Apply).">
          <DCArtboard id="dlg-s-cur" label="Current" width={820} height={520}>
            <CurrentSettings mode="dark" />
          </DCArtboard>
          <DCArtboard id="dlg-s-prop" label="Proposed · dark" width={1000} height={640}>
            <ProposedSettings vars={varsDark} mode="dark" />
          </DCArtboard>
          <DCArtboard id="dlg-s-prop-l" label="Proposed · light" width={1000} height={640}>
            <ProposedSettings vars={varsLight} mode="light" />
          </DCArtboard>
          <DCPostIt x={20} y={-40}>
            Tabs grouped into Workspace · Authoring · Ingest &amp; Compute · AI.
            Each row gets a sub-line so users can scan; sections in the body
            use mono-uppercase eyebrow + serif H1 + grouped inset card with
            row-level descriptions. Toggle component built in tokens. Toggle
            primitive, stepper primitive — these become reusable for every
            other settings tab. Reset-section / Done in the footer, no Apply
            (the existing immediate-save behavior surfaced honestly).
          </DCPostIt>
        </DCSection>

        <DCSection id="dlg-misc" title="Save Query · Auto-link review · Export · Open target"
          subtitle="The remaining dialogs. Same vocabulary of cards, eyebrow, footer kbd hints.">
          <DCArtboard id="dlg-sq-cur" label="Save Query · current" width={580} height={400}>
            <CurrentSaveQuery mode="dark" />
          </DCArtboard>
          <DCArtboard id="dlg-sq-prop" label="Save Query · proposed" width={680} height={400}>
            <ProposedSaveQuery vars={varsDark} mode="dark" />
          </DCArtboard>

          <DCArtboard id="dlg-al-cur" label="Auto-link · current" width={780} height={540}>
            <CurrentAutoLink mode="dark" />
          </DCArtboard>
          <DCArtboard id="dlg-al-prop" label="Auto-link · proposed" width={920} height={640}>
            <ProposedAutoLink vars={varsDark} mode="dark" />
          </DCArtboard>

          <DCArtboard id="dlg-ex-cur" label="Export · current" width={780} height={580}>
            <CurrentExport mode="dark" />
          </DCArtboard>
          <DCArtboard id="dlg-ex-prop" label="Export · proposed" width={920} height={640}>
            <ProposedExport vars={varsDark} mode="dark" />
          </DCArtboard>

          <DCArtboard id="dlg-ot-prop" label="Open target · proposed" width={760} height={460}>
            <ProposedOpenTarget vars={varsDark} mode="dark" />
          </DCArtboard>

          <DCPostIt x={20} y={-40}>
            Save Query: scope picker → side-by-side cards with copy explaining
            each option, not a fieldset of radios. Auto-link: confidence
            bars, context excerpts, "Select high-confidence" bulk. Export:
            three-column audit (Including / Excluded / Citations) with the
            missing-source count surfaced as a rust badge — and citations
            kept in their own column because they're the most common
            export gotcha. Open target: the three buttons become two
            choice cards with kbd hints.
          </DCPostIt>
        </DCSection>

      </DesignCanvas>

      {/* ── Tweaks ──────────────────────────────────────────────────── */}
      <TweaksPanel>
        <TweakSection label="Visual identity" />
        <TweakSelect
          label="Palette" value={t.palette}
          options={Object.keys(PALETTES).map((k) => ({ value: k, label: PALETTES[k].name + " · " + PALETTES[k].blurb }))}
          onChange={(v) => setTweak("palette", v)} />
        <TweakSelect
          label="Type pair" value={t.typePair}
          options={Object.keys(TYPE_PAIRS).map((k) => ({ value: k, label: TYPE_PAIRS[k].name + " · " + TYPE_PAIRS[k].blurb }))}
          onChange={(v) => setTweak("typePair", v)} />
        <TweakRadio
          label="Density" value={t.density}
          options={["compact", "cozy", "comfy"]}
          onChange={(v) => setTweak("density", v)} />
      </TweaksPanel>
    </>
  );
}

const root = ReactDOM.createRoot(document.body.appendChild(document.createElement("div")));
root.render(<App />);
