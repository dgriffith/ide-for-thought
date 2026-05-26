// Settings dialog — 10 tabs, current vs proposed.

const { Surface, catVars } = window.MinervaBits;
const { ModalShell, DialogCard } = window.MinervaDialogsCommon;
const Icon = window.MinervaIcon;

// ── CURRENT ─────────────────────────────────────────────────────────
const CurrentSettings = ({ mode }) => (
  <ModalShell vars={catVars(mode)} scrim={.5}>
    <div style={{
      background: "var(--bg-sidebar)",
      border: "1px solid var(--border)",
      borderRadius: 8, width: 760, height: 480,
      boxShadow: "0 8px 24px rgba(0,0,0,.4)",
      fontFamily: "-apple-system, system-ui, sans-serif",
      fontSize: 13,
      display: "grid", gridTemplateColumns: "160px 1fr",
      overflow: "hidden",
    }}>
      {/* Tab rail */}
      <div style={{
        background: "var(--bg-titlebar)",
        borderRight: "1px solid var(--border)",
        padding: "12px 8px",
        display: "flex", flexDirection: "column", gap: 1,
      }}>
        {["Editor", "Appearance", "Behaviors", "Refactoring", "Formatter",
          "Web", "Sites", "Bibliography", "Compute", "AI"].map((t, i) => (
          <button key={t} style={{
            padding: "5px 10px", textAlign: "left", border: "none",
            borderRadius: 4, fontSize: 12,
            background: i === 0 ? "var(--bg-button-hover)" : "transparent",
            color: i === 0 ? "var(--text)" : "var(--text-muted)",
          }}>{t}</button>
        ))}
      </div>
      {/* Tab body */}
      <div style={{ padding: 16, overflow: "hidden" }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 12px" }}>Editor</h3>
        <Field label="Font size">
          <input type="number" defaultValue="14" style={inputCur} />
        </Field>
        <Field label="Line height">
          <input type="number" defaultValue="1.5" step=".1" style={inputCur} />
        </Field>
        <Field label="Tab size">
          <select style={inputCur}><option>2 spaces</option></select>
        </Field>
        <Field label="Show invisibles">
          <input type="checkbox" />
        </Field>
        <Field label="Word wrap">
          <input type="checkbox" defaultChecked />
        </Field>
        <Field label="Auto-save">
          <select style={inputCur}><option>After 800ms idle</option></select>
        </Field>
        <Field label="Show line numbers">
          <input type="checkbox" defaultChecked />
        </Field>
      </div>
    </div>
  </ModalShell>
);

const Field = ({ label, children }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "6px 0", gap: 12,
  }}>
    <label style={{ color: "var(--text-muted)", fontSize: 12 }}>{label}</label>
    {children}
  </div>
);

const inputCur = {
  padding: "4px 8px", background: "var(--bg)", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 3, fontSize: 12,
  fontFamily: "inherit",
};

