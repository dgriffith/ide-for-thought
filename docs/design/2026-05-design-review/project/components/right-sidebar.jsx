// Right sidebar — 11-panel ribbon nightmare → grouped, labeled, scannable.

const { Surface, catVars } = window.MinervaBits;
const Icon = window.MinervaIcon;

// ── CURRENT ─────────────────────────────────────────────────────────────
// The Outline panel is shown, but the killer problem is the tab strip itself:
// 11 single-glyph buttons most of which are indecipherable.
const CurrentRightSidebar = ({ mode }) => {
  const tabs = [
    "☰", "⁂", "≡", "→", "←", "#", "⊞", "❝", "☆", "⚠", "✓",
  ];
  return (
    <Surface vars={catVars(mode)}>
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column",
                    background: "var(--bg-sidebar)", borderLeft: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 2, padding: "6px 8px", borderBottom: "1px solid var(--border)",
                      overflowX: "auto" }}>
          {tabs.map((g, i) => (
            <button key={i} style={{
              flexShrink: 0, padding: "4px 10px", border: "none", borderRadius: 4,
              background: i === 0 ? "var(--bg-button-hover)" : "transparent",
              color: i === 0 ? "var(--text)" : "var(--text-muted)",
              fontSize: 14, cursor: "pointer", fontFamily: "inherit",
            }}>{g}</button>
          ))}
        </div>

        {/* Outline panel — sparse, no hierarchy cue */}
        <div style={{ padding: "8px", fontSize: 13, flex: 1, overflow: "hidden" }}>
          <div style={{ padding: "3px 6px" }}>On the trust principle</div>
          <div style={{ padding: "3px 6px", paddingLeft: 16 }}>Why proposals?</div>
          <div style={{ padding: "3px 6px", paddingLeft: 16 }}>Approval tiers</div>
          <div style={{ padding: "3px 6px", paddingLeft: 28 }}>requires_approval</div>
          <div style={{ padding: "3px 6px", paddingLeft: 28 }}>notify_only</div>
          <div style={{ padding: "3px 6px", paddingLeft: 28 }}>autonomous</div>
          <div style={{ padding: "3px 6px", paddingLeft: 16 }}>The write guard</div>
          <div style={{ padding: "3px 6px", paddingLeft: 16 }}>Open questions</div>
        </div>
      </div>
    </Surface>
  );
};

