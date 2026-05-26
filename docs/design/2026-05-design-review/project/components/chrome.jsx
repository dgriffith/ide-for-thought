// Chrome: titlebar, tab bar, status bar — current vs proposed.

const { Surface, catVars, TrafficLights, Pin } = window.MinervaBits;
const { MinervaMark } = window.MinervaBrand;
const Icon = window.MinervaIcon;

// ── CURRENT ──────────────────────────────────────────────────────────────

const CurrentTitleBar = ({ mode }) => (
  <Surface vars={catVars(mode)}>
    <div style={{ width: "100%", height: 38, display: "flex", alignItems: "center",
                  background: "var(--bg-titlebar)", borderBottom: "1px solid var(--border)",
                  padding: "0 0 0 80px", position: "relative" }}>
      <div style={{ position: "absolute", left: 80, display: "flex", gap: 2 }}>
        <button style={btnCurrent}>&#x2190;</button>
        <button style={btnCurrent}>&#x2192;</button>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, textAlign: "center",
                    fontSize: 12, color: "var(--text-muted)" }}>
        my-thoughts <span style={{ opacity: .5, margin: "0 4px" }}>/</span>
        on-the-trust-principle.md<span style={{ color: "var(--accent)" }}>*</span>
      </div>
    </div>
    <div style={{ position: "absolute", left: 18, top: 12, display: "flex", gap: 8 }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((c, i) =>
        <span key={i} style={{ width: 12, height: 12, borderRadius: 999, background: c }} />)}
    </div>
  </Surface>
);

const btnCurrent = {
  padding: "2px 6px", border: "none", borderRadius: 3, background: "none",
  color: "var(--text)", fontSize: 14, cursor: "pointer", lineHeight: 1,
};

const CurrentTabBar = ({ mode }) => (
  <Surface vars={catVars(mode)}>
    <div style={{ display: "flex", background: "var(--bg-titlebar)",
                  borderBottom: "1px solid var(--border)", height: 28 }}>
      {[
        { name: "on-the-trust-principle", dirty: true, active: true },
        { name: "epistemic-defects" },
        { name: "Query", icon: "▷" },
        { name: "Plato — Republic", icon: "📖" },
      ].map((t, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "5px 8px 5px 12px", borderRight: "1px solid var(--border)",
          background: t.active ? "var(--bg)" : "transparent",
          color: t.active ? "var(--text)" : "var(--text-muted)",
          fontSize: 12,
        }}>
          {t.icon && <span style={{ fontSize: 10 }}>{t.icon}</span>}
          <span>{t.name}</span>
          {t.dirty && <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)" }} />}
          <span style={{ width: 16, height: 16, color: "var(--text-muted)" }}>×</span>
        </div>
      ))}
    </div>
  </Surface>
);

const CurrentStatusBar = ({ mode }) => (
  <Surface vars={catVars(mode)}>
    <div style={{
      height: 22, display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 8px", background: "var(--bg-titlebar)", borderTop: "1px solid var(--border)",
      color: "var(--text-muted)", fontSize: 11,
    }}>
      <div style={{ display: "flex", gap: 12 }}>
        <span>Ln 47, Col 23</span>
        <span>14 selected</span>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <span>← 7</span>
        <span style={{ color: "#f9e2af" }}>⚠ 2</span>
        <span>1,284 words</span>
        <span>14px</span>
        <span>dark</span>
        <span>Markdown</span>
      </div>
    </div>
  </Surface>
);

// ── PROPOSED ─────────────────────────────────────────────────────────────

const ProposedTitleBar = ({ vars, mode }) => (
  <Surface vars={vars}>
    <div style={{ height: 42, background: "var(--bg)", borderBottom: "1px solid var(--border)",
                  display: "flex", alignItems: "center", padding: "0 0 0 80px", position: "relative" }}>
      {/* traffic lights */}
      <div style={{ position: "absolute", left: 16, top: 0, height: "100%", display: "flex",
                    alignItems: "center", gap: 8 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c, i) =>
          <span key={i} style={{ width: 12, height: 12, borderRadius: 999, background: c,
                                 boxShadow: "inset 0 0 0 .5px rgba(0,0,0,.15)" }} />)}
      </div>

      {/* nav cluster — icon-only, with affordance */}
      <div style={{ display: "flex", gap: 2, marginRight: 12 }}>
        <button style={navBtn}><Icon name="back" size={15} /></button>
        <button style={navBtn} data-disabled><Icon name="forward" size={15} /></button>
      </div>

      <div style={{ width: 1, height: 18, background: "var(--border)" }} />

      {/* breadcrumb — typographically calmed */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 12, fontSize: 13 }}>
        <Icon name="minervaMark" size={14} color="var(--accent)" />
        <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-sans)" }}>my-thoughts</span>
        <span style={{ color: "var(--text-faint)", fontSize: 11 }}>›</span>
        <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-sans)" }}>essays</span>
        <span style={{ color: "var(--text-faint)", fontSize: 11 }}>›</span>
        <span style={{ color: "var(--text)", fontFamily: "var(--font-display)", fontStyle: "italic" }}>
          On the trust principle
        </span>
        <span style={{ color: "var(--accent)", marginLeft: 2 }}>•</span>
      </div>

      {/* right cluster — search affordance, settings */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, paddingRight: 14 }}>
        <button style={searchBox}>
          <Icon name="search" size={13} color="var(--text-muted)" />
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Find…</span>
          <span style={{ marginLeft: 16, color: "var(--text-faint)", fontFamily: "var(--font-mono)", fontSize: 10 }}>⌘ K</span>
        </button>
        <button style={iconBtn}><Icon name="settings" size={15} color="var(--text-muted)" /></button>
      </div>
    </div>
  </Surface>
);

