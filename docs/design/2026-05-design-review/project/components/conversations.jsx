// Conversations bottom dock — current vs proposed.

const { Surface, catVars } = window.MinervaBits;
const Icon = window.MinervaIcon;

// ── CURRENT ────────────────────────────────────────────────────────────
const CurrentConversations = ({ mode }) => (
  <Surface vars={catVars(mode)}>
    <div style={{
      width: "100%", height: "100%",
      background: "var(--bg-titlebar)", borderTop: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      fontSize: 13, fontFamily: "inherit",
    }}>
      {/* tab strip */}
      <div style={{
        display: "flex", height: 26, borderBottom: "1px solid var(--border)",
        background: "var(--bg-titlebar)", overflow: "hidden",
      }}>
        {["Ask about this note", "On the trust principle", "Find sources"].map((t, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "0 12px", borderRight: "1px solid var(--border)",
            background: i === 0 ? "var(--bg)" : "transparent",
            color: i === 0 ? "var(--text)" : "var(--text-muted)",
            fontSize: 12,
          }}>
            <span>{t}</span>
            <span style={{ color: "var(--text-muted)" }}>×</span>
          </div>
        ))}
      </div>

      {/* messages */}
      <div style={{ flex: 1, overflow: "hidden", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: 11 }}>You</div>
          <div>What's the difference between requires_approval and notify_only?</div>
        </div>
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Assistant</div>
          <div>The two tiers differ in when the gate fires. requires_approval queues a
            proposal node and waits for human review; notify_only applies the write
            immediately and surfaces the diff in the activity feed.</div>
        </div>
        {/* draft card */}
        <div style={{
          border: "1px solid var(--border)", borderRadius: 4, padding: 8,
          background: "var(--bg)",
        }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
            Proposal · 2 notes
          </div>
          <div style={{ fontSize: 12 }}>essays/approval-tiers.md</div>
          <div style={{ fontSize: 12 }}>essays/write-guard.md</div>
          <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
            <button style={{
              background: "var(--accent)", color: "var(--bg)", border: "none",
              padding: "3px 8px", borderRadius: 3, fontSize: 11, cursor: "pointer",
            }}>Approve & file</button>
            <button style={{
              background: "var(--bg-button)", color: "var(--text)", border: "none",
              padding: "3px 8px", borderRadius: 3, fontSize: 11, cursor: "pointer",
            }}>Discard</button>
          </div>
        </div>
      </div>

      {/* composer */}
      <div style={{
        padding: 8, borderTop: "1px solid var(--border)",
        display: "flex", gap: 6, alignItems: "center",
      }}>
        <textarea style={{
          flex: 1, height: 28, padding: "5px 8px", resize: "none",
          background: "var(--bg)", color: "var(--text)",
          border: "1px solid var(--border)", borderRadius: 4,
          fontFamily: "inherit", fontSize: 12,
        }} defaultValue="" />
        <select style={{
          background: "var(--bg-button)", color: "var(--text)",
          border: "1px solid var(--border)", borderRadius: 4,
          fontSize: 11, padding: "4px 6px",
        }}>
          <option>claude-opus-4-1</option>
        </select>
      </div>
    </div>
  </Surface>
);

