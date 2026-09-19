---
label: Claim
icon: 🗣️
color: "#89dceb"
externalClass: thought:Claim
properties:
  - name: claimKind
    label: Kind
    type: enum
    options: [factual, evaluative, definitional, predictive]
    predicate: thought:claimKind
  - name: verificationStatus
    label: Verification
    type: enum
    options: [corroborated, contested, unverifiable]
    predicate: thought:verificationStatus
  - name: currencyStatus
    label: Currency
    type: enum
    options: [current, scope-shifted, decayed, misstated]
    predicate: thought:currencyStatus
  - name: asOfDate
    label: As of
    type: date
    predicate: thought:asOfDate
  - name: hasPrimarySource
    label: Primary source
    type: text
    predicate: thought:hasPrimarySource
  - name: supports
    label: Supports
    type: link-to-type
    targetType: claim
    predicate: thought:supports
  - name: rebuts
    label: Rebuts
    type: link-to-type
    targetType: claim
    predicate: thought:rebuts
---

## Assertion

## Notes