const navBtn = {
  width: 26, height: 26, padding: 0, border: "none", borderRadius: 6,
  background: "transparent", color: "var(--text-muted)", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const iconBtn = { ...navBtn };
const searchBox = {
  display: "inline-flex", alignItems: "center", gap: 6,
  height: 24, padding: "0 10px",
  background: "var(--bg-inset)", border: "1px solid var(--border)",
  borderRadius: 6, color: "var(--text-muted)", cursor: "text",
  fontFamily: "var(--font-sans)",
};

// Proposed tab bar — taller, leading icon glyph cell, dirty pip on left of name,
// active tab with accent underline.
const ProposedTabBar = ({ vars, mode }) => {
  const tabs = [
    { kind: "note", name: "On the trust principle", dirty: true, active: true, path: "essays/" },
    { kind: "note", name: "Epistemic defects", path: "ontology/" },
    { kind: "query", name: "Unreviewed LLM writes" },
    { kind: "source", name: "Plato — Republic" },
    { kind: "note", name: "How autocomplete should feel" },
  ];
  return (
    <Surface vars={vars}>
      <div style={{ display: "flex", background: "var(--bg-elev)",
                    borderBottom: "1px solid var(--border)", height: 36, alignItems: "stretch" }}>
        {tabs.map((t, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "0 14px 0 14px",
            borderRight: "1px solid var(--border)",
            background: t.active ? "var(--bg)" : "transparent",
            color: t.active ? "var(--text)" : "var(--text-muted)",
            fontSize: 13, fontFamily: "var(--font-sans)",
            position: "relative",
            cursor: "pointer",
          }}>
            {t.active && (
              <span style={{
                position: "absolute", left: 0, right: 0, bottom: -1, height: 2,
                background: "var(--accent)",
              }} />
            )}
            {t.dirty
              ? <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--accent)", flexShrink: 0 }} />
              : <Icon name={t.kind === "query" ? "query" : t.kind === "source" ? "source" : "notes"}
                      size={14} color="var(--text-faint)" />}
            <span style={{
              fontFamily: t.kind === "query" || t.kind === "note" ? "var(--font-sans)" : "var(--font-sans)",
              whiteSpace: "nowrap",
            }}>
              {t.name}
            </span>
            <span style={{
              width: 16, height: 16, borderRadius: 4, display: "inline-flex", alignItems: "center", justifyContent: "center",
              color: "var(--text-faint)", opacity: t.active ? .8 : 0,
            }}>
              <Icon name="close" size={11} />
            </span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <button style={{
          ...iconBtn, alignSelf: "center", marginRight: 8,
        }}><Icon name="plus" size={14} color="var(--text-muted)" /></button>
      </div>
    </Surface>
  );
};

// Proposed status bar — taller, segmented, tabular nums.
const ProposedStatusBar = ({ vars, mode }) => {
  const item = (children, opts = {}) => (
    <button style={{
      ...statusItem, ...(opts.muted ? { color: "var(--text-faint)" } : {}),
      ...(opts.accent ? { color: "var(--accent)" } : {}),
    }}>{children}</button>
  );
  return (
    <Surface vars={vars}>
      <div style={{
        height: 28, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 12px",
        background: "var(--bg-elev)", borderTop: "1px solid var(--border)",
        color: "var(--text-muted)", fontSize: 11.5, fontFamily: "var(--font-sans)",
      }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>L47 · C23</span>
          <span style={{ ...sep }} />
          <span style={{ color: "var(--text-faint)" }}>14 selected</span>
          <span style={{ ...sep }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="check" size={11} color="var(--sage)" />
            <span style={{ color: "var(--text-faint)" }}>saved · 12s ago</span>
          </span>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="backlinks" size={12} />
            <span style={{ fontVariantNumeric: "tabular-nums" }}>7</span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--rust)" }}>
            <Icon name="warn" size={12} />
            <span style={{ fontVariantNumeric: "tabular-nums" }}>2</span>
          </span>
          <span style={{ ...sep }} />
          <span style={{ color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>1,284 words</span>
          <span style={{ color: "var(--text-faint)" }}>·</span>
          <span style={{ color: "var(--text-faint)" }}>Markdown</span>
        </div>
      </div>
    </Surface>
  );
};

const statusItem = {
  border: "none", background: "none", padding: 0, color: "inherit",
  fontSize: "inherit", fontFamily: "inherit", cursor: "pointer",
};
const sep = { width: 1, height: 11, background: "var(--border)" };

window.MinervaChrome = {
  CurrentTitleBar, CurrentTabBar, CurrentStatusBar,
  ProposedTitleBar, ProposedTabBar, ProposedStatusBar,
};
