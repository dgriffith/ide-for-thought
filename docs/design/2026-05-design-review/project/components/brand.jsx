// Brand artboards: wordmark + mark, palette swatches, type specimens.

const { Surface, Pin, Hairline } = window.MinervaBits;
const { PALETTES, TYPE_PAIRS, tokenVars } = window.MinervaTokens;
const Icon = window.MinervaIcon;

// ─── The Minerva mark — owl-eye, drawn carefully at large size ─────────────
const MinervaMark = ({ size = 96, color, ringColor, irisColor }) => {
  const c = color || "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" stroke={c}
         strokeWidth={1.6} style={{ display: "block" }}>
      {/* outer eye-almond */}
      <path d="M8 48C18 28 32 18 48 18s30 10 40 30c-10 20-24 30-40 30S18 68 8 48z"
            strokeWidth="2" />
      {/* iris */}
      <circle cx="48" cy="48" r="16" stroke={irisColor || c} strokeWidth="2" />
      {/* pupil */}
      <circle cx="48" cy="48" r="6" fill={c} stroke="none" />
      {/* highlight */}
      <circle cx="44" cy="44" r="1.5" fill={ringColor || "rgba(255,255,255,.4)"} stroke="none" />
      {/* serifed crowns — abstract feather tufts */}
      <path d="M30 24c2-3 5-5 8-5M58 19c3 0 6 2 8 5" strokeLinecap="round" />
    </svg>
  );
};

// ─── 1. Wordmark + tagline artboard ────────────────────────────────────────
const BrandArtboard = ({ vars, mode }) => (
  <Surface vars={vars} style={{ padding: 0 }}>
    <div style={{
      position: "absolute", inset: 0,
      display: "flex", flexDirection: "column",
      padding: 48,
      background: "var(--bg)",
    }}>
      {/* faint paper texture lines as parchment cue */}
      <div style={{
        position: "absolute", inset: 0, opacity: .04, pointerEvents: "none",
        backgroundImage: `repeating-linear-gradient(0deg, transparent 0 28px, var(--text) 28px 28.5px)`,
      }} />

      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 18 }}>
        <MinervaMark size={84} color="var(--accent)" />
        <div>
          <div style={{
            fontFamily: "var(--font-display)",
            fontSize: 64, lineHeight: .95,
            fontWeight: 500, letterSpacing: "-0.02em",
            color: "var(--text)",
          }}>
            Minerva
          </div>
          <div style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 16, marginTop: 8,
            color: "var(--text-muted)", letterSpacing: ".01em",
          }}>
            Software for superhumans
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {/* tagline triplet */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
        gap: 28, paddingTop: 28,
        borderTop: "1px solid var(--border)",
      }}>
        {[
          { k: "Notebase", v: "A markdown corpus you own, on disk, in plaintext, in git." },
          { k: "Knowledge graph", v: "Tags, wiki-links, frontmatter and claims, indexed live." },
          { k: "Trust principle", v: "The LLM proposes. The human confirms. Always." },
        ].map((row) => (
          <div key={row.k}>
            <div style={{
              fontFamily: "var(--font-display)", fontStyle: "italic",
              color: "var(--accent)", fontSize: 13, marginBottom: 6,
            }}>{row.k}</div>
            <div style={{
              fontSize: 13, lineHeight: 1.5,
              color: "var(--text-muted)", textWrap: "pretty",
            }}>{row.v}</div>
          </div>
        ))}
      </div>
    </div>
  </Surface>
);

// ─── 2. Color palette swatches ─────────────────────────────────────────────
const PaletteSwatches = ({ paletteKey, mode }) => {
  const p = PALETTES[paletteKey][mode];
  const swatches = [
    ["bg", p.bg, "bg"],
    ["bg-elev", p.bgElev, "elev"],
    ["bg-elev-2", p.bgElev2, "elev2"],
    ["border", p.border, "border"],
    ["text-faint", p.textFaint, "faint"],
    ["text-muted", p.textMuted, "muted"],
    ["text", p.text, "text"],
    ["accent", p.accent, "accent"],
    ["sage", p.sage, "sage"],
    ["rust", p.rust, "rust"],
    ["iris", p.iris, "iris"],
  ];
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10,
    }}>
      {swatches.map(([name, val, label]) => (
        <div key={name} style={{
          background: val,
          aspectRatio: "1.4",
          borderRadius: 6,
          border: "1px solid var(--border)",
          padding: 8,
          display: "flex", flexDirection: "column", justifyContent: "space-between",
          fontFamily: "var(--font-mono)", fontSize: 10,
          color: ["text", "border", "accent", "sage", "rust", "iris"].includes(label) && mode === "light" ? "white" : null,
        }}>
          <div style={{
            color: ["bg", "bg-elev", "bg-elev-2", "border", "faint", "muted"].includes(label) ? "var(--text-muted)" : (mode === "dark" ? "var(--accent-ink)" : "white"),
            fontWeight: 600, opacity: .95,
          }}>{label}</div>
          <div style={{
            color: ["bg", "bg-elev", "bg-elev-2", "border", "faint", "muted"].includes(label) ? "var(--text-faint)" : (mode === "dark" ? "var(--accent-ink)" : "white"),
            opacity: .85, fontSize: 9.5,
          }}>{val.replace(/oklch\(([^)]+)\)/, "$1")}</div>
        </div>
      ))}
    </div>
  );
};

