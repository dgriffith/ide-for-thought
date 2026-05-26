// Common dialog primitives: backdrop + small confirm/prompt + busy overlay.
// Render inside an artboard that has bg/elev variables set.

const { Surface, catVars } = window.MinervaBits;
const Icon = window.MinervaIcon;

// Backdrop fills the artboard, places the dialog card in the center. The
// artboard itself shows a faint shadow of the underlying app to give context.
const ModalShell = ({ children, vars, scrim = .55, bgPattern }) => (
  <Surface vars={vars}>
    <div style={{
      width: "100%", height: "100%", position: "relative",
      background: "var(--bg)",
      overflow: "hidden",
    }}>
      {/* dimmed "app behind it" sketch */}
      <div style={{
        position: "absolute", inset: 0,
        background:
          "linear-gradient(180deg, var(--bg-elev) 0 42px, transparent 42px), " +
          "linear-gradient(90deg, var(--bg-elev) 0 240px, transparent 240px)," +
          "var(--bg)",
        opacity: .9,
      }}>
        {bgPattern}
      </div>
      <div style={{
        position: "absolute", inset: 0,
        background: `rgba(20, 14, 6, ${scrim})`,
        backdropFilter: "blur(2px)",
      }} />
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 32,
      }}>{children}</div>
    </div>
  </Surface>
);

const DialogCard = ({ width = 380, children, style }) => (
  <div style={{
    background: "var(--bg-elev)",
    border: "1px solid var(--border-strong)",
    borderRadius: 12,
    boxShadow: "0 16px 48px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.04) inset",
    width, maxWidth: "100%",
    fontFamily: "var(--font-sans)",
    color: "var(--text)",
    ...style,
  }}>{children}</div>
);

// ── Confirm — CURRENT ──────────────────────────────────────────────────
const CurrentConfirm = ({ mode }) => (
  <ModalShell vars={catVars(mode)} scrim={.5}>
    <div style={{
      background: "var(--bg-sidebar)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      padding: 16,
      minWidth: 300, maxWidth: 400,
      boxShadow: "0 8px 24px rgba(0,0,0,.4)",
      fontFamily: "-apple-system, system-ui, sans-serif",
      fontSize: 13, display: "flex", flexDirection: "column", gap: 12,
      color: "var(--text)",
    }}>
      <p style={{ margin: 0 }}>
        Delete note "epistemic-defects.md"?
      </p>
      <label style={{ display: "flex", gap: 6, color: "var(--text-muted)", fontSize: 12, alignItems: "center" }}>
        <input type="checkbox" /> Don't ask again
      </label>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button style={{
          padding: "5px 14px", borderRadius: 4, fontSize: 12,
          background: "var(--bg-button)", color: "var(--text)",
          border: "1px solid var(--border)",
        }}>Cancel</button>
        <button style={{
          padding: "5px 14px", borderRadius: 4, fontSize: 12,
          background: "var(--accent)", color: "var(--bg)", border: "1px solid var(--accent)",
        }}>Delete</button>
      </div>
    </div>
  </ModalShell>
);

// ── Confirm — PROPOSED ─────────────────────────────────────────────────
const ProposedConfirm = ({ vars, mode }) => (
  <ModalShell vars={vars}>
    <DialogCard width={440}>
      {/* contextual header — title in serif, with the action verb */}
      <div style={{ padding: "20px 24px 0" }}>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 10.5,
          color: "var(--text-faint)", letterSpacing: ".08em",
          textTransform: "uppercase", marginBottom: 6,
        }}>Confirm action</div>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 19,
          fontWeight: 500, letterSpacing: "-0.005em",
        }}>
          Delete note?
        </div>
      </div>

      <div style={{ padding: "12px 24px 0", fontSize: 13, lineHeight: 1.5, color: "var(--text-muted)" }}>
        <span style={{ color: "var(--text)" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)" }}>
            essays/epistemic-defects.md
          </span>
        </span>{" "}
        will be removed from the file tree. The file stays in git history —
        run <code style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text)", background: "var(--bg-inset)", padding: "1px 5px", borderRadius: 3 }}>git checkout</code>{" "}
        to recover it.
      </div>

      <div style={{ padding: "16px 24px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <label style={{
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 12, color: "var(--text-muted)", cursor: "pointer",
        }}>
          <input type="checkbox" style={{ accentColor: "var(--accent)" }} />
          Don't ask me about deletes again
        </label>
      </div>

      <div style={{
        padding: "12px 18px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg)",
        borderRadius: "0 0 12px 12px",
        display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center",
      }}>
        <span style={{
          marginRight: "auto", fontSize: 10.5, color: "var(--text-faint)",
          fontFamily: "var(--font-mono)",
        }}>esc · cancel</span>
        <button style={{
          padding: "7px 14px", borderRadius: 6, fontSize: 12.5,
          background: "transparent", color: "var(--text-muted)",
          border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit",
        }}>Cancel</button>
        {/* "primary" not "danger" — per CLAUDE.md "no danger styling".
            Just the accent. Delete is a normal operation. */}
        <button style={{
          padding: "7px 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 600,
          background: "var(--accent)", color: "var(--accent-ink)",
          border: "1px solid var(--accent)", cursor: "pointer",
          fontFamily: "inherit",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          Delete
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, opacity: .7 }}>↵</span>
        </button>
      </div>
    </DialogCard>
  </ModalShell>
);

