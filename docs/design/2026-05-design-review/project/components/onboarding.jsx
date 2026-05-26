// Onboarding / About — the "personality" piece.

const { Surface } = window.MinervaBits;
const { MinervaMark } = window.MinervaBrand;
const Icon = window.MinervaIcon;

const CurrentOnboarding = () => {
  const { catVars } = window.MinervaBits;
  return (
    <Surface vars={catVars("dark")}>
      <div style={{
        width: "100%", height: "100%", background: "var(--bg)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 32,
        color: "var(--text)", fontFamily: "-apple-system, system-ui, sans-serif",
      }}>
        <div style={{
          width: 460, background: "var(--bg-sidebar)", border: "1px solid var(--border)",
          borderRadius: 6, padding: 22, fontSize: 13,
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            Welcome to Minerva
          </h2>
          <p style={{ marginBottom: 12, color: "var(--text)" }}>
            This thoughtbase is empty. I can draft an opening overview for you
            and file it as notes you can edit. Tell me what to write about.
          </p>
          <label style={{ display: "block", marginBottom: 4, color: "var(--text-muted)" }}>Subject</label>
          <input style={{
            width: "100%", padding: 6, marginBottom: 12,
            background: "var(--bg)", color: "var(--text)",
            border: "1px solid var(--border)", borderRadius: 3,
          }} placeholder="e.g. epistemology" />
          <label style={{ display: "block", marginBottom: 4, color: "var(--text-muted)" }}>Depth</label>
          <select style={{
            width: "100%", padding: 6, marginBottom: 12,
            background: "var(--bg)", color: "var(--text)",
            border: "1px solid var(--border)", borderRadius: 3,
          }}>
            <option>Moderate — 8 to 12 notes</option>
          </select>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button style={{
              padding: "5px 12px", background: "var(--bg-button)", color: "var(--text)",
              border: "1px solid var(--border)", borderRadius: 3,
            }}>Cancel</button>
            <button style={{
              padding: "5px 12px", background: "var(--accent)", color: "var(--bg)",
              border: "none", borderRadius: 3, fontWeight: 600,
            }}>Draft</button>
          </div>
        </div>
      </div>
    </Surface>
  );
};

const ProposedOnboarding = ({ vars, mode }) => (
  <Surface vars={vars}>
    <div style={{
      width: "100%", height: "100%", background: "var(--bg)",
      display: "flex", alignItems: "stretch", overflow: "hidden",
      fontFamily: "var(--font-sans)",
    }}>
      {/* left: brand panel */}
      <div style={{
        width: 280, padding: 36,
        background: "var(--bg-elev)",
        borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", justifyContent: "space-between",
        position: "relative", overflow: "hidden",
      }}>
        {/* subtle paper-ruling */}
        <div style={{
          position: "absolute", inset: 0, opacity: .05, pointerEvents: "none",
          backgroundImage: `repeating-linear-gradient(0deg, transparent 0 30px, var(--text) 30px 30.5px)`,
        }} />
        <div style={{ position: "relative" }}>
          <MinervaMark size={64} color="var(--accent)" />
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 36, fontWeight: 500,
            letterSpacing: "-0.02em", marginTop: 16, lineHeight: 1,
          }}>Minerva</div>
          <div style={{
            fontFamily: "var(--font-display)", fontStyle: "italic",
            color: "var(--text-muted)", fontSize: 13, marginTop: 4,
          }}>Software for superhumans</div>
        </div>
        <div style={{
          fontFamily: "var(--font-display)", fontStyle: "italic",
          fontSize: 15, lineHeight: 1.55, color: "var(--text-muted)",
          position: "relative",
        }}>
          “The owl of Minerva spreads her wings only with the falling of the
          dusk.” <span style={{ display: "block", marginTop: 8, fontSize: 11, fontFamily: "var(--font-mono)", fontStyle: "normal" }}>— Hegel</span>
        </div>
      </div>

      {/* right: the actual form */}
      <div style={{
        flex: 1, padding: "44px 48px", overflow: "hidden",
        display: "flex", flexDirection: "column", gap: 22,
      }}>
        <div>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 11,
            color: "var(--accent)", letterSpacing: ".06em", textTransform: "uppercase",
            marginBottom: 8,
          }}>New thoughtbase · step 1 of 1</div>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 500,
            letterSpacing: "-0.015em", lineHeight: 1.1,
          }}>
            What would you like to think about?
          </div>
          <div style={{
            fontSize: 13.5, color: "var(--text-muted)", marginTop: 10,
            lineHeight: 1.55, maxWidth: 460,
          }}>
            I'll draft a starter set of linked notes — an index plus a handful
            of children — and you can approve, edit, or discard the whole thing
            with one keystroke.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 460 }}>
          <Field label="Subject">
            <input style={input} defaultValue="The epistemology of dialogue" />
          </Field>

          <Field label="Reader" inline>
            <div style={{ display: "flex", gap: 6 }}>
              {["new to it", "familiar", "expert"].map((opt, i) => (
                <button key={opt} style={{
                  ...segBtn,
                  background: i === 1 ? "var(--bg)" : "transparent",
                  color: i === 1 ? "var(--text)" : "var(--text-muted)",
                  boxShadow: i === 1 ? "inset 0 0 0 1px var(--border-strong)" : "inset 0 0 0 1px var(--border)",
                }}>{opt}</button>
              ))}
            </div>
          </Field>

          <Field label="Depth" inline>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { l: "quick", n: "3–5" },
                { l: "moderate", n: "8–12" },
                { l: "deep", n: "15–25" },
              ].map((opt, i) => (
                <button key={opt.l} style={{
                  ...segBtn,
                  background: i === 1 ? "color-mix(in oklch, var(--accent) 14%, transparent)" : "transparent",
                  color: i === 1 ? "var(--accent)" : "var(--text-muted)",
                  boxShadow: i === 1 ? "inset 0 0 0 1px color-mix(in oklch, var(--accent) 30%, transparent)" : "inset 0 0 0 1px var(--border)",
                  display: "inline-flex", flexDirection: "column", alignItems: "center", padding: "8px 14px",
                }}>
                  <span style={{ fontWeight: 500 }}>{opt.l}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)" }}>{opt.n} notes</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label="For" optional>
            <input style={input} placeholder="e.g. a graduate seminar I'm preparing" />
          </Field>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{
          display: "flex", alignItems: "center", gap: 14,
          paddingTop: 16, borderTop: "1px solid var(--border)",
        }}>
          <button style={{
            background: "var(--accent)", color: "var(--accent-ink)",
            border: "none", padding: "9px 18px",
            borderRadius: 7, cursor: "pointer", fontFamily: "inherit",
            fontSize: 13, fontWeight: 600,
            display: "inline-flex", alignItems: "center", gap: 7,
          }}>
            <Icon name="sparkle" size={12} />
            Draft my thoughtbase
          </button>
          <button style={{
            background: "transparent", color: "var(--text-muted)",
            border: "none", padding: "9px 12px",
            cursor: "pointer", fontFamily: "inherit", fontSize: 13,
          }}>I'll start from scratch</button>
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: 11.5, color: "var(--text-faint)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" defaultChecked />
            Don't ask again
          </label>
        </div>
      </div>
    </div>
  </Surface>
);

const Field = ({ label, optional, inline, children }) => (
  <div style={{
    display: inline ? "flex" : "block",
    alignItems: inline ? "center" : "stretch",
    justifyContent: "space-between",
    gap: 14,
  }}>
    <label style={{
      fontSize: 12, color: "var(--text-muted)",
      display: "block", marginBottom: inline ? 0 : 6,
      fontFamily: "var(--font-sans)",
    }}>
      {label}
      {optional && <span style={{ color: "var(--text-faint)", marginLeft: 6 }}>· optional</span>}
    </label>
    {children}
  </div>
);

const input = {
  width: "100%", padding: "8px 10px",
  background: "var(--bg-inset)", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 6,
  fontFamily: "var(--font-sans)", fontSize: 13,
  outline: "none",
};
const segBtn = {
  padding: "6px 12px", border: "none",
  borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
  fontSize: 12, fontWeight: 450,
};

window.MinervaOnboarding = { CurrentOnboarding, ProposedOnboarding };
