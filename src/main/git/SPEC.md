---
id: git
type: submodule-design
status: draft
title: Git — opt-in publish target
parent: publish
---

## Responsibility

The opt-in Git *publish* flow: committing and pushing a rendered/exported copy of
a thoughtbase to a remote, using `isomorphic-git` so no system `git` binary is
required.

## Boundary

- **Not version control for the thoughtbase.** Thoughtbases are never auto-
  committed — this is a product non-goal. Git here is only a publish destination
  the user explicitly configures and triggers.
- **`PUBLISH_TO_GIT`** returns a discriminated `{ ok, … }` result (connection /
  auth failures are expected, non-exceptional outcomes rendered inline), not a
  thrown error.
- Credentials and remote config come from the thoughtbase's own config, which is
  untrusted input — treat a shared `.minerva/config.json` accordingly.
