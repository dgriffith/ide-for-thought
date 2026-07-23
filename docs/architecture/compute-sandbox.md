# ADR: OS sandbox for Python compute

**Status:** Proposed (2026-07). Scopes [#1329] (Security L1 — "Python compute is
full-privilege RCE by design"). macOS-only, matching the ship target. Builds on
the defense-in-depth already shipped under [#1413]: eyes-on-code consent
([#1412]), a real consent boundary in main ([#1411]), network-off-by-default in
the kernel ([#1418]), an execution audit log ([#1419]), and a static red-flag
scan ([#1420]).

This record fixes the mechanism, the policy, the phasing, and the open
decisions so the implementation PRs read as a deliberate plan rather than an
ad-hoc profile.

---

## Context

`src/main/compute/python-kernel.ts` executes arbitrary Python with the user's
full privileges. Everything shipped so far mitigates *how a cell gets to run*
(consent, provenance, audit) and shuts the *common* egress path *from inside the
interpreter* (the network socket guard). None of it is a real capability
boundary: a cell can still `subprocess` out, `ctypes` into libc, read
`~/.ssh/id_rsa`, or overwrite `~/.bashrc`. "Trust this thoughtbase" remains
equivalent to full-user RCE.

The endgame is an **OS-enforced boundary** so the interpreter simply *cannot*
touch the network or the filesystem outside the project, regardless of what the
code does.

## What can — and can't — be sandboxed

The decisive constraint: **only the Python kernel is a separate process.**

| Executor | Where it runs | Sandboxable per-process? |
|----------|---------------|--------------------------|
| **Python** | `python3` child of main (`python-kernel.ts`) | **Yes** |
| **SQL (DuckDB)** | in-process `.node` native addon, in main | No |
| **SPARQL** | in-process JS over the in-memory graph, in main | No |

So **this ADR's sandbox = the Python kernel only.** SQL and SPARQL execute
inside the main Electron process; isolating them would require extracting each
into its own helper process — a much larger, separate effort, explicitly out of
scope here. Their residual risk stays governed by what already exists: DuckDB's
`httpfs` autoload is disabled (`src/main/sources/tables.ts`, no network egress),
and SPARQL is read-only. Local-file read/write via DuckDB core built-ins remains
covered only by the consent gate — a known, accepted residual noted in
`tables.ts`.

## Decision: `sandbox-exec` + a Seatbelt profile

Our packaging is **Developer-ID + hardened runtime, _not_ App Sandbox**
(`build/entitlements.mac.plist` carries no `com.apple.security.app-sandbox`).
That rules some options in and out:

| Option | Granularity | Verdict |
|--------|-------------|---------|
| **`sandbox-exec` wrapping the kernel spawn** | exactly the Python child | **Chosen** |
| macOS **App Sandbox** (whole-app entitlements) | the entire app | Rejected — wrong granularity; wouldn't isolate compute from the rest of the app, and forces an MAS-style file model on everything |
| **XPC helper** with restrictive entitlements | a dedicated helper process | Deferred — Apple's "supported" per-process isolation and the proper long-term answer, but needs a macOS-native helper and a rewrite of the kernel transport |

`sandbox-exec(1)` is officially deprecated but present and functional on every
current macOS — Apple's own Seatbelt (`sandbox_init`) underpins the entire OS,
and mainstream tools (Chromium, various dev tools) rely on the same machinery.
The honest tradeoff: **ship the pragmatic `sandbox-exec` boundary now; treat the
XPC helper as a future hardening (Phase 3) if Apple ever removes the binary or
we pursue MAS distribution.** Because we're macOS-only, there is no
cross-platform tax on this choice.

### Integration point

In `spawnKernel`, wrap the launch:

```
spawn('/usr/bin/sandbox-exec',
  ['-D', `PROJECT=${rootPath}`,
   '-D', `TMPDIR=${tmpdir}`,
   '-f', profilePath,
   '--', pythonBin, kernelScript],
  { env, ... })
```

The profile is **parameterized per spawn** (`-D` params) from:

- `allowNetwork` (the existing per-machine setting) → emit `(allow network*)` or
  `(deny network*)`. The setting stays the single source of truth for network
  posture; the sandbox just makes it an OS boundary instead of an in-process
  guard.
- the **project root** → the one writable filesystem region.
- `TMPDIR` and the interpreter's own caches → writable (Python needs
  `__pycache__`, matplotlib needs a config dir).
- (Phase 3 only) the resolved interpreter **prefix** (`sys.prefix` /
  `sys.exec_prefix`) → for an allow-list read policy.

Loopback and the kernel's own Unix-domain RPC socket (`MINERVA_IPC_SOCKET`) must
stay permitted so the sandbox never severs the kernel's connection to main —
the same carve-out the in-kernel socket guard already makes.

## Policy — phased by breakage risk

A strict allow-list read policy breaks Python startup (dyld, frameworks,
`site-packages`, `mach-lookup` for CoreFoundation/matplotlib) and is
high-maintenance across Homebrew / pyenv / venv interpreters. So the profile is
**denylist-leaning**, and the phases are ordered by how likely each rule is to
break a legitimate cell.

### Phase 1 — network + exec containment (low breakage, highest value)

- `(deny network*)` unless `allowNetwork` → **turns the in-kernel socket guard
  from bypassable-via-subprocess into a real kernel boundary.** Single biggest
  win.
- `(deny process-exec*)` except the interpreter itself → **closes the
  `subprocess` / shell-out escape** (and with it the practical `ctypes`→`exec`
  path).
- Filesystem left broadly readable/writable → almost nothing legitimate breaks.

Phase 1 alone converts the two headline holes ("network off is bypassable",
"just shell out") into OS-enforced guarantees, at minimal breakage risk. It is
the recommended first PR.

### Phase 2 — filesystem containment (medium breakage)

- `(deny file-write*)` except the project root, `TMPDIR`, and interpreter caches
  → blocks overwriting `~/.bashrc`, planting a launch agent, etc.
- `(deny file-read*)` of a sensitive denylist — `~/.ssh`, `~/.aws`, `~/.config`,
  `~/.gnupg`, login keychains, browser profiles → blocks the "read secrets →
  exfiltrate" chain even if network were later enabled.

### Phase 3 — hardening (optional, higher breakage / larger effort)

- Tighten reads toward an allow-list (interpreter prefix + project only);
  minimize `mach-lookup`. Requires templating the interpreter's `sys.path`; must
  be validated across venv / Homebrew / pyenv.
- Evaluate the **XPC-helper** rearchitecture if `sandbox-exec` deprecation
  becomes real or MAS distribution is pursued.

## Robustness & failure modes

`sandbox-exec` can be absent, error on a malformed profile, or (someday) be
removed. The kernel must degrade **predictably, never silently**:

- Detect availability once (probe `/usr/bin/sandbox-exec` at first spawn).
- On an unavailable binary or a sandboxed-spawn failure, **fall back to the
  current in-kernel guards** (the socket guard still applies) **plus a one-time
  visible warning**, and **record the downgrade in the execution audit log**
  ([#1419]) so a sandbox failure is observable rather than a quiet loss of the
  boundary.
- Rationale: fail-closed (refuse all compute) is safest but breaks the feature
  on any environment quirk; a loud, audited graceful fallback keeps the tool
  usable while making the weakened posture impossible to miss.

## Testing

macOS-only integration tests (skip on non-darwin CI, mirroring
`tests/main/compute/python-library.test.ts`'s `skipIfNoPython`):

- With `allowNetwork` forced on, network is **still denied at the OS level**
  when the sandbox says so (proves the boundary, not just the in-kernel guard).
- A cell writing outside the project root is **denied**.
- A cell reading a planted sensitive file (Phase 2) is **denied**.
- A normal `import minerva` / pandas cell **still succeeds** under the sandbox
  (guards against an over-tight profile).

## Distribution notes

- Hardened runtime spawning `/usr/bin/sandbox-exec` needs **no new
  entitlements** — it's a plain child exec, and the app is not itself
  App-Sandboxed.
- The one caveat: if MAS / App-Sandbox distribution is ever pursued,
  `sandbox-exec` spawning is restricted and the **XPC-helper path (Phase 3)**
  becomes mandatory. Given Developer-ID-only distribution, this is not a current
  concern.

## Open decisions

1. **Fallback policy** — graceful+audited (recommended) vs. fail-closed vs. a
   user setting. Locked to graceful+audited unless a reviewer objects.
2. **Phase 2 write scope** — project root only, or project root + a
   user-configurable extra dir (for cells that legitimately write to a shared
   data dir)?
3. **Phase 2 read denylist** — ship a fixed list, or make it extensible?

## Child issues

- **P1** — `sandbox-exec` wrapper + `(deny network*/process-exec*)` + graceful
  audited fallback + macOS integration tests.
- **P2** — filesystem containment (`file-write*` to project/tmp only;
  `file-read*` sensitive denylist).
- **P3** (deferred) — allow-list hardening / `mach-lookup` minimization; XPC
  helper evaluation.

[#1329]: https://github.com/dgriffith/ide-for-thought/issues/1329
[#1411]: https://github.com/dgriffith/ide-for-thought/issues/1411
[#1412]: https://github.com/dgriffith/ide-for-thought/issues/1412
[#1413]: https://github.com/dgriffith/ide-for-thought/issues/1413
[#1418]: https://github.com/dgriffith/ide-for-thought/issues/1418
[#1419]: https://github.com/dgriffith/ide-for-thought/issues/1419
[#1420]: https://github.com/dgriffith/ide-for-thought/issues/1420
