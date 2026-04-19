---
title: Essential complexity — notes
description: Working notes on the essential/accidental complexity distinction, with a Toulmin-style justification of the claim that tooling alone cannot collapse essence.
status: draft
---

# Essential complexity

## The claim

Most software productivity gains over the past fifty years have attacked
**accidental** complexity — assemblers, garbage collection, high-level languages,
IDEs — rather than the **essential** complexity of modelling the domain itself.
Brooks's core thesis is that because the essential portion dominates modern
systems, no further tooling improvement can produce an order-of-magnitude
productivity jump.

## Grounds

Brooks frames this with a now-famous distinction:

> [[quote::brooks-essential-accidental]]

See [[cite::brooks-1986]] for the full argument.

## Warrant

Toulmin's framework is useful for articulating *why* the grounds above support
the claim: we need an explicit warrant connecting "essence dominates accident"
to "no single tooling improvement buys an order of magnitude."

> [[quote::toulmin-warrants-intro]]

The warrant here is something like: *productivity-gain advances that attack
only the minority component of total effort cannot, by arithmetic alone, move
the total by an order of magnitude.* That warrant is what justifies the
inferential step from [[cite::brooks-1986]]'s data to the "no silver bullet"
conclusion.

## Tags

#software-engineering #epistemology #toulmin