const PaletteArtboard = ({ vars, mode, paletteKey }) => (
  <Surface vars={vars}>
    <div style={{ padding: 32, height: "100%", display: "flex", flexDirection: "column", gap: 22, background: "var(--bg)" }}>
      <div>
        <div style={{
          fontFamily: "var(--font-display)", fontStyle: "italic",
          fontSize: 13, color: "var(--accent)", marginBottom: 2,
        }}>palette · {mode}</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 500, letterSpacing: "-0.01em" }}>
          {PALETTES[paletteKey].name}
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>
          {PALETTES[paletteKey].blurb}
        </div>
      </div>
      <PaletteSwatches paletteKey={paletteKey} mode={mode} />
      <div style={{ marginTop: "auto", display: "flex", gap: 12, alignItems: "center", color: "var(--text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
        <div>oklch · linear-light · perceptually uniform</div>
      </div>
    </div>
  </Surface>
);

// ─── 3. Type specimen ──────────────────────────────────────────────────────
const TypeSpecimen = ({ vars, mode }) => (
  <Surface vars={vars}>
    <div style={{ padding: 32, height: "100%", overflow: "hidden", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{
          fontFamily: "var(--font-display)", fontStyle: "italic",
          fontSize: 13, color: "var(--accent)", marginBottom: 2,
        }}>type system</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, letterSpacing: "-0.01em" }}>
          IBM Plex — three voices, one family
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 8 }}>
          plex serif · display
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 40, lineHeight: 1.05, fontWeight: 500 }}>
          Knowledge worth keeping
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontStyle: "italic", color: "var(--text-muted)", marginTop: 4 }}>
          Used for the wordmark, slide titles, onboarding, about, headings inside dialogs.
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 6 }}>
          plex sans · ui
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--text)", maxWidth: 520 }}>
          The sans handles everything that isn't body prose or code: menus, sidebar tabs,
          tab bar, status bar, dialog body. 13–14px at cozy density, weight 450 by default.
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 6 }}>
          plex mono · editor
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}>
          # On the trust principle{"\n"}
          The LLM proposes. The human confirms. Filed in `[[approval-tiers]]`.
        </div>
      </div>
    </div>
  </Surface>
);

// ─── 4. Icon system specimen ───────────────────────────────────────────────
const IconSpecimen = ({ vars, mode }) => {
  const groups = [
    { title: "Left sidebar", names: ["notes", "sites", "tags", "tables"] },
    { title: "Right sidebar", names: ["outline", "footnotes", "properties", "outgoing", "backlinks", "tags", "tables", "citations", "bookmark", "inspections", "proposals"] },
    { title: "Chrome", names: ["back", "forward", "search", "settings", "close", "plus"] },
    { title: "Tree", names: ["chevronRight", "chevronDown", "expandAll", "collapseAll", "reveal", "folder"] },
    { title: "Editor / talk", names: ["link", "conversation", "sparkle", "send", "warn", "check", "dot"] },
  ];
  return (
    <Surface vars={vars}>
      <div style={{ padding: 32, height: "100%", overflow: "hidden", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--accent)", marginBottom: 2 }}>iconography</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, letterSpacing: "-0.01em" }}>
            Custom set. 16px. 1.4 stroke.
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
            Replaces every Unicode glyph in the app. Built around an "owl-eye"
            geometry — concentric circles, considered serifs, monoline.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
          {groups.map((g) => (
            <div key={g.title}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 6 }}>
                {g.title}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {g.names.map((n) => (
                  <div key={n} style={{
                    width: 56, height: 64,
                    border: "1px solid var(--border)", borderRadius: 6,
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: 4,
                    color: "var(--text)",
                  }}>
                    <Icon name={n} size={20} />
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, color: "var(--text-faint)" }}>{n}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Surface>
  );
};

window.MinervaBrand = { BrandArtboard, PaletteArtboard, TypeSpecimen, IconSpecimen, MinervaMark };