// ── PROPOSED ────────────────────────────────────────────────────────────
const ProposedConversations = ({ vars, mode }) => (
  <Surface vars={vars}>
    <div style={{
      width: "100%", height: "100%",
      background: "var(--bg-elev)", borderTop: "1px solid var(--border)",
      display: "flex", fontFamily: "var(--font-sans)",
    }}>
      {/* tab rail on the left — vertical chat list (mail-app pattern) */}
      <div style={{
        width: 220, borderRight: "1px solid var(--border)",
        background: "var(--bg)", display: "flex", flexDirection: "column",
        flexShrink: 0,
      }}>
        <div style={{
          padding: "12px 14px 8px", display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500,
            letterSpacing: "-0.005em",
          }}>Conversations</div>
          <button style={{
            border: "none", background: "transparent", color: "var(--text-muted)",
            padding: 3, borderRadius: 5, cursor: "pointer",
          }}><Icon name="plus" size={13} /></button>
        </div>
        <div style={{ overflow: "hidden", flex: 1 }}>
          {[
            { title: "Difference between approval tiers", note: "essays/trust-principle", time: "now", active: true, draftCount: 1 },
            { title: "Find sources on Toulmin's warrants", note: "essays/warrants", time: "12m" },
            { title: "Decompose: epistemic-defects", note: "ontology", time: "1h" },
            { title: "Auto-tag last week's journal", note: "journal/2026-w20", time: "Mon" },
          ].map((c, i) => (
            <div key={i} style={{
              padding: "10px 14px",
              borderLeft: c.active ? "2px solid var(--accent)" : "2px solid transparent",
              background: c.active ? "color-mix(in oklch, var(--accent) 8%, transparent)" : "transparent",
              cursor: "pointer",
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline",
              }}>
                <span style={{
                  fontSize: 12.5, color: c.active ? "var(--text)" : "var(--text)",
                  fontWeight: c.active ? 500 : 450,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{c.title}</span>
                <span style={{
                  fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)",
                  flexShrink: 0,
                }}>{c.time}</span>
              </div>
              <div style={{
                fontSize: 10.5, color: "var(--text-muted)", marginTop: 3,
                display: "flex", alignItems: "center", gap: 5,
              }}>
                <Icon name="notes" size={10} color="var(--text-faint)" />
                <span style={{ fontFamily: "var(--font-mono)" }}>{c.note}</span>
                {c.draftCount && (
                  <span style={{
                    marginLeft: "auto", padding: "0 5px", borderRadius: 999,
                    background: "color-mix(in oklch, var(--accent) 22%, transparent)",
                    color: "var(--accent)",
                    fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 600,
                  }}>
                    {c.draftCount} proposal
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* conversation pane */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* header */}
        <div style={{
          padding: "10px 18px 8px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 15.5, fontWeight: 500,
              color: "var(--text)", letterSpacing: "-0.005em",
            }}>Difference between approval tiers</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              In <span style={{ color: "var(--accent)" }}>essays/on-the-trust-principle.md</span>
              {" · "}claude-opus-4-1
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button style={{
              fontSize: 11, padding: "4px 8px", border: "1px solid var(--border)",
              background: "transparent", color: "var(--text-muted)",
              borderRadius: 5, cursor: "pointer", fontFamily: "inherit",
            }}>claude-opus-4-1 ▾</button>
          </div>
        </div>

        {/* messages */}
        <div style={{ flex: 1, overflow: "hidden", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <Msg side="user" name="you">
            What's the difference between <code style={{
              fontFamily: "var(--font-mono)", fontSize: 11.5,
              background: "color-mix(in oklch, var(--accent) 14%, transparent)",
              color: "var(--accent)", padding: "1px 5px", borderRadius: 3,
            }}>requires_approval</code> and <code style={{
              fontFamily: "var(--font-mono)", fontSize: 11.5,
              background: "color-mix(in oklch, var(--accent) 14%, transparent)",
              color: "var(--accent)", padding: "1px 5px", borderRadius: 3,
            }}>notify_only</code>?
          </Msg>

          <Msg side="assistant" name="claude">
            <p style={{ margin: 0, lineHeight: 1.55 }}>
              The two tiers differ in <em style={{ color: "var(--accent)" }}>when</em> the gate
              fires. <code style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--accent)" }}>requires_approval</code>{" "}
              queues a proposal and waits for human review;{" "}
              <code style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--accent)" }}>notify_only</code>{" "}
              applies the write immediately and surfaces the diff in the activity feed.
            </p>
            <p style={{ margin: "10px 0 0", lineHeight: 1.55 }}>
              I drafted two notes that explain this with examples — review below.
            </p>
          </Msg>

          {/* proposal card — drastically improved */}
          <ProposalCard />
        </div>

        {/* composer */}
        <div style={{
          padding: 12, borderTop: "1px solid var(--border)",
        }}>
          <div style={{
            background: "var(--bg)", border: "1px solid var(--border)",
            borderRadius: 8,
            display: "flex", flexDirection: "column",
          }}>
            <textarea style={{
              padding: "10px 12px", resize: "none", height: 36,
              background: "transparent", color: "var(--text)",
              border: "none", outline: "none",
              fontFamily: "var(--font-sans)", fontSize: 13,
            }} placeholder="Ask about this note, or paste a question…" />
            <div style={{
              display: "flex", padding: "6px 8px 6px 12px", alignItems: "center", gap: 6,
              borderTop: "1px solid var(--border)",
            }}>
              <Icon name="notes" size={12} color="var(--text-faint)" />
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                essays/on-the-trust-principle.md
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
                ⏎ to send · ⇧⏎ newline
              </span>
              <button style={{
                background: "var(--accent)", color: "var(--accent-ink)",
                border: "none", padding: "5px 10px",
                borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                fontSize: 12, fontWeight: 600,
                display: "inline-flex", alignItems: "center", gap: 5,
              }}>
                <Icon name="send" size={11} />
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Surface>
);

const Msg = ({ side, name, children }) => {
  const isUser = side === "user";
  return (
    <div style={{
      display: "flex", gap: 12,
      flexDirection: isUser ? "row-reverse" : "row",
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 999,
        background: isUser ? "color-mix(in oklch, var(--iris) 22%, transparent)" : "color-mix(in oklch, var(--accent) 22%, transparent)",
        color: isUser ? "var(--iris)" : "var(--accent)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 13,
        flexShrink: 0,
      }}>{isUser ? "Y" : "M"}</div>
      <div style={{
        flex: 1, maxWidth: "78%",
        padding: "8px 12px", borderRadius: 8,
        background: isUser ? "var(--bg)" : "transparent",
        border: isUser ? "1px solid var(--border)" : "none",
        fontSize: 13, lineHeight: 1.55,
      }}>
        {children}
      </div>
    </div>
  );
};

const ProposalCard = () => (
  <div style={{
    border: "1px solid color-mix(in oklch, var(--accent) 28%, transparent)",
    borderRadius: 8,
    overflow: "hidden",
    background: "color-mix(in oklch, var(--accent) 5%, var(--bg))",
    marginLeft: 40,
    maxWidth: "78%",
  }}>
    <div style={{
      padding: "8px 12px",
      display: "flex", alignItems: "center", gap: 8,
      borderBottom: "1px solid color-mix(in oklch, var(--accent) 18%, transparent)",
    }}>
      <Icon name="proposals" size={13} color="var(--accent)" />
      <span style={{
        fontSize: 12, fontWeight: 600, color: "var(--accent)",
        letterSpacing: ".01em",
      }}>Proposal</span>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
        · 2 new notes · 0 edits
      </span>
      <span style={{ flex: 1 }} />
      <span style={{
        fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)",
      }}>auto-expires in 72h</span>
    </div>
    {[
      { path: "essays/approval-tiers.md", added: 41, removed: 0 },
      { path: "essays/write-guard.md", added: 22, removed: 0 },
    ].map((row, i) => (
      <div key={i} style={{
        padding: "8px 12px",
        display: "flex", alignItems: "center", gap: 10,
        borderTop: i === 0 ? "none" : "1px solid var(--border)",
      }}>
        <Icon name="notes" size={13} color="var(--text-muted)" />
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text)",
          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{row.path}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--sage)" }}>+{row.added}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-faint)" }}>−{row.removed}</span>
        <Icon name="chevronRight" size={11} color="var(--text-faint)" />
      </div>
    ))}
    <div style={{
      padding: "8px 12px", display: "flex", gap: 6, alignItems: "center",
      borderTop: "1px solid color-mix(in oklch, var(--accent) 18%, transparent)",
    }}>
      <button style={{
        background: "var(--accent)", color: "var(--accent-ink)",
        border: "none", padding: "5px 12px",
        borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
        fontSize: 12, fontWeight: 600,
      }}>Approve &amp; file</button>
      <button style={{
        background: "transparent", border: "1px solid var(--border)",
        color: "var(--text-muted)", padding: "5px 12px",
        borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12,
      }}>Edit first</button>
      <button style={{
        background: "transparent", border: "none",
        color: "var(--text-muted)", padding: "5px 10px",
        borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12,
      }}>Discard</button>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
        ⏎ approve · ⌫ discard
      </span>
    </div>
  </div>
);

window.MinervaConversations = { CurrentConversations, ProposedConversations };