// ── PROPOSED ────────────────────────────────────────────────────────────
// Grouped tab strip with three buckets — Note · Links · Activity — and each
// group's children rendered as text-labeled pills. The active group's pills
// always show labels; inactive groups collapse to a single label. Active
// pill within a group is the panel showing below.
const ProposedRightSidebar = ({ vars, mode }) => {
  const groups = [
    {
      id: "note", label: "Note",
      items: [
        { id: "outline", icon: "outline", label: "Outline" },
        { id: "properties", icon: "properties", label: "Properties" },
        { id: "footnotes", icon: "footnotes", label: "Footnotes" },
      ],
    },
    {
      id: "links", label: "Links",
      items: [
        { id: "outgoing", icon: "outgoing", label: "Outgoing" },
        { id: "backlinks", icon: "backlinks", label: "Backlinks", badge: 7 },
        { id: "tags", icon: "tags", label: "Tags" },
        { id: "citations", icon: "citations", label: "Citations" },
        { id: "tables", icon: "tables", label: "Tables" },
      ],
    },
    {
      id: "activity", label: "Activity",
      items: [
        { id: "inspections", icon: "inspections", label: "Inspections", badge: 2, accent: "rust" },
        { id: "proposals", icon: "proposals", label: "Proposals", badge: 3, accent: "accent" },
        { id: "bookmark", icon: "bookmark", label: "Bookmarks" },
      ],
    },
  ];
  const activeGroup = "note";
  const activeItem = "outline";

  return (
    <Surface vars={vars}>
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        background: "var(--bg-elev)", borderLeft: "1px solid var(--border)",
        fontFamily: "var(--font-sans)",
      }}>
        {/* group strip */}
        <div style={{
          display: "flex", padding: "10px 12px 4px", gap: 2,
        }}>
          {groups.map((g) => {
            const active = g.id === activeGroup;
            const totalBadge = g.items.reduce((s, i) => s + (i.badge || 0), 0);
            return (
              <button key={g.id} style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "5px 10px", borderRadius: 7, border: "none",
                background: active ? "var(--bg)" : "transparent",
                color: active ? "var(--text)" : "var(--text-muted)",
                boxShadow: active ? "inset 0 0 0 1px var(--border)" : "none",
                fontSize: 12.5, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
              }}>
                <span>{g.label}</span>
                {totalBadge > 0 && (
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 10,
                    padding: "1px 5px", borderRadius: 999,
                    background: g.items.some(i => i.accent === "rust") ? "color-mix(in oklch, var(--rust) 22%, transparent)" : "color-mix(in oklch, var(--accent) 22%, transparent)",
                    color: g.items.some(i => i.accent === "rust") ? "var(--rust)" : "var(--accent)",
                    fontVariantNumeric: "tabular-nums",
                  }}>{totalBadge}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* sub-row of active group items */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 4,
          padding: "4px 12px 10px", borderBottom: "1px solid var(--border)",
        }}>
          {groups.find(g => g.id === activeGroup).items.map((it) => {
            const active = it.id === activeItem;
            return (
              <button key={it.id} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "4px 9px", borderRadius: 6, border: "none",
                background: active ? "color-mix(in oklch, var(--accent) 14%, transparent)" : "transparent",
                color: active ? "var(--accent)" : "var(--text-muted)",
                fontSize: 11.5, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
              }}>
                <Icon name={it.icon} size={13} color={active ? "var(--accent)" : "currentColor"} />
                <span>{it.label}</span>
                {it.badge && (
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 10,
                    color: it.accent === "rust" ? "var(--rust)" : (active ? "var(--accent)" : "var(--text-faint)"),
                    fontVariantNumeric: "tabular-nums",
                  }}>{it.badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Panel header */}
        <div style={{
          padding: "12px 16px 8px",
          display: "flex", alignItems: "baseline", justifyContent: "space-between",
        }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500,
            letterSpacing: "-0.01em",
          }}>
            Outline
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
              h1–h3
            </span>
            <button style={{
              padding: 4, borderRadius: 5, border: "none", background: "transparent",
              color: "var(--text-muted)", cursor: "pointer",
            }}><Icon name="settings" size={12} /></button>
          </div>
        </div>

        {/* Outline body — typographically structured */}
        <div style={{ padding: "0 8px", overflow: "hidden", flex: 1 }}>
          {[
            { level: 1, n: "I.",   t: "On the trust principle",   line: 1 },
            { level: 2, n: "01",   t: "Why proposals?",            line: 12 },
            { level: 2, n: "02",   t: "Approval tiers",            line: 38, active: true },
            { level: 3, n: "a",    t: "requires_approval",         line: 44 },
            { level: 3, n: "b",    t: "notify_only",               line: 61 },
            { level: 3, n: "c",    t: "autonomous",                line: 82 },
            { level: 2, n: "03",   t: "The write guard",           line: 104 },
            { level: 2, n: "04",   t: "Open questions",            line: 142 },
          ].map((h, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "baseline", gap: 10,
              padding: "5px 8px 5px",
              paddingLeft: 8 + (h.level - 1) * 14,
              borderLeft: h.active ? "2px solid var(--accent)" : "2px solid transparent",
              background: h.active ? "color-mix(in oklch, var(--accent) 10%, transparent)" : "transparent",
              cursor: "pointer",
            }}>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 10,
                color: h.active ? "var(--accent)" : "var(--text-faint)",
                width: 18,
              }}>{h.n}</span>
              <span style={{
                fontSize: h.level === 1 ? 13.5 : 12.5,
                fontWeight: h.level === 1 ? 500 : 450,
                fontFamily: h.level === 1 ? "var(--font-display)" : "var(--font-sans)",
                color: h.active ? "var(--text)" : (h.level === 3 ? "var(--text-muted)" : "var(--text)"),
                flex: 1,
              }}>{h.t}</span>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 10,
                color: "var(--text-faint)",
              }}>{h.line}</span>
            </div>
          ))}
        </div>
      </div>
    </Surface>
  );
};

window.MinervaRightSidebar = {
  CurrentRightSidebar, ProposedRightSidebar,
};