// ── Prompt — CURRENT ───────────────────────────────────────────────────
const CurrentPrompt = ({ mode }) => (
  <ModalShell vars={catVars(mode)}>
    <div style={{
      background: "var(--bg-sidebar)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      padding: 16,
      minWidth: 300, maxWidth: 400,
      boxShadow: "0 8px 24px rgba(0,0,0,.4)",
      fontFamily: "-apple-system, system-ui, sans-serif",
      fontSize: 13, display: "flex", flexDirection: "column", gap: 12,
      color: "var(--text)",
    }}>
      <label style={{ margin: 0 }}>New note name:</label>
      <input type="text" style={{
        padding: "6px 10px", border: "1px solid var(--accent)", borderRadius: 4,
        background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none",
      }} defaultValue="approval-tiers" />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button style={{
          padding: "5px 14px", borderRadius: 4, fontSize: 12,
          background: "var(--bg-button)", color: "var(--text)", border: "1px solid var(--border)",
        }}>Cancel</button>
        <button style={{
          padding: "5px 14px", borderRadius: 4, fontSize: 12,
          background: "var(--accent)", color: "var(--bg)", border: "1px solid var(--accent)",
        }}>OK</button>
      </div>
    </div>
  </ModalShell>
);

// ── Prompt — PROPOSED ──────────────────────────────────────────────────
const ProposedPrompt = ({ vars, mode }) => (
  <ModalShell vars={vars}>
    <DialogCard width={460}>
      <div style={{ padding: "20px 24px 0" }}>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 10.5,
          color: "var(--text-faint)", letterSpacing: ".08em",
          textTransform: "uppercase", marginBottom: 6,
        }}>New note</div>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 19,
          fontWeight: 500, letterSpacing: "-0.005em",
        }}>
          What should we call it?
        </div>
      </div>
      <div style={{ padding: "14px 24px 18px" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 0,
          background: "var(--bg-inset)",
          border: "1px solid var(--accent)",
          boxShadow: "0 0 0 3px color-mix(in oklch, var(--accent) 18%, transparent)",
          borderRadius: 7, padding: "4px 4px 4px 12px",
        }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-faint)" }}>
            essays/
          </span>
          <input style={{
            flex: 1, padding: "6px 8px", border: "none", background: "transparent",
            color: "var(--text)", fontSize: 14, outline: "none",
            fontFamily: "var(--font-mono)",
          }} defaultValue="approval-tiers" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-faint)", paddingRight: 8 }}>
            .md
          </span>
        </div>
        <div style={{
          marginTop: 10, fontSize: 11.5, color: "var(--text-faint)",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <Icon name="reveal" size={11} />
          The note will be created next to <code style={{ fontFamily: "var(--font-mono)" }}>on-the-trust-principle.md</code>.
        </div>
      </div>
      <div style={{
        padding: "12px 18px", borderTop: "1px solid var(--border)",
        background: "var(--bg)", borderRadius: "0 0 12px 12px",
        display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center",
      }}>
        <span style={{ marginRight: "auto", fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
          esc · cancel · ↵ create
        </span>
        <button style={{
          padding: "7px 14px", borderRadius: 6, fontSize: 12.5,
          background: "transparent", color: "var(--text-muted)",
          border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit",
        }}>Cancel</button>
        <button style={{
          padding: "7px 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 600,
          background: "var(--accent)", color: "var(--accent-ink)",
          border: "1px solid var(--accent)", cursor: "pointer", fontFamily: "inherit",
        }}>Create note</button>
      </div>
    </DialogCard>
  </ModalShell>
);

// ── Busy Overlay — CURRENT ─────────────────────────────────────────────
const CurrentBusy = ({ mode }) => (
  <ModalShell vars={catVars(mode)} scrim={.4}>
    <div style={{
      padding: 16, background: "var(--bg-sidebar)",
      border: "1px solid var(--border)", borderRadius: 6,
      color: "var(--text)", fontSize: 13,
      fontFamily: "-apple-system, system-ui, sans-serif",
      minWidth: 220, textAlign: "center",
    }}>
      Merging notes…
    </div>
  </ModalShell>
);

// ── Busy Overlay — PROPOSED ────────────────────────────────────────────
const ProposedBusy = ({ vars, mode }) => (
  <ModalShell vars={vars} scrim={.35}>
    <DialogCard width={300} style={{ textAlign: "center", padding: "26px 24px 22px" }}>
      <div style={{
        margin: "0 auto 14px", width: 40, height: 40,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--accent)",
      }}>
        <svg viewBox="0 0 24 24" width="32" height="32">
          <circle cx="12" cy="12" r="9" stroke="var(--border)" strokeWidth="2" fill="none" />
          <path d="M21 12a9 9 0 0 1-9 9" stroke="var(--accent)" strokeWidth="2" fill="none"
                strokeLinecap="round" style={{
                  transformOrigin: "12px 12px",
                  animation: "spin 1.2s linear infinite",
                }} />
        </svg>
      </div>
      <div style={{
        fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500,
        letterSpacing: "-0.005em",
      }}>
        Merging notes
      </div>
      <div style={{
        marginTop: 6, fontSize: 12, color: "var(--text-muted)",
        lineHeight: 1.4,
      }}>
        Rewriting <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>13 incoming links</span>{" "}
        across the thoughtbase.
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </DialogCard>
  </ModalShell>
);

window.MinervaDialogsCommon = {
  ModalShell, DialogCard,
  CurrentConfirm, ProposedConfirm,
  CurrentPrompt, ProposedPrompt,
  CurrentBusy, ProposedBusy,
};