// ── PROPOSED ────────────────────────────────────────────────────────
const ProposedSettings = ({ vars, mode }) => {
  const groups = [
    {
      label: "Workspace", items: [
        { id: "editor", icon: "notes", label: "Editor", sub: "Font · wrap · whitespace", active: true },
        { id: "appearance", icon: "settings", label: "Appearance", sub: "Theme · fonts · density" },
        { id: "behaviors", icon: "reveal", label: "Behaviors", sub: "Auto-reveal · don't-ask-again" },
      ],
    },
    {
      label: "Authoring", items: [
        { id: "refactor", icon: "link", label: "Refactoring", sub: "Extract · split · merge" },
        { id: "formatter", icon: "check", label: "Formatter", sub: "31 rules · 5 enabled" },
        { id: "bibliography", icon: "citations", label: "Bibliography", sub: "Citation style · Zotero" },
      ],
    },
    {
      label: "Ingest & compute", items: [
        { id: "web", icon: "outgoing", label: "Web", sub: "Browser · ingest" },
        { id: "sites", icon: "sites", label: "Privileged sites", sub: "3 trusted" },
        { id: "compute", icon: "query", label: "Compute", sub: "Python · trust scope" },
      ],
    },
    {
      label: "AI", items: [
        { id: "ai", icon: "sparkle", label: "AI", sub: "Key · model · tools", badge: "·" },
      ],
    },
  ];
  return (
    <ModalShell vars={vars} scrim={.45}>
      <DialogCard width={920} style={{ height: 580, overflow: "hidden", display: "grid", gridTemplateColumns: "260px 1fr" }}>
        {/* Sidebar nav with groups */}
        <div style={{
          background: "var(--bg)",
          borderRight: "1px solid var(--border)",
          padding: "20px 0",
          overflow: "hidden",
        }}>
          {/* heading */}
          <div style={{ padding: "0 20px 16px" }}>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 19,
              fontWeight: 500, letterSpacing: "-0.005em",
            }}>Settings</div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 1, fontFamily: "var(--font-mono)" }}>
              minerva · v1.0.0
            </div>
          </div>
          {/* search */}
          <div style={{ padding: "0 14px 12px" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px", borderRadius: 6,
              background: "var(--bg-inset)", border: "1px solid var(--border)",
              fontSize: 12, color: "var(--text-muted)",
            }}>
              <Icon name="search" size={12} />
              <span>Search settings…</span>
            </div>
          </div>
          {groups.map((g) => (
            <div key={g.label} style={{ marginBottom: 10 }}>
              <div style={{
                padding: "5px 20px",
                fontFamily: "var(--font-mono)", fontSize: 10,
                color: "var(--text-faint)",
                letterSpacing: ".06em", textTransform: "uppercase",
              }}>{g.label}</div>
              {g.items.map((it) => (
                <div key={it.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "6px 20px",
                  borderLeft: it.active ? "2px solid var(--accent)" : "2px solid transparent",
                  background: it.active ? "color-mix(in oklch, var(--accent) 12%, transparent)" : "transparent",
                  cursor: "pointer",
                }}>
                  <Icon name={it.icon} size={14} color={it.active ? "var(--accent)" : "var(--text-muted)"} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12.5, color: "var(--text)",
                      fontWeight: it.active ? 500 : 450,
                    }}>{it.label}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 1 }}>{it.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Body */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Sticky title */}
          <div style={{
            padding: "22px 30px 14px",
            borderBottom: "1px solid var(--border)",
          }}>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 10.5,
              color: "var(--accent)", letterSpacing: ".08em",
              textTransform: "uppercase", marginBottom: 6,
            }}>Workspace · Editor</div>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500,
              letterSpacing: "-0.01em",
            }}>How the editor feels</div>
            <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-muted)", maxWidth: 540 }}>
              CodeMirror surface. These changes apply to every open note immediately.
            </div>
          </div>

          {/* Settings sections */}
          <div style={{ padding: "18px 30px 12px", overflow: "hidden", flex: 1 }}>
            <Section title="Type">
              <Setting label="Font family" sub="The mono used in the editor body.">
                <select style={selectProp} defaultValue="plex">
                  <option value="plex">IBM Plex Mono</option>
                  <option>JetBrains Mono</option>
                  <option>Berkeley Mono</option>
                  <option>system monospace</option>
                </select>
              </Setting>
              <Setting label="Font size" sub="Effective scale across all notes.">
                <Stepper value={14} unit="px" />
              </Setting>
              <Setting label="Line height" sub="Multiplier; 1.5 is comfortable.">
                <Stepper value={1.55} step={0.05} />
              </Setting>
            </Section>

            <Section title="Behavior">
              <Setting label="Word wrap" sub="Wrap long lines at the right margin.">
                <Toggle on />
              </Setting>
              <Setting label="Auto-save" sub="Files persist after this idle window.">
                <select style={selectProp}>
                  <option>After 800ms idle</option>
                </select>
              </Setting>
              <Setting label="Show invisibles" sub="Tabs and trailing whitespace.">
                <Toggle />
              </Setting>
              <Setting label="Show line numbers">
                <Toggle on />
              </Setting>
            </Section>
          </div>

          {/* Footer */}
          <div style={{
            padding: "12px 28px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{
              fontSize: 11, color: "var(--text-faint)",
              fontFamily: "var(--font-mono)",
            }}>
              Settings save immediately · no Apply button
            </span>
            <span style={{ flex: 1 }} />
            <button style={{
              padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border)",
              background: "transparent", color: "var(--text-muted)", fontSize: 12,
              cursor: "pointer", fontFamily: "inherit",
            }}>Reset section to defaults</button>
            <button style={{
              padding: "6px 14px", borderRadius: 6, border: "none",
              background: "var(--accent)", color: "var(--accent-ink)",
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}>Done</button>
          </div>
        </div>
      </DialogCard>
    </ModalShell>
  );
};

const Section = ({ title, children }) => (
  <div style={{ marginBottom: 22 }}>
    <div style={{
      fontFamily: "var(--font-mono)", fontSize: 10.5,
      color: "var(--text-faint)", letterSpacing: ".08em",
      textTransform: "uppercase", marginBottom: 10,
    }}>{title}</div>
    <div style={{
      background: "var(--bg-inset)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      overflow: "hidden",
    }}>{children}</div>
  </div>
);

const Setting = ({ label, sub, children }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 16,
    padding: "12px 14px",
    borderBottom: "1px solid var(--border)",
  }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 450 }}>{label}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{sub}</div>}
    </div>
    <div>{children}</div>
  </div>
);

const selectProp = {
  background: "var(--bg)", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 6,
  padding: "5px 10px", fontSize: 12, fontFamily: "var(--font-sans)",
};

const Stepper = ({ value, step = 1, unit = "" }) => (
  <div style={{
    display: "inline-flex", alignItems: "center",
    background: "var(--bg)", border: "1px solid var(--border)",
    borderRadius: 6, overflow: "hidden",
  }}>
    <button style={{
      padding: "5px 8px", border: "none", background: "transparent",
      color: "var(--text-muted)", cursor: "pointer", fontFamily: "var(--font-mono)",
    }}>−</button>
    <span style={{
      padding: "5px 10px", fontFamily: "var(--font-mono)", fontSize: 12,
      color: "var(--text)", borderLeft: "1px solid var(--border)",
      borderRight: "1px solid var(--border)", minWidth: 48, textAlign: "center",
    }}>{value}{unit}</span>
    <button style={{
      padding: "5px 8px", border: "none", background: "transparent",
      color: "var(--text-muted)", cursor: "pointer", fontFamily: "var(--font-mono)",
    }}>+</button>
  </div>
);

const Toggle = ({ on }) => (
  <span style={{
    display: "inline-flex", width: 32, height: 18, borderRadius: 999,
    background: on ? "var(--accent)" : "var(--border-strong)",
    position: "relative", cursor: "pointer", verticalAlign: "middle",
  }}>
    <span style={{
      position: "absolute", top: 2, left: on ? 16 : 2,
      width: 14, height: 14, borderRadius: 999,
      background: "white", boxShadow: "0 1px 2px rgba(0,0,0,.2)",
      transition: "left .15s",
    }} />
  </span>
);

window.MinervaDialogsSettings = { CurrentSettings, ProposedSettings };
