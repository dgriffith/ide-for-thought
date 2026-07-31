---
title: Upzoning lowers rents
tags: [housing, economics, supply]
status: draft
---

# Upzoning lowers rents

## The claim

The load-bearing claim — <https://minerva.dev/c/claim-upzoning-01> — is that
letting more homes be built on the same land pushes market rents **down**
relative to where they would otherwise sit. This [[rebuts::notes/induced-demand-objection]]
and draws on [[cite::glaeser-2005]].

## Grounds

Across metros, the places that permitted the most new housing per capita over
the last two decades saw the slowest rent growth. See [[quote::glaeser-supply-elasticity]].
Rents are a market-clearing price: hold demand roughly fixed and add units, and
the marginal renter no longer has to bid as high.

## Warrant

The step from "more units were built" to "rents rose more slowly" needs a
warrant: that housing in a metro is enough of a single market that supply added
in one neighborhood relieves price pressure in others (filtering, see
[[notes/glossary/filtering]]). Without that warrant, new luxury units near the
center need not touch rents at the edge.

A simple elasticity sketch: if the rent response to a supply shock is

$$\varepsilon_p = \frac{\partial \ln P}{\partial \ln Q},$$

then a metro with elastic supply ($\varepsilon_p$ near zero) barely moves price
when demand rises, while an inelastic one spikes.

```mermaid
flowchart LR
  Upzoning --> MoreUnits[More units built]
  MoreUnits --> Filtering[Filtering down the quality ladder]
  Filtering --> LowerRents[Lower market rents]
```

## Objection to engage

The strongest objection is that new supply *induces* its own demand by making a
neighborhood more desirable — the position developed in
[[notes/induced-demand-objection]]. Whether that fully offsets the supply effect
is the crux.

```turtle
<https://minerva.dev/c/claim-upzoning-01> a thought:Claim ;
    thought:label "Allowing denser housing lowers rents in the same market" ;
    thought:sourceText "Letting more homes be built on the same land pushes market rents down relative to where they would otherwise sit." .
```

